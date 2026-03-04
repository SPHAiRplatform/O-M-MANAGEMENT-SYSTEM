const express = require('express');
const { body } = require('express-validator');
const { requireAdmin } = require('../middleware/auth');
const { validateUUID, validateString, handleValidationErrors, removeUnexpectedFields } = require('../middleware/inputValidation');
const { getDb } = require('../middleware/tenantContext');
// Rate limiting removed for frequent use
// const { sensitiveOperationLimiter } = require('../middleware/rateLimiter');

module.exports = (pool) => {
  const router = express.Router();

  // List webhooks (admin only)
  router.get('/', requireAdmin, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const result = await db.query(
        `SELECT id, name, url, events, is_active, created_by, created_at, updated_at
         FROM webhooks
         ORDER BY created_at DESC`
      );
      res.json(result.rows);
    } catch (e) {
      res.status(500).json({ error: 'Failed to list webhooks', details: e.message });
    }
  });

  // Create webhook (admin only)
  // Body: { name, url, events: string[], secret? }
  // Rate limiting removed for frequent use
  router.post('/', requireAdmin, [
    removeUnexpectedFields(['name', 'url', 'events', 'secret']),
    validateString('name', 255, true),
    body('url')
      .trim()
      .notEmpty()
      .withMessage('URL is required')
      .isURL({ protocols: ['http', 'https'], require_protocol: true })
      .withMessage('URL must be a valid HTTP/HTTPS URL')
      .isLength({ max: 2048 })
      .withMessage('URL must be less than 2048 characters'),
    body('events')
      .optional()
      .isArray()
      .withMessage('Events must be an array')
      .custom((events) => {
        if (Array.isArray(events)) {
          const validEvents = ['task.completed', 'report.generated'];
          const invalid = events.filter(e => !validEvents.includes(e));
          if (invalid.length > 0) {
            throw new Error(`Invalid events: ${invalid.join(', ')}. Valid events: ${validEvents.join(', ')}`);
          }
        }
        return true;
      }),
    body('secret')
      .optional()
      .isLength({ min: 16, max: 255 })
      .withMessage('Secret must be between 16 and 255 characters'),
    handleValidationErrors
  ], async (req, res) => {
    try {
      const db = getDb(req, pool);
      const { name, url, events, secret } = req.body || {};
      const ev = Array.isArray(events) ? events : [];

      const result = await db.query(
        `INSERT INTO webhooks (name, url, events, secret, created_by)
         VALUES ($1, $2, $3::jsonb, $4, $5)
         RETURNING *`,
        [name, url, JSON.stringify(ev), secret || null, req.session.userId || null]
      );
      res.status(201).json(result.rows[0]);
    } catch (e) {
      res.status(500).json({ error: 'Failed to create webhook', details: e.message });
    }
  });

  // Update webhook (admin only)
  router.patch('/:id', requireAdmin, [
    validateUUID('id', 'param'),
    removeUnexpectedFields(['name', 'url', 'events', 'secret', 'is_active']),
    validateString('name', 255).optional(),
    body('url')
      .optional()
      .trim()
      .isURL({ protocols: ['http', 'https'], require_protocol: true })
      .withMessage('URL must be a valid HTTP/HTTPS URL')
      .isLength({ max: 2048 })
      .withMessage('URL must be less than 2048 characters'),
    body('events')
      .optional()
      .isArray()
      .withMessage('Events must be an array'),
    body('secret')
      .optional()
      .isLength({ min: 16, max: 255 })
      .withMessage('Secret must be between 16 and 255 characters'),
    body('is_active')
      .optional()
      .isBoolean()
      .withMessage('is_active must be a boolean'),
    handleValidationErrors
  ], async (req, res) => {
    try {
      const db = getDb(req, pool);
      const { name, url, events, secret, is_active } = req.body || {};

      const existing = await db.query('SELECT * FROM webhooks WHERE id = $1', [req.params.id]);
      if (existing.rows.length === 0) return res.status(404).json({ error: 'Webhook not found' });
      const cur = existing.rows[0];
      const next = {
        name: name ?? cur.name,
        url: url ?? cur.url,
        events: Array.isArray(events) ? events : (typeof cur.events === 'string' ? JSON.parse(cur.events) : (cur.events || [])),
        secret: secret ?? cur.secret,
        is_active: (typeof is_active === 'boolean') ? is_active : cur.is_active
      };

      const result = await db.query(
        `UPDATE webhooks
         SET name = $1,
             url = $2,
             events = $3::jsonb,
             secret = $4,
             is_active = $5,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $6
         RETURNING *`,
        [next.name, next.url, JSON.stringify(next.events), next.secret, next.is_active, req.params.id]
      );
      res.json(result.rows[0]);
    } catch (e) {
      res.status(500).json({ error: 'Failed to update webhook', details: e.message });
    }
  });

  // Delete webhook (admin only)
  router.delete('/:id', requireAdmin, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const result = await db.query('DELETE FROM webhooks WHERE id = $1 RETURNING id', [req.params.id]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Webhook not found' });
      res.json({ message: 'Deleted', id: result.rows[0].id });
    } catch (e) {
      res.status(500).json({ error: 'Failed to delete webhook', details: e.message });
    }
  });

  // List deliveries (admin only)
  router.get('/:id/deliveries', requireAdmin, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const result = await db.query(
        `SELECT *
         FROM webhook_deliveries
         WHERE webhook_id = $1
         ORDER BY created_at DESC
         LIMIT 200`,
        [req.params.id]
      );
      res.json(result.rows);
    } catch (e) {
      res.status(500).json({ error: 'Failed to list deliveries', details: e.message });
    }
  });

  return router;
};


