const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { mapTaskDataToTemplate } = require('../utils/dataMapper');
const { generateWordDocument } = require('../utils/wordGenerator');
const { generateExcelDocument } = require('../utils/excelGenerator');
const { emitEvent } = require('../utils/webhookEmitter');
const { notifyTaskAssigned, notifyTaskFlagged, notifyOvertimeRequest } = require('../utils/notifications');
const { isOutsideWorkingHours, formatTime, getWorkingHoursDescription } = require('../utils/overtime');
const { requireAuth, requireAdmin, requireSuperAdmin, isSuperAdmin, isAdmin } = require('../middleware/auth');
const { validateCreateTask } = require('../middleware/inputValidation');
const { getDb } = require('../middleware/tenantContext');
const { isSystemOwnerWithoutCompany } = require('../utils/organizationFilter');
const { logAudit, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require('../utils/auditLogger');

module.exports = (pool) => {
  const router = express.Router();

  // Get all tasks (all authenticated users can see all tasks)
  router.get('/', requireAuth, async (req, res) => {
    try {
      // System owners without a selected company should see no tasks
      if (isSystemOwnerWithoutCompany(req)) {
        return res.json([]);
      }
      
      // Get organization ID from request context (for explicit filtering)
      const { getOrganizationIdFromRequest } = require('../utils/organizationFilter');
      const organizationId = getOrganizationIdFromRequest(req);
      
      const { status, task_type, asset_id, completed_date } = req.query;
      
      // Use CTE to aggregate assigned_users separately to ensure all tasks are returned
      let query = `
        WITH task_assignments_agg AS (
          SELECT 
            ta.task_id,
            COALESCE(
              json_agg(jsonb_build_object(
                'id', u.id,
                'full_name', u.full_name,
                'username', u.username,
                'email', u.email
              )) FILTER (WHERE u.id IS NOT NULL),
              '[]'::json
            ) as assigned_users
          FROM task_assignments ta
          LEFT JOIN users u ON ta.user_id = u.id
          GROUP BY ta.task_id
        )
        SELECT t.id, t.task_code, t.checklist_template_id, t.asset_id, t.location, t.assigned_to,
               t.task_type, t.status, t.scheduled_date, t.started_at, t.completed_at,
               t.duration_minutes, t.overall_status, t.parent_task_id, t.created_at, t.updated_at,
               t.hours_worked, t.budgeted_hours, t.is_flagged, t.flag_reason, t.assigned_at,
               t.can_open_before_scheduled,
               t.is_paused, t.paused_at, t.resumed_at, t.pause_reason, t.total_pause_duration_minutes,
               a.asset_code, a.asset_name,
               ct.template_name, ct.template_code,
               COALESCE(taa.assigned_users, '[]'::json) as assigned_users,
               pm_user.id as pm_performed_by_id,
               pm_user.full_name as pm_performed_by_name,
               pm_user.username as pm_performed_by_username,
               pm_user.email as pm_performed_by_email
        FROM tasks t
        LEFT JOIN assets a ON t.asset_id = a.id
        LEFT JOIN checklist_templates ct ON t.checklist_template_id = ct.id
        LEFT JOIN task_assignments_agg taa ON t.id = taa.task_id
        LEFT JOIN users pm_user ON t.pm_performed_by = pm_user.id
        WHERE 1=1
      `;
      const params = [];
      let paramCount = 1;
      
      // Explicitly filter by organization_id (backup to RLS)
      if (organizationId) {
        query += ` AND t.organization_id = $${paramCount++}`;
        params.push(organizationId);
      } else {
        // If no organization context, return empty (shouldn't happen due to isSystemOwnerWithoutCompany check above)
        return res.json([]);
      }

      // All users can see all tasks (no filtering by assignment)

      if (status) {
        query += ` AND t.status = $${paramCount++}`;
        params.push(status);
      }
      if (task_type) {
        query += ` AND t.task_type = $${paramCount++}`;
        params.push(task_type);
      }
      if (asset_id) {
        query += ` AND t.asset_id = $${paramCount++}`;
        params.push(asset_id);
      }
      if (completed_date) {
        query += ` AND t.completed_at IS NOT NULL AND DATE(t.completed_at) = $${paramCount++}`;
        params.push(completed_date);
      }

      query += ' ORDER BY t.created_at DESC';

      // Log query for debugging
      console.log(`[TASKS] User: ${req.session?.username || 'unknown'} (${req.session?.role || 'unknown'}) requesting tasks`);
      console.log(`[TASKS] Query params:`, params);
      
      // Use req.db if available (has tenant context), otherwise fall back to pool
      const db = getDb(req, pool);
      let result;
      try {
        result = await db.query(query, params);
      } catch (error) {
        // Check if error is due to missing pause/resume columns
        if (error.code === '42703' && error.message.includes('is_paused')) {
          console.error('[TASKS] Database migration required: pause/resume columns missing');
          console.error('[TASKS] Please run migration: add_task_pause_resume.sql');
          return res.status(500).json({ 
            error: 'Database migration required',
            message: 'The pause/resume columns are missing from the tasks table. Please run the migration: add_task_pause_resume.sql'
          });
        }
        throw error;
      }
      
      // Parse assigned_users JSON array and ensure status is included
      const tasks = result.rows.map(task => {
        if (task.assigned_users && typeof task.assigned_users === 'string') {
          try {
            task.assigned_users = JSON.parse(task.assigned_users);
          } catch (e) {
            task.assigned_users = [];
          }
        }
        // Ensure status is always present (default to 'pending' if missing)
        if (!task.status) {
          task.status = 'pending';
        }
        return task;
      });
      
      console.log(`[TASKS] Fetched ${tasks.length} tasks for user: ${req.session?.username || 'unknown'}`);
      console.log(`[TASKS] Status breakdown:`, 
        tasks.reduce((acc, t) => {
          acc[t.status] = (acc[t.status] || 0) + 1;
          return acc;
        }, {})
      );
      console.log(`[TASKS] Task codes:`, tasks.map(t => t.task_code).slice(0, 5));
      
      res.json(tasks);
    } catch (error) {
      console.error('Error fetching tasks:', error);
      res.status(500).json({ error: 'Failed to fetch tasks' });
    }
  });

  // Get task by ID
  router.get('/:id', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);
      // Get task with assigned users
      // Use subquery to avoid JSONB grouping issues
      const result = await db.query(`
        WITH task_assignments_agg AS (
          SELECT ta.task_id,
                 COALESCE(
                   json_agg(jsonb_build_object(
                     'id', u.id,
                     'full_name', u.full_name,
                     'username', u.username,
                     'email', u.email
                   )) FILTER (WHERE u.id IS NOT NULL),
                   '[]'::json
                 ) as assigned_users
          FROM task_assignments ta
          LEFT JOIN users u ON ta.user_id = u.id
          WHERE ta.task_id = $1
          GROUP BY ta.task_id
        )
        SELECT t.*, 
               a.asset_code, a.asset_name, a.asset_type,
               ct.id as template_id, ct.template_code, ct.template_name, ct.description,
               ct.asset_type as template_asset_type, ct.task_type as template_task_type,
               ct.frequency, ct.checklist_structure, ct.validation_rules, ct.cm_generation_rules,
               ct.created_at as template_created_at, ct.updated_at as template_updated_at,
               COALESCE(taa.assigned_users, '[]'::json) as assigned_users,
               pm_user.id as pm_performed_by_id,
               pm_user.full_name as pm_performed_by_name,
               pm_user.username as pm_performed_by_username,
               pm_user.email as pm_performed_by_email
        FROM tasks t
        LEFT JOIN assets a ON t.asset_id = a.id
        LEFT JOIN checklist_templates ct ON t.checklist_template_id = ct.id
        LEFT JOIN task_assignments_agg taa ON t.id = taa.task_id
        LEFT JOIN users pm_user ON t.pm_performed_by = pm_user.id
        WHERE t.id = $1
      `, [req.params.id]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Task not found' });
      }
      
      // Parse JSONB fields if they exist
      const task = result.rows[0];
      if (task.checklist_structure && typeof task.checklist_structure === 'string') {
        task.checklist_structure = JSON.parse(task.checklist_structure);
      }
      if (task.validation_rules && typeof task.validation_rules === 'string') {
        task.validation_rules = JSON.parse(task.validation_rules);
      }
      if (task.cm_generation_rules && typeof task.cm_generation_rules === 'string') {
        task.cm_generation_rules = JSON.parse(task.cm_generation_rules);
      }
      
      // Parse assigned_users JSON array
      if (task.assigned_users && typeof task.assigned_users === 'string') {
        try {
          task.assigned_users = JSON.parse(task.assigned_users);
        } catch (e) {
          task.assigned_users = [];
        }
      }
      
      res.json(task);
    } catch (error) {
      console.error('Error fetching task:', error);
      res.status(500).json({ error: 'Failed to fetch task' });
    }
  });

  // Create task (any authenticated user can create, but only superadmin can set budgeted_hours)
  router.post('/', requireAuth, validateCreateTask, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const {
        checklist_template_id,
        asset_id,
        location, // Location field for location-based tasks
        assigned_to, // Can be single user ID or array of user IDs
        task_type,
        scheduled_date,
        hours_worked,
        budgeted_hours
      } = req.body;

      // Validate required fields
      if (!checklist_template_id) {
        return res.status(400).json({ error: 'checklist_template_id is required' });
      }
      // asset_id is now optional - tasks can be location-based instead of asset-based

      // Only superadmin can set budgeted_hours
      if (budgeted_hours !== undefined && !isSuperAdmin(req)) {
        return res.status(403).json({ error: 'Only super admin can set budgeted hours' });
      }

      const taskType = task_type || 'PM';
      
      // Validate task type
      const validTaskTypes = ['PM', 'PCM', 'UCM', 'INSPECTION'];
      if (!validTaskTypes.includes(taskType)) {
        return res.status(400).json({ error: `task_type must be one of: ${validTaskTypes.join(', ')}` });
      }
      
      // Allow manual scheduling for all task types
      // If scheduled_date is provided, use it; otherwise default to today
      let finalScheduledDate;
      if (scheduled_date) {
        // Validate that scheduled_date is not in the past
        const scheduledDate = new Date(scheduled_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        scheduledDate.setHours(0, 0, 0, 0);
        
        if (scheduledDate < today) {
          return res.status(400).json({ error: 'scheduled_date cannot be in the past' });
        }
        
        finalScheduledDate = scheduled_date;
      } else {
        // Default to today if not provided
        finalScheduledDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
      }

      // Short task code: PM-ABBREV-XXXX (template-related, max ~16 chars)
      let taskCodePrefix = taskType;
      const templateRow = await db.query(
        'SELECT template_code, template_name FROM checklist_templates WHERE id = $1',
        [checklist_template_id]
      );
      if (templateRow.rows.length > 0) {
        const tc = (templateRow.rows[0].template_code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        const tn = (templateRow.rows[0].template_name || '').trim();
        if (tc && tc.length <= 8) {
          taskCodePrefix = `${taskType}-${tc}`;
        } else if (tn) {
          const abbrev = tn.split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('').replace(/[^A-Z0-9]/g, '').slice(0, 6);
          taskCodePrefix = `${taskType}-${abbrev || 'TASK'}`;
        } else {
          taskCodePrefix = `${taskType}-${(tc || 'T').slice(0, 6)}`;
        }
      }
      const task_code = `${taskCodePrefix}-${uuidv4().substring(0, 4).toUpperCase()}`;

      // Handle assigned_to - can be single ID, array of IDs, or null
      const assignedUserIds = assigned_to 
        ? (Array.isArray(assigned_to) ? assigned_to : [assigned_to]).filter(id => id)
        : [];
      
      // Set assigned_at if task is assigned (use first user for backward compatibility)
      const primaryAssignedTo = assignedUserIds.length > 0 ? assignedUserIds[0] : null;
      const assignedAt = assignedUserIds.length > 0 ? new Date() : null;

      // Get organization_id from asset or user context
      let organizationId = null;
      if (asset_id) {
        // Get organization_id from asset
        const assetResult = await db.query(
          'SELECT organization_id FROM assets WHERE id = $1',
          [asset_id]
        );
        if (assetResult.rows.length > 0) {
          organizationId = assetResult.rows[0].organization_id;
        }
      }
      
      // If no organization_id from asset, get from user context
      if (!organizationId) {
        const { getOrganizationIdFromRequest } = require('../utils/organizationFilter');
        organizationId = getOrganizationIdFromRequest(req);
      }

      const result = await db.query(
        `INSERT INTO tasks (
          task_code, checklist_template_id, asset_id, location, assigned_to, task_type, scheduled_date, 
          status, hours_worked, budgeted_hours, assigned_at, organization_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10, $11) RETURNING *`,
        [
          task_code, 
          checklist_template_id, 
          asset_id || null, // Optional - for backward compatibility
          location || null, // New location field
          primaryAssignedTo, // Keep for backward compatibility
          taskType, 
          finalScheduledDate,
          hours_worked || 0,
          budgeted_hours || null,
          assignedAt,
          organizationId
        ]
      );
      
      const task = result.rows[0];
      
      // Create task assignments for all assigned users
      if (assignedUserIds.length > 0) {
        // Insert all assignments
        for (const userId of assignedUserIds) {
          await db.query(
            `INSERT INTO task_assignments (task_id, user_id, assigned_at, assigned_by, organization_id)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (task_id, user_id) DO NOTHING`,
            [task.id, userId, assignedAt, req.session.userId, organizationId]
          );
        }
        
        // Get asset (if exists) and all assigned users for notifications
        const assetQuery = asset_id 
          ? db.query('SELECT asset_name FROM assets WHERE id = $1', [asset_id])
          : Promise.resolve({ rows: [] });
        
        const [assetResult, usersResult] = await Promise.all([
          assetQuery,
          db.query(
            `SELECT id, full_name, username, email FROM users WHERE id = ANY($1::uuid[])`,
            [assignedUserIds]
          )
        ]);
        
        task.asset_name = assetResult.rows[0]?.asset_name;
        task.location = location || null; // Include location in task object
        if (task.checklist_template_id) {
          const templateResult = await db.query(
            'SELECT template_name FROM checklist_templates WHERE id = $1',
            [task.checklist_template_id]
          );
          task.template_name = templateResult.rows[0]?.template_name || null;
        }
        const assignedUsers = usersResult.rows;

        // Creator display name for notification: "FirstName LastSurname"
        let creatorDisplayName = '';
        if (req.session.userId) {
          const creatorResult = await db.query(
            'SELECT full_name, username FROM users WHERE id = $1',
            [req.session.userId]
          );
          const full = (creatorResult.rows[0]?.full_name || creatorResult.rows[0]?.username || '').trim();
          if (full) {
            const parts = full.split(/\s+/).filter(Boolean);
            creatorDisplayName = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : parts[0];
          }
        }
        if (!creatorDisplayName) creatorDisplayName = 'Unknown';
        
        // Send notification to all assigned users
        for (const assignedUser of assignedUsers) {
          try {
            await notifyTaskAssigned(pool, {
              ...task,
              asset_name: task.asset_name || location, // Use location if no asset_name
              location: location,
              assigned_to: assignedUser.id, // For notification function compatibility
              creator_display_name: creatorDisplayName
            }, assignedUser);
          } catch (notifError) {
            console.error(`Error sending assignment notification to ${assignedUser.email}:`, notifError);
            // Don't fail task creation if notification fails
          }
        }
        
        // Add assigned_users array to task response
        task.assigned_users = assignedUsers.map(u => ({
          id: u.id,
          full_name: u.full_name,
          username: u.username,
          email: u.email
        }));
      }
      
      console.log(`Task created: ${task_code}, Type: ${taskType}, Scheduled: ${finalScheduledDate}`);
      logAudit(pool, req, { action: AUDIT_ACTIONS.TASK_CREATED, entityType: AUDIT_ENTITY_TYPES.TASK, entityId: task.id, details: { task_code: task.task_code } }).catch(() => {});
      res.status(201).json(task);
    } catch (error) {
      console.error('Error creating task:', error);
      console.error('Error details:', {
        message: error.message,
        code: error.code,
        detail: error.detail,
        constraint: error.constraint
      });
      
      // Provide more specific error messages
      if (error.code === '23503') {
        return res.status(400).json({ 
          error: 'Invalid reference', 
          details: 'The checklist_template_id or asset_id does not exist' 
        });
      }
      
      res.status(500).json({ 
        error: 'Failed to create task',
        details: error.message 
      });
    }
  });

  // Start task (only assigned users can start tasks)
  router.patch('/:id/start', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);
      // First check if task exists and if user is assigned
      const taskCheck = await db.query(
        `SELECT t.*, 
                EXISTS (
                  SELECT 1 FROM task_assignments ta 
                  WHERE ta.task_id = t.id AND ta.user_id = $2
                ) as is_assigned
         FROM tasks t 
         WHERE t.id = $1`,
        [req.params.id, req.session.userId]
      );

      if (taskCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Task not found' });
      }

      const task = taskCheck.rows[0];
      
      // Check if user is assigned (admins/super_admins can start any task)
      const role = req.session?.role;
      const isAssigned = task.is_assigned || role === 'admin' || role === 'super_admin';
      
      if (!isAssigned) {
        return res.status(403).json({ 
          error: 'You can only start tasks assigned to you',
          scheduled_date: task.scheduled_date
        });
      }

      // Check scheduled date restriction (unless can_open_before_scheduled is true)
      if (task.scheduled_date && !task.can_open_before_scheduled) {
        const scheduledDate = new Date(task.scheduled_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        scheduledDate.setHours(0, 0, 0, 0);
        
        if (scheduledDate > today) {
          return res.status(400).json({ 
            error: `Task cannot be started before scheduled date: ${task.scheduled_date}`,
            scheduled_date: task.scheduled_date
          });
        }
      }


      // Check if starting outside working hours (07:00-16:00)
      const now = new Date();
      const outsideWorkingHours = isOutsideWorkingHours(now);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // If starting outside working hours, automatically create overtime request for acknowledgement
        let overtimeRequest = null;
        if (outsideWorkingHours) {
          // Get user info
          const userResult = await client.query(
            'SELECT id, full_name, username, email FROM users WHERE id = $1',
            [req.session.userId]
          );
          const user = userResult.rows[0] || { id: req.session.userId, full_name: 'Unknown', username: 'unknown' };

          // Create overtime request for acknowledgement
          const overtimeResult = await client.query(
            `INSERT INTO overtime_requests (task_id, requested_by, request_type, request_time, status, organization_id)
             VALUES ($1, $2, 'start_after_hours', $3, 'pending', $4)
             RETURNING *`,
            [req.params.id, req.session.userId, now, task.organization_id]
          );
          overtimeRequest = overtimeResult.rows[0];

          // Send notification to super admins for acknowledgement
          try {
            await notifyOvertimeRequest(pool, overtimeRequest, { ...task, asset_name: task.asset_name }, user);
          } catch (notifError) {
            console.error('Error sending overtime notification:', notifError);
            // Don't fail the request if notification fails
          }
        }

        // Start the task
        const result = await client.query(
          `UPDATE tasks 
           SET status = 'in_progress', started_at = CURRENT_TIMESTAMP 
           WHERE id = $1 AND status = 'pending' 
           RETURNING *`,
          [req.params.id]
        );
        
        if (result.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Task cannot be started (may already be started or completed)' });
        }

        const startedTask = result.rows[0];

        // If this is a CM task (PCM/UCM) with spares_used from parent PM, deduct them now
        if ((startedTask.task_type === 'PCM' || startedTask.task_type === 'UCM' || 
             (startedTask.task_type === 'CM' && startedTask.parent_task_id)) && 
            startedTask.spares_used) {
          try {
            let sparesUsed = startedTask.spares_used;
            if (typeof sparesUsed === 'string') {
              sparesUsed = JSON.parse(sparesUsed);
            }
            
            if (Array.isArray(sparesUsed) && sparesUsed.length > 0) {
              const { v4: uuidv4 } = require('uuid');
              const slipNo = `SLIP-${Date.now()}-${uuidv4().slice(0, 6).toUpperCase()}`;
              const slipRes = await client.query(
                `INSERT INTO inventory_slips (slip_no, task_id, created_by, organization_id)
                 VALUES ($1, $2, $3, $4) RETURNING *`,
                [slipNo, req.params.id, req.session.userId || null, task.organization_id]
              );
              const slip = slipRes.rows[0];

              const updates = {};
              for (const line of sparesUsed) {
                const code = String(line.item_code || '').trim();
                const qty = parseInt(line.qty_used, 10);
                if (!code || !Number.isFinite(qty) || qty <= 0) continue;

                const itemRes = await client.query(
                  'SELECT * FROM inventory_items WHERE item_code = $1 FOR UPDATE',
                  [code]
                );
                if (itemRes.rows.length === 0) continue;
                const item = itemRes.rows[0];
                const available = item.actual_qty || 0;
                if (available - qty < 0) {
                  console.warn(`Insufficient stock for ${code}: available ${available}, requested ${qty}`);
                  continue;
                }

                const newQty = available - qty;
                await client.query('UPDATE inventory_items SET actual_qty = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newQty, item.id]);
                await client.query(
                  `INSERT INTO inventory_slip_lines (slip_id, item_id, item_code_snapshot, item_description_snapshot, qty_used)
                   VALUES ($1, $2, $3, $4, $5)`,
                  [slip.id, item.id, item.item_code, item.item_description, qty]
                );
                await client.query(
                  `INSERT INTO inventory_transactions (item_id, task_id, slip_id, tx_type, qty_change, created_by, organization_id)
                   VALUES ($1, $2, $3, 'use', $4, $5, $6)`,
                  [item.id, req.params.id, slip.id, -qty, req.session.userId || null, task.organization_id]
                );

                updates[code] = newQty;
              }

              // Update Excel Actual Qty (best-effort)
              if (Object.keys(updates).length > 0) {
                try {
                  const { updateActualQtyInExcel } = require('../utils/inventoryExcelSync');
                  await updateActualQtyInExcel(updates);
                } catch (e) {
                  console.error('Error updating Excel:', e);
                }
              }

              console.log(`Deducted ${sparesUsed.length} spare(s) from inventory when starting CM task ${startedTask.task_code}`);
            }
          } catch (spareError) {
            console.error('Error deducting spares when starting CM task:', spareError);
            // Don't fail task start if spare deduction fails, but log it
          }
        }

        await client.query('COMMIT');
        
        res.json({
          ...startedTask,
          overtime_request: overtimeRequest ? {
            id: overtimeRequest.id,
            status: overtimeRequest.status,
            message: 'Overtime work detected. Super admin has been notified for acknowledgement.'
          } : null
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error starting task:', error);
      res.status(500).json({ error: 'Failed to start task' });
    }
  });

  // Complete task
  router.patch('/:id/complete', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const { overall_status, duration_minutes, cm_occurred_at, started_at, completed_at } = req.body;
      
      const taskResult = await db.query('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
      if (taskResult.rows.length === 0) {
        return res.status(404).json({ error: 'Task not found' });
      }

      const task = taskResult.rows[0];

      // Check if task is locked (only admin/super_admin can update locked tasks)
      if (task.is_locked && !isAdmin(req)) {
        return res.status(403).json({ 
          error: 'Task is locked and can only be updated by admin or super admin' 
        });
      }

      // Technicians can only complete their own tasks
      const role = req.session?.role;
      if (role === 'technician' && task.assigned_to !== req.session.userId) {
        return res.status(403).json({ error: 'You can only complete tasks assigned to you' });
      }
      
      // For UCM tasks, use provided timestamps or current time
      let finalStartedAt = started_at ? new Date(started_at) : (task.started_at ? new Date(task.started_at) : new Date());
      let finalCompletedAt = completed_at ? new Date(completed_at) : new Date();
      let finalCmOccurredAt = cm_occurred_at ? new Date(cm_occurred_at) : null;
      
      // For other task types, use current time if not provided
      if (task.task_type !== 'UCM') {
        finalStartedAt = task.started_at ? new Date(task.started_at) : new Date();
        finalCompletedAt = new Date();
      }
      
      // Calculate duration excluding pause time
      const totalPauseDuration = task.total_pause_duration_minutes || 0;
      const rawDuration = duration_minutes || (finalStartedAt 
        ? Math.round((finalCompletedAt - finalStartedAt) / 60000)
        : null);
      
      // Subtract pause time from total duration to get actual work time
      const duration = rawDuration ? Math.max(0, rawDuration - totalPauseDuration) : null;

      // Build update query dynamically for UCM
      let updateFields = [
        'status = $1',
        'completed_at = $2',
        'overall_status = $3',
        'duration_minutes = $4'
      ];
      let updateValues = ['completed', finalCompletedAt, overall_status, duration];
      let paramCount = 5;

      // For UCM, update cm_occurred_at and started_at if provided
      if (task.task_type === 'UCM') {
        if (finalCmOccurredAt) {
          updateFields.push(`cm_occurred_at = $${paramCount++}`);
          updateValues.push(finalCmOccurredAt);
        }
        if (started_at) {
          updateFields.push(`started_at = $${paramCount++}`);
          updateValues.push(finalStartedAt);
        }
      }

      updateValues.push(req.params.id);
      const updateQuery = `UPDATE tasks 
         SET ${updateFields.join(', ')}
         WHERE id = $${paramCount} 
         RETURNING *`;

      const result = await db.query(updateQuery, updateValues);

      // Check if completing outside working hours (07:00-16:00)
      const now = new Date();
      const outsideWorkingHours = isOutsideWorkingHours(now);
      
      // If completing outside working hours, automatically create overtime request for acknowledgement
      let overtimeRequest = null;
      if (outsideWorkingHours) {
        // Get user info
        const userResult = await db.query(
          'SELECT id, full_name, username, email FROM users WHERE id = $1',
          [req.session.userId]
        );
        const user = userResult.rows[0] || { id: req.session.userId, full_name: 'Unknown', username: 'unknown' };

        // Get asset name for notification
        const assetResult = await db.query(
          'SELECT asset_name FROM assets WHERE id = $1',
          [task.asset_id]
        );
        const assetName = assetResult.rows[0]?.asset_name || 'Unknown Asset';

        // Create overtime request for acknowledgement
        const overtimeResult = await db.query(
          `INSERT INTO overtime_requests (task_id, requested_by, request_type, request_time, status, organization_id)
           VALUES ($1, $2, 'complete_after_hours', $3, 'pending', $4)
           RETURNING *`,
          [req.params.id, req.session.userId, now, task.organization_id]
        );
        overtimeRequest = overtimeResult.rows[0];

        // Send notification to super admins for acknowledgement
        try {
          await notifyOvertimeRequest(pool, overtimeRequest, { ...task, asset_name: assetName }, user);
        } catch (notifError) {
          console.error('Error sending overtime notification:', notifError);
          // Don't fail the request if notification fails
        }
      }

      // If PM task failed, generate PCM task
      if (task.task_type === 'PM' && overall_status === 'fail' && task.checklist_template_id) {
        await generateCMTask(pool, task.id, task.checklist_template_id, task.asset_id);
      }

      // Webhook event: task completed
      emitEvent(pool, 'task.completed', {
        task_id: req.params.id,
        task_code: task.task_code,
        task_type: task.task_type,
        overall_status,
        completed_at: completedAt.toISOString()
      }).catch(() => {});

      res.json({
        ...result.rows[0],
        overtime_request: overtimeRequest ? {
          id: overtimeRequest.id,
          status: overtimeRequest.status,
          message: 'Overtime work detected. Super admin has been notified for acknowledgement.'
        } : null
      });
    } catch (error) {
      console.error('Error completing task:', error);
      res.status(500).json({ error: 'Failed to complete task' });
    }
  });

  // Generate report from template (Word or Excel)
  router.get('/:id/report', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const taskId = req.params.id;
      const requestedFormat = req.query.format ? req.query.format.toLowerCase() : null; // Optional
      
      if (!taskId) {
        return res.status(400).json({ error: 'Task ID is required' });
      }

      if (requestedFormat && !['word', 'excel'].includes(requestedFormat)) {
        return res.status(400).json({ error: 'Invalid format. Must be "word" or "excel"' });
      }

      console.log(`Report request for task ID: ${taskId}, format: ${requestedFormat || 'auto'}`);

      // Get task details with location
      const taskResult = await db.query(`
        SELECT t.*, 
               a.asset_code, a.asset_name, a.asset_type, a.location,
               u.full_name as assigned_to_name,
               ct.*
        FROM tasks t
        LEFT JOIN assets a ON t.asset_id = a.id
        LEFT JOIN users u ON t.assigned_to = u.id
        LEFT JOIN checklist_templates ct ON t.checklist_template_id = ct.id
        WHERE t.id = $1
      `, [taskId]);

      if (taskResult.rows.length === 0) {
        return res.status(404).json({ 
          error: 'Task not found',
          requested_id: taskId
        });
      }

      const task = taskResult.rows[0];

      // Parse JSONB fields
      if (task.checklist_structure && typeof task.checklist_structure === 'string') {
        task.checklist_structure = JSON.parse(task.checklist_structure);
      }

      // Only allow report generation for completed tasks
      if (task.status !== 'completed') {
        return res.status(400).json({ 
          error: 'Report can only be generated for completed tasks',
          current_status: task.status 
        });
      }

      // Get checklist response with metadata
      const responseResult = await db.query(
        `SELECT cr.*, u.full_name as submitted_by_name 
         FROM checklist_responses cr 
         LEFT JOIN users u ON cr.submitted_by = u.id 
         WHERE cr.task_id = $1 
         ORDER BY cr.submitted_at DESC LIMIT 1`,
        [taskId]
      );

      // Get failed item images for this task
      const imagesResult = await db.query(
        'SELECT * FROM failed_item_images WHERE task_id = $1 ORDER BY uploaded_at ASC',
        [taskId]
      );
      const taskImages = imagesResult.rows;

      let checklistResponse = null;
      if (responseResult.rows.length > 0) {
        checklistResponse = responseResult.rows[0];
        // Parse JSONB response_data
        if (checklistResponse.response_data && typeof checklistResponse.response_data === 'string') {
          checklistResponse.response_data = JSON.parse(checklistResponse.response_data);
        }
      }

      // Map data to template format (format-agnostic)
      const templateData = mapTaskDataToTemplate(task, checklistResponse, taskImages);

      // Determine available template format automatically
      const templateCode = task.template_code || 'WS-PM-013';
      const assetType = task.asset_type || 'weather_station';

      // Probe availability
      const { getTemplatePath } = require('../utils/templateMapper');
      const wordPath = getTemplatePath('word', templateCode, assetType);
      const excelPath = getTemplatePath('excel', templateCode, assetType);

      // Decide final format:
      // 1) If client requested a format, ensure it's available, otherwise error.
      // 2) If no format requested, pick Word if available, else Excel, else error.
      let finalFormat = null;
      if (requestedFormat) {
        if (requestedFormat === 'word' && wordPath) finalFormat = 'word';
        else if (requestedFormat === 'excel' && excelPath) finalFormat = 'excel';
        else {
          return res.status(400).json({
            error: `Requested format '${requestedFormat}' not available for this template`,
            available: {
              word: !!wordPath,
              excel: !!excelPath
            }
          });
        }
      } else {
        if (wordPath) finalFormat = 'word';
        else if (excelPath) finalFormat = 'excel';
        else {
          return res.status(404).json({
            error: 'No template found for this task',
            template_code: templateCode,
            asset_type: assetType
          });
        }
      }

      // Generate document based on resolved format
      let documentBuffer;
      let fileExtension;
      let contentType;

      if (finalFormat === 'word') {
        documentBuffer = generateWordDocument(templateData, templateCode, assetType);
        fileExtension = 'docx';
        contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      } else {
        documentBuffer = await generateExcelDocument(templateData, templateCode, assetType);
        fileExtension = 'xlsx';
        contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      }

      // Generate filename
      const dateStr = new Date().toISOString().split('T')[0];
      const filename = `Task_${task.task_code}_${dateStr}.${fileExtension}`;
      
      // Save to server's reports directory: D:\PJs\ChecksheetsApp\server\reports\
      const fs = require('fs');
      const path = require('path');
      const reportsDir = path.join(__dirname, '../reports');
      
      // Ensure the reports directory exists
      if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
        console.log('Created reports directory:', reportsDir);
      }
      
      // Save file to server - ALL REPORTS MUST BE SAVED HERE
      const filePath = path.join(reportsDir, filename);
      try {
        fs.writeFileSync(filePath, documentBuffer);
        console.log(`✓ ${finalFormat.toUpperCase()} REPORT SAVED TO: ${filePath}`);
        console.log(`  Full path: ${path.resolve(filePath)}`);
      } catch (saveError) {
        console.error(`Error saving ${finalFormat} report to server:`, saveError);
        // Continue even if save fails - still send to browser
      }

      // Webhook event: report generated
      emitEvent(pool, 'report.generated', {
        task_id: taskId,
        task_code: task.task_code,
        format: finalFormat,
        filename,
        saved_path: filePath
      }).catch(() => {});

      // Send document to browser for download
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', documentBuffer.length);

      res.send(documentBuffer);
    } catch (error) {
      console.error(`Error generating ${req.query.format || 'auto'} report:`, error);
      res.status(500).json({ 
        error: `Failed to generate ${req.query.format || 'auto'} report`, 
        details: error.message 
      });
    }
  });

  // Delete single task (system_owner only)
  router.delete('/:id', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const db = getDb(req, pool);

      // Verify task exists
      const taskResult = await db.query('SELECT id, task_code FROM tasks WHERE id = $1', [id]);
      if (taskResult.rows.length === 0) {
        return res.status(404).json({ error: 'Task not found' });
      }

      const taskRow = taskResult.rows[0];
      await db.query('DELETE FROM tasks WHERE id = $1', [id]);
      logAudit(pool, req, { action: AUDIT_ACTIONS.TASK_DELETED, entityType: AUDIT_ENTITY_TYPES.TASK, entityId: id, details: { task_code: taskRow.task_code } }).catch(() => {});
      res.json({ message: `Task ${taskRow.task_code} deleted successfully` });
    } catch (error) {
      console.error('Error deleting task:', error);
      res.status(500).json({ error: 'Failed to delete task' });
    }
  });

  // Bulk delete tasks (system_owner only)
  router.post('/bulk-delete', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { ids } = req.body;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'ids array is required' });
      }

      const db = getDb(req, pool);

      // Verify tasks exist and get their codes for confirmation
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
      const taskResult = await db.query(
        `SELECT id, task_code FROM tasks WHERE id IN (${placeholders})`,
        ids
      );

      if (taskResult.rows.length === 0) {
        return res.status(404).json({ error: 'No matching tasks found' });
      }

      await db.query(`DELETE FROM tasks WHERE id IN (${placeholders})`, ids);
      const deletedCodes = taskResult.rows.map(t => t.task_code);
      logAudit(pool, req, { action: AUDIT_ACTIONS.TASK_BULK_DELETED, entityType: AUDIT_ENTITY_TYPES.TASK, details: { count: deletedCodes.length, task_codes: deletedCodes.slice(0, 5) } }).catch(() => {});
      res.json({
        message: `${taskResult.rows.length} task(s) deleted successfully`,
        deleted: deletedCodes
      });
    } catch (error) {
      console.error('Error bulk deleting tasks:', error);
      res.status(500).json({ error: 'Failed to delete tasks' });
    }
  });

  return router;
};

