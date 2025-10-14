const nodemailer = require('nodemailer');
const validator = require('validator');

// Create transporter with retry logic
function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    // Add connection pooling for better performance
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
  });
}

const transporter = createTransporter();

// Verify email service on startup with better error handling
transporter.verify()
  .then(() => {
    console.log('Email service ready');
  })
  .catch((error) => {
    console.error('Email service configuration error:', error);
    console.log('Email functionality may not work properly');
  });

// Helper function to format dates consistently
function formatDate(date) {
  return new Date(date).toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
}

// Sanitize email content to prevent injection
function sanitizeEmailContent(content) {
  if (typeof content !== 'string') return '';
  return validator.escape(content).replace(/\n/g, '<br>');
}

const emailTemplates = {
  bookingConfirmation: (booking, session, client) => ({
    subject: 'Booking Confirmation - Your Training Session is Confirmed!',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #4CAF50; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0;">Booking Confirmed!</h1>
        </div>
        <div style="background: white; padding: 30px; border: 1px solid #ddd; border-radius: 0 0 8px 8px;">
          <h2 style="color: #333;">Hi ${sanitizeEmailContent(client.name)}!</h2>
          <p>Your training session has been successfully booked. Here are the details:</p>
          
          <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #4CAF50; margin-top: 0;">Session Details</h3>
            <p><strong>Date:</strong> ${formatDate(session.date)}</p>
            <p><strong>Time:</strong> ${sanitizeEmailContent(session.time)}</p>
            <p><strong>Exercise Type:</strong> ${session.exerciseType === 'body-health' ? 'Body Health' : 'Regular Training'}</p>
            <p><strong>Group Size:</strong> ${booking.groupSize} ${booking.groupSize === 1 ? 'person' : 'people'}</p>
            ${session.trainer ? `<p><strong>Trainer:</strong> ${sanitizeEmailContent(session.trainer.name)}</p>` : ''}
          </div>
          
          <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0; color: #856404;"><strong>Cancellation Policy:</strong> You can cancel your booking up to 24 hours before the session time.</p>
          </div>
          
          <p style="color: #666;">You'll receive a reminder email 2 hours before your session.</p>
        </div>
      </div>
    `,
    text: `Hi ${client.name}! Your training session has been confirmed for ${formatDate(session.date)} at ${session.time}. Exercise Type: ${session.exerciseType === 'body-health' ? 'Body Health' : 'Regular Training'}. Group Size: ${booking.groupSize}.`
  }),

  cancellationNotification: (booking, session, client) => ({
    subject: 'Booking Cancelled - Training Session',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #dc3545; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0;">Booking Cancelled</h1>
        </div>
        <div style="background: white; padding: 30px; border: 1px solid #ddd; border-radius: 0 0 8px 8px;">
          <h2 style="color: #333;">Hi ${sanitizeEmailContent(client.name)},</h2>
          <p>Your training session has been cancelled.</p>
          <p><strong>Session Details:</strong></p>
          <p>Date: ${formatDate(session.date)}</p>
          <p>Time: ${sanitizeEmailContent(session.time)}</p>
          <p>Exercise Type: ${session.exerciseType === 'body-health' ? 'Body Health' : 'Regular Training'}</p>
          
          <p style="color: #666;">If you have any questions, please contact us.</p>
        </div>
      </div>
    `,
    text: `Hi ${client.name}, Your training session for ${formatDate(session.date)} at ${session.time} has been cancelled.`
  }),

  sessionReminder: (booking, session, client) => ({
    subject: 'Reminder: Your Training Session Starts in 2 Hours!',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #FF9800; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0;">Session Reminder</h1>
        </div>
        <div style="background: white; padding: 30px; border: 1px solid #ddd; border-radius: 0 0 8px 8px;">
          <h2 style="color: #333;">Hi ${sanitizeEmailContent(client.name)}!</h2>
          <p><strong>Your training session starts in 2 hours!</strong></p>
          
          <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p><strong>Date:</strong> ${formatDate(session.date)}</p>
            <p><strong>Time:</strong> ${sanitizeEmailContent(session.time)}</p>
            <p><strong>Exercise Type:</strong> ${session.exerciseType === 'body-health' ? 'Body Health' : 'Regular Training'}</p>
            <p><strong>Group Size:</strong> ${booking.groupSize} ${booking.groupSize === 1 ? 'person' : 'people'}</p>
            ${session.trainer ? `<p><strong>Trainer:</strong> ${sanitizeEmailContent(session.trainer.name)}</p>` : ''}
          </div>
          
          <p style="color: #666;">See you soon!</p>
        </div>
      </div>
    `,
    text: `Hi ${client.name}! Your training session starts in 2 hours! Date: ${formatDate(session.date)} Time: ${session.time}`
  }),

  trainerNotification: (booking, session, client) => ({
    subject: 'New Booking: Client Booked Your Training Session',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #2196F3; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0;">New Booking Alert</h1>
        </div>
        <div style="background: white; padding: 30px; border: 1px solid #ddd; border-radius: 0 0 8px 8px;">
          <h2 style="color: #333;">New Session Booking!</h2>
          
          <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p><strong>Client:</strong> ${sanitizeEmailContent(client.name)} (${sanitizeEmailContent(client.email)})</p>
            <p><strong>Date:</strong> ${formatDate(session.date)}</p>
            <p><strong>Time:</strong> ${sanitizeEmailContent(session.time)}</p>
            <p><strong>Exercise Type:</strong> ${session.exerciseType === 'body-health' ? 'Body Health' : 'Regular Training'}</p>
            <p><strong>Group Size:</strong> ${booking.groupSize} ${booking.groupSize === 1 ? 'person' : 'people'}</p>
            ${client.phone ? `<p><strong>Phone:</strong> ${sanitizeEmailContent(client.phone)}</p>` : ''}
          </div>
          
          ${booking.isPackageBooking ? `
            <div style="background: #e8f4f8; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 0; color: #0c5460;"><strong>Package Booking:</strong> This is session ${booking.sessionNumber}/8</p>
            </div>
          ` : ''}
        </div>
      </div>
    `,
    text: `New Booking! Client: ${client.name} (${client.email}) Session: ${formatDate(session.date)} at ${session.time} Group Size: ${booking.groupSize}`
  }),

  passwordReset: (user, resetToken) => ({
    subject: 'Password Reset Request - Personal Trainer Booking',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #6c757d; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0;">Password Reset</h1>
        </div>
        <div style="background: white; padding: 30px; border: 1px solid #ddd; border-radius: 0 0 8px 8px;">
          <h2 style="color: #333;">Hi ${sanitizeEmailContent(user.name)},</h2>
          <p>You requested a password reset for your account. Click the link below to reset your password:</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.APP_URL}/reset-password?token=${resetToken}" 
               style="background: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
               Reset Password
            </a>
          </div>
          
          <p style="color: #666;">This link expires in 1 hour for security reasons.</p>
          <p style="color: #666; font-size: 0.9em;">If you didn't request this password reset, please ignore this email.</p>
        </div>
      </div>
    `,
    text: `Hi ${user.name}, Visit this link to reset your password: ${process.env.APP_URL}/reset-password?token=${resetToken} This link expires in 1 hour.`
  }),

  customMessage: (recipient, subject, message) => ({
    subject: sanitizeEmailContent(subject),
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #4CAF50; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0;">Message from Your Trainer</h1>
        </div>
        <div style="background: white; padding: 30px; border: 1px solid #ddd; border-radius: 0 0 8px 8px;">
          <h2 style="color: #333;">Hi ${sanitizeEmailContent(recipient.name)}!</h2>
          <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0; white-space: pre-wrap;">${sanitizeEmailContent(message)}</div>
          <p style="color: #666;">Best regards, Your Personal Trainer</p>
        </div>
      </div>
    `,
    text: `Hi ${recipient.name}!\n\n${message}\n\nBest regards, Your Personal Trainer`
  })
};

