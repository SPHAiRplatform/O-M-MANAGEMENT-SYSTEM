/**
 * Notification Utility
 * Handles creating and managing notifications for users
 */

const crypto = require('crypto');
const { sendTaskAssignmentEmail, sendTaskReminderEmail } = require('./email');

/**
 * Generate a deterministic idempotency key for a notification
 * This key uniquely identifies a notification based on its content
 * @param {Object} notificationData - Notification data
 * @returns {string} Idempotency key
 */
function generateIdempotencyKey(notificationData) {
  const { user_id, type, task_id, metadata } = notificationData;
  const metadataObj = metadata ? (typeof metadata === 'string' ? JSON.parse(metadata) : metadata) : null;
  
  // Build identifying fields based on notification type
  let identifyingFields = {
    user_id,
    type,
    task_id: task_id || null
  };
  
  // Add type-specific identifying fields
  if (type === 'tracker_status_request' || type.startsWith('tracker_status_')) {
    // For tracker status notifications, use request_id, task_type, status_type
    identifyingFields.request_id = metadataObj?.request_id || null;
    identifyingFields.task_type = metadataObj?.task_type || null;
    identifyingFields.status_type = metadataObj?.status_type || null;
    // Round timestamp to minute to prevent duplicates from rapid submissions
    const now = new Date();
    identifyingFields.time_bucket = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  } else if (type === 'task_assigned' || type === 'task_reminder') {
    // For task notifications, use task_id and scheduled_date
    identifyingFields.task_id = task_id;
    identifyingFields.scheduled_date = metadataObj?.scheduled_date || metadataObj?.task?.scheduled_date || null;
  } else if (type.startsWith('early_completion_')) {
    // For early completion, use request_id
    identifyingFields.request_id = metadataObj?.request_id || null;
  } else if (type === 'task_flagged') {
    // For flagged tasks, use task_id
    identifyingFields.task_id = task_id;
  } else if (type === 'overtime_request') {
    // For overtime requests, use overtime_request_id
    identifyingFields.overtime_request_id = metadataObj?.overtime_request_id || null;
    identifyingFields.request_type = metadataObj?.request_type || null;
  }
  
  // Create a deterministic hash from the identifying fields
  const keyString = JSON.stringify(identifyingFields);
  const hash = crypto.createHash('sha256').update(keyString).digest('hex').substring(0, 16);
  
  // Return a readable key format: {user_id}_{type}_{hash}
  return `${user_id}_${type}_${hash}`;
}

/**
 * Create a notification for a user with idempotency protection
 * @param {Object} pool - Database connection pool
 * @param {Object} notificationData - Notification data
 * @param {string} notificationData.user_id - User ID to notify
 * @param {string} notificationData.task_id - Task ID (optional)
 * @param {string} notificationData.type - Notification type
 * @param {string} notificationData.title - Notification title
 * @param {string} notificationData.message - Notification message
 * @param {Object} notificationData.metadata - Additional metadata (optional)
 */
