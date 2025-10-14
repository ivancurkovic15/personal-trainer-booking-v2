const express = require('express');
const validator = require('validator');
const User = require('../models/User');
const Session = require('../models/Session');
const Booking = require('../models/Booking');
const emailService = require('../emailService');

const router = express.Router();

// Helper function
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return validator.escape(input.trim());
}

// Middleware for authentication (reuse from server)
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Get sessions for a specific date (public with auth)
router.get('/sessions/:date', requireAuth, async (req, res) => {
  try {
    const date = req.params.date;
    
    if (!validator.isISO8601(date)) {
      return res.status(400).json({ error: 'Invalid date format' });
    }
    
    const sessions = await Session.getSessionsByDate(date);
    
    const sessionsWithBookings = await Promise.all(
      sessions.map(async (session) => {
        const availableSpots = await session.getAvailableSpots();
        return {
          ...session.toObject(),
          spotsLeft: availableSpots,
          currentBookings: session.maxCapacity - availableSpots
        };
      })
    );
    
    res.json(sessionsWithBookings);
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get sessions for date (admin view)
router.get('/sessions/date/:date', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!validator.isISO8601(req.params.date)) {
      return res.status(400).json({ error: 'Invalid date format' });
    }
    
    const date = new Date(req.params.date);
    const nextDay = new Date(date);
    nextDay.setDate(date.getDate() + 1);
    
    const sessions = await Session.find({
      date: {
        $gte: date,
        $lt: nextDay
      },
      isActive: true
    }).populate(['createdBy', 'trainer']).sort({ time: 1 });
    
    const sessionsWithDetails = await Promise.all(
      sessions.map(async (session) => {
        const bookings = await Booking.getSessionBookings(session._id);
        const availableSpots = await session.getAvailableSpots();
        
        return {
          ...session.toObject(),
          bookings: bookings,
          currentBookings: session.maxCapacity - availableSpots,
          spotsLeft: availableSpots
        };
      })
    );
    
    res.json(sessionsWithDetails);
  } catch (error) {
    console.error('Error fetching sessions for date:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get session details (admin)
router.get('/session/:id/details', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!validator.isMongoId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid session ID' });
    }
    
    const session = await Session.findById(req.params.id).populate(['createdBy', 'trainer']);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const bookings = await Booking.getSessionBookings(session._id);
    const availableSpots = await session.getAvailableSpots();
    
    res.json({
      ...session.toObject(),
      bookings: bookings,
      currentBookings: session.maxCapacity - availableSpots,
      spotsLeft: availableSpots
    });
  } catch (error) {
    console.error('Error fetching session details:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create session (admin only)
router.post('/session', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { date, time, exerciseType, maxCapacity, trainerId, description } = req.body;
    
    // Validation
    const errors = [];
    if (!date || !validator.isISO8601(date)) errors.push('Valid date is required');
    if (!time || !/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time)) errors.push('Valid time in HH:MM format is required');
    if (!exerciseType || !['body-health', 'regular-training'].includes(exerciseType)) errors.push('Valid exercise type is required');
    if (!maxCapacity || !validator.isInt(maxCapacity.toString(), { min: 1, max: 4 })) errors.push('Max capacity must be between 1 and 4');
    if (!trainerId || !validator.isMongoId(trainerId)) errors.push('Valid trainer ID is required');
    
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join(', ') });
    }
    
    const trainer = await User.findOne({ _id: trainerId, role: 'admin' });
    if (!trainer) {
      return res.status(400).json({ error: 'Invalid trainer selected' });
    }
    
    const existingSession = await Session.findOne({ 
      trainer: trainerId,
      date: new Date(date), 
      time 
    });
    
    if (existingSession) {
      return res.status(400).json({ error: 'Trainer already has a session at this date and time' });
    }
    
    const session = new Session({
      date: new Date(date),
      time,
      exerciseType,
      maxCapacity: parseInt(maxCapacity),
      trainer: trainerId,
      description: sanitizeInput(description) || '',
      price: 50,
      packagePrice: 200,
      packageDuration: 90,
      createdBy: req.user.id
    });
    
    await session.save();
    res.json({ success: true, session });
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(400).json({ error: 'Error creating session' });
  }
});

// Create booking
router.post('/booking', requireAuth, async (req, res) => {
  try {
    const { sessionId, groupSize, isPackageBooking, packageId, sessionNumber } = req.body;
    
    if (req.user.role === 'admin') {
      return res.status(403).json({ error: 'Admins cannot book sessions' });
    }
    
    if (!validator.isMongoId(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID' });
    }
    
    if (!validator.isInt(groupSize.toString(), { min: 1, max: 4 })) {
      return res.status(400).json({ error: 'Group size must be between 1 and 4' });
    }
    
    const session = await Session.findById(sessionId).populate(['createdBy', 'trainer']);
    if (!session || !session.isActive) {
      return res.status(400).json({ error: 'Session not available' });
    }
    
    if (!(await session.hasCapacity(parseInt(groupSize)))) {
      return res.status(400).json({ error: 'Not enough spots available' });
    }
    
    const booking = new Booking({
      session: sessionId,
      client: req.user.id,
      groupSize: parseInt(groupSize),
      isPackageBooking: isPackageBooking || false,
      packageId: packageId || null,
      sessionNumber: sessionNumber ? parseInt(sessionNumber) : null
    });
    
    await booking.save();
    
    if (isPackageBooking) {
      await User.findByIdAndUpdate(req.user.id, {
        $inc: { activeSessions: 1 },
        $set: { packageExpiry: new Date(Date.now() + (session.packageDuration * 24 * 60 * 60 * 1000)) }
      });
    }
    
    try {
      const user = await User.findById(req.user.id);
      const emailResult = await emailService.sendBookingConfirmation(
        booking, 
        session, 
        user, 
        session.trainer
      );
      console.log('Booking confirmation emails sent:', emailResult);
    } catch (emailError) {
      console.error('Error sending confirmation emails:', emailError);
    }
    
    res.json({ success: true, booking });
  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(400).json({ error: 'Error creating booking' });
  }
});

// Delete session (admin only)
router.delete('/session/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!validator.isMongoId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid session ID' });
    }
    
    const bookings = await Booking.find({ session: req.params.id, status: 'confirmed' })
      .populate([
        { path: 'session', populate: { path: 'trainer' } },
        'client'
      ]);
    
    for (const booking of bookings) {
      try {
        await emailService.sendCancellationNotification(
          booking, 
          booking.session, 
          booking.client
        );
      } catch (emailError) {
        console.error('Error sending cancellation email:', emailError);
      }
    }
    
    await Booking.deleteMany({ session: req.params.id });
    await Session.findByIdAndDelete(req.params.id);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting session:', error);
    res.status(400).json({ error: 'Error deleting session' });
  }
});

