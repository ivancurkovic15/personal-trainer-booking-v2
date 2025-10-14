const jwt = require('jsonwebtoken');
const User = require('./models/User');

// Generate JWT token
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

// Verify JWT token
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

  // Attach user to request
  req.user = decoded;
  res.locals.user = decoded;
  next();
}

// Admin authorization middleware
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).render('error', { error: 'Admin access required' });
  }
  next();
}

// Optional auth - for routes that work with or without login
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

module.exports = {
  generateToken,
  verifyToken,
  requireAuth,
  requireAdmin,
  optionalAuth
};