// Helper function to generate CM task from failed PM
async function generateCMTask(pool, pmTaskId, checklistTemplateId, assetId) {
  const db = pool; // This function runs outside request context, use pool directly
  try {
    // Get checklist template to find CM generation rules
    const templateResult = await db.query(
      'SELECT cm_generation_rules FROM checklist_templates WHERE id = $1',
      [checklistTemplateId]
    );

    if (templateResult.rows.length === 0) return;

    let cmRules = templateResult.rows[0].cm_generation_rules;
    // Parse JSONB if it's a string
    if (cmRules && typeof cmRules === 'string') {
      try {
        cmRules = JSON.parse(cmRules);
      } catch (e) {
        console.error('Error parsing cm_generation_rules:', e);
        return;
      }
    }
    if (!cmRules || !cmRules.auto_generate) return;

    // Get the PM task details
    const pmTaskResult = await db.query(
      'SELECT * FROM tasks WHERE id = $1',
      [pmTaskId]
    );
    const pmTask = pmTaskResult.rows[0];

    // Get who performed the PM task (from checklist response)
    const pmPerformedByResult = await db.query(
      `SELECT submitted_by FROM checklist_responses 
       WHERE task_id = $1 
       ORDER BY submitted_at DESC 
       LIMIT 1`,
      [pmTaskId]
    );
    const pmPerformedBy = pmPerformedByResult.rows.length > 0 
      ? pmPerformedByResult.rows[0].submitted_by 
      : null;

    // Find CM template for the same asset type
    const cmTemplateResult = await db.query(
      `SELECT * FROM checklist_templates 
       WHERE asset_type = (SELECT asset_type FROM assets WHERE id = $1) 
       AND task_type IN ('PCM', 'UCM') 
       LIMIT 1`,
      [assetId]
    );

    const cmTemplate = cmTemplateResult.rows.length > 0 ? cmTemplateResult.rows[0] : null;
    const cmTemplateId = cmTemplate ? cmTemplate.id : checklistTemplateId; // Fallback to PM template if no CM template exists

    let cmPrefix = 'PCM';
    if (cmTemplate) {
      const tc = (cmTemplate.template_code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const tn = (cmTemplate.template_name || '').trim();
      if (tc && tc.length <= 8) cmPrefix = `PCM-${tc}`;
      else if (tn) {
        const abbrev = tn.split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('').replace(/[^A-Z0-9]/g, '').slice(0, 6);
        cmPrefix = `PCM-${abbrev || 'CM'}`;
      } else if (tc) cmPrefix = `PCM-${tc.slice(0, 6)}`;
    }
    const taskCode = `${cmPrefix}-${uuidv4().substring(0, 4).toUpperCase()}`;

    // Get spares_used from PM task's checklist response (if any)
    const pmSparesResult = await db.query(
      `SELECT spares_used FROM checklist_responses 
       WHERE task_id = $1 
       ORDER BY submitted_at DESC 
       LIMIT 1`,
      [pmTaskId]
    );
    let pmSparesUsed = null;
    if (pmSparesResult.rows.length > 0 && pmSparesResult.rows[0].spares_used) {
      pmSparesUsed = pmSparesResult.rows[0].spares_used;
      // If it's already a JSONB object, stringify it for storage
      if (typeof pmSparesUsed !== 'string') {
        pmSparesUsed = JSON.stringify(pmSparesUsed);
      }
    }

    // Create CM task with spares_used from PM (stored as JSONB in task metadata)
    // Inherit organization_id from parent PM task
    const cmTaskResult = await db.query(
      `INSERT INTO tasks (
        task_code, checklist_template_id, asset_id, task_type, 
        status, parent_task_id, scheduled_date, pm_performed_by, spares_used, organization_id
      ) VALUES ($1, $2, $3, 'PCM', 'pending', $4, CURRENT_DATE, $5, $6::jsonb, $7) RETURNING *`,
      [taskCode, cmTemplateId, assetId, pmTaskId, pmPerformedBy, pmSparesUsed, pmTask.organization_id]
    );

    const cmTask = cmTaskResult.rows[0];

    // Generate CM letter
    // Inherit organization_id from task
    const letterNumber = `CM-LTR-${Date.now()}`;
    await db.query(
      `INSERT INTO cm_letters (
        task_id, parent_pm_task_id, letter_number, asset_id,
        issue_description, priority, status, organization_id
      ) VALUES ($1, $2, $3, $4, $5, $6, 'open', $7)`,
      [
        cmTask.id,
        pmTaskId,
        letterNumber,
        assetId,
        `Corrective maintenance required due to failed PM task: ${pmTask.task_code}`,
        cmRules.default_priority || 'medium',
        pmTask.organization_id
      ]
    );

    console.log(`CM task ${cmTask.task_code} generated from failed PM task ${pmTask.task_code}`);
  } catch (error) {
    console.error('Error generating CM task:', error);
  }
}