async function createNotification(pool, notificationData) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { user_id, task_id, type, title, message, metadata } = notificationData;
    
    // Get user's organization_id and roles to determine if they're system_owner
    const userResult = await client.query(
      'SELECT organization_id, role, roles FROM users WHERE id = $1',
      [user_id]
    );
    
    let organizationId = null;
    if (userResult.rows.length > 0) {
      const user = userResult.rows[0];
      // Check if user is system_owner (platform creator - doesn't belong to any organization)
      const userRoles = user.roles ? (typeof user.roles === 'string' ? JSON.parse(user.roles) : user.roles) : [user.role];
      const isSystemOwner = userRoles.includes('system_owner') || user.role === 'system_owner' || userRoles.includes('super_admin') || user.role === 'super_admin';
      
      // For system_owner users, organization_id can be NULL
      // For regular tenant users, use their organization_id
      if (!isSystemOwner && user.organization_id) {
        organizationId = user.organization_id;
      }
      // If system_owner, organizationId remains null
    }
    
    // Generate deterministic idempotency key
    const idempotencyKey = generateIdempotencyKey(notificationData);
    
    // Enhanced logging
    const metadataObj = metadata ? (typeof metadata === 'string' ? JSON.parse(metadata) : metadata) : null;
    const requestId = metadataObj?.request_id || null;
    
    console.log(`[NOTIFICATIONS] Creating notification with idempotency key:`, {
      user_id,
      type,
      title,
      request_id: requestId,
      organization_id: organizationId,
      idempotency_key: idempotencyKey,
      timestamp: new Date().toISOString()
    });
    
    // Application-level check: Check if notification with this idempotency key already exists
    // Use SELECT FOR UPDATE to lock the row and prevent concurrent inserts
    const existingCheck = await client.query(
      `SELECT id, created_at FROM notifications 
       WHERE idempotency_key = $1
       FOR UPDATE`,
      [idempotencyKey]
    );
    
    if (existingCheck.rows.length > 0) {
      console.log(`[NOTIFICATIONS] ⚠️ Duplicate notification detected by idempotency key, returning existing:`, {
        user_id,
        type,
        idempotency_key: idempotencyKey,
        existing_id: existingCheck.rows[0].id,
        existing_created_at: existingCheck.rows[0].created_at
      });
      await client.query('COMMIT');
      return { id: existingCheck.rows[0].id };
    }
    
    // Insert notification with idempotency key and organization_id
    // The application-level check above should prevent most duplicates
    // If a duplicate still occurs (race condition), the unique index will prevent it
    // organization_id can be NULL for system_owner users
    const result = await client.query(
      `INSERT INTO notifications (user_id, organization_id, task_id, type, title, message, metadata, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, created_at`,
      [
        user_id,
        organizationId, // Can be NULL for system users
        task_id || null, 
        type, 
        title, 
        message, 
        metadata ? JSON.stringify(metadata) : null,
        idempotencyKey
      ]
    );
    
    // If insert was skipped due to conflict, fetch the existing notification
    if (result.rows.length === 0) {
      const existing = await client.query(
        `SELECT id, created_at FROM notifications 
         WHERE idempotency_key = $1`,
        [idempotencyKey]
      );
      
      if (existing.rows.length > 0) {
        console.log(`[NOTIFICATIONS] ⚠️ Notification already exists (database conflict), returning existing:`, {
          idempotency_key: idempotencyKey,
          existing_id: existing.rows[0].id
        });
        await client.query('COMMIT');
        return { id: existing.rows[0].id };
      }
    }
    
    await client.query('COMMIT');
    
    console.log(`[NOTIFICATIONS] ✅ Notification created successfully:`, {
      id: result.rows[0].id,
      user_id,
      type,
      request_id: requestId,
      idempotency_key: idempotencyKey,
      created_at: result.rows[0].created_at
    });
    
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    
    // Check if error is due to unique constraint violation (additional safety)
    if (error.code === '23505') {
      console.log(`[NOTIFICATIONS] ⚠️ Unique constraint violation (duplicate prevented by database):`, {
        user_id: notificationData.user_id,
        type: notificationData.type,
        idempotency_key: generateIdempotencyKey(notificationData),
        error: error.message
      });
      
      // Try to fetch the existing notification
      try {
        const idempotencyKey = generateIdempotencyKey(notificationData);
        const existing = await pool.query(
          `SELECT id FROM notifications 
           WHERE idempotency_key = $1
           ORDER BY created_at DESC LIMIT 1`,
          [idempotencyKey]
        );
        if (existing.rows.length > 0) {
          return { id: existing.rows[0].id };
        }
      } catch (fetchError) {
        console.error('[NOTIFICATIONS] Error fetching existing notification:', fetchError);
      }
    }
    
    console.error('[NOTIFICATIONS] ❌ Error creating notification:', {
      error: error.message,
      code: error.code,
      user_id: notificationData.user_id,
      type: notificationData.type,
      idempotency_key: generateIdempotencyKey(notificationData)
    });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Resolve task display name: template_name if available, else task_code.
 * Fetches from DB when task has checklist_template_id but no template_name.
 */
async function getTaskDisplayName(pool, task) {
  if (task.template_name) return task.template_name;
  if (!task.checklist_template_id) return task.task_code || 'Task';
  try {
    const res = await pool.query(
      'SELECT template_name FROM checklist_templates WHERE id = $1',
      [task.checklist_template_id]
    );
    const name = res.rows[0]?.template_name;
    return (name && name.trim()) ? name : (task.task_code || 'Task');
  } catch (e) {
    return task.task_code || 'Task';
  }
}

/**
 * Create task assignment notification
 * Sends email first (primary), then creates in-app notification (secondary)
 */
