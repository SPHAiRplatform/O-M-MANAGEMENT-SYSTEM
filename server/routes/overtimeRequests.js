/**
 * Overtime Requests Route
 * Handles approval/rejection of overtime work requests
 */

const express = require('express');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const { createNotification } = require('../utils/notifications');
const { getDb } = require('../middleware/tenantContext');

module.exports = (pool) => {
  const router = express.Router();

  // Get all overtime requests (super admin only)
  router.get('/', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const { status } = req.query;
      
      let query = `
        SELECT 
          or.id,
          or.task_id,
          or.requested_by,
          or.request_type,
          or.request_time,
          or.status,
          or.approved_by,
          or.approved_at,
          or.rejection_reason,
          or.created_at,
          t.task_code,
          t.task_type,
          a.asset_name,
          u.full_name as requested_by_name,
          u.username as requested_by_username,
          approver.full_name as approved_by_name
        FROM overtime_requests or
        LEFT JOIN tasks t ON or.task_id = t.id
        LEFT JOIN assets a ON t.asset_id = a.id
        LEFT JOIN users u ON or.requested_by = u.id
        LEFT JOIN users approver ON or.approved_by = approver.id
        WHERE 1=1
      `;
      
      const params = [];
      if (status) {
        params.push(status);
        query += ` AND or.status = $${params.length}`;
      }
      
      query += ' ORDER BY or.created_at DESC';
      
      const result = await db.query(query, params);
      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching overtime requests:', error);
      res.status(500).json({ error: 'Failed to fetch overtime requests' });
    }
  });

  // Get overtime request by ID
  router.get('/:id', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const result = await db.query(
        `SELECT 
          or.*,
          t.task_code,
          t.task_type,
          a.asset_name,
          u.full_name as requested_by_name,
          u.username as requested_by_username,
          u.email as requested_by_email,
          approver.full_name as approved_by_name
        FROM overtime_requests or
        LEFT JOIN tasks t ON or.task_id = t.id
        LEFT JOIN assets a ON t.asset_id = a.id
        LEFT JOIN users u ON or.requested_by = u.id
        LEFT JOIN users approver ON or.approved_by = approver.id
        WHERE or.id = $1`,
        [req.params.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Overtime request not found' });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error fetching overtime request:', error);
      res.status(500).json({ error: 'Failed to fetch overtime request' });
    }
  });

  // Approve overtime request
  router.patch('/:id/approve', requireAuth, requireSuperAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get the overtime request
      const requestResult = await client.query(
        `SELECT or.*, t.task_code, u.full_name, u.username, u.email
         FROM overtime_requests or
         LEFT JOIN tasks t ON or.task_id = t.id
         LEFT JOIN users u ON or.requested_by = u.id
         WHERE or.id = $1`,
        [req.params.id]
      );

      if (requestResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Overtime request not found' });
      }

      const overtimeRequest = requestResult.rows[0];

      if (overtimeRequest.status !== 'pending') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Overtime request has already been processed' });
      }

      // Update the request
      const updateResult = await client.query(
        `UPDATE overtime_requests 
         SET status = 'approved', 
             approved_by = $1, 
             approved_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING *`,
        [req.session.userId, req.params.id]
      );

      await client.query('COMMIT');

      // Notify the user
      try {
        await createNotification(pool, {
          user_id: overtimeRequest.requested_by,
          task_id: overtimeRequest.task_id,
          type: 'overtime_approved',
          title: 'Overtime Work Acknowledged',
          message: `Your overtime work for task ${overtimeRequest.task_code} has been acknowledged by the super admin.`,
          metadata: {
            overtime_request_id: overtimeRequest.id,
            task_code: overtimeRequest.task_code,
            approved_by: req.session.userId
          }
        });
      } catch (notifError) {
        console.error('Error sending approval notification:', notifError);
      }

      res.json(updateResult.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error approving overtime request:', error);
      res.status(500).json({ error: 'Failed to approve overtime request' });
    } finally {
      client.release();
    }
  });

  // Reject overtime request
  router.patch('/:id/reject', requireAuth, requireSuperAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
      const { rejection_reason } = req.body;

      await client.query('BEGIN');

      // Get the overtime request
      const requestResult = await client.query(
        `SELECT or.*, t.task_code, u.full_name, u.username, u.email
         FROM overtime_requests or
         LEFT JOIN tasks t ON or.task_id = t.id
         LEFT JOIN users u ON or.requested_by = u.id
         WHERE or.id = $1`,
        [req.params.id]
      );

      if (requestResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Overtime request not found' });
      }

      const overtimeRequest = requestResult.rows[0];

      if (overtimeRequest.status !== 'pending') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Overtime request has already been processed' });
      }

      // Update the request
      const updateResult = await client.query(
        `UPDATE overtime_requests 
         SET status = 'rejected', 
             approved_by = $1, 
             approved_at = CURRENT_TIMESTAMP,
             rejection_reason = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3
         RETURNING *`,
        [req.session.userId, rejection_reason || null, req.params.id]
      );

      await client.query('COMMIT');

      // Notify the user
      try {
        await createNotification(pool, {
          user_id: overtimeRequest.requested_by,
          task_id: overtimeRequest.task_id,
          type: 'overtime_rejected',
          title: 'Overtime Work Not Acknowledged',
          message: `Your overtime work for task ${overtimeRequest.task_code} was not acknowledged.${rejection_reason ? ` Reason: ${rejection_reason}` : ''}`,
          metadata: {
            overtime_request_id: overtimeRequest.id,
            task_code: overtimeRequest.task_code,
            rejection_reason: rejection_reason || null,
            rejected_by: req.session.userId
          }
        });
      } catch (notifError) {
        console.error('Error sending rejection notification:', notifError);
      }

      res.json(updateResult.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error rejecting overtime request:', error);
      res.status(500).json({ error: 'Failed to reject overtime request' });
    } finally {
      client.release();
    }
  });

  return router;
};
