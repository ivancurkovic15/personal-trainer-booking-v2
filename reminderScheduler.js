const cron = require('node-cron');
const mongoose = require('mongoose');
const emailService = require('./emailService');

// Import models (will be initialized by server.js)
let Session, Booking, User;

function initializeScheduler(sessionModel, bookingModel, userModel) {
  Session = sessionModel;
  Booking = bookingModel;
  User = userModel;

  // Schedule reminder emails to run every 15 minutes
  // This checks for sessions starting in 2 hours
  cron.schedule('*/15 * * * *', async () => {
    console.log('Running reminder email check...');
    await sendSessionReminders();
  });

  console.log('Reminder scheduler initialized - checking every 15 minutes');
}

async function sendSessionReminders() {
  try {
    // Calculate the time 2 hours from now with a 15-minute window
    const now = new Date();
    const twoHoursFromNow = new Date(now.getTime() + (2 * 60 * 60 * 1000));
    const startWindow = new Date(twoHoursFromNow.getTime() - (7 * 60 * 1000)); // 7 minutes before
    const endWindow = new Date(twoHoursFromNow.getTime() + (8 * 60 * 1000)); // 8 minutes after

    console.log(`Checking for sessions between ${startWindow.toISOString()} and ${endWindow.toISOString()}`);

    // Find sessions starting in approximately 2 hours
    const upcomingSessions = await Session.find({
      date: {
        $gte: new Date(startWindow.getFullYear(), startWindow.getMonth(), startWindow.getDate()),
        $lte: new Date(endWindow.getFullYear(), endWindow.getMonth(), endWindow.getDate())
      },
      isActive: true
    }).populate('trainer');

    for (const session of upcomingSessions) {
      try {
        // Create session datetime by combining date and time
        const sessionDate = new Date(session.date);
        const [hours, minutes] = session.time.split(':');
        const sessionDateTime = new Date(
          sessionDate.getFullYear(),
          sessionDate.getMonth(),
          sessionDate.getDate(),
          parseInt(hours),
          parseInt(minutes),
          0,
          0
        );

        // Check if this session is in our 2-hour window
        if (sessionDateTime >= startWindow && sessionDateTime <= endWindow) {
          console.log(`Found session at ${sessionDateTime.toISOString()} - sending reminders`);

          // Find all confirmed bookings for this session that haven't had reminders sent
          const bookings = await Booking.find({
            session: session._id,
            status: 'confirmed',
            reminderSent: { $ne: true }
          }).populate('client');

          if (bookings.length === 0) {
            console.log('No bookings found or all reminders already sent for this session');
            continue;
          }

          // Send reminder to each client
          for (const booking of bookings) {
            try {
              const result = await emailService.sendSessionReminder(booking, session, booking.client);
              console.log(`Reminder sent to ${booking.client.email}:`, result.success);

              // Mark that reminder was sent to avoid duplicates
              if (result.success) {
                booking.reminderSent = true;
                await booking.save();
                console.log(`Marked reminder as sent for booking ${booking._id}`);
              }
            } catch (error) {
              console.error(`Failed to send reminder to ${booking.client.email}:`, error);
            }
          }
        }
      } catch (sessionError) {
        console.error(`Error processing session ${session._id}:`, sessionError);
      }
    }
  } catch (error) {
    console.error('Error in sendSessionReminders:', error);
  }
}

// Manual function to send reminders (for testing)
async function sendRemindersNow() {
  console.log('Manually triggering reminder check...');
  await sendSessionReminders();
}

// Function to reset reminder flags (useful for testing)
async function resetReminderFlags() {
  try {
    const result = await Booking.updateMany(
      { reminderSent: true },
      { $unset: { reminderSent: 1 } }
    );
    console.log(`Reset reminder flags for ${result.modifiedCount} bookings`);
    return result;
  } catch (error) {
    console.error('Error resetting reminder flags:', error);
    throw error;
  }
}

// Function to get upcoming sessions (for debugging)
async function getUpcomingSessions(hoursAhead = 2) {
  try {
    const now = new Date();
    const futureTime = new Date(now.getTime() + (hoursAhead * 60 * 60 * 1000));
    
    const sessions = await Session.find({
      date: {
        $gte: now,
        $lte: futureTime
      },
      isActive: true
    }).populate(['trainer']);

    return sessions;
  } catch (error) {
    console.error('Error getting upcoming sessions:', error);
    throw error;
  }
}

module.exports = {
  initializeScheduler,
  sendRemindersNow,
  resetReminderFlags,
  getUpcomingSessions
};