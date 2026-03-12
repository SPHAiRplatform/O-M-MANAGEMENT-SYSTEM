const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { body, validationResult } = require('express-validator');
const { requireAuth } = require('../middleware/auth');
const nodemailer = require('nodemailer');
const { getDb } = require('../middleware/tenantContext');

// Multer config for feedback attachments (temp directory, 5MB limit)
const feedbackUpload = multer({
  dest: path.join(os.tmpdir(), 'feedback-uploads'),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|pdf/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (mime && ext) return cb(null, true);
    cb(new Error('Only images and PDF files are allowed.'));
  }
});

module.exports = (pool) => {
  const router = express.Router();

  // Validation rules
  const feedbackValidation = [
    body('email').optional().isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('subject').isIn(['question', 'bug', 'feature', 'improvement', 'other']).withMessage('Valid subject is required'),
    body('message').trim().isLength({ min: 20, max: 2000 }).withMessage('Message must be between 20 and 2000 characters'),
    body('page_url').optional().isString().trim(),
  ];

  // Get the Contact Developer email (any authenticated user)
  router.get('/contact-email', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const result = await db.query(
        `SELECT setting_value FROM platform_settings WHERE setting_key = 'feedback_contact_email' AND setting_value IS NOT NULL AND setting_value != ''`
      );
      res.json({ contact_email: result.rows[0]?.setting_value || '' });
    } catch (_) {
      res.json({ contact_email: '' });
    }
  });

  // Submit feedback (with optional file attachment)
  router.post('/', requireAuth, feedbackUpload.single('attachment'), feedbackValidation, async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const { subject, message, page_url } = req.body;
      const userId = req.session.userId;
      const db = getDb(req, pool);

      // Look up user info from DB (name + registered email)
      let userName = 'User';
      let userEmail = req.body.email || '';
      if (userId) {
        try {
          const userResult = await db.query('SELECT full_name, username, email FROM users WHERE id = $1', [userId]);
          if (userResult.rows.length > 0) {
            const u = userResult.rows[0];
            userName = u.full_name || u.username || 'User';
            userEmail = u.email || u.username || userEmail;
          }
        } catch (err) {
          console.error('Error fetching user info:', err);
        }
      }

      // Save to database
      const result = await db.query(
        `INSERT INTO feedback_submissions (user_id, name, email, subject, message, page_url, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'new')
         RETURNING id, created_at`,
        [userId, userName, userEmail, subject, message, page_url || null]
      );

      const feedbackId = result.rows[0].id;

      // Send email notification (if email is configured)
      try {
        if (process.env.SMTP_HOST && process.env.SMTP_USER) {
          let toEmail = process.env.SMTP_USER;
          try {
            const settingsRow = await db.query(
              `SELECT setting_value FROM platform_settings WHERE setting_key = 'feedback_contact_email' AND setting_value IS NOT NULL AND setting_value != '' LIMIT 1`
            );
            if (settingsRow.rows[0]?.setting_value) {
              toEmail = settingsRow.rows[0].setting_value.trim();
            } else if (process.env.FEEDBACK_EMAIL) {
              toEmail = process.env.FEEDBACK_EMAIL;
            }
          } catch (_) {
            if (process.env.FEEDBACK_EMAIL) toEmail = process.env.FEEDBACK_EMAIL;
          }

          const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASSWORD,
            },
          });

          const subjectLabels = {
            question: 'Question',
            bug: 'Bug Report',
            feature: 'Feature Request',
            improvement: 'Improvement Suggestion',
            other: 'Other'
          };

          const mailOptions = {
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            replyTo: userEmail || undefined,
            to: toEmail,
            subject: `[SPHAiRDigital Feedback] ${subjectLabels[subject] || subject} - ${userName}`,
            html: `
              <h2>New Feedback Submission</h2>
              <p><strong>From:</strong> ${userName} (${userEmail})</p>
              <p><strong>Subject:</strong> ${subjectLabels[subject] || subject}</p>
              <p><strong>Page:</strong> ${page_url || 'Unknown'}</p>
              <p><strong>Feedback ID:</strong> ${feedbackId}</p>
              <hr>
              <p><strong>Message:</strong></p>
              <p>${message.replace(/\n/g, '<br>')}</p>
              ${req.file ? '<p><em>📎 See attached file.</em></p>' : ''}
            `,
          };

          if (req.file) {
            mailOptions.attachments = [{
              filename: req.file.originalname,
              path: req.file.path
            }];
          }

          await transporter.sendMail(mailOptions);
        }
      } catch (emailError) {
        // Log but don't fail the request if email fails
        console.error('Error sending feedback email:', emailError);
      }

      res.json({
        success: true,
        message: 'Feedback submitted successfully',
        id: feedbackId,
      });
    } catch (error) {
      console.error('Error submitting feedback:', error);
      res.status(500).json({ error: 'Failed to submit feedback' });
    } finally {
      // Clean up temp file
      if (req.file && req.file.path) {
        try { fs.unlink(req.file.path, () => {}); } catch (_) {}
      }
    }
  });

  return router;
};
