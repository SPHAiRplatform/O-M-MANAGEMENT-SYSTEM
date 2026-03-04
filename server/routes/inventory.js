const express = require('express');
const { requireAuth, requireAdmin, isTechnician } = require('../middleware/auth');
const { requireFeature } = require('../middleware/requireFeature');
const fs = require('fs');
const path = require('path');
const { parseInventoryFromExcel, updateActualQtyInExcel, updateInventoryItemInExcel, exportInventoryToExcel, DEFAULT_INVENTORY_XLSX } = require('../utils/inventoryExcelSync');
const { v4: uuidv4 } = require('uuid');
const {
  getOrganizationSlugFromRequest,
  getStoragePath,
  ensureCompanyDirs
} = require('../utils/organizationStorage');
const { getOrganizationIdFromRequest } = require('../utils/organizationFilter');
const { getDb } = require('../middleware/tenantContext');

module.exports = (pool) => {
  const router = express.Router();
  router.use(requireFeature(pool, 'inventory'));
  
  console.log('[INVENTORY] Inventory routes module loaded');
  console.log('[INVENTORY] Registering routes...');

  // Automatic Excel -> DB sync (safe, only runs when Excel file changes)
  // This makes "Sync from Excel" effectively automatic for all users.
  let lastSyncedMtimeMs = null;
  let syncInFlight = null;

  async function syncInventoryFromExcel(organizationId) {
    const parsed = await parseInventoryFromExcel();
    const items = parsed.items || [];

    let upserts = 0;
    let skipped = 0;
    for (const item of items) {
      // Skip invalid items: item_code is "0" or empty, or description is "0"
      if (!item.item_code || item.item_code.trim() === '' || item.item_code === '0' || item.item_description === '0') {
        skipped++;
        continue;
      }
      
      // Skip items where all fields are zeros (invalid data)
      if (item.item_code === '0' && 
          (item.item_description === '0' || !item.item_description) && 
          (!item.part_type || item.part_type === '0') &&
          (!item.min_level || item.min_level === 0) &&
          (!item.actual_qty || item.actual_qty === 0)) {
        skipped++;
        continue;
      }

      await pool.query(
        `INSERT INTO inventory_items (section, item_code, item_description, part_type, min_level, actual_qty, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (item_code) DO UPDATE SET
           section = EXCLUDED.section,
           item_description = EXCLUDED.item_description,
           part_type = EXCLUDED.part_type,
           min_level = EXCLUDED.min_level,
           -- IMPORTANT: actual_qty stays in sync with Excel as the "source"
           actual_qty = EXCLUDED.actual_qty,
           updated_at = CURRENT_TIMESTAMP`,
        [item.section || null, item.item_code, item.item_description || null, item.part_type || null, item.min_level || 0, item.actual_qty || 0, organizationId]
      );
      upserts++;
    }
    
    if (skipped > 0) {
      console.log(`[INVENTORY] Skipped ${skipped} invalid item(s) during sync`);
    }

    return { message: 'Imported inventory from Excel', items: upserts, file: parsed.filePath };
  }

  async function ensureInventorySyncedIfNeeded(organizationId) {
    // Default: enabled (user requested automatic sync). Can be disabled via env if ever needed.
    const enabled = String(process.env.INVENTORY_AUTO_SYNC ?? 'true').toLowerCase() !== 'false';
    if (!enabled) return;

    let stat;
    try {
      stat = fs.statSync(DEFAULT_INVENTORY_XLSX);
    } catch (e) {
      // If file missing/unreadable, don't block inventory reads; existing DB data still works.
      return;
    }

    const mtimeMs = stat.mtimeMs;
    if (lastSyncedMtimeMs !== null && mtimeMs <= lastSyncedMtimeMs) return;

    if (!syncInFlight) {
      syncInFlight = (async () => {
        try {
          await syncInventoryFromExcel(organizationId);
          lastSyncedMtimeMs = mtimeMs;
        } finally {
          syncInFlight = null;
        }
      })();
    }

    await syncInFlight;
  }

  // List inventory items
  router.get('/items', requireAuth, async (req, res) => {
    try {
      // System owners without a selected company should see no inventory
      const { isSystemOwnerWithoutCompany } = require('../utils/organizationFilter');
      if (isSystemOwnerWithoutCompany(req)) {
        return res.json([]);
      }
      
      // Wrap sync in try-catch to prevent it from breaking the entire endpoint
      try {
        await ensureInventorySyncedIfNeeded(getOrganizationIdFromRequest(req));
      } catch (syncError) {
        console.error('[INVENTORY] Error syncing from Excel (non-fatal):', syncError.message);
        // Continue even if sync fails - use existing DB data
      }
      
      // Get organization ID from request context (for explicit filtering)
      const { getOrganizationIdFromRequest } = require('../utils/organizationFilter');
      const organizationId = getOrganizationIdFromRequest(req);
      
      if (!organizationId) {
        return res.json([]);
      }
      
      const lowStock = String(req.query.low_stock || '').toLowerCase() === 'true';
      const q = String(req.query.q || '').trim();

      const params = [];
      let where = 'WHERE organization_id = $1';
      params.push(organizationId);
      let paramCount = 2;
      
      if (lowStock) {
        where += ` AND actual_qty <= min_level`;
      }
      if (q) {
        params.push(`%${q}%`);
        // Search by section number OR description OR item_code
        where += ` AND (item_description ILIKE $${paramCount} OR section ILIKE $${paramCount} OR item_code ILIKE $${paramCount})`;
        paramCount++;
      }

      const db = getDb(req, pool);
      const result = await db.query(
        `SELECT * FROM inventory_items ${where} ORDER BY section NULLS LAST, item_code`,
        params
      );
      
      // Remove the last 14 items from the list (they are not supposed to be counted as spares)
      const items = result.rows;
      const filteredItems = items.length > 14 ? items.slice(0, items.length - 14) : items;
      
      res.json(filteredItems);
    } catch (e) {
      console.error('[INVENTORY] Error in GET /items:', e);
      res.status(500).json({ error: 'Service unavailable' });
    }
  });

  // Import/refresh items from Excel (admin only) - kept for backward compatibility
  router.post('/import', requireAdmin, async (req, res) => {
    try {
      const out = await syncInventoryFromExcel(getOrganizationIdFromRequest(req));
      // Also update the mtime checkpoint so GET /items won't immediately re-sync.
      try {
        const stat = fs.statSync(DEFAULT_INVENTORY_XLSX);
        lastSyncedMtimeMs = stat.mtimeMs;
      } catch (e) {
        // ignore
      }
      res.json(out);
    } catch (e) {
      console.error('[INVENTORY] Error in POST /import:', e);
      res.status(500).json({ error: 'Import failed' });
    }
  });

  // Download inventory as Excel file (admin only) - uses existing template
  // IMPORTANT: This route must be defined BEFORE any catch-all routes
  console.log('[INVENTORY] Registering GET /download route');
  router.get('/download', requireAdmin, async (req, res) => {
    console.log('[INVENTORY] ========== DOWNLOAD REQUEST ==========');
    console.log('[INVENTORY] Download request received from:', req.session?.username || 'unknown');
    console.log('[INVENTORY] User ID:', req.session?.userId);
    console.log('[INVENTORY] User role:', req.session?.role);
    console.log('[INVENTORY] Request method:', req.method);
    console.log('[INVENTORY] Request path:', req.path);
    console.log('[INVENTORY] Request originalUrl:', req.originalUrl);
    console.log('[INVENTORY] ======================================');
    
    try {
      // Get organization slug for file storage
      const organizationSlug = await getOrganizationSlugFromRequest(req, pool);
      if (organizationSlug) {
        await ensureCompanyDirs(organizationSlug);
      }

      console.log('[INVENTORY] Starting export to Excel...');
      const buffer = await exportInventoryToExcel(pool);
      console.log('[INVENTORY] Excel export successful, buffer size:', buffer.length, 'bytes');
      
      // Save to company exports folder if organization context exists
      const filename = `Inventory_Count_${new Date().toISOString().split('T')[0]}.xlsx`;
      if (organizationSlug) {
        const exportsDir = getStoragePath(organizationSlug, 'exports');
        const exportPath = path.join(exportsDir, filename);
        fs.writeFileSync(exportPath, buffer);
        console.log('[INVENTORY] Saved export to company folder:', exportPath);
      }
      
      // Set headers for file download
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);
      
      console.log('[INVENTORY] Sending file:', filename);
      res.send(buffer);
      console.log('[INVENTORY] File sent successfully');
    } catch (e) {
      console.error('[INVENTORY] Error exporting inventory to Excel:', e);
      
      // Send error response
      if (!res.headersSent) {
        res.status(500).json({ 
          error: 'Export failed'
        });
      }
    }
  });

  // Admin: restock/adjust (updates DB + writes back only Actual Qty in Excel)
  router.post('/adjust', requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
      const { item_code, qty_change, note, tx_type } = req.body || {};
      if (!item_code) return res.status(400).json({ error: 'Item code required' });
      const delta = parseInt(qty_change, 10);
      if (!Number.isFinite(delta) || delta === 0) return res.status(400).json({ error: 'Invalid quantity' });

      await client.query('BEGIN');
      const itemRes = await client.query('SELECT * FROM inventory_items WHERE item_code = $1 FOR UPDATE', [item_code]);
      if (itemRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Not found' });
      }

      const item = itemRes.rows[0];
      const newQty = (item.actual_qty || 0) + delta;
      if (newQty < 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Insufficient stock' });
      }

      await client.query(
        `UPDATE inventory_items SET actual_qty = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [newQty, item.id]
      );

      await client.query(
        `INSERT INTO inventory_transactions (item_id, tx_type, qty_change, note, created_by, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [item.id, tx_type || (delta > 0 ? 'restock' : 'adjust'), delta, note || null, req.session.userId || null, getOrganizationIdFromRequest(req)]
      );

      await client.query('COMMIT');

      // Sync to Excel (only Actual Qty changes)
      await updateActualQtyInExcel({ [item_code]: newQty });

      res.json({ item_code, actual_qty: newQty });
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('[INVENTORY] Error in POST /adjust:', e);
      res.status(500).json({ error: 'Update failed' });
    } finally {
      client.release();
    }
  });

  // Consume spares for a task - all authenticated users can consume during task execution
  // Body: { task_id, items: [{ item_code, qty_used }] }
  router.post('/consume', requireAuth, async (req, res) => {
    const client = await pool.connect();
    try {
      const { task_id, items } = req.body || {};
      if (!task_id) return res.status(400).json({ error: 'Task ID required' });
      if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Items required' });

      await client.query('BEGIN');

      const orgId = getOrganizationIdFromRequest(req);
      const slipNo = `SLIP-${Date.now()}-${uuidv4().slice(0, 6).toUpperCase()}`;
      const slipRes = await client.query(
        `INSERT INTO inventory_slips (slip_no, task_id, created_by, organization_id)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [slipNo, task_id, req.session.userId || null, orgId]
      );
      const slip = slipRes.rows[0];

      const updates = {};

      for (const line of items) {
        const code = String(line.item_code || '').trim();
        const qty = parseInt(line.qty_used, 10);
        if (!code || !Number.isFinite(qty) || qty <= 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Invalid item data' });
        }

        const itemRes = await client.query(
          'SELECT * FROM inventory_items WHERE item_code = $1 FOR UPDATE',
          [code]
        );
        if (itemRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Not found' });
        }

        const item = itemRes.rows[0];
        const available = item.actual_qty || 0;
        if (available - qty < 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Insufficient stock' });
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
          [item.id, task_id, slip.id, -qty, req.session.userId || null, orgId]
        );

        updates[code] = newQty;
      }

      await client.query('COMMIT');

      // Sync Excel Actual Qty
      await updateActualQtyInExcel(updates);

      res.status(201).json({ slip, updated_items: updates });
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('[INVENTORY] Error in POST /consume:', e);
      res.status(500).json({ error: 'Consume failed' });
    } finally {
      client.release();
    }
  });

  // List slips
  router.get('/slips', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const result = await db.query(
        `SELECT s.*, u.full_name as created_by_name
         FROM inventory_slips s
         LEFT JOIN users u ON s.created_by = u.id
         ORDER BY s.created_at DESC
         LIMIT 200`
      );
      res.json(result.rows);
    } catch (e) {
      console.error('[INVENTORY] Error in GET /slips:', e);
      res.status(500).json({ error: 'Service unavailable' });
    }
  });

  router.get('/slips/:id', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const slipRes = await db.query('SELECT * FROM inventory_slips WHERE id = $1', [req.params.id]);
      if (slipRes.rows.length === 0) return res.status(404).json({ error: 'Not found' });
      const linesRes = await db.query('SELECT * FROM inventory_slip_lines WHERE slip_id = $1 ORDER BY created_at ASC', [req.params.id]);
      res.json({ slip: slipRes.rows[0], lines: linesRes.rows });
    } catch (e) {
      console.error('[INVENTORY] Error in GET /slips/:id:', e);
      res.status(500).json({ error: 'Service unavailable' });
    }
  });

  // Create new inventory item (admin only)
  router.post('/items', requireAdmin, async (req, res) => {
    try {
      const { section, item_code, item_description, part_type, min_level, actual_qty } = req.body;
      
      if (!item_code) {
        return res.status(400).json({ error: 'Item code required' });
      }

      // Validate: reject invalid item codes
      const trimmedCode = String(item_code || '').trim();
      if (!trimmedCode || trimmedCode === '0') {
        return res.status(400).json({ error: 'Invalid item code' });
      }

      // Validate: reject invalid descriptions
      if (item_description === '0') {
        return res.status(400).json({ error: 'Invalid description' });
      }

      // Check if item_code already exists
      const db = getDb(req, pool);
      const existing = await db.query('SELECT id FROM inventory_items WHERE item_code = $1', [trimmedCode]);
      if (existing.rows.length > 0) {
        return res.status(400).json({ error: 'Already exists' });
      }

      const result = await db.query(
        `INSERT INTO inventory_items (section, item_code, item_description, part_type, min_level, actual_qty, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          section || null,
          trimmedCode,
          item_description || null,
          part_type || null,
          min_level || 0,
          actual_qty || 0,
          getOrganizationIdFromRequest(req)
        ]
      );

      res.status(201).json(result.rows[0]);
    } catch (e) {
      if (e.code === '23505') { // Unique violation
        res.status(400).json({ error: 'Already exists' });
      } else {
        console.error('[INVENTORY] Error in POST /items:', e);
        res.status(500).json({ error: 'Create failed' });
      }
    }
  });

  // Update inventory item (admin only) - can update all fields including item_code
  router.put('/items/:item_code', requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
      const oldItemCode = req.params.item_code;
      const { section, item_code, item_description, part_type, min_level, actual_qty } = req.body;

      // Get current item to check if it exists
      const currentItem = await client.query('SELECT * FROM inventory_items WHERE item_code = $1', [oldItemCode]);
      if (currentItem.rows.length === 0) {
        await client.release();
        return res.status(404).json({ error: 'Inventory item not found' });
      }

      // If item_code is being changed, check if new code already exists
      if (item_code !== undefined && item_code !== oldItemCode) {
        const existing = await client.query('SELECT id FROM inventory_items WHERE item_code = $1', [item_code]);
        if (existing.rows.length > 0) {
          await client.release();
          return res.status(400).json({ error: 'New item code already exists' });
        }
      }

      await client.query('BEGIN');

      // Build update query dynamically based on provided fields
      const updates = [];
      const values = [];
      let paramIndex = 1;

      if (section !== undefined) {
        updates.push(`section = $${paramIndex++}`);
        values.push(section || null);
      }
      if (item_code !== undefined && item_code !== oldItemCode) {
        updates.push(`item_code = $${paramIndex++}`);
        values.push(item_code);
      }
      if (item_description !== undefined) {
        updates.push(`item_description = $${paramIndex++}`);
        values.push(item_description || null);
      }
      if (part_type !== undefined) {
        updates.push(`part_type = $${paramIndex++}`);
        values.push(part_type || null);
      }
      if (min_level !== undefined) {
        updates.push(`min_level = $${paramIndex++}`);
        values.push(parseInt(min_level, 10) || 0);
      }
      if (actual_qty !== undefined) {
        updates.push(`actual_qty = $${paramIndex++}`);
        values.push(parseInt(actual_qty, 10) || 0);
      }

      if (updates.length === 0) {
        await client.query('ROLLBACK');
        await client.release();
        return res.status(400).json({ error: 'No fields to update' });
      }

      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(oldItemCode);

      const result = await client.query(
        `UPDATE inventory_items 
         SET ${updates.join(', ')}
         WHERE item_code = $${paramIndex}
         RETURNING *`,
        values
      );

      await client.query('COMMIT');
      await client.release();

      // Sync to Excel with all updated fields
      const excelUpdates = {};
      if (section !== undefined) excelUpdates.section = section;
      if (item_code !== undefined) excelUpdates.item_code = item_code;
      if (item_description !== undefined) excelUpdates.item_description = item_description;
      if (part_type !== undefined) excelUpdates.part_type = part_type;
      if (min_level !== undefined) excelUpdates.min_level = min_level;
      if (actual_qty !== undefined) excelUpdates.actual_qty = actual_qty;

      try {
        await updateInventoryItemInExcel(oldItemCode, excelUpdates);
      } catch (excelError) {
        console.error('[INVENTORY] Error updating Excel file:', excelError);
        // Don't fail the request if Excel update fails, but log it
      }

      res.json(result.rows[0]);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      await client.release();
      if (e.code === '23505') { // Unique violation
        res.status(400).json({ error: 'Already exists' });
      } else {
        console.error('[INVENTORY] Error in PUT /items/:item_code:', e);
        res.status(500).json({ error: 'Update failed' });
      }
    }
  });

  // Get spares usage with date range filter
  router.get('/usage', requireAuth, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      
      let dateFilter = '';
      const params = [];
      let paramCount = 1;
      
      if (startDate && endDate) {
        // Use explicit date range
        dateFilter = `WHERE DATE(t.created_at) >= $${paramCount++} AND DATE(t.created_at) <= $${paramCount++}`;
        params.push(startDate, endDate);
      } else if (startDate) {
        // Only start date provided
        dateFilter = `WHERE DATE(t.created_at) >= $${paramCount++}`;
        params.push(startDate);
      } else if (endDate) {
        // Only end date provided
        dateFilter = `WHERE DATE(t.created_at) <= $${paramCount++}`;
        params.push(endDate);
      } else {
        // Default to last 30 days if no dates provided
        dateFilter = 'WHERE t.created_at >= CURRENT_DATE - INTERVAL \'30 days\'';
      }

      const db = getDb(req, pool);
      const result = await db.query(
        `SELECT
          i.section,
          i.item_code,
          i.item_description,
          SUM(ABS(t.qty_change)) as total_qty_used,
          COUNT(DISTINCT t.slip_id) as usage_count,
          MAX(t.created_at) as last_used_at
         FROM inventory_transactions t
         INNER JOIN inventory_items i ON t.item_id = i.id
         INNER JOIN inventory_slips s ON t.slip_id = s.id
         ${dateFilter}
         AND t.tx_type = 'use'
         GROUP BY i.section, i.item_code, i.item_description
         ORDER BY total_qty_used DESC, i.section, i.item_code
         LIMIT 500`,
        params
      );
      
      // Note: Spare requests are now included in usage tracking since they create
      // inventory_transactions and inventory_slips when approved

      res.json(result.rows);
    } catch (e) {
      console.error('[INVENTORY] Error in GET /usage:', e);
      res.status(500).json({ error: 'Service unavailable' });
    }
  });

  console.log('[INVENTORY] All inventory routes registered');
  return router;
};


