const express = require('express');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const { validateUUID, validateString, handleValidationErrors, removeUnexpectedFields } = require('../middleware/inputValidation');
const { body } = require('express-validator');
const { notifyEarlyCompletionStatus } = require('../utils/notifications');
const { getDb } = require('../middleware/tenantContext');

module.exports = (pool) => {
  const router = express.Router();

  // Get early completion requests for a task
  router.get('/task/:taskId', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const { taskId } = req.params;
      
      const result = await db.query(
        `SELECT ecr.*, 
                u1.full_name as requested_by_name,
                u2.full_name as approved_by_name,
                u3.full_name as rejected_by_name
         FROM early_completion_requests ecr
         LEFT JOIN users u1 ON ecr.requested_by = u1.id
         LEFT JOIN users u2 ON ecr.approved_by = u2.id
         LEFT JOIN users u3 ON ecr.rejected_by = u3.id
         WHERE ecr.task_id = $1
         ORDER BY ecr.requested_at DESC`,
        [taskId]
      );
      
      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching early completion requests:', error);
      res.status(500).json({ error: 'Failed to fetch early completion requests' });
    }
  });

  // Get all pending early completion requests (superadmin only)
  router.get('/pending', requireSuperAdmin, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const result = await db.query(
        `SELECT ecr.*, 
                t.task_code, t.task_type, t.scheduled_date,
                a.asset_name,
                u.full_name as requested_by_name
         FROM early_completion_requests ecr
         LEFT JOIN tasks t ON ecr.task_id = t.id
         LEFT JOIN assets a ON t.asset_id = a.id
         LEFT JOIN users u ON ecr.requested_by = u.id
         WHERE ecr.status = 'pending'
         ORDER BY ecr.requested_at ASC`,
        []
      );
      
      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching pending requests:', error);
      res.status(500).json({ error: 'Failed to fetch pending requests' });
    }
  });

  // Create early completion request
  router.post('/', requireAuth, [
    removeUnexpectedFields(['task_id', 'motivation']),
    validateUUID('task_id', 'body'),
    body('motivation')
      .trim()
      .notEmpty()
      .withMessage('Motivation is required')
      .isLength({ min: 10, max: 1000 })
      .withMessage('Motivation must be between 10 and 1000 characters'),
    handleValidationErrors
  ], async (req, res) => {
    try {
      const db = getDb(req, pool);
      const { task_id, motivation } = req.body;
      const userId = req.session.userId;

      // Check if task exists and is assigned to user
      const taskResult = await db.query(
        `SELECT t.*, a.asset_name 
         FROM tasks t
         LEFT JOIN assets a ON t.asset_id = a.id
         WHERE t.id = $1`,
        [task_id]
      );

      if (taskResult.rows.length === 0) {
        return res.status(404).json({ error: 'Task not found' });
      }

      const task = taskResult.rows[0];

      // Check if task is assigned to current user
      if (task.assigned_to !== userId) {
        return res.status(403).json({ error: 'You can only request early completion for tasks assigned to you' });
      }

      // Check if task already has a pending request
      const existingRequest = await db.query(
        `SELECT id FROM early_completion_requests 
         WHERE task_id = $1 AND status = 'pending'`,
        [task_id]
      );

      if (existingRequest.rows.length > 0) {
        return res.status(400).json({ error: 'A pending early completion request already exists for this task' });
      }

      // Check if task is already completed or can be opened
      if (task.status === 'completed' || task.can_open_before_scheduled) {
        return res.status(400).json({ error: 'Task is already completed or approved for early completion' });
      }

      // Check if scheduled date is in the future
      if (task.scheduled_date) {
        // Use local date formatting to avoid timezone shift
        const formatLocalDate = (d) => {
          const date = new Date(d);
          return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        };
        const today = formatLocalDate(new Date());
        const scheduledDate = formatLocalDate(task.scheduled_date);
        
        if (today >= scheduledDate) {
          return res.status(400).json({ error: 'Task scheduled date has already passed or is today' });
        }
      }

      // Create request
      const result = await db.query(
        `INSERT INTO early_completion_requests (task_id, requested_by, motivation, status, organization_id)
         VALUES ($1, $2, $3, 'pending', $4)
         RETURNING *`,
        [task_id, userId, motivation, task.organization_id]
      );

      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('Error creating early completion request:', error);
      res.status(500).json({ error: 'Failed to create early completion request' });
    }
  });

  // Approve early completion request (superadmin only)
  router.post('/:id/approve', requireSuperAdmin, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const { id } = req.params;
      const approvedBy = req.session.userId;

      // Get request
      const requestResult = await db.query(
        `SELECT ecr.*, t.*, a.asset_name
         FROM early_completion_requests ecr
         LEFT JOIN tasks t ON ecr.task_id = t.id
         LEFT JOIN assets a ON t.asset_id = a.id
         WHERE ecr.id = $1`,
        [id]
      );

      if (requestResult.rows.length === 0) {
        return res.status(404).json({ error: 'Early completion request not found' });
      }

      const request = requestResult.rows[0];

      if (request.status !== 'pending') {
        return res.status(400).json({ error: 'Request is not pending' });
      }

      // Update request
      await db.query(
        `UPDATE early_completion_requests 
         SET status = 'approved',
             approved_by = $1,
             approved_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [approvedBy, id]
      );

      // Update task to allow early opening
      await db.query(
        `UPDATE tasks 
         SET can_open_before_scheduled = true,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [request.task_id]
      );

      // Notify user
      try {
        const userResult = await db.query(
          'SELECT full_name, username FROM users WHERE id = $1',
          [request.requested_by]
        );
        const requestedUser = userResult.rows[0];
        
        if (requestedUser) {
          await notifyEarlyCompletionStatus(pool, {
            ...request,
            id: request.id
          }, {
            task_code: request.task_code,
            scheduled_date: request.scheduled_date
          }, true);
        }
      } catch (notifError) {
        console.error('Error sending approval notification:', notifError);
      }

      res.json({ message: 'Early completion request approved', task_id: request.task_id });
    } catch (error) {
      console.error('Error approving early completion request:', error);
      res.status(500).json({ error: 'Failed to approve early completion request' });
    }
  });

  // Reject early completion request (superadmin only)
  router.post('/:id/reject', requireSuperAdmin, [
    body('rejection_reason')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Rejection reason must be less than 500 characters'),
    handleValidationErrors
  ], async (req, res) => {
    try {
      const db = getDb(req, pool);
      const { id } = req.params;
      const { rejection_reason } = req.body;
      const rejectedBy = req.session.userId;

      // Get request
      const requestResult = await db.query(
        `SELECT ecr.*, t.*, a.asset_name
         FROM early_completion_requests ecr
         LEFT JOIN tasks t ON ecr.task_id = t.id
         LEFT JOIN assets a ON t.asset_id = a.id
         WHERE ecr.id = $1`,
        [id]
      );

      if (requestResult.rows.length === 0) {
        return res.status(404).json({ error: 'Early completion request not found' });
      }

      const request = requestResult.rows[0];

      if (request.status !== 'pending') {
        return res.status(400).json({ error: 'Request is not pending' });
      }

      // Update request
      await db.query(
        `UPDATE early_completion_requests 
         SET status = 'rejected',
             rejected_by = $1,
             rejected_at = CURRENT_TIMESTAMP,
             rejection_reason = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [rejectedBy, rejection_reason || 'No reason provided', id]
      );

      // Notify user
      try {
        const userResult = await db.query(
          'SELECT full_name, username FROM users WHERE id = $1',
          [request.requested_by]
        );
        const requestedUser = userResult.rows[0];
        
        if (requestedUser) {
          await notifyEarlyCompletionStatus(pool, {
            ...request,
            id: request.id,
            rejection_reason: rejection_reason || 'No reason provided'
          }, {
            task_code: request.task_code,
            scheduled_date: request.scheduled_date
          }, false);
        }
      } catch (notifError) {
        console.error('Error sending rejection notification:', notifError);
      }

      res.json({ message: 'Early completion request rejected' });
    } catch (error) {
      console.error('Error rejecting early completion request:', error);
      res.status(500).json({ error: 'Failed to reject early completion request' });
    }
  });

  return router;
};
