const express = require('express');
const fs = require('fs');
const path = require('path');
const { requireFeature } = require('../middleware/requireFeature');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../middleware/tenantContext');
const { generateFaultLogExcel } = require('../utils/faultLogGenerator');
const {
  getOrganizationSlugFromRequest,
  getStoragePath,
  getFileUrl,
  ensureCompanyDirs,
  getOrganizationSlugById
} = require('../utils/organizationStorage');

module.exports = (pool) => {
  const router = express.Router();
  router.use(requireFeature(pool, 'cm_letters'));

  // Get all CM letters
  router.get('/', requireAuth, async (req, res) => {
    try {
      // System owners without a selected company should see no CM letters
      const { isSystemOwnerWithoutCompany, getOrganizationIdFromRequest } = require('../utils/organizationFilter');
      if (isSystemOwnerWithoutCompany(req)) {
        return res.json([]);
      }
      
      // Get organization ID from request context (for explicit filtering)
      const organizationId = getOrganizationIdFromRequest(req);
      if (!organizationId) {
        return res.json([]);
      }
      
      const { status, task_id, startDate, endDate } = req.query;
      let query = `
        SELECT cm.*, 
               t.task_code,
               a.asset_code, a.asset_name,
               pt.task_code as parent_task_code
        FROM cm_letters cm
        LEFT JOIN tasks t ON cm.task_id = t.id
        LEFT JOIN assets a ON cm.asset_id = a.id
        LEFT JOIN tasks pt ON cm.parent_pm_task_id = pt.id
        WHERE cm.organization_id = $1
      `;
      // Note: cm.* includes images and action_taken fields from fault log
      const params = [organizationId];
      let paramCount = 2;

      if (status) {
        query += ` AND cm.status = $${paramCount++}`;
        params.push(status);
      }
      if (task_id) {
        query += ` AND cm.task_id = $${paramCount++}`;
        params.push(task_id);
      }
      if (startDate) {
        query += ` AND DATE(cm.generated_at) >= $${paramCount++}`;
        params.push(startDate);
      }
      if (endDate) {
        query += ` AND DATE(cm.generated_at) <= $${paramCount++}`;
        params.push(endDate);
      }

      query += ' ORDER BY cm.generated_at DESC';

      const db = getDb(req, pool);
      const result = await db.query(query, params);
      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching CM letters:', error);
      res.status(500).json({ error: 'Failed to fetch CM letters' });
    }
  });

  // Download Fault Log Report (Excel) - MUST be before /:id route
  router.get('/fault-log/download', requireAuth, async (req, res) => {
    try {
      const { period = 'custom', startDate, endDate } = req.query;

      // Validate period - accept 'custom' as valid
      const validPeriods = ['all', 'weekly', 'monthly', 'yearly', 'custom'];
      console.log(`[FAULT LOG DOWNLOAD] Received period: "${period}", startDate: "${startDate}", endDate: "${endDate}"`);
      
      if (period && !validPeriods.includes(period)) {
        console.log(`[FAULT LOG DOWNLOAD] Invalid period: "${period}". Valid periods: ${validPeriods.join(', ')}`);
        return res.status(400).json({ 
          error: 'Invalid period', 
          message: `Period must be one of: ${validPeriods.join(', ')}` 
        });
      }
      
      console.log(`[FAULT LOG DOWNLOAD] Period validation passed: "${period}"`);

      // Validate that dates are provided for custom period
      if (period === 'custom' && (!startDate || !endDate)) {
        return res.status(400).json({ 
          error: 'Missing date range', 
          message: 'Both startDate and endDate are required for custom period' 
        });
      }

      // Parse dates if provided
      let startDateObj = null;
      let endDateObj = null;
      if (startDate) {
        startDateObj = new Date(startDate);
        if (isNaN(startDateObj.getTime())) {
          return res.status(400).json({ error: 'Invalid startDate format' });
        }
        // Set to start of day
        startDateObj.setHours(0, 0, 0, 0);
      }
      if (endDate) {
        endDateObj = new Date(endDate);
        if (isNaN(endDateObj.getTime())) {
          return res.status(400).json({ error: 'Invalid endDate format' });
        }
        // Set to end of day
        endDateObj.setHours(23, 59, 59, 999);
      }

      // Validate date range
      if (startDateObj && endDateObj && startDateObj > endDateObj) {
        return res.status(400).json({ 
          error: 'Invalid date range', 
          message: 'Start date must be before or equal to end date' 
        });
      }

      // Get organization slug for file storage
      const organizationSlug = await getOrganizationSlugFromRequest(req, pool);
      if (!organizationSlug) {
        return res.status(400).json({ error: 'Organization context is required' });
      }

      // Ensure company directories exist
      await ensureCompanyDirs(organizationSlug);

      // Generate Excel
      const buffer = await generateFaultLogExcel(pool, {
        period: period === 'custom' ? 'all' : period, // Use 'all' for custom to let date filtering handle it
        startDate: startDateObj,
        endDate: endDateObj
      });

      // Generate filename with date range
      let filename;
      if (startDate && endDate) {
        const startStr = startDate.replace(/-/g, '');
        const endStr = endDate.replace(/-/g, '');
        filename = `Fault_Log_${startStr}_to_${endStr}.xlsx`;
      } else {
        const periodLabel = period === 'all' ? 'All' : period.charAt(0).toUpperCase() + period.slice(1);
        const dateStr = new Date().toISOString().split('T')[0];
        filename = `Fault_Log_${periodLabel}_${dateStr}.xlsx`;
      }

      // Save report to company reports folder
      const reportsDir = getStoragePath(organizationSlug, 'reports');
      const reportPath = path.join(reportsDir, filename);
      fs.writeFileSync(reportPath, buffer);

      // Set headers
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);

      // Send buffer
      res.send(buffer);
    } catch (error) {
      console.error('Error generating fault log report:', error);
      console.error('Error stack:', error.stack);
      res.status(500).json({ 
        error: 'Failed to generate fault log report', 
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });

  // Get CM letter by ID
  router.get('/:id', requireAuth, async (req, res) => {
    try {
      // System owners without a selected company should see no CM letters
      const { isSystemOwnerWithoutCompany } = require('../utils/organizationFilter');
      if (isSystemOwnerWithoutCompany(req)) {
        return res.status(404).json({ error: 'CM letter not found' });
      }
      
      const db = getDb(req, pool);
      
      const result = await db.query(`
        SELECT cm.*, 
               t.task_code,
               a.asset_code, a.asset_name,
               pt.task_code as parent_task_code
        FROM cm_letters cm
        LEFT JOIN tasks t ON cm.task_id = t.id
        LEFT JOIN assets a ON cm.asset_id = a.id
        LEFT JOIN tasks pt ON cm.parent_pm_task_id = pt.id
        WHERE cm.id = $1
      `, [req.params.id]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'CM letter not found' });
      }
      
      const cmLetter = result.rows[0];
      
      // If images field is empty or null, try to fetch from failed_item_images table
      let images = cmLetter.images;
      if (!images || (typeof images === 'string' && images.trim() === '') || 
          (Array.isArray(images) && images.length === 0)) {
        
        // Try to get images from the parent PM task
        if (cmLetter.parent_pm_task_id) {
          const imagesResult = await db.query(
            `SELECT image_path, image_filename, item_id, section_id, comment 
             FROM failed_item_images 
             WHERE task_id = $1 
             ORDER BY uploaded_at ASC`,
            [cmLetter.parent_pm_task_id]
          );
          
          if (imagesResult.rows.length > 0) {
            images = imagesResult.rows.map(img => {
              // Use the full company-scoped path from image_path
              // image_path format: "/uploads/companies/{slug}/images/timestamp-uuid-filename.ext"
              // Keep the full path for proper company-scoped file serving
              let imagePath = img.image_path;
              let filename = img.image_filename || (imagePath ? imagePath.split('/').pop() : null);
              
              // If image_path is a company-scoped path, use it directly
              if (imagePath && imagePath.startsWith('/uploads/companies/')) {
                // Full company-scoped path - use as-is
                return {
                  path: imagePath,
                  image_path: imagePath,
                  filename: filename,
                  item_id: img.item_id,
                  section_id: img.section_id,
                  comment: img.comment || ''
                };
              }
              
              // Legacy path format - extract filename for backward compatibility
              if (imagePath && imagePath.includes('/')) {
                filename = imagePath.split('/').pop();
                imagePath = filename; // Store just filename for legacy routes
              }
              
              // If we don't have a filename yet, try to get it from image_filename
              if (!filename && img.image_filename) {
                filename = img.image_filename;
              }
              
              return {
                path: imagePath || filename,
                image_path: imagePath || filename,
                filename: filename,
                item_id: img.item_id,
                section_id: img.section_id,
                comment: img.comment || ''
              };
            });
            
            // Update the CM letter with the images (backfill)
            await db.query(
              'UPDATE cm_letters SET images = $1::jsonb WHERE id = $2',
              [JSON.stringify(images), req.params.id]
            );
            
            cmLetter.images = images;
            console.log(`Backfilled ${images.length} images for CM letter ${req.params.id} from parent PM task ${cmLetter.parent_pm_task_id}`);
          }
        }
      }
      
      res.json(cmLetter);
    } catch (error) {
      console.error('Error fetching CM letter:', error);
      res.status(500).json({ error: 'Failed to fetch CM letter' });
    }
  });

  // Update CM letter status
  router.patch('/:id/status', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const { status, resolved_at } = req.body;
      const updateFields = ['status = $1'];
      const params = [status];
      let paramCount = 2;

      if (resolved_at) {
        updateFields.push(`resolved_at = $${paramCount++}`);
        params.push(resolved_at);
      } else if (status === 'resolved' || status === 'closed') {
        updateFields.push('resolved_at = CURRENT_TIMESTAMP');
      }

      params.push(req.params.id);

      const result = await db.query(
        `UPDATE cm_letters
         SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
         WHERE id = $${paramCount}
         RETURNING *`,
        params
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'CM letter not found' });
      }
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error updating CM letter:', error);
      res.status(500).json({ error: 'Failed to update CM letter' });
    }
  });

  // Update CM letter fault log data
  router.patch('/:id/fault-log', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const {
        reported_by,
        plant,
        fault_description,
        affected_plant_functionality,
        main_affected_item,
        production_affected,
        affected_item_line,
        affected_item_cabinet,
        affected_item_inverter,
        affected_item_comb_box,
        affected_item_bb_tracker,
        code_error,
        failure_cause,
        action_taken
      } = req.body;

      // First, check if the fault log columns exist
      const columnCheck = await db.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'cm_letters' 
        AND column_name IN (
          'reported_by', 'plant', 'fault_description', 'affected_plant_functionality',
          'main_affected_item', 'production_affected', 'affected_item_line',
          'affected_item_cabinet', 'affected_item_inverter', 'affected_item_comb_box',
          'affected_item_bb_tracker', 'code_error', 'failure_cause', 'action_taken'
        )
      `);
      
      const existingColumns = new Set(columnCheck.rows.map(r => r.column_name));
      
      // If no fault log columns exist, return helpful error
      if (existingColumns.size === 0) {
        return res.status(500).json({ 
          error: 'Fault log columns not found',
          message: 'The database migration for fault log fields has not been run yet. Please run: node server/scripts/run-migration.js add_fault_log_fields_to_cm_letters.sql',
          migrationFile: 'add_fault_log_fields_to_cm_letters.sql'
        });
      }

      const updateFields = [];
      const params = [];
      let paramCount = 1;

      // Build dynamic update query - only include fields that exist in the database
      if (reported_by !== undefined && existingColumns.has('reported_by')) {
        updateFields.push(`reported_by = $${paramCount++}`);
        params.push(reported_by || null);
      }
      if (plant !== undefined && existingColumns.has('plant')) {
        updateFields.push(`plant = $${paramCount++}`);
        params.push(plant);
      }
      if (fault_description !== undefined && existingColumns.has('fault_description')) {
        updateFields.push(`fault_description = $${paramCount++}`);
        params.push(fault_description);
      }
      if (affected_plant_functionality !== undefined && existingColumns.has('affected_plant_functionality')) {
        updateFields.push(`affected_plant_functionality = $${paramCount++}`);
        params.push(affected_plant_functionality);
      }
      if (main_affected_item !== undefined && existingColumns.has('main_affected_item')) {
        updateFields.push(`main_affected_item = $${paramCount++}`);
        params.push(main_affected_item);
      }
      if (production_affected !== undefined && existingColumns.has('production_affected')) {
        updateFields.push(`production_affected = $${paramCount++}`);
        params.push(production_affected);
      }
      if (affected_item_line !== undefined && existingColumns.has('affected_item_line')) {
        updateFields.push(`affected_item_line = $${paramCount++}`);
        params.push(affected_item_line);
      }
      if (affected_item_cabinet !== undefined && existingColumns.has('affected_item_cabinet')) {
        updateFields.push(`affected_item_cabinet = $${paramCount++}`);
        params.push(affected_item_cabinet);
      }
      if (affected_item_inverter !== undefined && existingColumns.has('affected_item_inverter')) {
        updateFields.push(`affected_item_inverter = $${paramCount++}`);
        params.push(affected_item_inverter);
      }
      if (affected_item_comb_box !== undefined && existingColumns.has('affected_item_comb_box')) {
        updateFields.push(`affected_item_comb_box = $${paramCount++}`);
        params.push(affected_item_comb_box);
      }
      if (affected_item_bb_tracker !== undefined && existingColumns.has('affected_item_bb_tracker')) {
        updateFields.push(`affected_item_bb_tracker = $${paramCount++}`);
        params.push(affected_item_bb_tracker);
      }
      if (code_error !== undefined && existingColumns.has('code_error')) {
        updateFields.push(`code_error = $${paramCount++}`);
        params.push(code_error);
      }
      if (failure_cause !== undefined && existingColumns.has('failure_cause')) {
        updateFields.push(`failure_cause = $${paramCount++}`);
        params.push(failure_cause);
      }
      if (action_taken !== undefined && existingColumns.has('action_taken')) {
        updateFields.push(`action_taken = $${paramCount++}`);
        params.push(action_taken);
      }

      if (updateFields.length === 0) {
        return res.status(400).json({ error: 'No fields to update or columns do not exist' });
      }

      params.push(req.params.id);
      updateFields.push(`updated_at = CURRENT_TIMESTAMP`);

      const result = await db.query(
        `UPDATE cm_letters
         SET ${updateFields.join(', ')}
         WHERE id = $${paramCount}
         RETURNING *`,
        params
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'CM letter not found' });
      }
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error updating CM letter fault log:', error);
      
      // Provide helpful error message if columns don't exist
      if (error.code === '42703') {
        return res.status(500).json({ 
          error: 'Database column not found',
          message: 'The database migration for fault log fields has not been run yet. Please run the migration: add_fault_log_fields_to_cm_letters.sql',
          migrationFile: 'add_fault_log_fields_to_cm_letters.sql',
          details: error.message
        });
      }
      
      res.status(500).json({ error: 'Failed to update CM letter fault log', message: error.message });
    }
  });

  return router;
};

