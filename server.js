// Load environment variables first
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const validator = require('validator');
const crypto = require('crypto');
const User = require('./models/User');
const Session = require('./models/Session');
const Booking = require('./models/Booking');

// Import email service and reminder scheduler
const emailService = require('./emailService');
const reminderScheduler = require('./reminderScheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// Validate required environment variables
const requiredEnvVars = ['MONGODB_URI', 'JWT_SECRET', 'EMAIL_HOST', 'EMAIL_USER', 'EMAIL_PASS'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Allow inline styles from EJS
  crossOriginEmbedderPolicy: false
}));

// Rate limiting
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: 'Too many password reset requests, please try again later.',
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});

app.use(generalLimiter);

// MongoDB connection with better error handling
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  console.log('Connected to MongoDB successfully');
  reminderScheduler.initializeScheduler(Session, Booking, User);
  console.log('Reminder scheduler initialized');
})
.catch((error) => {
  console.error('MongoDB connection error:', error);
  process.exit(1);
});

// Handle MongoDB connection events
mongoose.connection.on('error', (error) => {
  console.error('MongoDB connection error:', error);
});

mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB disconnected. Attempting to reconnect...');
});

// Middleware setup
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

// Helper functions
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return validator.escape(input.trim());
}

function generateToken(user) {
  return jwt.sign(
    { 
      id: user._id, 
      email: user.email, 
      role: user.role 
    },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return null;
  }
}

// Authentication middleware
function requireAuth(req, res, next) {
  const token = req.cookies?.token;

  if (!token) {
    return res.redirect('/login');
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    res.clearCookie('token');
    return res.redirect('/login');
  }

  req.user = decoded;
  res.locals.user = decoded;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).render('error', { error: 'Admin access required' });
  }
  next();
}

function optionalAuth(req, res, next) {
  const token = req.cookies?.token;

  if (token) {
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = decoded;
      res.locals.user = decoded;
    }
  }
  next();
}

// ============= AUTH ROUTES =============

// Login page (public)
app.get('/login', (req, res) => {
  if (req.cookies.token) {
    const decoded = verifyToken(req.cookies.token);
    if (decoded) {
      return decoded.role === 'admin' ? res.redirect('/admin') : res.redirect('/');
    }
  }
  res.render('login');
});

// Login POST route
app.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).render('login', { error: 'Email and password are required' });
    }
    
    if (!validator.isEmail(email)) {
      return res.status(400).render('login', { error: 'Please enter a valid email address' });
    }
    
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(400).render('login', { error: 'Invalid email or password' });
    }
    
    const isMatch = await user.verifyPassword(password);
    if (!isMatch) {
      return res.status(400).render('login', { error: 'Invalid email or password' });
    }
    
    const token = generateToken(user);
    
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });
    
    if (user.role === 'admin') {
      res.redirect('/admin');
    } else {
      res.redirect('/');
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).render('login', { error: 'An error occurred during login' });
  }
});

// Register page (public)
app.get('/register', (req, res) => {
  if (req.cookies.token) {
    const decoded = verifyToken(req.cookies.token);
    if (decoded) {
      return decoded.role === 'admin' ? res.redirect('/admin') : res.redirect('/');
    }
  }
  res.render('login');
});

// Register POST route
app.post('/register', async (req, res) => {
  try {
    const { name, email, password, phone, role } = req.body;
    
    const errors = [];
    
    if (!name || name.trim().length < 2) {
      errors.push('Name must be at least 2 characters long');
    }
    
    if (!email || !validator.isEmail(email)) {
      errors.push('Please enter a valid email address');
    }
    
    if (!password || password.length < 6) {
      errors.push('Password must be at least 6 characters long');
    }
    
    if (phone && !validator.isMobilePhone(phone, 'any', { strictMode: false })) {
      errors.push('Please enter a valid phone number');
    }
    
    if (!role || !['admin', 'client'].includes(role)) {
      errors.push('Please select a valid account type');
    }
    
    if (errors.length > 0) {
      return res.status(400).render('login', { error: errors.join(', ') });
    }
    
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).render('login', { error: 'Email already registered' });
    }
    
    const user = new User({
      name: sanitizeInput(name),
      email: email.toLowerCase(),
      password: password,
      phone: phone ? sanitizeInput(phone) : '',
      role: role
    });
    
    await user.save();
    
    const token = generateToken(user);
    
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });
    
    if (user.role === 'admin') {
      res.redirect('/admin');
    } else {
      res.redirect('/');
    }
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).render('login', { error: 'An error occurred during registration' });
  }
});

// Forgot password page
app.get('/forgot-password', (req, res) => {
  res.render('forgot-password');
});

