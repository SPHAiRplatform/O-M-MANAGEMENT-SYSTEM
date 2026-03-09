const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { parsePlantMap } = require('../utils/plantMapParser');
const { requireAuth, requireAdmin, isAdmin, isSuperAdmin, requireSuperAdmin } = require('../middleware/auth');
const { requireFeature } = require('../middleware/requireFeature');
const { createNotification } = require('../utils/notifications');
const { getCompanySubDir, getOrganizationSlugFromRequest, getOrganizationIdFromRequest } = require('../utils/organizationStorage');
const { getDb } = require('../middleware/tenantContext');

module.exports = (pool) => {
  const router = express.Router();
  router.use(requireFeature(pool, 'plant'));

  /**
   * Helper function to save map structure to company-scoped file
   *
   * IMPORTANT: This function now correctly handles system owners who have selected a company.
   * System owners have organizationId = null but CAN have a valid organizationSlug from their
   * selected company (stored in session). We get organizationSlug FIRST to ensure file saves
   * work for system owners.
   *
   * @param {Object} req - Express request object
   * @param {Array} structure - Map structure array
   * @param {number} version - Version number
   * @param {string} organizationId - Organization ID (optional, can be null for system owners)
   * @returns {Promise<{success: boolean, error?: string, filePath?: string, skipped?: boolean}>}
   */
  async function saveMapStructureToFile(req, structure, version, organizationId = null, labels = null) {
    const db = getDb(req, pool);
    try {
      // CRITICAL FIX: Get organizationSlug FIRST, before checking organizationId
      // This ensures system owners who have selected a company can still save files
      // Even though their organizationId is null, they have a valid organizationSlug
      const organizationSlug = await getOrganizationSlugFromRequest(req, pool);

      // If no organizationId provided, try to get it from user's record (for non-system-owners)
      if (!organizationId) {
        if (req.session && req.session.userId) {
          try {
            const userResult = await db.query(
              'SELECT organization_id, role, roles FROM users WHERE id = $1',
              [req.session.userId]
            );
            if (userResult.rows.length > 0) {
              const user = userResult.rows[0];
              const userRoles = user.roles ? (typeof user.roles === 'string' ? JSON.parse(user.roles) : user.roles) : [user.role];
              const isSystemOwner = userRoles.includes('system_owner') || user.role === 'system_owner' || userRoles.includes('super_admin') || user.role === 'super_admin';
              // For non-system-owners, use their organization_id
              if (!isSystemOwner && user.organization_id) {
                organizationId = user.organization_id;
              }
              // For system owners: organizationId stays null, but we already have organizationSlug
            }
          } catch (dbError) {
            console.error('[PLANT] Error fetching user organization_id for file save:', dbError);
            // Continue - we might still have organizationSlug
          }
        }
      }

      // CRITICAL: Skip only if we have NEITHER organizationId NOR organizationSlug
      // System owners will have organizationSlug but not organizationId - that's OK!
      if (!organizationSlug) {
        console.log('[PLANT] No organization slug found, skipping file save');
        console.log('[PLANT] (This is expected for system owners who have not selected a company)');
        return { success: true, skipped: true };
      }

      // We have organizationSlug - proceed with file save
      // organizationId may be null for system owners, and that's OK
      console.log(`[PLANT] Saving map structure for organization slug: ${organizationSlug} (organizationId: ${organizationId || 'null - system owner'})`);

      const plantDir = getCompanySubDir(organizationSlug, 'plant');
      const mapFilePath = path.join(plantDir, 'map-structure.json');

      // Ensure directory exists
      try {
        if (!fs.existsSync(plantDir)) {
          fs.mkdirSync(plantDir, { recursive: true });
          console.log(`[PLANT] Created plant directory: ${plantDir}`);
        }
      } catch (dirError) {
        console.error('[PLANT] Error creating plant directory:', dirError);
        return { success: false, error: `Failed to create directory: ${dirError.message}` };
      }

      const mapData = {
        structure: structure,
        version: version,
        updated_at: new Date().toISOString(),
        organization_id: organizationId, // Can be null for system owners
        organization_slug: organizationSlug
      };

      // Include custom labels: use provided labels, or preserve existing ones from file
      if (labels) {
        mapData.labels = labels;
      } else if (fs.existsSync(mapFilePath)) {
        try {
          const existingData = JSON.parse(fs.readFileSync(mapFilePath, 'utf8'));
          if (existingData.labels) {
            mapData.labels = existingData.labels;
          }
        } catch (_) { /* ignore parse errors */ }
      }

      // Validate structure before saving
      if (!Array.isArray(structure)) {
        return { success: false, error: 'Structure must be an array' };
      }

      // Write file with error handling
      try {
        fs.writeFileSync(mapFilePath, JSON.stringify(mapData, null, 2), { encoding: 'utf8', flag: 'w' });
        console.log(`[PLANT] ✅ Saved map structure to company folder: ${mapFilePath} (version ${version}, ${structure.length} trackers)`);
        return { success: true, filePath: mapFilePath };
      } catch (writeError) {
        console.error('[PLANT] ❌ Error writing map structure file:', {
          error: writeError.message,
          code: writeError.code,
          path: mapFilePath,
          stack: writeError.stack
        });
        return { success: false, error: `Failed to write file: ${writeError.message}` };
      }
    } catch (error) {
      console.error('[PLANT] ❌ Unexpected error in saveMapStructureToFile:', {
        error: error.message,
        stack: error.stack,
        organizationId,
        version
      });
      return { success: false, error: `Unexpected error: ${error.message}` };
    }
  }

  // Get parsed plant map data (from Excel - legacy)
  router.get('/map-data', requireAuth, async (req, res) => {
    try {
      console.log('[PLANT] Request received for /map-data');
      const mapData = await parsePlantMap();
      console.log(`[PLANT] Map data parsed successfully: ${mapData.cells.length} cells`);
      res.json(mapData);
    } catch (error) {
      console.error('[PLANT] Error getting map data:', error);
      console.error('[PLANT] Error stack:', error.stack);
      res.status(500).json({ error: 'Failed to parse plant map', details: error.message });
    }
  });

  // Get plant map structure from company-scoped folder
  router.get('/structure', requireAuth, async (req, res) => {
    try {
      console.log('[PLANT] Request received for /structure');
      
      // System owners without a selected company should see no plant data
      const { isSystemOwnerWithoutCompany } = require('../utils/organizationFilter');
      if (isSystemOwnerWithoutCompany(req)) {
        return res.json({ structure: [], version: 0 });
      }
      
      // Get organization slug from request context
      const organizationSlug = await getOrganizationSlugFromRequest(req, pool);
      
      // If no organization slug, return empty structure (system owner without company)
      if (!organizationSlug) {
        console.log('[PLANT] No organization context, returning empty structure');
        return res.json({ structure: [], version: 0 });
      }
      
      // Try to load from company-scoped plant folder first
      const plantDir = getCompanySubDir(organizationSlug, 'plant');
      const mapFilePath = path.join(plantDir, 'map-structure.json');
      
      if (fs.existsSync(mapFilePath)) {
        try {
          const fileContent = fs.readFileSync(mapFilePath, 'utf8');
          if (!fileContent || fileContent.trim().length === 0) {
            console.warn('[PLANT] Map structure file is empty, falling back to database');
            // Fall through to database fallback
          } else {
            const mapData = JSON.parse(fileContent);
            if (!mapData || !Array.isArray(mapData.structure)) {
              console.warn('[PLANT] Invalid map structure format in file, falling back to database');
              // Fall through to database fallback
            } else {
              console.log(`[PLANT] ✅ Loaded map structure from file (version ${mapData.version}) with ${mapData.structure.length} trackers`);
              return res.json({
                structure: mapData.structure,
                version: mapData.version || 0,
                labels: mapData.labels || null
              });
            }
          }
        } catch (fileError) {
          console.error('[PLANT] ❌ Error reading map structure file:', {
            error: fileError.message,
            code: fileError.code,
            path: mapFilePath,
            stack: fileError.stack
          });
          // Fall through to database fallback
        }
      }
      
      // NO DATABASE FALLBACK - Plant maps must be in company folder
      // This ensures data isolation - each company has its own map
      console.log('[PLANT] Map structure file not found in company folder, returning empty structure');
      console.log('[PLANT] Plant maps must be stored in: uploads/companies/{slug}/plant/map-structure.json');
      return res.json({ structure: [], version: 0 });
    } catch (error) {
      console.error('[PLANT] Error getting structure:', error);
      res.status(500).json({ error: 'Failed to get plant map structure', details: error.message });
    }
  });

  // Save plant map structure to database
  router.post('/structure', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const { structure, labels } = req.body;

      if (!Array.isArray(structure)) {
        return res.status(400).json({ error: 'Structure must be an array' });
      }

      console.log(`[PLANT] Saving structure with ${structure.length} trackers`);
      
      // Get user's organization_id (if authenticated)
      let organizationId = null;
      if (req.session && req.session.userId) {
        const userResult = await db.query(
          'SELECT organization_id, role, roles FROM users WHERE id = $1',
          [req.session.userId]
        );
        if (userResult.rows.length > 0) {
          const user = userResult.rows[0];
          const userRoles = user.roles ? (typeof user.roles === 'string' ? JSON.parse(user.roles) : user.roles) : [user.role];
          const isSystemOwner = userRoles.includes('system_owner') || user.role === 'system_owner' || userRoles.includes('super_admin') || user.role === 'super_admin';
          // For system_owner users, organization_id can be NULL
          // For regular tenant users, use their organization_id
          if (!isSystemOwner && user.organization_id) {
            organizationId = user.organization_id;
          }
        }
      }
      
      // Get current version (filtered by organization_id if available)
      let versionQuery = 'SELECT version FROM plant_map_structure';
      const versionParams = [];
      if (organizationId) {
        versionQuery += ' WHERE organization_id = $1';
        versionParams.push(organizationId);
      }
      versionQuery += ' ORDER BY version DESC LIMIT 1';
      
      const currentResult = await db.query(versionQuery, versionParams);
      
      const newVersion = currentResult.rows.length > 0 
        ? currentResult.rows[0].version + 1 
        : 1;
      
      // Insert new version
      await db.query(`
        INSERT INTO plant_map_structure (structure_data, version, organization_id)
        VALUES ($1, $2, $3)
      `, [JSON.stringify(structure), newVersion, organizationId]);
      
      // Also save to company-scoped folder (if organization context exists)
      const fileSaveResult = await saveMapStructureToFile(req, structure, newVersion, organizationId, labels || null);
      if (!fileSaveResult.success && !fileSaveResult.skipped) {
        console.warn('[PLANT] ⚠️ File save failed (non-critical):', fileSaveResult.error);
      }

      console.log(`[PLANT] Structure saved successfully, version ${newVersion}`);

      res.json({ success: true, version: newVersion, count: structure.length });
    } catch (error) {
      console.error('[PLANT] Error saving structure:', error);
      res.status(500).json({ error: 'Failed to save plant map structure', details: error.message });
    }
  });

  // Serve the grasscutting Excel file from company-scoped folder
  router.get('/grasscutting.xlsx', requireAuth, async (req, res) => {
    try {
      // Get organization slug from request context
      const organizationSlug = await getOrganizationSlugFromRequest(req, pool);
      
      let filePath = null;
      let plantDir = null;
      
      // Try company-scoped folder first (if organization context exists)
      if (organizationSlug) {
        plantDir = getCompanySubDir(organizationSlug, 'plant');
        filePath = path.join(plantDir, 'grasscutting.xlsx');
      
        // Fallback to old location if not found in company folder
        if (!fs.existsSync(filePath)) {
          filePath = path.join(__dirname, '../plant/grasscutting.xlsx');
        }
      } else {
        // No organization context, use old location
        filePath = path.join(__dirname, '../plant/grasscutting.xlsx');
      }
      
      // Security check: prevent directory traversal
      const resolvedPath = path.resolve(filePath);
      const allowedDirs = plantDir 
        ? [path.resolve(plantDir), path.resolve(__dirname, '../plant')]
        : [path.resolve(__dirname, '../plant')];
      
      const isAllowed = allowedDirs.some(allowedDir => resolvedPath.startsWith(allowedDir));
      if (!isAllowed) {
        console.error('[PLANT] Directory traversal blocked');
        return res.status(403).json({ error: 'Forbidden' });
      }
      
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        console.error('[PLANT] File not found:', filePath);
        return res.status(404).json({ error: 'Plant file not found' });
      }
      
      // Set headers for Excel file
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'inline; filename="grasscutting.xlsx"');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
      
      // Stream the file
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
      
      fileStream.on('error', (err) => {
        console.error('[PLANT] Error streaming file:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Error reading plant file' });
        }
      });
    } catch (error) {
      console.error('[PLANT] Error serving plant file:', error);
      res.status(500).json({ error: 'Failed to serve plant file' });
    }
  });

  // ============================================
  // TRACKER STATUS REQUEST ENDPOINTS
  // ============================================

  // Submit tracker status request (any authenticated user)
  router.post('/tracker-status-request', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const { tracker_ids, task_type, status_type, message } = req.body;
      const userId = req.session.userId;

      console.log('[PLANT] Tracker status request received:', {
        userId,
        tracker_ids,
        task_type,
        status_type,
        hasSession: !!req.session,
        sessionUserId: req.session?.userId,
        timestamp: new Date().toISOString()
      });

      // Check if user is authenticated
      if (!userId) {
        console.error('[PLANT] No userId in session');
        return res.status(401).json({ error: 'User not authenticated' });
      }

      // Validation
      if (!Array.isArray(tracker_ids) || tracker_ids.length === 0) {
        return res.status(400).json({ error: 'tracker_ids must be a non-empty array' });
      }
      if (!['grass_cutting', 'panel_wash'].includes(task_type)) {
        return res.status(400).json({ error: 'task_type must be "grass_cutting" or "panel_wash"' });
      }
      if (!['done', 'halfway'].includes(status_type)) {
        return res.status(400).json({ error: 'status_type must be "done" or "halfway"' });
      }

      // Check for duplicate request (same user, same trackers, same type, same status within last 30 seconds)
      const duplicateCheck = await db.query(
        `SELECT id, created_at FROM tracker_status_requests 
         WHERE user_id = $1 
         AND tracker_ids = $2 
         AND task_type = $3 
         AND status_type = $4 
         AND status = 'pending'
         AND created_at > NOW() - INTERVAL '30 seconds'`,
        [userId, tracker_ids, task_type, status_type]
      );

      if (duplicateCheck.rows.length > 0) {
        console.log(`[PLANT] ⚠️ Duplicate request detected and prevented:`, {
          userId,
          tracker_ids,
          task_type,
          status_type,
          existing_id: duplicateCheck.rows[0].id,
          existing_created_at: duplicateCheck.rows[0].created_at
        });
        return res.status(409).json({ 
          error: 'Duplicate request detected',
          message: 'A similar request was submitted recently. Please wait a moment before submitting again.',
          existing_request_id: duplicateCheck.rows[0].id
        });
      }

      // Get user info including organization_id and roles
      const userResult = await db.query(
        'SELECT full_name, username, organization_id, role, roles FROM users WHERE id = $1', 
        [userId]
      );
      if (userResult.rows.length === 0) {
        console.error('[PLANT] User not found in database:', userId);
        return res.status(404).json({ error: 'User not found' });
      }
      const user = userResult.rows[0];

      // Check if user is system_owner (platform creator - doesn't belong to any organization)
      const userRoles = user.roles ? (typeof user.roles === 'string' ? JSON.parse(user.roles) : user.roles) : [user.role];
      const isSystemOwner = userRoles.includes('system_owner') || user.role === 'system_owner' || userRoles.includes('super_admin') || user.role === 'super_admin';

      // For system_owner users, organization_id can be NULL
      // For regular tenant users, organization_id is required
      if (!isSystemOwner && !user.organization_id) {
        console.error('[PLANT] User has no organization_id:', userId);
        return res.status(400).json({ error: 'User is not associated with an organization' });
      }

      // Create request
      // Note: tracker_ids is a TEXT[] array in PostgreSQL, so we pass it as an array
      // organization_id can be NULL for system_owner users
      const result = await db.query(
        `INSERT INTO tracker_status_requests (user_id, organization_id, tracker_ids, task_type, status_type, message, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending')
         RETURNING *`,
        [userId, user.organization_id || null, tracker_ids, task_type, status_type, message || null]
      );

      const request = result.rows[0];

      // Only create in-app notifications for admins in the same organization (system owner must not receive company notifications)
      const requestOrgId = request.organization_id ?? null;
      let adminsResult = { rows: [] };
      if (requestOrgId) {
        adminsResult = await db.query(
          `SELECT DISTINCT id, full_name, username FROM users 
           WHERE is_active = true
             AND organization_id = $1
             AND (
               role IN ('admin', 'super_admin')
               OR (
                 roles IS NOT NULL 
                 AND (
                   roles::text LIKE '%"operations_admin"%'
                   OR roles::text LIKE '%"admin"%'
                   OR roles::text LIKE '%"super_admin"%'
                 )
               )
             )`,
          [requestOrgId]
        );
      }

      console.log(`[PLANT] Found ${adminsResult.rows.length} admin(s) to notify for tracker status request ${request.id}`);

      const statusText = status_type === 'done' ? 'completed' : 'halfway done';
      const taskText = task_type === 'grass_cutting' ? 'Grass Cutting' : 'Panel Wash';
      const title = `Tracker Status Request - ${taskText}`;
      const messageText = `${user.full_name || user.username} has marked ${tracker_ids.length} tracker(s) as ${statusText} for ${taskText}. Trackers: ${tracker_ids.join(', ')}`;

      // Create notifications for org admins only (idempotency_key will prevent duplicates)
      for (const admin of adminsResult.rows) {
        try {
          await createNotification(pool, {
            user_id: admin.id,
            type: 'tracker_status_request',
            title: title,
            message: messageText,
            metadata: {
              request_id: request.id,
              tracker_ids: tracker_ids,
              task_type: task_type,
              status_type: status_type,
              requested_by: {
                id: userId,
                full_name: user.full_name,
                username: user.username
              },
              message: message || null
            }
          });
          
          console.log(`[PLANT] ✅ Notification created for admin ${admin.id} (${admin.username}) for request ${request.id}`);
        } catch (notifError) {
          // Check if error is due to unique constraint violation (duplicate prevented by database/idempotency_key)
          if (notifError.code === '23505') {
            console.log(`[PLANT] ⚠️ Duplicate notification prevented by idempotency_key for admin ${admin.id} (${admin.username}) for request ${request.id}`);
            continue;
          }
          console.error(`[PLANT] ❌ Error creating notification for admin ${admin.id} (${admin.username}):`, {
            error: notifError.message,
            code: notifError.code,
            detail: notifError.detail,
            stack: notifError.stack,
            admin_id: admin.id,
            admin_username: admin.username,
            request_id: request.id
          });
          // Continue with other admins even if one fails
        }
      }

      console.log(`[PLANT] ✅ Tracker status request created: ${request.id} by user ${userId}`);
      res.json({ success: true, request: request });
    } catch (error) {
      console.error('[PLANT] ❌ Error creating tracker status request:', error);
      console.error('[PLANT] Error name:', error.name);
      console.error('[PLANT] Error message:', error.message);
      console.error('[PLANT] Error code:', error.code);
      console.error('[PLANT] Error detail:', error.detail);
      console.error('[PLANT] Error stack:', error.stack);
      console.error('[PLANT] Request details:', {
        userId: req.session?.userId,
        hasSession: !!req.session,
        sessionId: req.sessionID,
        body: req.body
      });
      
      // Provide more specific error messages
      let errorMessage = 'Failed to create tracker status request';
      if (error.code === '42P01') {
        errorMessage = 'Database table does not exist. Please run the migration.';
      } else if (error.code === '42703') {
        errorMessage = 'Database column does not exist. Please check the migration.';
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      res.status(500).json({ 
        error: errorMessage, 
        details: error.detail || error.message,
        code: error.code
      });
    }
  });

  // Get pending tracker status requests (admin/superadmin only)
  router.get('/tracker-status-requests', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const userId = req.session.userId;
      
      // Check if user is admin or super admin
      const userResult = await db.query(
        `SELECT role, roles FROM users WHERE id = $1`,
        [userId]
      );
      
      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const user = userResult.rows[0];
      const userRoles = user.roles ? (typeof user.roles === 'string' ? JSON.parse(user.roles) : user.roles) : [user.role];
      const isAdminUser = userRoles.some(r => r === 'admin' || r === 'super_admin') || user.role === 'admin' || user.role === 'super_admin';

      if (!isAdminUser) {
        return res.status(403).json({ error: 'Only admins can view tracker status requests' });
      }

      const { status = 'pending' } = req.query;

      const result = await db.query(
        `SELECT tsr.*, 
                u.full_name as user_full_name, 
                u.username as user_username,
                reviewer.full_name as reviewer_full_name,
                reviewer.username as reviewer_username
         FROM tracker_status_requests tsr
         LEFT JOIN users u ON tsr.user_id = u.id
         LEFT JOIN users reviewer ON tsr.reviewed_by = reviewer.id
         WHERE tsr.status = $1
         ORDER BY tsr.created_at DESC`,
        [status]
      );

      res.json(result.rows);
    } catch (error) {
      console.error('[PLANT] Error fetching tracker status requests:', error);
      res.status(500).json({ error: 'Failed to fetch tracker status requests', details: error.message });
    }
  });

  // Approve or reject tracker status request (admin/superadmin only)
  router.patch('/tracker-status-request/:id', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const { id } = req.params;
      const { action, rejection_reason } = req.body; // action: 'approve' or 'reject'
      const reviewerId = req.session.userId;

      console.log('[PLANT] Review request received:', {
        id,
        action,
        rejection_reason,
        reviewerId,
        body: req.body
      });

      if (!action) {
        return res.status(400).json({ error: 'action is required' });
      }

      if (!['approve', 'reject'].includes(action)) {
        return res.status(400).json({ error: 'action must be "approve" or "reject"' });
      }

      // Check if user is admin or super admin and get organization_id
      const userResult = await db.query(
        `SELECT role, roles, organization_id FROM users WHERE id = $1`,
        [reviewerId]
      );
      
      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const user = userResult.rows[0];
      const userRoles = user.roles ? (typeof user.roles === 'string' ? JSON.parse(user.roles) : user.roles) : [user.role];
      const isAdminUser = userRoles.some(r => r === 'admin' || r === 'super_admin') || user.role === 'admin' || user.role === 'super_admin';

      if (!isAdminUser) {
        return res.status(403).json({ error: 'Only admins can review tracker status requests' });
      }

      // Get organization_id for plant_map_structure update
      // For system_owner users, organization_id can be NULL
      const isSystemOwner = userRoles.includes('system_owner') || user.role === 'system_owner' || userRoles.includes('super_admin') || user.role === 'super_admin';
      const organizationId = (!isSystemOwner && user.organization_id) ? user.organization_id : null;

      // Get the request
      const requestResult = await db.query(
        `SELECT * FROM tracker_status_requests WHERE id = $1`,
        [id]
      );

      if (requestResult.rows.length === 0) {
        return res.status(404).json({ error: 'Tracker status request not found' });
      }

      const request = requestResult.rows[0];

      if (request.status !== 'pending') {
        return res.status(400).json({ 
          error: 'Request has already been reviewed',
          current_status: request.status,
          reviewed_by: request.reviewed_by,
          reviewed_at: request.reviewed_at
        });
      }

      const newStatus = action === 'approve' ? 'approved' : 'rejected';

      // Update request
      await db.query(
        `UPDATE tracker_status_requests 
         SET status = $1, reviewed_by = $2, reviewed_at = CURRENT_TIMESTAMP, 
             rejection_reason = $3, updated_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [newStatus, reviewerId, action === 'reject' ? (rejection_reason || null) : null, id]
      );

      // If approved, update the plant map structure
      if (action === 'approve') {
        // CRITICAL FIX: Load structure from FILE first (to ensure consistency with reset cycle)
        // This matches the reset cycle and GET /structure endpoint behavior
        const organizationSlug = await getOrganizationSlugFromRequest(req, pool);
        let structure = null;
        let currentVersion = 0;
        
        if (organizationSlug) {
          const plantDir = getCompanySubDir(organizationSlug, 'plant');
          const mapFilePath = path.join(plantDir, 'map-structure.json');
          
          if (fs.existsSync(mapFilePath)) {
            try {
              const fileContent = fs.readFileSync(mapFilePath, 'utf8');
              if (fileContent && fileContent.trim().length > 0) {
                const mapData = JSON.parse(fileContent);
                if (mapData && Array.isArray(mapData.structure)) {
                  structure = mapData.structure;
                  currentVersion = mapData.version || 0;
                  console.log(`[PLANT] Loaded structure from file for approval (version ${currentVersion}, ${structure.length} trackers)`);
                }
              }
            } catch (fileError) {
              console.error('[PLANT] Error reading map structure file for approval:', fileError);
            }
          }
        }
        
        // Fallback to database if file doesn't exist
        if (!structure) {
          console.log('[PLANT] File not found, loading from database for approval');
          let structureQuery = 'SELECT structure_data, version FROM plant_map_structure';
          const structureParams = [];
          if (organizationId) {
            structureQuery += ' WHERE organization_id = $1';
            structureParams.push(organizationId);
          }
          structureQuery += ' ORDER BY version DESC LIMIT 1';
          
          const structureResult = await db.query(structureQuery, structureParams);

          if (structureResult.rows.length === 0 || !structureResult.rows[0].structure_data) {
            console.error('[PLANT] No structure found in database for approval');
            return res.status(404).json({ error: 'Plant map structure not found' });
          }

          structure = structureResult.rows[0].structure_data;
          currentVersion = structureResult.rows[0].version || 0;
          if (typeof structure === 'string') {
            structure = JSON.parse(structure);
          }
        }
        
        if (!Array.isArray(structure)) {
          console.error('[PLANT] Invalid structure format for approval');
          return res.status(500).json({ error: 'Invalid map structure format' });
        }

        // Update tracker colors based on status_type
        const colorKey = request.task_type === 'grass_cutting' ? 'grassCuttingColor' : 'panelWashColor';
        const doneColor = '#90EE90'; // Light green for done
        const halfwayColor = '#FFD700'; // Gold for halfway

        const newColor = request.status_type === 'done' ? doneColor : halfwayColor;

        let updatedCount = 0;
        structure.forEach(tracker => {
          if (request.tracker_ids.includes(tracker.id)) {
            const oldColor = tracker[colorKey];
            tracker[colorKey] = newColor;
            if (oldColor !== newColor) {
              updatedCount++;
            }
          }
        });
        
        console.log(`[PLANT] Updated ${updatedCount} tracker(s) ${colorKey} to ${newColor} for approval`);

        // Save updated structure
        // Use currentVersion from file/database + 1
        const newVersion = currentVersion + 1;
        console.log(`[PLANT] Saving structure with version ${newVersion} (previous: ${currentVersion}) for approval`);

        // Save to database
        await db.query(
          `INSERT INTO plant_map_structure (structure_data, version, organization_id)
           VALUES ($1, $2, $3)`,
          [JSON.stringify(structure), newVersion, organizationId]
        );
        console.log(`[PLANT] ✅ Saved structure to database (version ${newVersion}, organizationId: ${organizationId || 'NULL'}) for approval`);
        
        // CRITICAL: Save to company-scoped folder (frontend loads from file)
        // saveMapStructureToFile() now correctly handles system owners by using organizationSlug
        const fileSaveResult = await saveMapStructureToFile(req, structure, newVersion, organizationId);

        if (!fileSaveResult.success && !fileSaveResult.skipped) {
          // File save actually failed (not just skipped)
          console.error('[PLANT] ❌ File save failed for approval:', fileSaveResult.error);
          // Don't return error - approval should still succeed even if file save fails
          // But log it for debugging
        } else if (fileSaveResult.skipped) {
          // File save was skipped - this should only happen if system owner has no company selected
          console.warn('[PLANT] ⚠️ File save skipped for approval (no organization context - system owner without selected company)');
        } else {
          console.log(`[PLANT] ✅ Successfully saved map structure to file for approval (version ${newVersion}, ${structure.length} trackers)`);
        }

        // Ensure cycle exists (create Cycle 1 if task just started)
        const cycleOrgId = getOrganizationIdFromRequest(req) || organizationId;
        await ensureCycleExists(request.task_type, cycleOrgId);

        // Check if cycle should be marked as complete after status update
        const progressData = calculateProgress(structure, request.task_type);
        await checkAndMarkCycleComplete(request.task_type, progressData.progress, cycleOrgId);
      }

      // Get requester info
      const requesterResult = await db.query(
        'SELECT full_name, username FROM users WHERE id = $1',
        [request.user_id]
      );
      const requester = requesterResult.rows[0];

      // Mark original notification as read for the reviewer (admin who approved/rejected)
      // This marks all tracker_status_request notifications for this request_id that belong to the reviewer
      await db.query(
        `UPDATE notifications 
         SET is_read = true, read_at = CURRENT_TIMESTAMP 
         WHERE type = 'tracker_status_request' 
         AND metadata->>'request_id' = $1
         AND user_id = $2
         AND is_read = false`,
        [id, reviewerId]
      );

      console.log(`[PLANT] Marked original notification as read for reviewer ${reviewerId} for request ${id}`);

      // Notify the requester (only create if it doesn't already exist to prevent duplicates)
      const statusText = action === 'approve' ? 'approved' : 'rejected';
      const taskText = request.task_type === 'grass_cutting' ? 'Grass Cutting' : 'Panel Wash';
      const statusTypeText = request.status_type === 'done' ? 'completed' : 'halfway done';
      const title = action === 'approve' 
        ? `Tracker Status ${statusText.charAt(0).toUpperCase() + statusText.slice(1)} - ${taskText}`
        : `Tracker Status Request Rejected - ${taskText}`;
      
      const notificationMessage = action === 'approve'
        ? `Your request to mark ${request.tracker_ids.length} tracker(s) as ${statusTypeText} for ${taskText} has been approved. Trackers: ${request.tracker_ids.join(', ')}`
        : `Your request to mark ${request.tracker_ids.length} tracker(s) as ${statusTypeText} for ${taskText} has been rejected.${rejection_reason ? ` Reason: ${rejection_reason}` : ''}`;

      // Create notification for requester (idempotency_key will prevent duplicates automatically)
      await createNotification(pool, {
        user_id: request.user_id,
        type: `tracker_status_${statusText}`,
        title: title,
        message: notificationMessage,
        metadata: {
          request_id: id,
          tracker_ids: request.tracker_ids,
          task_type: request.task_type,
          status_type: request.status_type,
          action: action,
          rejection_reason: rejection_reason || null
        }
      });
      console.log(`[PLANT] Created notification for requester ${request.user_id} for request ${id}`);

      console.log(`[PLANT] Tracker status request ${id} ${statusText} by user ${reviewerId}`);
      res.json({ success: true, status: newStatus });
    } catch (error) {
      console.error('[PLANT] Error reviewing tracker status request:', error);
      res.status(500).json({ error: 'Failed to review tracker status request', details: error.message });
    }
  });

  // ==================== CYCLE TRACKING ENDPOINTS ====================

  // Helper function to calculate progress from structure
  function calculateProgress(structure, taskType) {
    const allTrackers = structure.filter(t => t.id && t.id.startsWith('M') && /^M\d{2}$/.test(t.id));
    if (allTrackers.length === 0) return { progress: 0, doneCount: 0, halfwayCount: 0, totalCount: 0 };

    const colorKey = taskType === 'grass_cutting' ? 'grassCuttingColor' : 'panelWashColor';
    const doneCount = allTrackers.filter(t => {
      const color = t[colorKey] || '#ffffff';
      return color === '#90EE90' || color === '#4CAF50';
    }).length;
    
    const halfwayCount = allTrackers.filter(t => {
      const color = t[colorKey] || '#ffffff';
      return color === '#FFD700' || color === '#FF9800';
    }).length;

    const progress = ((doneCount + halfwayCount * 0.5) / allTrackers.length) * 100;
    return {
      progress: Math.min(100, Math.max(0, progress)),
      doneCount,
      halfwayCount,
      totalCount: allTrackers.length
    };
  }

  // Helper function to ensure cycle exists (create Cycle 1 when task starts)
  async function ensureCycleExists(taskType, organizationId = null) {
    // Check if there's any cycle for this task type and organization
    const params = [taskType];
    let orgFilter = organizationId
      ? ` AND organization_id = $${params.push(organizationId)}`
      : ' AND organization_id IS NULL';

    const existingCycleResult = await db.query(`
      SELECT id, cycle_number, completed_at
      FROM tracker_cycles
      WHERE task_type = $1${orgFilter}
      ORDER BY cycle_number DESC
      LIMIT 1
    `, params);

    // If no cycles exist, create Cycle 1 (task has just started)
    if (existingCycleResult.rows.length === 0) {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;

      const newCycleResult = await db.query(`
        INSERT INTO tracker_cycles (task_type, cycle_number, started_at, year, month, organization_id)
        VALUES ($1, 1, $2, $3, $4, $5)
        RETURNING id, cycle_number, started_at, year, month
      `, [taskType, now, year, month, organizationId]);

      console.log(`[PLANT] Cycle 1 created for ${taskType} org=${organizationId} - task has started`);
      return newCycleResult.rows[0];
    }

    // If there's an incomplete cycle, return it
    const incompleteCycle = existingCycleResult.rows.find(c => !c.completed_at);
    if (incompleteCycle) {
      return incompleteCycle;
    }

    // All cycles are complete, return null (shouldn't happen in normal flow)
    return null;
  }

  // Helper function to check and mark cycle as complete
  async function checkAndMarkCycleComplete(taskType, progress, organizationId = null) {
    if (progress < 100) return;

    // Get current incomplete cycle for this organization
    const params = [taskType];
    let orgFilter = organizationId
      ? ` AND organization_id = $${params.push(organizationId)}`
      : ' AND organization_id IS NULL';

    const cycleResult = await db.query(`
      SELECT id, cycle_number, completed_at
      FROM tracker_cycles
      WHERE task_type = $1 AND completed_at IS NULL${orgFilter}
      ORDER BY cycle_number DESC
      LIMIT 1
    `, params);

    if (cycleResult.rows.length > 0) {
      const cycle = cycleResult.rows[0];
      if (!cycle.completed_at) {
        // Mark as completed
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;

        await db.query(`
          UPDATE tracker_cycles
          SET completed_at = $1, year = $2, month = $3, updated_at = CURRENT_TIMESTAMP
          WHERE id = $4
        `, [now, year, month, cycle.id]);

        console.log(`[PLANT] Cycle ${cycle.cycle_number} for ${taskType} marked as complete`);
      }
    }
  }

  // Get current cycle information
  router.get('/cycles/:task_type', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const { task_type } = req.params;

      if (!['grass_cutting', 'panel_wash'].includes(task_type)) {
        return res.status(400).json({ error: 'Invalid task_type. Must be "grass_cutting" or "panel_wash"' });
      }

      // Get organization_id for scoping cycles per organization
      const cycleOrgId = getOrganizationIdFromRequest(req);

      // Get user's organization_id for structure filtering (existing logic)
      let organizationId = null;
      if (req.session && req.session.userId) {
        const userResult = await db.query(
          'SELECT organization_id, role, roles FROM users WHERE id = $1',
          [req.session.userId]
        );
        if (userResult.rows.length > 0) {
          const user = userResult.rows[0];
          const userRoles = user.roles ? (typeof user.roles === 'string' ? JSON.parse(user.roles) : user.roles) : [user.role];
          const isSystemOwner = userRoles.includes('system_owner') || user.role === 'system_owner' || userRoles.includes('super_admin') || user.role === 'super_admin';
          if (!isSystemOwner && user.organization_id) {
            organizationId = user.organization_id;
          }
        }
      }

      // Use cycleOrgId (from tenant context / selected org) or fall back to user's org
      const effectiveOrgId = cycleOrgId || organizationId;

      // Calculate current progress first to check if task has started
      let structureQuery = 'SELECT structure_data FROM plant_map_structure';
      const structureParams = [];
      if (organizationId) {
        structureQuery += ' WHERE organization_id = $1';
        structureParams.push(organizationId);
      }
      structureQuery += ' ORDER BY version DESC LIMIT 1';

      const structureResult = await db.query(structureQuery, structureParams);

      let progress = 0;
      let doneCount = 0;
      let halfwayCount = 0;
      let totalCount = 0;

      if (structureResult.rows.length > 0 && structureResult.rows[0].structure_data) {
        let structure = structureResult.rows[0].structure_data;
        if (typeof structure === 'string') {
          structure = JSON.parse(structure);
        }
        const progressData = calculateProgress(structure, task_type);
        progress = progressData.progress;
        doneCount = progressData.doneCount;
        halfwayCount = progressData.halfwayCount;
        totalCount = progressData.totalCount;
      }

      // Get current incomplete cycle for THIS organization
      const cycleParams = [task_type];
      let cycleOrgFilter = effectiveOrgId
        ? ` AND organization_id = $${cycleParams.push(effectiveOrgId)}`
        : ' AND organization_id IS NULL';

      const cycleResult = await db.query(`
        SELECT id, cycle_number, started_at, completed_at, year, month
        FROM tracker_cycles
        WHERE task_type = $1 AND completed_at IS NULL${cycleOrgFilter}
        ORDER BY cycle_number DESC
        LIMIT 1
      `, cycleParams);

      // If no cycle exists, task hasn't started yet
      if (cycleResult.rows.length === 0) {
        // If progress > 0, task has started but cycle wasn't created (edge case - create it now)
        if (progress > 0) {
          const newCycle = await ensureCycleExists(task_type, effectiveOrgId);
          if (newCycle) {
            return res.json({
              cycle_number: newCycle.cycle_number,
              started_at: newCycle.started_at,
              completed_at: newCycle.completed_at,
              year: newCycle.year,
              month: newCycle.month,
              progress: progress,
              is_complete: progress >= 100,
              task_started: true,
              done_count: doneCount,
              halfway_count: halfwayCount,
              total_count: totalCount
            });
          }
        }

        // Task hasn't started yet - return null cycle
        return res.json({
          cycle_number: null,
          started_at: null,
          completed_at: null,
          year: null,
          month: null,
          progress: progress,
          is_complete: false,
          task_started: false,
          done_count: doneCount,
          halfway_count: halfwayCount,
          total_count: totalCount
        });
      }

      const cycle = cycleResult.rows[0];

      // Progress already calculated above, no need to recalculate
      // Check if cycle should be marked as complete
      await checkAndMarkCycleComplete(task_type, progress, effectiveOrgId);

      res.json({
        cycle_number: cycle.cycle_number,
        started_at: cycle.started_at,
        completed_at: cycle.completed_at,
        year: cycle.year,
        month: cycle.month,
        progress: progress,
        is_complete: progress >= 100,
        done_count: doneCount,
        halfway_count: halfwayCount,
        total_count: totalCount
      });
    } catch (error) {
      console.error('[PLANT] Error getting cycle info:', error);
      res.status(500).json({ error: 'Failed to get cycle information', details: error.message });
    }
  });

  // Reset cycle (admin only)
  router.post('/cycles/:task_type/reset', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const { task_type } = req.params;
      const userId = req.session.userId;

      if (!['grass_cutting', 'panel_wash'].includes(task_type)) {
        return res.status(400).json({ error: 'Invalid task_type. Must be "grass_cutting" or "panel_wash"' });
      }

      // Check if user is admin and get organization_id
      const userResult = await db.query(
        `SELECT role, roles, organization_id FROM users WHERE id = $1`,
        [userId]
      );
      
      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const user = userResult.rows[0];
      const userRoles = user.roles ? (typeof user.roles === 'string' ? JSON.parse(user.roles) : user.roles) : [user.role];
      const isAdminUser = userRoles.some(r => r === 'admin' || r === 'super_admin' || r === 'operations_admin' || r === 'system_owner') 
        || user.role === 'admin' || user.role === 'super_admin';

      if (!isAdminUser) {
        return res.status(403).json({ error: 'Only admins can reset cycles' });
      }

      // Get organization_id for plant_map_structure update
      // For system_owner users, organization_id can be NULL for structure queries
      const isSystemOwner = userRoles.includes('system_owner') || user.role === 'system_owner' || userRoles.includes('super_admin') || user.role === 'super_admin';
      const organizationId = (!isSystemOwner && user.organization_id) ? user.organization_id : null;

      // For cycle scoping, always resolve the actual organization (even for system_owner)
      const cycleOrgId = getOrganizationIdFromRequest(req) || user.organization_id || null;

      // Load structure from FILE first (to ensure consistency with frontend)
      // This matches the GET /structure endpoint behavior
      const organizationSlug = await getOrganizationSlugFromRequest(req, pool);
      let structure = null;
      let currentVersion = 0;

      if (organizationSlug) {
        const plantDir = getCompanySubDir(organizationSlug, 'plant');
        const mapFilePath = path.join(plantDir, 'map-structure.json');

        if (fs.existsSync(mapFilePath)) {
          try {
            const fileContent = fs.readFileSync(mapFilePath, 'utf8');
            if (fileContent && fileContent.trim().length > 0) {
              const mapData = JSON.parse(fileContent);
              if (mapData && Array.isArray(mapData.structure)) {
                structure = mapData.structure;
                currentVersion = mapData.version || 0;
                console.log(`[PLANT] Loaded structure from file for cycle reset (version ${currentVersion}, ${structure.length} trackers)`);
              }
            }
          } catch (fileError) {
            console.error('[PLANT] Error reading map structure file for cycle reset:', fileError);
          }
        }
      }

      // Fallback to database if file doesn't exist
      if (!structure) {
        console.log('[PLANT] File not found, loading from database for cycle reset');
        let structureQuery = 'SELECT structure_data, version FROM plant_map_structure';
        const structureParams = [];
        if (organizationId) {
          structureQuery += ' WHERE organization_id = $1';
          structureParams.push(organizationId);
        }
        structureQuery += ' ORDER BY version DESC LIMIT 1';

        const structureResult = await db.query(structureQuery, structureParams);

        if (structureResult.rows.length === 0 || !structureResult.rows[0].structure_data) {
          return res.status(404).json({ error: 'Plant map structure not found' });
        }

        structure = structureResult.rows[0].structure_data;
        currentVersion = structureResult.rows[0].version || 0;
        if (typeof structure === 'string') {
          structure = JSON.parse(structure);
        }
      }

      if (!Array.isArray(structure)) {
        return res.status(500).json({ error: 'Invalid map structure format' });
      }

      // Get current cycle for THIS organization
      const cycleParams = [task_type];
      let cycleOrgFilter = cycleOrgId
        ? ` AND organization_id = $${cycleParams.push(cycleOrgId)}`
        : ' AND organization_id IS NULL';

      const cycleResult = await db.query(`
        SELECT id, cycle_number, completed_at
        FROM tracker_cycles
        WHERE task_type = $1${cycleOrgFilter}
        ORDER BY cycle_number DESC
        LIMIT 1
      `, cycleParams);

      let currentCycle = null;
      let newCycleNumber = 1;
      let previousCycleNumber = null;

      if (cycleResult.rows.length > 0) {
        currentCycle = cycleResult.rows[0];
        previousCycleNumber = currentCycle.cycle_number;
        // If there's an incomplete cycle, complete it; otherwise start a new cycle
        if (!currentCycle.completed_at) {
          // Mark current cycle as completed
          const now = new Date();
          const year = now.getFullYear();
          const month = now.getMonth() + 1;
          await db.query(`
            UPDATE tracker_cycles
            SET completed_at = $1, year = $2, month = $3, updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
          `, [now, year, month, currentCycle.id]);
        }
        // Start next cycle
        newCycleNumber = currentCycle.cycle_number + 1;
      }
      // If no cycles exist at all, start with Cycle 1

      // Create new cycle scoped to this organization
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;

      const newCycleResult = await db.query(`
        INSERT INTO tracker_cycles (task_type, cycle_number, started_at, year, month, reset_by, reset_at, organization_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, cycle_number, started_at, year, month
      `, [task_type, newCycleNumber, now, year, month, userId, now, cycleOrgId]);

      const newCycle = newCycleResult.rows[0];

      // Reset ALL tracker colors to white for BOTH task types
      // CRITICAL FIX: Reset both grassCuttingColor AND panelWashColor to prevent "hardcoded" colors
      // This ensures a completely fresh start - all trackers will be white and waiting for new updates
      let resetGrassCount = 0;
      let resetPanelCount = 0;
      let totalTrackers = 0;
      
      structure.forEach(tracker => {
        if (tracker.id && tracker.id.startsWith('M') && /^M\d{2}$/.test(tracker.id)) {
          totalTrackers++;
          
          // Aggressively reset grassCuttingColor - delete first, then set to white
          const oldGrassColor = tracker.grassCuttingColor;
          delete tracker.grassCuttingColor; // Remove property completely
          tracker.grassCuttingColor = '#ffffff'; // Set to white
          if (oldGrassColor && oldGrassColor !== '#ffffff' && oldGrassColor !== undefined && oldGrassColor !== null) {
            resetGrassCount++;
          }
          
          // Aggressively reset panelWashColor - delete first, then set to white
          const oldPanelColor = tracker.panelWashColor;
          delete tracker.panelWashColor; // Remove property completely
          tracker.panelWashColor = '#ffffff'; // Set to white
          if (oldPanelColor && oldPanelColor !== '#ffffff' && oldPanelColor !== undefined && oldPanelColor !== null) {
            resetPanelCount++;
          }
        }
      });
      
      // Verify reset worked for BOTH color properties
      const verifyGrassReset = structure.filter(t => 
        t.id && t.id.startsWith('M') && /^M\d{2}$/.test(t.id) && 
        (t.grassCuttingColor === '#ffffff' || t.grassCuttingColor === undefined)
      ).length;
      
      const verifyPanelReset = structure.filter(t => 
        t.id && t.id.startsWith('M') && /^M\d{2}$/.test(t.id) && 
        (t.panelWashColor === '#ffffff' || t.panelWashColor === undefined)
      ).length;
      
      console.log(`[PLANT] Reset cycle for ${task_type}:`);
      console.log(`[PLANT]   - Total trackers: ${totalTrackers}`);
      console.log(`[PLANT]   - Grass cutting colors reset: ${resetGrassCount}`);
      console.log(`[PLANT]   - Panel wash colors reset: ${resetPanelCount}`);
      console.log(`[PLANT]   - Verified grass cutting white: ${verifyGrassReset}/${totalTrackers}`);
      console.log(`[PLANT]   - Verified panel wash white: ${verifyPanelReset}/${totalTrackers}`);
      
      if (verifyGrassReset !== totalTrackers || verifyPanelReset !== totalTrackers) {
        console.warn(`[PLANT] ⚠️ Warning: Not all trackers were reset correctly!`);
        console.warn(`[PLANT]   Expected ${totalTrackers} for both colors, got grass: ${verifyGrassReset}, panel: ${verifyPanelReset}`);
      }

      // Final verification: Ensure NO tracker has non-white colors (safety check)
      // This is CRITICAL - any non-white colors will make trackers appear "hardcoded"
      const nonWhiteTrackers = structure.filter(t => 
        t.id && t.id.startsWith('M') && /^M\d{2}$/.test(t.id) && 
        ((t.grassCuttingColor && t.grassCuttingColor !== '#ffffff' && t.grassCuttingColor !== undefined && t.grassCuttingColor !== null) ||
         (t.panelWashColor && t.panelWashColor !== '#ffffff' && t.panelWashColor !== undefined && t.panelWashColor !== null))
      );
      
      if (nonWhiteTrackers.length > 0) {
        console.error(`[PLANT] ❌ CRITICAL: Found ${nonWhiteTrackers.length} trackers with non-white colors after reset!`);
        console.error(`[PLANT]   Trackers: ${nonWhiteTrackers.map(t => `${t.id}(grass:${t.grassCuttingColor || 'undefined'},panel:${t.panelWashColor || 'undefined'})`).join(', ')}`);
        // Force reset these trackers - this ensures ALL colors are white
        nonWhiteTrackers.forEach(tracker => {
          // Explicitly set to white, removing any existing color values
          delete tracker.grassCuttingColor;
          delete tracker.panelWashColor;
          tracker.grassCuttingColor = '#ffffff';
          tracker.panelWashColor = '#ffffff';
        });
        console.log(`[PLANT] ✅ Force-reset ${nonWhiteTrackers.length} trackers to white (removed existing colors)`);
        
        // Re-verify after force reset
        const stillNonWhite = structure.filter(t => 
          t.id && t.id.startsWith('M') && /^M\d{2}$/.test(t.id) && 
          ((t.grassCuttingColor && t.grassCuttingColor !== '#ffffff') ||
           (t.panelWashColor && t.panelWashColor !== '#ffffff'))
        );
        if (stillNonWhite.length > 0) {
          console.error(`[PLANT] ❌❌ CRITICAL ERROR: ${stillNonWhite.length} trackers STILL have non-white colors after force reset!`);
          console.error(`[PLANT]   This indicates a deeper issue. Trackers: ${stillNonWhite.map(t => t.id).join(', ')}`);
        } else {
          console.log(`[PLANT] ✅ Verification passed: All trackers are now white after force reset`);
        }
      } else {
        console.log(`[PLANT] ✅ All trackers verified as white - no force reset needed`);
      }

      // Save updated structure
      // Use currentVersion from file/database + 1
      const newVersion = currentVersion + 1;
      console.log(`[PLANT] Saving structure with version ${newVersion} (previous: ${currentVersion})`);

      // Save to database
      await db.query(`
        INSERT INTO plant_map_structure (structure_data, version, organization_id)
        VALUES ($1, $2, $3)
      `, [JSON.stringify(structure), newVersion, organizationId]);
      console.log(`[PLANT] ✅ Saved structure to database (version ${newVersion}, organizationId: ${organizationId || 'NULL'})`);
      
      // CRITICAL: Save to company-scoped folder (frontend loads from file)
      // saveMapStructureToFile() now correctly handles system owners by using organizationSlug
      const fileSaveResult = await saveMapStructureToFile(req, structure, newVersion, organizationId);

      if (!fileSaveResult.success && !fileSaveResult.skipped) {
        // File save actually failed (not just skipped due to no organization context)
        console.error('[PLANT] ❌ File save failed:', fileSaveResult.error);
        return res.status(500).json({
          error: 'Failed to save map structure to file',
          details: fileSaveResult.error
        });
      }

      if (fileSaveResult.skipped) {
        // File save was skipped - this should only happen if system owner has no company selected
        console.warn('[PLANT] ⚠️ File save skipped (no organization context - system owner without selected company)');
      } else {
        console.log(`[PLANT] ✅ Successfully saved map structure to file (version ${newVersion}, ${structure.length} trackers)`);
        
        // Verify file was saved correctly by reading it back
        if (organizationSlug) {
          try {
            const plantDir = getCompanySubDir(organizationSlug, 'plant');
            const mapFilePath = path.join(plantDir, 'map-structure.json');
            if (fs.existsSync(mapFilePath)) {
              const savedContent = fs.readFileSync(mapFilePath, 'utf8');
              const savedData = JSON.parse(savedContent);
              
              // Verify all trackers have white colors
              const savedNonWhite = savedData.structure?.filter(t => 
                t.id && t.id.startsWith('M') && /^M\d{2}$/.test(t.id) && 
                ((t.grassCuttingColor && t.grassCuttingColor !== '#ffffff') ||
                 (t.panelWashColor && t.panelWashColor !== '#ffffff'))
              ) || [];
              
              if (savedNonWhite.length > 0) {
                console.error(`[PLANT] ❌ CRITICAL: File contains ${savedNonWhite.length} trackers with non-white colors!`);
                console.error(`[PLANT]   This indicates colors are persisted in the file. Trackers: ${savedNonWhite.map(t => t.id).join(', ')}`);
              } else {
                console.log(`[PLANT] ✅ File verification passed: All trackers have white colors`);
              }
            }
          } catch (verifyError) {
            console.warn(`[PLANT] ⚠️ Could not verify saved file:`, verifyError.message);
          }
        }
      }

      if (previousCycleNumber !== null) {
        console.log(`[PLANT] Cycle reset: ${task_type} cycle ${previousCycleNumber} -> ${newCycleNumber} by user ${userId}`);
      } else {
        console.log(`[PLANT] Cycle reset: ${task_type} starting fresh with cycle ${newCycleNumber} by user ${userId}`);
      }

      res.json({
        success: true,
        new_cycle_number: newCycle.cycle_number,
        previous_cycle_number: previousCycleNumber,
        started_at: newCycle.started_at,
        year: newCycle.year,
        month: newCycle.month
      });
    } catch (error) {
      console.error('[PLANT] Error resetting cycle:', error);
      res.status(500).json({ error: 'Failed to reset cycle', details: error.message });
    }
  });

  // Clear cycle to zero (system_owner only) - deletes all cycle records and resets trackers
  router.post('/cycles/:task_type/clear', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const { task_type } = req.params;
      const userId = req.session.userId;

      if (!['grass_cutting', 'panel_wash'].includes(task_type)) {
        return res.status(400).json({ error: 'Invalid task_type' });
      }

      // Only system_owner can clear to zero
      const userResult = await db.query(
        'SELECT role, roles, organization_id FROM users WHERE id = $1',
        [userId]
      );
      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const user = userResult.rows[0];
      const userRoles = user.roles ? (typeof user.roles === 'string' ? JSON.parse(user.roles) : user.roles) : [user.role];
      const isSystemOwner = userRoles.includes('system_owner') || user.role === 'system_owner'
        || userRoles.includes('super_admin') || user.role === 'super_admin';

      if (!isSystemOwner) {
        return res.status(403).json({ error: 'Only system owners can clear cycles to zero' });
      }

      // Resolve organization for scoping
      const cycleOrgId = getOrganizationIdFromRequest(req) || user.organization_id || null;

      // Delete cycle records for this task_type AND organization only
      if (cycleOrgId) {
        await db.query('DELETE FROM tracker_cycles WHERE task_type = $1 AND organization_id = $2', [task_type, cycleOrgId]);
        try {
          await db.query('DELETE FROM tracker_cycle_history WHERE task_type = $1 AND organization_id = $2', [task_type, cycleOrgId]);
        } catch (historyErr) {
          console.warn('[PLANT] tracker_cycle_history table may not exist:', historyErr.message);
        }
      } else {
        await db.query('DELETE FROM tracker_cycles WHERE task_type = $1 AND organization_id IS NULL', [task_type]);
        try {
          await db.query('DELETE FROM tracker_cycle_history WHERE task_type = $1 AND organization_id IS NULL', [task_type]);
        } catch (historyErr) {
          console.warn('[PLANT] tracker_cycle_history table may not exist:', historyErr.message);
        }
      }

      console.log(`[PLANT] Cycles cleared to zero for ${task_type} org=${cycleOrgId} by user ${userId}`);

      // Also reset all tracker colors to white
      const organizationSlug = await getOrganizationSlugFromRequest(req, pool);
      const organizationId = cycleOrgId;

      if (organizationSlug) {
        const plantDir = getCompanySubDir(organizationSlug, 'plant');
        const mapFilePath = path.join(plantDir, 'map-structure.json');

        if (fs.existsSync(mapFilePath)) {
          try {
            const fileContent = fs.readFileSync(mapFilePath, 'utf8');
            const mapData = JSON.parse(fileContent);

            if (mapData && Array.isArray(mapData.structure)) {
              mapData.structure.forEach(tracker => {
                if (tracker.id && tracker.id.startsWith('M') && /^M\d{2}$/.test(tracker.id)) {
                  tracker.grassCuttingColor = '#ffffff';
                  tracker.panelWashColor = '#ffffff';
                }
              });

              mapData.version = (mapData.version || 0) + 1;
              mapData.updated_at = new Date().toISOString();
              fs.writeFileSync(mapFilePath, JSON.stringify(mapData, null, 2), 'utf8');

              // Also save to database
              await db.query(
                'INSERT INTO plant_map_structure (structure_data, version, organization_id) VALUES ($1, $2, $3)',
                [JSON.stringify(mapData.structure), mapData.version, organizationId]
              );

              console.log(`[PLANT] Tracker colors reset to white for ${task_type}`);
            }
          } catch (fileError) {
            console.error('[PLANT] Error resetting tracker colors:', fileError);
          }
        }
      }

      res.json({ success: true, message: `${task_type} cycles cleared to zero` });
    } catch (error) {
      console.error('[PLANT] Error clearing cycles:', error);
      res.status(500).json({ error: 'Failed to clear cycles' });
    }
  });

  // Get cycle history
  router.get('/cycles/:task_type/history', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const { task_type } = req.params;
      const { year, month } = req.query;

      if (!['grass_cutting', 'panel_wash'].includes(task_type)) {
        return res.status(400).json({ error: 'Invalid task_type. Must be "grass_cutting" or "panel_wash"' });
      }

      // Scope history to the current organization
      const cycleOrgId = getOrganizationIdFromRequest(req);

      let query = `
        SELECT
          tc.id,
          tc.cycle_number,
          tc.started_at,
          tc.completed_at,
          tc.reset_at,
          tc.year,
          tc.month,
          tc.notes,
          u.full_name as reset_by_name,
          u.username as reset_by_username,
          EXTRACT(EPOCH FROM (tc.completed_at - tc.started_at)) / 86400 as duration_days
        FROM tracker_cycles tc
        LEFT JOIN users u ON tc.reset_by = u.id
        WHERE tc.task_type = $1
      `;
      const params = [task_type];

      // Filter by organization
      if (cycleOrgId) {
        query += ` AND tc.organization_id = $${params.length + 1}`;
        params.push(cycleOrgId);
      }

      if (year) {
        query += ` AND tc.year = $${params.length + 1}`;
        params.push(parseInt(year, 10));
      }

      if (month) {
        query += ` AND tc.month = $${params.length + 1}`;
        params.push(parseInt(month, 10));
      }

      query += ` ORDER BY tc.year DESC, tc.month DESC, tc.cycle_number DESC`;

      const result = await db.query(query, params);

      const cycles = result.rows.map(row => ({
        id: row.id,
        cycle_number: row.cycle_number,
        started_at: row.started_at,
        completed_at: row.completed_at,
        reset_at: row.reset_at,
        year: row.year,
        month: row.month,
        month_name: new Date(2000, row.month - 1, 1).toLocaleString('default', { month: 'long' }),
        duration_days: row.duration_days ? Math.round(row.duration_days * 10) / 10 : null,
        reset_by: row.reset_by_name ? {
          name: row.reset_by_name,
          username: row.reset_by_username
        } : null,
        notes: row.notes
      }));

      // Calculate summary
      const summary = {
        total_cycles: cycles.length,
        by_month: {}
      };

      cycles.forEach(cycle => {
        if (!summary.by_month[cycle.month]) {
          summary.by_month[cycle.month] = 0;
        }
        summary.by_month[cycle.month]++;
      });

      res.json({ cycles, summary });
    } catch (error) {
      console.error('[PLANT] Error getting cycle history:', error);
      res.status(500).json({ error: 'Failed to get cycle history', details: error.message });
    }
  });

  // Get cycle statistics
  router.get('/cycles/:task_type/stats', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const { task_type } = req.params;
      const { year } = req.query;

      if (!['grass_cutting', 'panel_wash'].includes(task_type)) {
        return res.status(400).json({ error: 'Invalid task_type. Must be "grass_cutting" or "panel_wash"' });
      }

      const targetYear = year ? parseInt(year, 10) : new Date().getFullYear();

      // Scope stats to the current organization
      const cycleOrgId = getOrganizationIdFromRequest(req);

      // Get cycles for the year, scoped by organization
      const statsParams = [task_type, targetYear];
      let orgStatsFilter = '';
      if (cycleOrgId) {
        orgStatsFilter = ` AND organization_id = $${statsParams.push(cycleOrgId)}`;
      }

      const cyclesResult = await db.query(`
        SELECT
          cycle_number,
          started_at,
          completed_at,
          year,
          month,
          EXTRACT(EPOCH FROM (completed_at - started_at)) / 86400 as duration_days
        FROM tracker_cycles
        WHERE task_type = $1 AND year = $2 AND completed_at IS NOT NULL${orgStatsFilter}
        ORDER BY month, cycle_number
      `, statsParams);

      const cycles = cyclesResult.rows;
      const totalCycles = cycles.length;

      // Calculate average duration
      const completedCycles = cycles.filter(c => c.duration_days !== null);
      const avgDuration = completedCycles.length > 0
        ? completedCycles.reduce((sum, c) => sum + parseFloat(c.duration_days), 0) / completedCycles.length
        : 0;

      // Group by month
      const cyclesByMonth = {};
      cycles.forEach(cycle => {
        if (!cyclesByMonth[cycle.month]) {
          cyclesByMonth[cycle.month] = {
            month: cycle.month,
            month_name: new Date(2000, cycle.month - 1, 1).toLocaleString('default', { month: 'long' }),
            count: 0,
            cycles: [],
            avg_duration: 0
          };
        }
        cyclesByMonth[cycle.month].count++;
        cyclesByMonth[cycle.month].cycles.push(cycle.cycle_number);
        if (cycle.duration_days) {
          cyclesByMonth[cycle.month].avg_duration += parseFloat(cycle.duration_days);
        }
      });

      // Calculate averages per month
      Object.keys(cyclesByMonth).forEach(month => {
        const monthData = cyclesByMonth[month];
        const monthCyclesWithDuration = monthData.cycles.length;
        monthData.avg_duration = monthCyclesWithDuration > 0
          ? monthData.avg_duration / monthCyclesWithDuration
          : 0;
        monthData.first_cycle = Math.min(...monthData.cycles);
        monthData.last_cycle = Math.max(...monthData.cycles);
      });

      // Find peak month
      let peakMonth = null;
      let maxCycles = 0;
      Object.values(cyclesByMonth).forEach(monthData => {
        if (monthData.count > maxCycles) {
          maxCycles = monthData.count;
          peakMonth = monthData;
        }
      });

      res.json({
        year: targetYear,
        task_type: task_type,
        total_cycles: totalCycles,
        average_cycle_duration_days: Math.round(avgDuration * 10) / 10,
        cycles_by_month: Object.values(cyclesByMonth).sort((a, b) => a.month - b.month),
        monthly_summary: cyclesByMonth,
        peak_month: peakMonth
      });
    } catch (error) {
      console.error('[PLANT] Error getting cycle stats:', error);
      res.status(500).json({ error: 'Failed to get cycle statistics', details: error.message });
    }
  });

  // Upload plant map Excel file (system owner only)
  // Saves to company plant folder and parses into map structure
  const plantUpload = multer({
    storage: multer.diskStorage({
      destination: async (req, file, cb) => {
        try {
          const slug = await getOrganizationSlugFromRequest(req, pool);
          const plantDir = getCompanySubDir(slug, 'plant');
          if (!fs.existsSync(plantDir)) fs.mkdirSync(plantDir, { recursive: true });
          cb(null, plantDir);
        } catch (err) {
          cb(err);
        }
      },
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `plant-map${ext}`);
      }
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const allowed = /xlsx|xls|csv/;
      const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
      if (allowed.test(ext)) return cb(null, true);
      cb(new Error('Only Excel (.xlsx, .xls) or CSV files are allowed'));
    }
  });

  router.post('/upload-map', requireAuth, requireSuperAdmin, plantUpload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const slug = await getOrganizationSlugFromRequest(req, pool);
      if (!slug) {
        return res.status(400).json({ error: 'Please select a company first' });
      }

      // Try to parse the uploaded Excel into map structure
      let structure = [];
      try {
        const parsed = parsePlantMap(req.file.path);
        if (parsed && parsed.length > 0) {
          structure = parsed;
        }
      } catch (parseError) {
        console.log('[PLANT] Could not auto-parse map structure from upload:', parseError.message);
        // File is still saved — user can use the Builder to create structure manually
      }

      // If we got structure, save it as map-structure.json
      if (structure.length > 0) {
        const organizationId = getOrganizationIdFromRequest(req);
        await saveMapStructureToFile(req, structure, 1, organizationId);
      }

      res.json({
        message: 'Plant map uploaded successfully',
        file: req.file.originalname,
        size: req.file.size,
        trackersFound: structure.length,
        path: req.file.path
      });
    } catch (error) {
      console.error('[PLANT] Error uploading plant map:', error);
      res.status(500).json({ error: 'Failed to upload plant map' });
    }
  });

  return router;
};
