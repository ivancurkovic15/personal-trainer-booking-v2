const mongoose = require('mongoose');

const SessionSchema = new mongoose.Schema({
  date: { type: Date, required: true },
  time: { 
    type: String, 
    required: true,
    validate: {
      validator: function(v) {
        return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(v);
      },
      message: 'Invalid time format. Use HH:MM'
    }
  },
  exerciseType: { 
    type: String, 
    enum: ['body-health', 'regular-training'], 
    required: true 
  },
  maxCapacity: { 
    type: Number, 
    min: 1, 
    max: 4, 
    required: true 
  },
  currentBookings: { type: Number, default: 0, min: 0 },
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  trainer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  description: { 
    type: String, 
    default: '',
    maxLength: 500
  },
  price: { type: Number, required: true, min: 0 },
  packagePrice: { type: Number, required: true, min: 0 },
  packageDuration: { type: Number, default: 90, min: 1 },
  createdAt: { type: Date, default: Date.now }
});

// Method to get available spots
SessionSchema.methods.getAvailableSpots = async function() {
  const Booking = require('./Booking');
  const bookings = await Booking.find({ 
    session: this._id, 
    status: 'confirmed' 
  });
  const totalBooked = bookings.reduce((sum, booking) => sum + booking.groupSize, 0);
  return this.maxCapacity - totalBooked;
};

// Method to check if session has capacity for group size
SessionSchema.methods.hasCapacity = async function(groupSize) {
  const availableSpots = await this.getAvailableSpots();
  return availableSpots >= groupSize;
};

// Static method to get sessions for a date range
SessionSchema.statics.getSessionsInDateRange = function(startDate, endDate) {
  return this.find({
    date: {
      $gte: startDate,
      $lte: endDate
    },
    isActive: true
  }).populate(['createdBy', 'trainer']);
};

// Static method to get sessions by date
SessionSchema.statics.getSessionsByDate = function(date) {
  const startDate = new Date(date);
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + 1);
  
  return this.find({
    date: {
      $gte: startDate,
      $lt: endDate
    },
    isActive: true
  }).populate(['createdBy', 'trainer']);
};

// Index for unique trainer/date/time combinations (allows multiple trainers at same time)
SessionSchema.index({ trainer: 1, date: 1, time: 1 }, { unique: true });
SessionSchema.index({ date: 1 });
SessionSchema.index({ trainer: 1 });

module.exports = mongoose.model('Session', SessionSchema);