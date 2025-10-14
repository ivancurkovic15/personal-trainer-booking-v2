const express = require('express');
const validator = require('validator');
const User = require('../models/User');
const Session = require('../models/Session');
const Booking = require('../models/Booking');
const emailService = require('../emailService');
const reminderScheduler = require('../reminderScheduler');

const router = express.Router();

// Helper function
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return validator.escape(input.trim());
}

// Admin dashboard
router.get('/', async (req, res) => {
  try {
    const sessions = await Session.find({}).populate(['createdBy', 'trainer']).sort({ date: 1, time: 1 });
    const bookings = await Booking.find({ status: 'confirmed' }).populate([
      { path: 'session', populate: { path: 'trainer' } },
      'client'
    ]).sort({ createdAt: -1 });
    const trainers = await User.find({ role: 'admin' }, 'name email phone');
    
    // Calculate statistics
    const totalSessions = sessions.length;
    const activeSessions = sessions.filter(s => s.isActive && new Date(s.date) > new Date()).length;
    const totalBookings = bookings.length;
    const totalClients = await User.countDocuments({ role: 'client' });
    
    res.render('admin', { 
      sessions,
      bookings,
      trainers,
      stats: {
        totalSessions,
        activeSessions, 
        totalBookings,
        totalClients
      },
      user: req.user
    });
  } catch (error) {
    console.error('Error loading admin dashboard:', error);
    res.status(500).render('error', { error: 'Error loading admin dashboard' });
  }
});

// Calendar API for admin
router.get('/api/calendar/:year/:month', async (req, res) => {
  try {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month) - 1;
    
    if (isNaN(year) || isNaN(month) || month < 0 || month > 11) {
      return res.status(400).json({ error: 'Invalid year or month' });
    }
    
    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0);
    
    const sessions = await Session.getSessionsInDateRange(startDate, endDate);
    
    const sessionsWithBookings = await Promise.all(
      sessions.map(async (session) => {
        const bookings = await Booking.getSessionBookings(session._id);
        return {
          ...session.toObject(),
          bookings: bookings
        };
      })
    );
    
    res.json(sessionsWithBookings);
  } catch (error) {
    console.error('Error fetching calendar data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get sessions for a specific date (admin)
router.get('/api/sessions/date/:date', async (req, res) => {
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
router.get('/api/session/:id/details', async (req, res) => {
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

// Client package management
router.post('/api/client/:id/add-package', async (req, res) => {
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

router.post('/api/client/:id/reset-package', async (req, res) => {
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

// Email functionality
router.post('/api/send-session-email', async (req, res) => {
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
    
    // Validate all recipient IDs
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

// Test reminder system (admin only)
router.post('/api/test-reminders', async (req, res) => {
  try {
    await reminderScheduler.sendRemindersNow();
    res.json({ success: true, message: 'Reminder check triggered' });
  } catch (error) {
    console.error('Error testing reminders:', error);
    res.status(500).json({ error: 'Error testing reminders' });
  }
});

module.exports = router;