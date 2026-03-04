/**
 * Email Utility
 * Handles sending emails for notifications
 */

const nodemailer = require('nodemailer');

// Create reusable transporter object using SMTP transport
let transporter = null;

/**
 * Initialize email transporter
 */
function initializeEmailTransporter() {
  // Only initialize if email is enabled
  if (process.env.EMAIL_ENABLED !== 'true') {
    console.log('Email notifications are disabled (EMAIL_ENABLED != true)');
    return null;
  }

  // Check for required email configuration
  if (!process.env.SMTP_HOST || !process.env.SMTP_PORT || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('Email configuration incomplete. Email notifications will be disabled.');
    console.warn('Required: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS');
    return null;
  }

  try {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10),
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      // For Gmail and other services that require OAuth2
      ...(process.env.SMTP_SERVICE && {
        service: process.env.SMTP_SERVICE // e.g., 'gmail', 'outlook'
      })
    });

    console.log('Email transporter initialized successfully');
    return transporter;
  } catch (error) {
    console.error('Error initializing email transporter:', error);
    return null;
  }
}

/**
 * Verify email transporter connection
 */
async function verifyEmailConnection() {
  if (!transporter) {
    transporter = initializeEmailTransporter();
  }

  if (!transporter) {
    return false;
  }

  try {
    await transporter.verify();
    console.log('Email server connection verified');
    return true;
  } catch (error) {
    console.error('Email server connection failed:', error);
    return false;
  }
}

/**
 * Send email notification
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML email body
 * @param {string} options.text - Plain text email body (optional)
 */
async function sendEmail({ to, subject, html, text }) {
  // Check if email is enabled
  if (process.env.EMAIL_ENABLED !== 'true') {
    console.log('Email notifications disabled, skipping email to:', to);
    return { success: false, reason: 'Email disabled' };
  }

  // Initialize transporter if not already done
  if (!transporter) {
    transporter = initializeEmailTransporter();
  }

  if (!transporter) {
    console.warn('Email transporter not available, skipping email to:', to);
    return { success: false, reason: 'Transporter not available' };
  }

  // Get sender information
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER || 'noreply@example.com';
  const fromName = process.env.EMAIL_FROM_NAME || 'SPHAiRDigital';

  try {
    const mailOptions = {
      from: `"${fromName}" <${from}>`,
      to: to,
      subject: subject,
      html: html,
      text: text || html.replace(/<[^>]*>/g, '') // Strip HTML tags for text version
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', {
      to: to,
      subject: subject,
      messageId: info.messageId
    });

    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending email:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send task assignment email
 * @param {Object} user - User object with email, full_name
 * @param {Object} task - Task object with task details
 */
async function sendTaskAssignmentEmail(user, task) {
  if (!user || !user.email) {
    console.warn('Cannot send email: user email not available');
    return { success: false, reason: 'No email address' };
  }

  const taskTypeNames = {
    'PM': 'Preventive Maintenance',
    'PCM': 'Planned Corrective Maintenance',
    'UCM': 'Unplanned Corrective Maintenance'
  };

  const taskTypeName = taskTypeNames[task.task_type] || task.task_type;
  const scheduledDate = task.scheduled_date 
    ? new Date(task.scheduled_date).toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      })
    : 'TBD';

  const taskLabel = task.task_display_name || task.template_name || task.task_code;
  const creatorLabel = (task.creator_display_name && String(task.creator_display_name).trim()) || 'Unknown';
  const subject = `New Task Assigned: ${taskLabel}`;
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .header {
          background-color: #007bff;
          color: white;
          padding: 20px;
          text-align: center;
          border-radius: 5px 5px 0 0;
        }
        .content {
          background-color: #f8f9fa;
          padding: 20px;
          border-radius: 0 0 5px 5px;
        }
        .task-details {
          background-color: white;
          padding: 15px;
          margin: 15px 0;
          border-left: 4px solid #007bff;
          border-radius: 4px;
        }
        .detail-row {
          margin: 10px 0;
        }
        .label {
          font-weight: bold;
          color: #555;
        }
        .value {
          color: #333;
        }
        .button {
          display: inline-block;
          padding: 12px 24px;
          background-color: #007bff;
          color: white;
          text-decoration: none;
          border-radius: 5px;
          margin-top: 20px;
        }
        .footer {
          margin-top: 20px;
          padding-top: 20px;
          border-top: 1px solid #ddd;
          font-size: 12px;
          color: #666;
          text-align: center;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>New Task Assigned</h1>
      </div>
      <div class="content">
        <p>Hello ${user.full_name || user.username},</p>
        
        <p>You have been assigned a new task in SPHAiRDigital.</p>
        
        <div class="task-details">
          <div class="detail-row">
            <span class="label">Task:</span>
            <span class="value">${taskLabel}</span>
          </div>
          <div class="detail-row">
            <span class="label">Task Type:</span>
            <span class="value">${taskTypeName}</span>
          </div>
          <div class="detail-row">
            <span class="label">Asset:</span>
            <span class="value">${task.asset_name || 'Unknown Asset'}</span>
          </div>
          <div class="detail-row">
            <span class="label">Scheduled Date:</span>
            <span class="value">${scheduledDate}</span>
          </div>
        </div>
        
        <p>Please log in to the system to view task details and begin work.</p>
        
        <p><strong>Assigned by ${creatorLabel}</strong></p>
        
        ${process.env.APP_URL ? `
          <a href="${process.env.APP_URL}/tasks/${task.id}" class="button">View Task</a>
        ` : ''}
        
        <div class="footer">
          <p>This is an automated notification from SPHAiRDigital.</p>
          <p>Please do not reply to this email.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({
    to: user.email,
    subject: subject,
    html: html
  });
}