// Enhanced send email function with retry logic
async function sendEmail(to, template, maxRetries = 3) {
  if (!validator.isEmail(to)) {
    throw new Error('Invalid email address');
  }

  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to: to,
    subject: template.subject,
    text: template.text,
    html: template.html,
  };

  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await transporter.sendMail(mailOptions);
      console.log(`Email sent successfully to ${to}:`, result.messageId);
      return { success: true, messageId: result.messageId };
    } catch (error) {
      lastError = error;
      console.error(`Email attempt ${attempt}/${maxRetries} failed to ${to}:`, error.message);
      
      if (attempt < maxRetries) {
        // Wait before retrying (exponential backoff)
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  console.error(`All email attempts failed to ${to}:`, lastError);
  return { success: false, error: lastError.message };
}

const emailService = {
  async sendBookingConfirmation(booking, session, client, trainer) {
    try {
      const template = emailTemplates.bookingConfirmation(booking, session, client);
      const clientResult = await sendEmail(client.email, template);
      
      let trainerResult = { success: true, message: 'No trainer email sent' };
      if (trainer && trainer.email && trainer.email !== client.email) {
        const trainerTemplate = emailTemplates.trainerNotification(booking, session, client);
        trainerResult = await sendEmail(trainer.email, trainerTemplate);
      }
      
      return { clientResult, trainerResult };
    } catch (error) {
      console.error('Error in sendBookingConfirmation:', error);
      return { 
        clientResult: { success: false, error: error.message },
        trainerResult: { success: false, error: error.message }
      };
    }
  },

  async sendCancellationNotification(booking, session, client) {
    try {
      const template = emailTemplates.cancellationNotification(booking, session, client);
      return await sendEmail(client.email, template);
    } catch (error) {
      console.error('Error in sendCancellationNotification:', error);
      return { success: false, error: error.message };
    }
  },

  async sendSessionReminder(booking, session, client) {
    try {
      // Check if reminder already sent to avoid duplicates
      if (booking.reminderSent) {
        return { success: true, message: 'Reminder already sent' };
      }
      
      const template = emailTemplates.sessionReminder(booking, session, client);
      const result = await sendEmail(client.email, template);
      
      // Mark reminder as sent if successful
      if (result.success && booking.markModified) {
        booking.reminderSent = true;
        await booking.save();
      }
      
      return result;
    } catch (error) {
      console.error('Error in sendSessionReminder:', error);
      return { success: false, error: error.message };
    }
  },

  async sendPasswordReset(user, resetToken) {
    try {
      const template = emailTemplates.passwordReset(user, resetToken);
      return await sendEmail(user.email, template);
    } catch (error) {
      console.error('Error in sendPasswordReset:', error);
      return { success: false, error: error.message };
    }
  },

  async sendCustomMessage(recipient, subject, message) {
    try {
      const template = emailTemplates.customMessage(recipient, subject, message);
      return await sendEmail(recipient.email, template);
    } catch (error) {
      console.error('Error in sendCustomMessage:', error);
      return { success: false, error: error.message };
    }
  },

  async sendBulkCustomMessage(recipients, subject, message) {
    const results = [];
    
    // Validate inputs
    if (!Array.isArray(recipients) || recipients.length === 0) {
      throw new Error('Recipients must be a non-empty array');
    }
    
    if (!subject || !message) {
      throw new Error('Subject and message are required');
    }
    
    // Send emails with delay to avoid rate limiting
    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      
      try {
        const result = await this.sendCustomMessage(recipient, subject, message);
        results.push({ recipient: recipient.email, result });
        
        // Add small delay between emails to be respectful to email server
        if (i < recipients.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.error(`Error sending to ${recipient.email}:`, error);
        results.push({ 
          recipient: recipient.email, 
          result: { success: false, error: error.message } 
        });
      }
    }
    
    return results;
  },

  // Test email connectivity
  async testConnection() {
    try {
      await transporter.verify();
      return { success: true, message: 'Email service is working' };
    } catch (error) {
      console.error('Email service test failed:', error);
      return { success: false, error: error.message };
    }
  }
};

module.exports = emailService;