/**
 * Email Utility
 * Uses Brevo HTTP API (port 443) when BREVO_API_KEY is set,
 * falls back to nodemailer SMTP otherwise.
 */

const https = require('https');
const nodemailer = require('nodemailer');

let transporter = null;

// --- Brevo HTTP API sender ---
// attachments: [{ name: 'file.png', content: <Buffer or base64 string>, type: 'image/png' }]
function sendViaBrevoApi({ to, subject, html, text, from, fromName, attachments }) {
  return new Promise((resolve, reject) => {
    const payload = {
      sender: { name: fromName, email: from },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text || html.replace(/<[^>]*>/g, '')
    };

    if (attachments && attachments.length > 0) {
      payload.attachment = attachments.map(a => ({
        name: a.name,
        content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : a.content
      }));
    }

    const body = JSON.stringify(payload);

    const req = https.request({
      hostname: 'api.brevo.com',
      path: '/v3/smtp/email',
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ success: true, messageId: JSON.parse(data).messageId });
        } else {
          reject(new Error(`Brevo API error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(new Error('Brevo API request timeout')); });
    req.write(body);
    req.end();
  });
}

// --- SMTP transporter (fallback) ---
function initializeEmailTransporter() {
  if (process.env.EMAIL_ENABLED !== 'true') {
    console.log('Email notifications are disabled (EMAIL_ENABLED != true)');
    return null;
  }

  if (!process.env.SMTP_HOST || !process.env.SMTP_PORT || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('Email configuration incomplete. Email notifications will be disabled.');
    return null;
  }

  try {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      ...(process.env.SMTP_SERVICE && { service: process.env.SMTP_SERVICE })
    });
    console.log('Email transporter initialized successfully (SMTP)');
    return transporter;
  } catch (error) {
    console.error('Error initializing email transporter:', error);
    return null;
  }
}

async function verifyEmailConnection() {
  if (process.env.BREVO_API_KEY) return true;
  if (!transporter) transporter = initializeEmailTransporter();
  if (!transporter) return false;
  try {
    await transporter.verify();
    return true;
  } catch (error) {
    console.error('Email server connection failed:', error);
    return false;
  }
}

/**
 * Send email notification
 * attachments (optional): [{ name, content (Buffer or base64), type }]
 */
async function sendEmail({ to, subject, html, text, attachments }) {
  if (process.env.EMAIL_ENABLED !== 'true') {
    console.log('Email notifications disabled, skipping email to:', to);
    return { success: false, reason: 'Email disabled' };
  }

  const from = process.env.EMAIL_FROM || process.env.SMTP_USER || 'noreply@example.com';
  const fromName = process.env.EMAIL_FROM_NAME || 'SPHAiRDigital';

  // Use Brevo HTTP API if key is configured (works even when SMTP ports are blocked)
  if (process.env.BREVO_API_KEY) {
    try {
      const result = await sendViaBrevoApi({ to, subject, html, text, from, fromName, attachments });
      console.log('Email sent successfully via Brevo API:', { to, subject });
      return result;
    } catch (error) {
      console.error('Error sending email via Brevo API:', error.message);
      return { success: false, error: error.message };
    }
  }

  // Fallback: SMTP
  if (!transporter) transporter = initializeEmailTransporter();
  if (!transporter) {
    console.warn('Email transporter not available, skipping email to:', to);
    return { success: false, reason: 'Transporter not available' };
  }

  try {
    const info = await transporter.sendMail({
      from: `"${fromName}" <${from}>`,
      to, subject, html,
      text: text || html.replace(/<[^>]*>/g, '')
    });
    console.log('Email sent successfully via SMTP:', { to, subject, messageId: info.messageId });
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

// Initialize on module load (skip SMTP init if using Brevo API)
if (process.env.EMAIL_ENABLED === 'true') {
  if (process.env.BREVO_API_KEY) {
    console.log('Email transporter initialized successfully (Brevo HTTP API)');
  } else {
    initializeEmailTransporter();
  }
}

module.exports = {
  sendEmail,
  sendTaskAssignmentEmail,
  sendTaskReminderEmail,
  verifyEmailConnection,
  initializeEmailTransporter
};