async function notifyTaskAssigned(pool, task, assignedUser) {
  const taskDetails = {
    task_code: task.task_code,
    task_type: task.task_type,
    scheduled_date: task.scheduled_date,
    asset_name: task.asset_name || 'Unknown Asset'
  };

  const taskDisplayName = await getTaskDisplayName(pool, task);
  const creatorLabel = (task.creator_display_name && task.creator_display_name.trim()) ? task.creator_display_name.trim() : 'Unknown';
  const scheduledStr = task.scheduled_date
    ? new Date(task.scheduled_date).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
    : 'TBD';
  const messageLines = [
    `You have been assigned a new ${task.task_type} task: ${taskDisplayName} for ${taskDetails.asset_name}. Scheduled for ${scheduledStr}.`,
    '',
    `Assigned by ${creatorLabel}`
  ];
  const message = messageLines.join('\n');

  // PRIMARY: Send email notification first
  try {
    const emailResult = await sendTaskAssignmentEmail(assignedUser, {
      ...task,
      asset_name: taskDetails.asset_name,
      task_display_name: taskDisplayName,
      creator_display_name: creatorLabel
    });
    
    if (emailResult.success) {
      console.log(`Email notification sent successfully to ${assignedUser.email} for task ${task.task_code}`);
    } else {
      console.warn(`Email notification failed for ${assignedUser.email}: ${emailResult.reason || emailResult.error}`);
    }
  } catch (emailError) {
    console.error('Error sending task assignment email:', emailError);
    // Continue with in-app notification even if email fails
  }
  
  // SECONDARY: Create in-app notification
  return await createNotification(pool, {
    user_id: task.assigned_to,
    task_id: task.id,
    type: 'task_assigned',
    title: 'New Task Assigned',
    message,
    metadata: {
      task: taskDetails,
      highlight: true, // Highlight this task
      scheduled_date: task.scheduled_date
    }
  });
}

/**
 * Create task reminder notification (3 days before)
 * Sends email first (primary), then creates in-app notification (secondary)
 */
async function notifyTaskReminder(pool, task, assignedUser) {
  const taskDetails = {
    task_code: task.task_code,
    task_type: task.task_type,
    scheduled_date: task.scheduled_date,
    asset_name: task.asset_name || 'Unknown Asset'
  };

  const taskDisplayName = await getTaskDisplayName(pool, task);
  
  // PRIMARY: Send email notification first
  try {
    const emailResult = await sendTaskReminderEmail(assignedUser, {
      ...task,
      asset_name: taskDetails.asset_name,
      task_display_name: taskDisplayName
    });
    
    if (emailResult.success) {
      console.log(`Reminder email sent successfully to ${assignedUser.email} for task ${task.task_code}`);
    } else {
      console.warn(`Reminder email failed for ${assignedUser.email}: ${emailResult.reason || emailResult.error}`);
    }
  } catch (emailError) {
    console.error('Error sending task reminder email:', emailError);
    // Continue with in-app notification even if email fails
  }
  
  // SECONDARY: Create in-app notification
  return await createNotification(pool, {
    user_id: task.assigned_to,
    task_id: task.id,
    type: 'task_reminder',
    title: 'Task Reminder - Due Soon',
    message: `Reminder: Your ${task.task_type} task "${taskDisplayName}" for ${taskDetails.asset_name} is scheduled in 3 days (${new Date(task.scheduled_date).toLocaleDateString()}).`,
    metadata: {
      task: taskDetails,
      highlight: true,
      scheduled_date: task.scheduled_date,
      days_until: 3
    }
  });
}

/**
 * Notify org-scoped admins when task is flagged (budget exceeded).
 * System owner (platform) must not receive company notifications; only admins
 * in the same organization as the task are notified.
 */
async function notifyTaskFlagged(pool, task, assignedUser) {
  const organizationId = task.organization_id ?? null;
  if (!organizationId) {
    return [];
  }

  // Only notify admins that belong to the task's organization (excludes platform system owners with NULL org)
  const orgAdmins = await pool.query(
    `SELECT id FROM users 
     WHERE organization_id = $1
       AND is_active = true
       AND (
         role IN ('admin', 'super_admin')
         OR (roles IS NOT NULL AND roles::text LIKE '%"operations_admin"%')
       )`,
    [organizationId]
  );

  const notifications = [];
  for (const admin of orgAdmins.rows) {
    const notification = await createNotification(pool, {
      user_id: admin.id,
      task_id: task.id,
      type: 'task_flagged',
      title: 'Task Flagged - Budget Exceeded',
      message: `Task ${task.task_code} assigned to ${assignedUser.full_name || assignedUser.username} has exceeded budgeted hours (${task.budgeted_hours}h budgeted, ${task.hours_worked}h worked) and is not yet completed.`,
      metadata: {
        task: {
          task_code: task.task_code,
          task_type: task.task_type,
          assigned_to_name: assignedUser.full_name || assignedUser.username,
          budgeted_hours: task.budgeted_hours,
          hours_worked: task.hours_worked
        }
      }
    });
    notifications.push(notification);
  }

  return notifications;
}

/**
 * Notify org-scoped admins about overtime work request.
 * System owner (platform) must not receive company notifications; only admins
 * in the same organization as the task are notified.
 * @param {Object} pool - Database connection pool
 * @param {Object} overtimeRequest - Overtime request object
 * @param {Object} task - Task object (must include organization_id)
 * @param {Object} user - User who requested overtime
 */