// Forgot password POST
app.post('/forgot-password', passwordResetLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email || !validator.isEmail(email)) {
      return res.render('forgot-password', { 
        error: 'Please enter a valid email address' 
      });
    }
    
    const user = await User.findOne({ email: email.toLowerCase() });
    
    const successMessage = 'If an account with that email exists, a password reset link has been sent.';
    
    if (!user) {
      return res.render('forgot-password', { message: successMessage });
    }
    
    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 3600000;
    await user.save();
    
    try {
      await emailService.sendPasswordReset(user, resetToken);
      res.render('forgot-password', { message: successMessage });
    } catch (emailError) {
      console.error('Error sending reset email:', emailError);
      res.render('forgot-password', { 
        error: 'Error sending reset email. Please try again.' 
      });
    }
  } catch (error) {
    console.error('Forgot password error:', error);
    res.render('forgot-password', { 
      error: 'An error occurred. Please try again.' 
    });
  }
});

// Reset password page
app.get('/reset-password', (req, res) => {
  const token = req.query.token;
  if (!token) {
    return res.render('reset-password', { error: 'Invalid reset link' });
  }
  res.render('reset-password', { token });
});

// Reset password POST
app.post('/reset-password', async (req, res) => {
  try {
    const { token, password, confirmPassword } = req.body;
    
    if (!password || password.length < 6) {
      return res.render('reset-password', { 
        token, 
        error: 'Password must be at least 6 characters long' 
      });
    }
    
    if (password !== confirmPassword) {
      return res.render('reset-password', { 
        token, 
        error: 'Passwords do not match' 
      });
    }
    
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });
    
    if (!user) {
      return res.render('reset-password', { 
        error: 'Password reset token is invalid or has expired' 
      });
    }
    
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    
    res.render('reset-password', { 
      success: 'Password has been reset successfully. You can now log in.' 
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.render('reset-password', { 
      token: req.body.token,
      error: 'An error occurred. Please try again.' 
    });
  }
});

// Logout
// Logout
app.get('/logout', (req, res) => {
  try {
    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });
    res.redirect('/login');
  } catch (error) {
    console.error('Logout error:', error);
    res.redirect('/login');
  }
});

// ============= END AUTH ROUTES =============

// Home route
app.get('/', requireAuth, async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      return res.redirect('/admin');
    }
    
    const sessions = await Session.find({ isActive: true }).populate(['createdBy', 'trainer']);
    const bookings = await Booking.find({ client: req.user.id, status: 'confirmed' }).populate({
      path: 'session',
      populate: { path: 'trainer' }
    });
    
    res.render('index', { 
      sessions, 
      bookings, 
      user: req.user,
      moment: require('moment')
    });
  } catch (error) {
    console.error('Error loading home page:', error);
    res.status(500).render('error', { error: 'Error loading page' });
  }
});

// Admin dashboard
app.get('/admin', requireAuth, requireAdmin, async (req, res) => {
  try {
    const sessions = await Session.find({}).populate(['createdBy', 'trainer']).sort({ date: 1, time: 1 });
    const bookings = await Booking.find({ status: 'confirmed' }).populate([
      { path: 'session', populate: { path: 'trainer' } },
      'client'
    ]).sort({ createdAt: -1 });
    const trainers = await User.find({ role: 'admin' }, 'name email phone');
    
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
      moment: require('moment'),
      user: req.user
    });
  } catch (error) {
    console.error('Error loading admin dashboard:', error);
    res.status(500).render('error', { error: 'Error loading admin dashboard' });
  }
});

// Mount API routes with authentication middleware
app.use('/api', requireAuth, require('./routes/api'));

// Calendar API (admin only)
app.get('/api/calendar/:year/:month', requireAuth, requireAdmin, async (req, res) => {
  try {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month) - 1;
    
    if (isNaN(year) || isNaN(month) || month < 0 || month > 11) {
      return res.status(400).json({ error: 'Invalid year or month' });
    }
    
    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0);
    
    const sessions = await Session.find({
      date: {
        $gte: startDate,
        $lte: endDate
      },
      isActive: true
    }).populate(['createdBy', 'trainer']);
    
    const sessionsWithBookings = await Promise.all(
      sessions.map(async (session) => {
        const bookings = await Booking.find({ 
          session: session._id, 
          status: 'confirmed' 
        }).populate('client');
        
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

// Redirect /trainer to /admin for backwards compatibility
app.get('/trainer', requireAuth, requireAdmin, (req, res) => {
  res.redirect('/admin');
});

// Health check endpoint for monitoring
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', { error: 'Page not found' });
});

// Global error handling
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  
  const isDevelopment = process.env.NODE_ENV === 'development';
  const errorMessage = isDevelopment ? error.message : 'Internal server error';
  
  if (res.headersSent) {
    return next(error);
  }
  
  res.status(500).render('error', { error: errorMessage });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
  console.log(`${signal} received, shutting down gracefully`);
  server.close(() => {
    mongoose.connection.close(false, () => {
      console.log('MongoDB connection closed');
      process.exit(0);
    });
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = app;