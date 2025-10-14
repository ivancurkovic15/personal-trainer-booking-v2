const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const validator = require('validator');

const UserSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true,
    trim: true,
    maxLength: 100
  },
  email: { 
    type: String, 
    required: true, 
    unique: true,
    lowercase: true,
    validate: [validator.isEmail, 'Invalid email address']
  },
  password: { 
    type: String, 
    required: true,
    minLength: 6
  },
  role: { 
    type: String, 
    enum: ['admin', 'client'], 
    default: 'client' 
  },
  phone: { 
    type: String,
    validate: {
      validator: function(v) {
        return !v || validator.isMobilePhone(v, 'any', { strictMode: false });
      },
      message: 'Invalid phone number'
    }
  },
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
  // Package tracking for 8-session packages
  activeSessions: { type: Number, default: 0, min: 0 },
  packageExpiry: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

// Hash password before saving
UserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    this.password = await bcrypt.hash(this.password, saltRounds);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to verify password
UserSchema.methods.verifyPassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to check if user has active package
UserSchema.methods.hasActivePackage = function() {
  return this.activeSessions > 0 && 
         this.packageExpiry && 
         new Date() < this.packageExpiry;
};

// Static method to get clients with package info
UserSchema.statics.getClientsWithPackageInfo = function() {
  return this.find({ role: 'client' }, 'name email phone activeSessions packageExpiry createdAt');
};

// Add indexes for better performance
UserSchema.index({ email: 1 });
UserSchema.index({ resetPasswordToken: 1 });

module.exports = mongoose.model('User', UserSchema);