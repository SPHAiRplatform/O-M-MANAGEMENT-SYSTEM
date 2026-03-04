/**
 * Sync Route
 * Handles bulk synchronization of offline operations
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../middleware/tenantContext');

module.exports = (pool) => {
  const router = express.Router();

  // Bulk sync endpoint for offline operations
  router.post('/sync', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const { operations } = req.body;

      if (!Array.isArray(operations) || operations.length === 0) {
        return res.status(400).json({ error: 'Operations array is required' });
      }

      const results = [];
      const errors = [];

      for (const operation of operations) {
        try {
          const { type, method, url, data } = operation;

          // Process each operation based on type
          let result = null;

          switch (type) {
            case 'task_start':
              if (url.includes('/tasks/')) {
                const taskId = url.match(/\/tasks\/([^\/]+)\/start/)?.[1];
                if (taskId) {
                  const taskResult = await db.query(
                    `UPDATE tasks SET status = 'in_progress', started_at = CURRENT_TIMESTAMP 
                     WHERE id = $1 AND status = 'pending' RETURNING *`,
                    [taskId]
                  );
                  result = taskResult.rows[0];
                }
              }
              break;

            case 'task_pause':
              if (url.includes('/tasks/')) {
                const taskId = url.match(/\/tasks\/([^\/]+)\/pause/)?.[1];
                if (taskId && data) {
                  const taskResult = await db.query(
                    `UPDATE tasks SET is_paused = TRUE, paused_at = CURRENT_TIMESTAMP, pause_reason = $1
                     WHERE id = $2 AND status = 'in_progress' RETURNING *`,
                    [data.pause_reason || null, taskId]
                  );
                  result = taskResult.rows[0];
                }
              }
              break;

            case 'task_resume':
              if (url.includes('/tasks/')) {
                const taskId = url.match(/\/tasks\/([^\/]+)\/resume/)?.[1];
                if (taskId) {
                  // Get current pause info
                  const taskCheck = await db.query('SELECT paused_at, total_pause_duration_minutes FROM tasks WHERE id = $1', [taskId]);
                  const task = taskCheck.rows[0];
                  
                  if (task && task.paused_at) {
                    const pausedAt = new Date(task.paused_at);
                    const now = new Date();
                    const pauseDuration = Math.round((now - pausedAt) / 60000);
                    const newTotalPause = (task.total_pause_duration_minutes || 0) + pauseDuration;

                    const taskResult = await db.query(
                      `UPDATE tasks SET is_paused = FALSE, resumed_at = CURRENT_TIMESTAMP, 
                       total_pause_duration_minutes = $1, paused_at = NULL
                       WHERE id = $2 RETURNING *`,
                      [newTotalPause, taskId]
                    );
                    result = taskResult.rows[0];
                  }
                }
              }
              break;

            case 'task_complete':
              if (url.includes('/tasks/')) {
                const taskId = url.match(/\/tasks\/([^\/]+)\/complete/)?.[1];
                if (taskId && data) {
                  const taskCheck = await db.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
                  const task = taskCheck.rows[0];
                  
                  if (task) {
                    const totalPauseDuration = task.total_pause_duration_minutes || 0;
                    const startedAt = task.started_at ? new Date(task.started_at) : new Date();
                    const completedAt = new Date();
                    const rawDuration = data.duration_minutes || Math.round((completedAt - startedAt) / 60000);
                    const duration = Math.max(0, rawDuration - totalPauseDuration);

                    const taskResult = await db.query(
                      `UPDATE tasks SET status = 'completed', completed_at = $1, 
                       overall_status = $2, duration_minutes = $3
                       WHERE id = $4 RETURNING *`,
                      [completedAt, data.overall_status || 'pass', duration, taskId]
                    );
                    result = taskResult.rows[0];
                  }
                }
              }
              break;

            case 'checklist_submit':
              // Handle checklist response submission
              if (data) {
                // This would need to integrate with the checklist response route logic
                // For now, we'll return a success indicator
                result = { synced: true, type: 'checklist_submit' };
              }
              break;

            default:
              result = { synced: true, type: 'unknown', message: 'Operation type not specifically handled' };
          }

          results.push({
            operationId: operation.id || operation.requestId,
            type,
            success: true,
            result
          });
        } catch (error) {
          console.error('Error processing sync operation:', error);
          errors.push({
            operationId: operation.id || operation.requestId,
            type: operation.type,
            error: error.message
          });
        }
      }

      res.json({
        success: true,
        synced: results.length,
        failed: errors.length,
        results,
        errors
      });
    } catch (error) {
      console.error('Sync error:', error);
      res.status(500).json({ error: 'Failed to sync operations', details: error.message });
    }
  });

  return router;
};
