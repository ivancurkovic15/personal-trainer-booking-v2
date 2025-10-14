const mongoose = require('mongoose');

const BookingSchema = new mongoose.Schema({
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  groupSize: { 
    type: Number, 
    min: 1, 
    max: 4, 
    required: true 
  },
  status: { 
    type: String, 
    enum: ['confirmed', 'cancelled'], 
    default: 'confirmed' 
  },
  notes: { 
    type: String, 
    default: '',
    maxLength: 1000
  },
  reminderSent: { type: Boolean, default: false },
  canCancel: { type: Boolean, default: true },
  cancellationDeadline: { type: Date },
  isPackageBooking: { type: Boolean, default: false },
  packageId: { type: String },
  sessionNumber: { type: Number, min: 1, max: 8 },
  createdAt: { type: Date, default: Date.now }
});

// Method to check if booking can be cancelled
BookingSchema.methods.isCancellable = function() {
  return new Date() < this.cancellationDeadline;
};

// Method to calculate cancellation deadline
BookingSchema.methods.calculateCancellationDeadline = async function() {
  const Session = require('./Session');
  const session = await Session.findById(this.session);
  if (session) {
    const sessionDate = new Date(session.date);
    const [hours, minutes] = session.time.split(':');
    sessionDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
    
    // 24 hours before session time
    return new Date(sessionDate.getTime() - (24 * 60 * 60 * 1000));
  }
  return null;
};

// Pre-save middleware to calculate cancellation deadline
BookingSchema.pre('save', async function(next) {
  if (this.isNew) {
    try {
      this.cancellationDeadline = await this.calculateCancellationDeadline();
      this.canCancel = this.cancellationDeadline && new Date() < this.cancellationDeadline;
    } catch (error) {
      console.error('Error calculating cancellation deadline:', error);
    }
  }
  next();
});

// Static method to get bookings for a client
BookingSchema.statics.getClientBookings = function(clientId, status = 'confirmed') {
  return this.find({ client: clientId, status }).populate({
    path: 'session',
    populate: { path: 'trainer' }
  }).sort({ createdAt: -1 });
};

// Static method to get bookings for a session
BookingSchema.statics.getSessionBookings = function(sessionId, status = 'confirmed') {
  return this.find({ session: sessionId, status }).populate('client');
};

// Static method to get all bookings with full details for admin
BookingSchema.statics.getAllBookingsWithDetails = function(status = 'confirmed') {
  return this.find({ status }).populate([
    { path: 'session', populate: { path: 'trainer' } },
    'client'
  ]).sort({ createdAt: -1 });
};

// Add indexes for better performance
BookingSchema.index({ session: 1, client: 1 });
BookingSchema.index({ client: 1, status: 1 });
BookingSchema.index({ session: 1, status: 1 });

module.exports = mongoose.model('Booking', BookingSchema);