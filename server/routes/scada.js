const express = require('express');
const crypto = require('crypto');
const { requireAuth, isSuperAdmin } = require('../middleware/auth');
const { getDb } = require('../middleware/tenantContext');

// Simple encryption for API keys (use a proper KMS in production)
const ENCRYPTION_KEY = process.env.SCADA_ENCRYPTION_KEY || process.env.SESSION_SECRET || 'default-key-change-me';

function encrypt(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(encryptedText) {
  if (!encryptedText) return null;
  try {
    const [ivHex, encrypted] = encryptedText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return null;
  }
}

module.exports = (pool) => {
  const router = express.Router();

  // Helper: check system owner (delegates to auth middleware helper)
  const isSystemOwner = (req) => isSuperAdmin(req);

  // ========== SCADA CONNECTION MANAGEMENT (System Owner Only) ==========

  // List all SCADA connections (system owner sees all, org users see their own)
  router.get('/connections', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const orgFilter = req.query.organization_id;

      let query, params;
      if (isSystemOwner(req) && orgFilter) {
        query = `
          SELECT c.*, o.name as organization_name
          FROM scada_connections c
          JOIN organizations o ON c.organization_id = o.id
          WHERE c.organization_id = $1
          ORDER BY c.created_at DESC
        `;
        params = [orgFilter];
      } else if (isSystemOwner(req)) {
        query = `
          SELECT c.*, o.name as organization_name
          FROM scada_connections c
          JOIN organizations o ON c.organization_id = o.id
          ORDER BY c.created_at DESC
        `;
        params = [];
      } else {
        query = `
          SELECT c.*, o.name as organization_name
          FROM scada_connections c
          JOIN organizations o ON c.organization_id = o.id
          ORDER BY c.created_at DESC
        `;
        params = [];
      }

      const result = await db.query(query, params);

      // Never expose encrypted API keys to frontend
      const connections = result.rows.map(c => ({
        ...c,
        api_key_encrypted: c.api_key_encrypted ? '••••••••' : null,
        has_api_key: !!c.api_key_encrypted
      }));

      res.json(connections);
    } catch (error) {
      console.error('Error fetching SCADA connections:', error);
      res.status(500).json({ error: 'Failed to fetch SCADA connections' });
    }
  });

  // Create a SCADA connection (System Owner only)
  router.post('/connections', requireAuth, async (req, res) => {
    try {
      if (!isSystemOwner(req)) {
        return res.status(403).json({ error: 'Only system owners can create SCADA connections' });
      }

      const {
        organization_id, name, provider, base_url,
        api_key, auth_type, auth_config,
        poll_interval_minutes, field_mapping
      } = req.body;

      if (!organization_id || !name || !base_url) {
        return res.status(400).json({ error: 'organization_id, name, and base_url are required' });
      }

      const db = getDb(req, pool);
      const encryptedKey = api_key ? encrypt(api_key) : null;

      const result = await db.query(`
        INSERT INTO scada_connections (
          organization_id, name, provider, base_url,
          api_key_encrypted, auth_type, auth_config,
          poll_interval_minutes, field_mapping
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `, [
        organization_id, name, provider || 'custom', base_url,
        encryptedKey, auth_type || 'api_key', JSON.stringify(auth_config || {}),
        poll_interval_minutes || 5, JSON.stringify(field_mapping || {})
      ]);

      const connection = result.rows[0];
      connection.api_key_encrypted = connection.api_key_encrypted ? '••••••••' : null;
      connection.has_api_key = !!encryptedKey;

      res.status(201).json(connection);
    } catch (error) {
      console.error('Error creating SCADA connection:', error);
      res.status(500).json({ error: 'Failed to create SCADA connection' });
    }
  });

  // Update a SCADA connection (System Owner only)
  router.put('/connections/:id', requireAuth, async (req, res) => {
    try {
      if (!isSystemOwner(req)) {
        return res.status(403).json({ error: 'Only system owners can update SCADA connections' });
      }

      const { id } = req.params;
      const {
        name, provider, base_url,
        api_key, auth_type, auth_config,
        poll_interval_minutes, field_mapping, is_active
      } = req.body;

      // Build update query dynamically
      const updates = [];
      const values = [];
      let paramCount = 1;

      if (name !== undefined) { updates.push(`name = $${paramCount++}`); values.push(name); }
      if (provider !== undefined) { updates.push(`provider = $${paramCount++}`); values.push(provider); }
      if (base_url !== undefined) { updates.push(`base_url = $${paramCount++}`); values.push(base_url); }
      if (api_key !== undefined) { updates.push(`api_key_encrypted = $${paramCount++}`); values.push(api_key ? encrypt(api_key) : null); }
      if (auth_type !== undefined) { updates.push(`auth_type = $${paramCount++}`); values.push(auth_type); }
      if (auth_config !== undefined) { updates.push(`auth_config = $${paramCount++}`); values.push(JSON.stringify(auth_config)); }
      if (poll_interval_minutes !== undefined) { updates.push(`poll_interval_minutes = $${paramCount++}`); values.push(poll_interval_minutes); }
      if (field_mapping !== undefined) { updates.push(`field_mapping = $${paramCount++}`); values.push(JSON.stringify(field_mapping)); }
      if (is_active !== undefined) { updates.push(`is_active = $${paramCount++}`); values.push(is_active); }

      updates.push(`updated_at = NOW()`);
      values.push(id);

      const db = getDb(req, pool);
      const result = await db.query(
        `UPDATE scada_connections SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Connection not found' });
      }

      const connection = result.rows[0];
      connection.api_key_encrypted = connection.api_key_encrypted ? '••••••••' : null;
      connection.has_api_key = !!connection.api_key_encrypted;

      res.json(connection);
    } catch (error) {
      console.error('Error updating SCADA connection:', error);
      res.status(500).json({ error: 'Failed to update SCADA connection' });
    }
  });

  // Delete a SCADA connection (System Owner only)
  router.delete('/connections/:id', requireAuth, async (req, res) => {
    try {
      if (!isSystemOwner(req)) {
        return res.status(403).json({ error: 'Only system owners can delete SCADA connections' });
      }

      const db = getDb(req, pool);
      const result = await db.query(
        'DELETE FROM scada_connections WHERE id = $1 RETURNING id',
        [req.params.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Connection not found' });
      }

      res.json({ message: 'Connection deleted' });
    } catch (error) {
      console.error('Error deleting SCADA connection:', error);
      res.status(500).json({ error: 'Failed to delete SCADA connection' });
    }
  });

  // Test a SCADA connection (System Owner only)
  router.post('/connections/:id/test', requireAuth, async (req, res) => {
    try {
      if (!isSystemOwner(req)) {
        return res.status(403).json({ error: 'Only system owners can test connections' });
      }

      const db = getDb(req, pool);
      const connResult = await db.query(
        'SELECT * FROM scada_connections WHERE id = $1',
        [req.params.id]
      );

      if (connResult.rows.length === 0) {
        return res.status(404).json({ error: 'Connection not found' });
      }

      const conn = connResult.rows[0];
      const apiKey = decrypt(conn.api_key_encrypted);

      // Attempt to fetch from the SCADA API
      const startTime = Date.now();
      try {
        const headers = { 'Content-Type': 'application/json' };

        if (conn.auth_type === 'api_key' && apiKey) {
          headers['Authorization'] = `Bearer ${apiKey}`;
        } else if (conn.auth_type === 'basic' && apiKey) {
          headers['Authorization'] = `Basic ${Buffer.from(apiKey).toString('base64')}`;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(conn.base_url, {
          method: 'GET',
          headers,
          signal: controller.signal
        });

        clearTimeout(timeout);
        const responseTime = Date.now() - startTime;

        // Update connection status
        await db.query(
          `UPDATE scada_connections SET status = $1, last_sync_at = NOW(), last_error = NULL, updated_at = NOW() WHERE id = $2`,
          [response.ok ? 'connected' : 'error', conn.id]
        );

        res.json({
          success: response.ok,
          status: response.status,
          statusText: response.statusText,
          responseTime: `${responseTime}ms`,
          message: response.ok ? 'Connection successful' : `Server returned ${response.status}`
        });
      } catch (fetchError) {
        const responseTime = Date.now() - startTime;

        await db.query(
          `UPDATE scada_connections SET status = 'error', last_error = $1, updated_at = NOW() WHERE id = $2`,
          [fetchError.message, conn.id]
        );

        res.json({
          success: false,
          responseTime: `${responseTime}ms`,
          message: fetchError.name === 'AbortError' ? 'Connection timed out (10s)' : fetchError.message
        });
      }
    } catch (error) {
      console.error('Error testing SCADA connection:', error);
      res.status(500).json({ error: 'Failed to test connection' });
    }
  });

  // ========== SCADA DATA ENDPOINTS (Org Users) ==========

  // Get latest SCADA data for the current organization
  router.get('/data/latest', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const { data_type, device_id, limit: queryLimit } = req.query;
      const limit = Math.min(parseInt(queryLimit) || 100, 500);

      let query = `
        SELECT d.*, c.name as connection_name
        FROM scada_data d
        JOIN scada_connections c ON d.connection_id = c.id
        WHERE 1=1
      `;
      const params = [];
      let paramIdx = 1;

      if (data_type) {
        query += ` AND d.data_type = $${paramIdx++}`;
        params.push(data_type);
      }
      if (device_id) {
        query += ` AND d.device_id = $${paramIdx++}`;
        params.push(device_id);
      }

      query += ` ORDER BY d.timestamp DESC LIMIT $${paramIdx}`;
      params.push(limit);

      const result = await db.query(query, params);
      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching SCADA data:', error);
      res.status(500).json({ error: 'Failed to fetch SCADA data' });
    }
  });

  // Get SCADA data summary (KPIs) for the current organization
  router.get('/data/summary', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);

      // Get the most recent value for each data type
      const latestData = await db.query(`
        SELECT DISTINCT ON (data_type)
          data_type, value, unit, timestamp, device_id
        FROM scada_data
        ORDER BY data_type, timestamp DESC
      `);

      // Get today's energy yield
      const todayEnergy = await db.query(`
        SELECT
          COALESCE(SUM(value), 0) as total_energy,
          MAX(unit) as unit
        FROM scada_data
        WHERE data_type = 'energy'
          AND timestamp >= CURRENT_DATE
      `);

      // Get active alarms count
      const activeAlarms = await db.query(`
        SELECT
          severity,
          COUNT(*) as count
        FROM scada_alarms
        WHERE resolved_at IS NULL
        GROUP BY severity
      `);

      // Get connected inverter count
      const inverterStatus = await db.query(`
        SELECT DISTINCT ON (device_id)
          device_id, value, timestamp
        FROM scada_data
        WHERE data_type = 'inverter_status'
        ORDER BY device_id, timestamp DESC
      `);

      res.json({
        latestReadings: latestData.rows,
        todayEnergy: {
          value: parseFloat(todayEnergy.rows[0]?.total_energy || 0),
          unit: todayEnergy.rows[0]?.unit || 'kWh'
        },
        alarms: activeAlarms.rows.reduce((acc, row) => {
          acc[row.severity] = parseInt(row.count);
          return acc;
        }, { critical: 0, warning: 0, info: 0 }),
        inverters: inverterStatus.rows.map(inv => ({
          deviceId: inv.device_id,
          status: parseFloat(inv.value) > 0 ? 'online' : 'offline',
          lastUpdate: inv.timestamp
        }))
      });
    } catch (error) {
      console.error('Error fetching SCADA summary:', error);
      res.status(500).json({ error: 'Failed to fetch SCADA summary' });
    }
  });

  // Get SCADA alarms for the current organization
  router.get('/alarms', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const { resolved, severity, limit: queryLimit } = req.query;
      const limit = Math.min(parseInt(queryLimit) || 50, 200);

      let query = 'SELECT a.*, u.full_name as acknowledged_by_name FROM scada_alarms a LEFT JOIN users u ON a.acknowledged_by = u.id WHERE 1=1';
      const params = [];
      let paramIdx = 1;

      if (resolved === 'false') {
        query += ' AND a.resolved_at IS NULL';
      } else if (resolved === 'true') {
        query += ' AND a.resolved_at IS NOT NULL';
      }

      if (severity) {
        query += ` AND a.severity = $${paramIdx++}`;
        params.push(severity);
      }

      query += ` ORDER BY a.occurred_at DESC LIMIT $${paramIdx}`;
      params.push(limit);

      const result = await db.query(query, params);
      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching SCADA alarms:', error);
      res.status(500).json({ error: 'Failed to fetch SCADA alarms' });
    }
  });

  // Acknowledge an alarm
  router.post('/alarms/:id/acknowledge', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const result = await db.query(
        `UPDATE scada_alarms SET acknowledged_by = $1, acknowledged_at = NOW() WHERE id = $2 RETURNING *`,
        [req.session.userId, req.params.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Alarm not found' });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error acknowledging alarm:', error);
      res.status(500).json({ error: 'Failed to acknowledge alarm' });
    }
  });

  // Get SCADA data for charts (time-series)
  router.get('/data/timeseries', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const { data_type, device_id, period } = req.query;

      if (!data_type) {
        return res.status(400).json({ error: 'data_type is required' });
      }

      // Determine time range based on period
      let interval;
      switch (period) {
        case 'day': interval = '24 hours'; break;
        case 'week': interval = '7 days'; break;
        case 'month': interval = '30 days'; break;
        default: interval = '24 hours';
      }

      let query = `
        SELECT timestamp, value, unit, device_id
        FROM scada_data
        WHERE data_type = $1
          AND timestamp >= NOW() - INTERVAL '${interval}'
      `;
      const params = [data_type];

      if (device_id) {
        query += ` AND device_id = $2`;
        params.push(device_id);
      }

      query += ' ORDER BY timestamp ASC';

      const result = await db.query(query, params);
      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching SCADA timeseries:', error);
      res.status(500).json({ error: 'Failed to fetch timeseries data' });
    }
  });

  return router;
};
