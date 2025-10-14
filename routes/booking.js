const express = require('express');
const User = require('../models/User');
const Session = require('../models/Session');
const Booking = require('../models/Booking');

const router = express.Router();

// Booking page - could be used for a dedicated booking interface
router.get('/', async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      return res.redirect('/admin');
    }
    
    // Get upcoming sessions
    const sessions = await Session.find({ 
      isActive: true,
      date: { $gte: new Date() }
    }).populate(['createdBy', 'trainer']).sort({ date: 1, time: 1 });
    
    // Get user's current bookings
    const bookings = await Booking.getClientBookings(req.user.id);
    
    res.render('booking', { 
      sessions, 
      bookings, 
      user: req.user,
      moment: require('moment')
    });
  } catch (error) {
    console.error('Error loading booking page:', error);
    res.status(500).render('error', { error: 'Error loading booking page' });
  }
});

// Get user's bookings (API endpoint)
router.get('/api/my-bookings', async (req, res) => {
  try {
    const bookings = await Booking.getClientBookings(req.user.id);
    res.json({ success: true, bookings });
  } catch (error) {
    console.error('Error fetching user bookings:', error);
    res.status(500).json({ error: 'Error fetching bookings' });
  }
});

// Get user's package information
router.get('/api/my-package', async (req, res) => {
  try {
    const user = await User.findById(req.user.id, 'activeSessions packageExpiry');
    
    const packageInfo = {
      hasActivePackage: user.hasActivePackage(),
      activeSessions: user.activeSessions || 0,
      packageExpiry: user.packageExpiry,
      isExpired: user.packageExpiry && new Date() > new Date(user.packageExpiry)
    };
    
    res.json({ success: true, packageInfo });
  } catch (error) {
    console.error('Error fetching package info:', error);
    res.status(500).json({ error: 'Error fetching package information' });
  }
});

module.exports = router;