async function notifyOvertimeRequest(pool, overtimeRequest, task, user) {
  try {
    const organizationId = task.organization_id ?? null;
    if (!organizationId) {
      return [];
    }

    // Only notify admins that belong to the task's organization (excludes platform system owners)
    const orgAdmins = await pool.query(
      `SELECT id, full_name, email, username FROM users 
       WHERE organization_id = $1
         AND is_active = true
         AND (
           role IN ('admin', 'super_admin')
           OR (roles IS NOT NULL AND roles::text LIKE '%"operations_admin"%')
         )`,
      [organizationId]
    );

    if (orgAdmins.rows.length === 0) {
      return [];
    }

    const notifications = [];
    const taskDetails = {
      task_code: task.task_code,
      task_type: task.task_type,
      asset_name: task.asset_name || 'Unknown Asset'
    };

    const requestTypeText = overtimeRequest.request_type === 'start_after_hours'
      ? 'starting a task'
      : 'completing a task';

    for (const admin of orgAdmins.rows) {
      const message = `${user.full_name || user.username} is requesting approval for ${requestTypeText} outside working hours (07:00-16:00). Task: ${task.task_code}`;

      const notification = await createNotification(pool, {
        user_id: admin.id,
        task_id: task.id,
        type: 'overtime_request',
        title: 'Overtime Work - Acknowledgement Required',
        message: message,
        metadata: {
          overtime_request_id: overtimeRequest.id,
          task: taskDetails,
          requested_by: {
            id: user.id,
            full_name: user.full_name,
            username: user.username
          },
          request_type: overtimeRequest.request_type,
          request_time: overtimeRequest.request_time,
          current_time: new Date().toISOString()
        }
      });

      notifications.push(notification);
    }

    console.log(`Overtime request notifications sent to ${orgAdmins.rows.length} org admin(s) for task ${task.task_code}`);
    return notifications;
  } catch (error) {
    console.error('Error sending overtime request notifications:', error);
    return [];
  }
}

/**
 * Notify user about early completion request status
 */
async function notifyEarlyCompletionStatus(pool, request, task, approved) {
  const status = approved ? 'approved' : 'rejected';
  const title = approved 
    ? 'Early Completion Request Approved' 
    : 'Early Completion Request Rejected';
  const message = approved
    ? `Your request to complete task ${task.task_code} before its scheduled date has been approved. The task is now available for completion.`
    : `Your request to complete task ${task.task_code} before its scheduled date has been rejected. Reason: ${request.rejection_reason || 'Not specified'}`;
  
  return await createNotification(pool, {
    user_id: request.requested_by,
    task_id: task.id,
    type: `early_completion_${status}`,
    title: title,
    message: message,
    metadata: {
      task: {
        task_code: task.task_code,
        scheduled_date: task.scheduled_date
      },
      request_id: request.id
    }
  });
}

/**
 * Schedule reminder notifications (to be called by a cron job or scheduled task)
 * This should check for tasks scheduled 3 days from now and create reminders
 */
async function scheduleReminders(pool) {
  try {
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
    const targetDate = threeDaysFromNow.toISOString().split('T')[0];
    
    // Find tasks scheduled exactly 3 days from now that haven't been completed
    // Get all assigned users for each task
    const tasks = await pool.query(
      `SELECT DISTINCT t.*, a.asset_name, ct.template_name
       FROM tasks t
       LEFT JOIN assets a ON t.asset_id = a.id
       LEFT JOIN checklist_templates ct ON t.checklist_template_id = ct.id
       WHERE t.scheduled_date = $1
         AND t.status NOT IN ('completed', 'cancelled')
         AND EXISTS (
           SELECT 1 FROM task_assignments ta WHERE ta.task_id = t.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM notifications n
           WHERE n.task_id = t.id
             AND n.type = 'task_reminder'
             AND n.created_at::date = CURRENT_DATE
         )`,
      [targetDate]
    );
    
    // For each task, get all assigned users and send reminders
    for (const task of tasks.rows) {
      const assignedUsers = await pool.query(
        `SELECT u.id, u.full_name, u.username, u.email
         FROM task_assignments ta
         JOIN users u ON ta.user_id = u.id
         WHERE ta.task_id = $1`,
        [task.id]
      );
      
      // Send reminder to each assigned user
      for (const assignedUser of assignedUsers.rows) {
        await notifyTaskReminder(pool, task, {
          full_name: assignedUser.full_name,
          username: assignedUser.username,
          email: assignedUser.email || null
        });
      }
    }
    
    console.log(`Scheduled ${tasks.rows.length} reminder notifications for ${targetDate}`);
    return tasks.rows.length;
  } catch (error) {
    console.error('Error scheduling reminders:', error);
    throw error;
  }
}


module.exports = {
  createNotification,
  notifyTaskAssigned,
  notifyTaskReminder,
  notifyTaskFlagged,
  notifyOvertimeRequest,
  notifyEarlyCompletionStatus,
  scheduleReminders
};
