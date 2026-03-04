const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../middleware/tenantContext');

module.exports = (pool) => {
  const router = express.Router();

  // Get all notifications for current user
  router.get('/', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const userId = req.session.userId;
      const { unread_only } = req.query;

      let query = `
        SELECT n.*,
               t.task_code, t.task_type, t.scheduled_date,
               a.asset_name,
               tsr.status as request_status
        FROM notifications n
        LEFT JOIN tasks t ON n.task_id = t.id
        LEFT JOIN assets a ON t.asset_id = a.id
        LEFT JOIN tracker_status_requests tsr ON n.type = 'tracker_status_request'
          AND (n.metadata->>'request_id')::text = tsr.id::text
        WHERE n.user_id = $1
      `;

      const params = [userId];

      if (unread_only === 'true') {
        query += ' AND n.is_read = false';
      }

      query += ' ORDER BY n.created_at DESC LIMIT 100';

      const result = await db.query(query, params);

      // Parse metadata JSONB and add request status for tracker_status_request notifications
      const notifications = result.rows.map(notif => {
        if (notif.metadata && typeof notif.metadata === 'string') {
          try {
            notif.metadata = JSON.parse(notif.metadata);
          } catch (e) {
            notif.metadata = null;
          }
        }

        // Add request status to metadata for tracker_status_request notifications
        if (notif.type === 'tracker_status_request' && notif.request_status) {
          if (!notif.metadata) {
            notif.metadata = {};
          }
          notif.metadata.request_status = notif.request_status;
        }

        // Remove request_status from top level (it's now in metadata)
        delete notif.request_status;

        return notif;
      });

      res.json(notifications);
    } catch (error) {
      console.error('Error fetching notifications:', error);
      res.status(500).json({ error: 'Failed to fetch notifications' });
    }
  });

  // Get unread notification count
  router.get('/unread-count', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const userId = req.session.userId;

      const result = await db.query(
        `SELECT COUNT(*) as count
         FROM notifications
         WHERE user_id = $1 AND is_read = false`,
        [userId]
      );

      res.json({ count: parseInt(result.rows[0].count, 10) });
    } catch (error) {
      console.error('Error fetching unread count:', error);
      res.status(500).json({ error: 'Failed to fetch unread count' });
    }
  });

  // Mark notification as read
  router.patch('/:id/read', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const { id } = req.params;
      const userId = req.session.userId;

      // Verify notification belongs to user
      const checkResult = await db.query(
        'SELECT id FROM notifications WHERE id = $1 AND user_id = $2',
        [id, userId]
      );

      if (checkResult.rows.length === 0) {
        return res.status(404).json({ error: 'Notification not found' });
      }

      const result = await db.query(
        `UPDATE notifications
         SET is_read = true, read_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND user_id = $2
         RETURNING *`,
        [id, userId]
      );

      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error marking notification as read:', error);
      res.status(500).json({ error: 'Failed to mark notification as read' });
    }
  });

  // Mark all notifications as read
  router.patch('/read-all', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const userId = req.session.userId;

      // First, get the count of unread notifications
      const countResult = await db.query(
        `SELECT COUNT(*) as count FROM notifications
         WHERE user_id = $1 AND is_read = false`,
        [userId]
      );
      const count = parseInt(countResult.rows[0].count, 10);

      // Then update all unread notifications
      await db.query(
        `UPDATE notifications
         SET is_read = true, read_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND is_read = false`,
        [userId]
      );

      res.json({
        message: 'All notifications marked as read',
        count: count
      });
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      res.status(500).json({ error: 'Failed to mark all notifications as read' });
    }
  });

  // Delete notification
  router.delete('/:id', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const { id } = req.params;
      const userId = req.session.userId;

      // Verify notification belongs to user
      const checkResult = await db.query(
        'SELECT id FROM notifications WHERE id = $1 AND user_id = $2',
        [id, userId]
      );

      if (checkResult.rows.length === 0) {
        return res.status(404).json({ error: 'Notification not found' });
      }

      await db.query('DELETE FROM notifications WHERE id = $1', [id]);

      res.json({ message: 'Notification deleted' });
    } catch (error) {
      console.error('Error deleting notification:', error);
      res.status(500).json({ error: 'Failed to delete notification' });
    }
  });

  return router;
};