/**
 * Send task reminder email (3 days before scheduled date)
 * @param {Object} user - User object with email, full_name
 * @param {Object} task - Task object with task details
 */
async function sendTaskReminderEmail(user, task) {
  if (!user || !user.email) {
    console.warn('Cannot send email: user email not available');
    return { success: false, reason: 'No email address' };
  }

  const taskTypeNames = {
    'PM': 'Preventive Maintenance',
    'PCM': 'Planned Corrective Maintenance',
    'UCM': 'Unplanned Corrective Maintenance'
  };

  const taskTypeName = taskTypeNames[task.task_type] || task.task_type;
  const scheduledDate = task.scheduled_date 
    ? new Date(task.scheduled_date).toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      })
    : 'TBD';

  const taskLabel = task.task_display_name || task.template_name || task.task_code;
  const subject = `Task Reminder: ${taskLabel} - Due in 3 Days`;
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .header {
          background-color: #ffc107;
          color: #333;
          padding: 20px;
          text-align: center;
          border-radius: 5px 5px 0 0;
        }
        .content {
          background-color: #f8f9fa;
          padding: 20px;
          border-radius: 0 0 5px 5px;
        }
        .task-details {
          background-color: white;
          padding: 15px;
          margin: 15px 0;
          border-left: 4px solid #ffc107;
          border-radius: 4px;
        }
        .detail-row {
          margin: 10px 0;
        }
        .label {
          font-weight: bold;
          color: #555;
        }
        .value {
          color: #333;
        }
        .button {
          display: inline-block;
          padding: 12px 24px;
          background-color: #ffc107;
          color: #333;
          text-decoration: none;
          border-radius: 5px;
          margin-top: 20px;
          font-weight: bold;
        }
        .footer {
          margin-top: 20px;
          padding-top: 20px;
          border-top: 1px solid #ddd;
          font-size: 12px;
          color: #666;
          text-align: center;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Task Reminder - Due Soon</h1>
      </div>
      <div class="content">
        <p>Hello ${user.full_name || user.username},</p>
        
        <p><strong>This is a reminder that you have a task scheduled in 3 days.</strong></p>
        
        <div class="task-details">
          <div class="detail-row">
            <span class="label">Task:</span>
            <span class="value">${taskLabel}</span>
          </div>
          <div class="detail-row">
            <span class="label">Task Type:</span>
            <span class="value">${taskTypeName}</span>
          </div>
          <div class="detail-row">
            <span class="label">Asset:</span>
            <span class="value">${task.asset_name || 'Unknown Asset'}</span>
          </div>
          <div class="detail-row">
            <span class="label">Scheduled Date:</span>
            <span class="value">${scheduledDate}</span>
          </div>
        </div>
        
        <p>Please ensure you are prepared to complete this task on the scheduled date.</p>
        
        ${process.env.APP_URL ? `
          <a href="${process.env.APP_URL}/tasks/${task.id}" class="button">View Task</a>
        ` : ''}
        
        <div class="footer">
          <p>This is an automated reminder from SPHAiRDigital.</p>
          <p>Please do not reply to this email.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({
    to: user.email,
    subject: subject,
    html: html
  });
}

// Initialize transporter on module load
if (process.env.EMAIL_ENABLED === 'true') {
  initializeEmailTransporter();
}

module.exports = {
  sendEmail,
  sendTaskAssignmentEmail,
  sendTaskReminderEmail,
  verifyEmailConnection,
  initializeEmailTransporter
};
