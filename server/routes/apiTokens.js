const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { body } = require('express-validator');
const { requireAdmin } = require('../middleware/auth');
const { validateString, validateUUID, handleValidationErrors, removeUnexpectedFields } = require('../middleware/inputValidation');
// Rate limiting removed for frequent use
// const { sensitiveOperationLimiter } = require('../middleware/rateLimiter');
const { getDb } = require('../middleware/tenantContext');

function generateSecret() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = (pool) => {
  const router = express.Router();

  // List tokens (admin only)
  router.get('/', requireAdmin, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const result = await db.query(
        `SELECT id, name, user_id, role, is_active, created_by, created_at, last_used
         FROM api_tokens
         ORDER BY created_at DESC`
      );
      res.json(result.rows);
    } catch (e) {
      res.status(500).json({ error: 'Failed to list API tokens', details: e.message });
    }
  });

  // Create token (admin only)
  // Body: { name, role, user_id }
  // Returns: { token: "tok_<id>_<secret>" } ONLY ONCE.
  // Rate limiting and validation applied
  // Rate limiting removed for frequent use
  router.post('/', requireAdmin, [
    removeUnexpectedFields(['name', 'role', 'user_id']),
    validateString('name', 255, true),
    body('role').optional().isIn(['admin', 'supervisor', 'technician']).withMessage('Role must be one of: admin, supervisor, technician'),
    validateUUID('user_id', 'body').optional(),
    handleValidationErrors
  ], async (req, res) => {
    try {
      const db = getDb(req, pool);
      const { name, role, user_id } = req.body || {};

      const targetUserId = user_id || req.session.userId; // default: acts as current admin user
      if (!targetUserId) return res.status(400).json({ error: 'user_id is required (or login first)' });

      const secret = generateSecret();
      const secretHash = await bcrypt.hash(secret, 10);

      const result = await db.query(
        `INSERT INTO api_tokens (name, user_id, role, secret_hash, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, user_id, role, is_active, created_at`,
        [name, targetUserId, role || 'admin', secretHash, req.session.userId || null]
      );

      const rec = result.rows[0];
      const token = `tok_${rec.id}_${secret}`;
      res.status(201).json({ ...rec, token });
    } catch (e) {
      res.status(500).json({ error: 'Failed to create API token', details: e.message });
    }
  });

  // Deactivate token (admin only)
  router.patch('/:id/deactivate', requireAdmin, [
    validateUUID('id', 'param'),
    handleValidationErrors
  ], async (req, res) => {
    try {
      const db = getDb(req, pool);
      const result = await db.query(
        `UPDATE api_tokens SET is_active = false WHERE id = $1 RETURNING id, name, is_active`,
        [req.params.id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Token not found' });
      res.json(result.rows[0]);
    } catch (e) {
      res.status(500).json({ error: 'Failed to deactivate token', details: e.message });
    }
  });

  return router;
};


