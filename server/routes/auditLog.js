const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../middleware/tenantContext');

module.exports = (pool) => {
  const router = express.Router();

  const isSystemOwner = (req) =>
    req.session?.roles?.includes('system_owner') || req.session?.role === 'system_owner' ||
    req.session?.roles?.includes('super_admin') || req.session?.role === 'super_admin';

  const scopeCondition = (req, conditions, params, paramIndexRef) => {
    if (isSystemOwner(req)) {
      if (req.query.organization_id) {
        conditions.push(`a.organization_id = $${paramIndexRef.current++}`);
        params.push(req.query.organization_id);
      }
    } else {
      const orgId = req.tenantContext?.organizationId;
      if (orgId) {
        conditions.push(`a.organization_id = $${paramIndexRef.current++}`);
        params.push(orgId);
      }
    }
  };

  // GET / — List audit log entries (system owner: all orgs; org admin: own org only)
  router.get('/', requireAuth, async (req, res) => {
    try {
      if (!isSystemOwner(req) && !req.tenantContext?.organizationId) {
        return res.status(403).json({ error: 'Organization context required to view audit log' });
      }
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
      const offset = (page - 1) * limit;

      const conditions = [];
      const params = [];
      const paramIndexRef = { current: 1 };

      scopeCondition(req, conditions, params, paramIndexRef);

      if (req.query.action) {
        conditions.push(`a.action = $${paramIndexRef.current++}`);
        params.push(req.query.action);
      }
      if (req.query.entity_type) {
        conditions.push(`a.entity_type = $${paramIndexRef.current++}`);
        params.push(req.query.entity_type);
      }
      if (req.query.user_id) {
        conditions.push(`a.user_id = $${paramIndexRef.current++}`);
        params.push(req.query.user_id);
      }
      if (req.query.from) {
        conditions.push(`a.created_at >= $${paramIndexRef.current++}`);
        params.push(req.query.from);
      }
      if (req.query.to) {
        conditions.push(`a.created_at <= $${paramIndexRef.current++}`);
        params.push(req.query.to + 'T23:59:59.999Z');
      }
      if (req.query.search) {
        const searchTerm = `%${req.query.search}%`;
        conditions.push(`(a.username ILIKE $${paramIndexRef.current} OR a.action ILIKE $${paramIndexRef.current} OR a.entity_type ILIKE $${paramIndexRef.current} OR a.details::text ILIKE $${paramIndexRef.current})`);
        params.push(searchTerm);
        paramIndexRef.current++;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const countResult = await pool.query(
        `SELECT COUNT(*) as total FROM audit_log a ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0].total);

      const entriesResult = await pool.query(
        `SELECT a.id, a.user_id, a.username, a.action, a.entity_type, a.entity_id, a.organization_id,
                o.name AS organization_name, a.details, a.ip_address, a.created_at
         FROM audit_log a
         LEFT JOIN organizations o ON o.id = a.organization_id
         ${whereClause}
         ORDER BY a.created_at DESC
         LIMIT $${paramIndexRef.current++} OFFSET $${paramIndexRef.current++}`,
        [...params, limit, offset]
      );

      res.json({
        entries: entriesResult.rows,
        total,
        page,
        limit
      });
    } catch (error) {
      console.error('[AUDIT LOG] Error listing entries:', error);
      res.status(500).json({ error: 'Failed to load audit log entries' });
    }
  });

  router.get('/actions', requireAuth, async (req, res) => {
    try {
      if (!isSystemOwner(req) && !req.tenantContext?.organizationId) {
        return res.status(403).json({ error: 'Organization context required' });
      }
      const conditions = [];
      const params = [];
      const paramIndexRef = { current: 1 };
      scopeCondition(req, conditions, params, paramIndexRef);
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const result = await pool.query(
        `SELECT DISTINCT action FROM audit_log a ${whereClause} ORDER BY action ASC`,
        params
      );
      res.json(result.rows.map(r => r.action));
    } catch (error) {
      console.error('[AUDIT LOG] Error listing actions:', error);
      res.status(500).json({ error: 'Failed to load audit log actions' });
    }
  });

  router.get('/entity-types', requireAuth, async (req, res) => {
    try {
      if (!isSystemOwner(req) && !req.tenantContext?.organizationId) {
        return res.status(403).json({ error: 'Organization context required' });
      }
      const conditions = [];
      const params = [];
      const paramIndexRef = { current: 1 };
      scopeCondition(req, conditions, params, paramIndexRef);
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const result = await pool.query(
        `SELECT DISTINCT entity_type FROM audit_log a ${whereClause} ORDER BY entity_type ASC`,
        params
      );
      res.json(result.rows.map(r => r.entity_type));
    } catch (error) {
      console.error('[AUDIT LOG] Error listing entity types:', error);
      res.status(500).json({ error: 'Failed to load audit log entity types' });
    }
  });

  return router;
};