// Delete booking
router.delete('/booking/:id', requireAuth, async (req, res) => {
  try {
    if (!validator.isMongoId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid booking ID' });
    }
    
    const booking = await Booking.findById(req.params.id).populate([
      { path: 'session', populate: { path: 'trainer' } },
      'client'
    ]);
    
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    if (req.user.role !== 'admin' && booking.client._id.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    if (req.user.role !== 'admin' && !booking.isCancellable()) {
      return res.status(400).json({ 
        error: 'Cannot cancel booking within 24 hours of the session time' 
      });
    }
    
    if (booking.isPackageBooking) {
      await User.findByIdAndUpdate(booking.client._id, {
        $inc: { activeSessions: -1 }
      });
    }
    
    try {
      await emailService.sendCancellationNotification(
        booking, 
        booking.session, 
        booking.client
      );
    } catch (emailError) {
      console.error('Error sending cancellation email:', emailError);
    }
    
    await Booking.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting booking:', error);
    res.status(400).json({ error: 'Error deleting booking' });
  }
});

// Get trainers (admin only)
router.get('/trainers', requireAuth, requireAdmin, async (req, res) => {
  try {
    const trainers = await User.find({ role: 'admin' }, 'name email phone');
    res.json(trainers);
  } catch (error) {
    console.error('Error fetching trainers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get clients (admin only)
router.get('/clients', requireAuth, requireAdmin, async (req, res) => {
  try {
    const clients = await User.getClientsWithPackageInfo();
    res.json(clients);
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update booking notes (admin only)
router.put('/booking/:id/notes', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!validator.isMongoId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid booking ID' });
    }
    
    const { notes } = req.body;
    const sanitizedNotes = sanitizeInput(notes) || '';
    
    const booking = await Booking.findByIdAndUpdate(
      req.params.id,
      { notes: sanitizedNotes },
      { new: true }
    ).populate('client', 'name email phone');
    
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    res.json({ success: true, booking });
  } catch (error) {
    console.error('Error updating booking notes:', error);
    res.status(400).json({ error: 'Error updating notes' });
  }
});

// Client package management (admin only)
router.post('/client/:id/add-package', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!validator.isMongoId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid client ID' });
    }
    
    const client = await User.findById(req.params.id);
    
    if (!client || client.role !== 'client') {
      return res.status(404).json({ error: 'Client not found' });
    }

    const updatedClient = await User.findByIdAndUpdate(req.params.id, {
      $inc: { activeSessions: 8 },
      $set: { packageExpiry: new Date(Date.now() + (90 * 24 * 60 * 60 * 1000)) }
    }, { new: true });

    res.json({ success: true, client: updatedClient });
  } catch (error) {
    console.error('Error adding package:', error);
    res.status(400).json({ error: 'Error adding package' });
  }
});

router.post('/client/:id/reset-package', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!validator.isMongoId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid client ID' });
    }
    
    const updatedClient = await User.findByIdAndUpdate(req.params.id, {
      $set: { 
        activeSessions: 0,
        packageExpiry: null 
      }
    }, { new: true });

    if (!updatedClient) {
      return res.status(404).json({ error: 'Client not found' });
    }

    res.json({ success: true, client: updatedClient });
  } catch (error) {
    console.error('Error resetting package:', error);
    res.status(400).json({ error: 'Error resetting package' });
  }
});

// Email functionality (admin only)
router.post('/send-session-email', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { sessionId, subject, message, recipients } = req.body;
    
    if (!sessionId || !subject || !message || !recipients || recipients.length === 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (!validator.isMongoId(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID' });
    }
    
    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    for (const recipientId of recipients) {
      if (!validator.isMongoId(recipientId)) {
        return res.status(400).json({ error: 'Invalid recipient ID' });
      }
    }
    
    const recipientUsers = await User.find({ _id: { $in: recipients } });
    const sanitizedSubject = sanitizeInput(subject);
    const sanitizedMessage = sanitizeInput(message);
    
    const results = await emailService.sendBulkCustomMessage(recipientUsers, sanitizedSubject, sanitizedMessage);
    
    res.json({ success: true, results });
  } catch (error) {
    console.error('Error sending session email:', error);
    res.status(500).json({ error: 'Error sending email' });
  }
});

module.exports = router;