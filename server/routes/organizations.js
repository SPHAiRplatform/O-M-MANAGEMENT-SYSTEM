/**
 * Organizations API Routes
 * CRUD operations for organizations (tenants)
 * Settings, Features, and Branding management
 */

const express = require('express');
const bcrypt = require('bcrypt');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { requireAuth, requireSuperAdmin, isSuperAdmin } = require('../middleware/auth');
const { getDb } = require('../middleware/tenantContext');
const { initializeDefaultConfigurations } = require('../utils/organizationConfig');
const { cloneSystemTemplatesToOrganization } = require('../utils/templateCloning');
const { getCompanyDisplayName } = require('../utils/companyDisplayName');
const { 
  getCompanyDir, 
  sanitizeSlug, 
  getStoragePath, 
  getFileUrl,
  ensureCompanyDirs,
  getOrganizationSlugById
} = require('../utils/organizationStorage');
const { logAudit, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require('../utils/auditLogger');

module.exports = (pool) => {
  const router = express.Router();

  // Get all organizations (System Owner only)
  router.get('/', requireAuth, async (req, res) => {
    try {
      // Only system owners can list all organizations
      const isSystemOwner = req.session.roles?.includes('system_owner') || 
                           req.session.role === 'system_owner';
      
      if (!isSystemOwner) {
        return res.status(403).json({ error: 'Only system owners can list organizations' });
      }

      const db = getDb(req, pool);
      const result = await db.query(`
        SELECT 
          id, name, slug, is_active, created_at, updated_at,
          (SELECT COUNT(*) FROM users WHERE organization_id = organizations.id) as user_count,
          (SELECT COUNT(*) FROM assets WHERE organization_id = organizations.id) as asset_count,
          (SELECT COUNT(*) FROM tasks WHERE organization_id = organizations.id AND task_type = 'PM') as task_count,
          (SELECT setting_value::text FROM organization_settings WHERE organization_id = organizations.id AND setting_key = 'user_limit' LIMIT 1) as user_limit,
          (SELECT setting_value::text FROM organization_settings WHERE organization_id = organizations.id AND setting_key = 'subscription_plan' LIMIT 1) as subscription_plan
        FROM organizations
        ORDER BY created_at DESC
      `);
      const rows = result.rows.map(row => {
        const r = { ...row };
        if (r.user_limit != null) {
          try { r.user_limit = JSON.parse(r.user_limit); } catch (_) { r.user_limit = null; }
        }
        if (r.subscription_plan != null) {
          try {
            const sp = typeof r.subscription_plan === 'string' ? JSON.parse(r.subscription_plan) : r.subscription_plan;
            r.subscription_plan = typeof sp === 'string' ? sp : (sp && typeof sp === 'object' ? null : sp);
          } catch (_) { r.subscription_plan = null; }
        }
        return r;
      });
      res.json(rows);
    } catch (error) {
      console.error('Error fetching organizations:', error);
      res.status(500).json({ error: 'Failed to fetch organizations' });
    }
  });

  // Get organization by ID
  router.get('/:id', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const isSystemOwner = req.session.roles?.includes('system_owner') || 
                           req.session.role === 'system_owner';
      
      const db = getDb(req, pool);
      
      // System owners can see any org, others only their own
      let query = 'SELECT * FROM organizations WHERE id = $1';
      const params = [id];
      
      if (!isSystemOwner) {
        query += ' AND id = $2';
        params.push(req.session.organizationId || req.tenantContext?.organizationId);
      }
      
      const result = await db.query(query, params);
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Organization not found' });
      }
      
      const org = result.rows[0];
      const settingsResult = await db.query(`
        SELECT setting_key, setting_value FROM organization_settings
        WHERE organization_id = $1 AND setting_key IN ('user_limit', 'subscription_plan')
      `, [id]);
      settingsResult.rows.forEach(s => {
        try {
          const v = typeof s.setting_value === 'string' ? JSON.parse(s.setting_value) : s.setting_value;
          org[s.setting_key] = v;
        } catch (_) {
          org[s.setting_key] = s.setting_value;
        }
      });
      res.json(org);
    } catch (error) {
      console.error('Error fetching organization:', error);
      res.status(500).json({ error: 'Failed to fetch organization' });
    }
  });

  // Get current organization with limits (for tenant context: user_count, user_limit, subscription_plan)
  router.get('/current/limits', requireAuth, async (req, res) => {
    try {
      const orgId = req.session.organizationId || req.tenantContext?.organizationId;
      const isSystemOwner = req.session.roles?.includes('system_owner') || req.session.role === 'system_owner';
      if (!orgId && !isSystemOwner) {
        return res.status(400).json({ error: 'No organization context' });
      }
      const db = getDb(req, pool);
      let targetOrgId = orgId;
      if (isSystemOwner && req.query.organization_id) {
        targetOrgId = req.query.organization_id;
      }
      if (!targetOrgId) {
        return res.status(400).json({ error: 'Organization context required' });
      }
      const orgResult = await db.query(
        'SELECT id, name, slug FROM organizations WHERE id = $1',
        [targetOrgId]
      );
      if (orgResult.rows.length === 0) {
        return res.status(404).json({ error: 'Organization not found' });
      }
      const countResult = await db.query(
        'SELECT COUNT(*) as count FROM users WHERE organization_id = $1',
        [targetOrgId]
      );
      const settingsResult = await db.query(`
        SELECT setting_key, setting_value FROM organization_settings
        WHERE organization_id = $1 AND setting_key IN ('user_limit', 'subscription_plan')
      `, [targetOrgId]);
      const user_count = parseInt(countResult.rows[0].count, 10);
      let user_limit = null;
      let subscription_plan = null;
      settingsResult.rows.forEach(s => {
        try {
          const v = typeof s.setting_value === 'string' ? JSON.parse(s.setting_value) : s.setting_value;
          if (s.setting_key === 'user_limit') user_limit = v;
          if (s.setting_key === 'subscription_plan') subscription_plan = v;
        } catch (parseError) {
          console.warn('Failed to parse organization setting:', {
            settingKey: s.setting_key,
            error: parseError.message,
            organizationId: targetOrgId
          });
          // Use default values - already initialized above
        }
      });
      res.json({
        organization: orgResult.rows[0],
        user_count,
        user_limit,
        subscription_plan
      });
    } catch (error) {
      console.error('Error fetching organization limits:', error);
      res.status(500).json({ error: 'Failed to fetch limits' });
    }
  });

  // Get current organization enabled features (for tenant nav and route gating)
  const GATED_FEATURE_CODES = ['plant', 'inventory', 'calendar', 'cm_letters', 'templates', 'users'];
  router.get('/current/features', requireAuth, async (req, res) => {
    try {
      const orgId = req.session.organizationId || req.tenantContext?.organizationId;
      const isSystemOwner = req.session.roles?.includes('system_owner') || req.session.role === 'system_owner';
      if (!orgId && !isSystemOwner) {
        return res.json({ features: {} });
      }
      const db = getDb(req, pool);
      let targetOrgId = orgId;
      if (isSystemOwner && req.query.organization_id) {
        targetOrgId = req.query.organization_id;
      }
      if (!targetOrgId) {
        return res.json({ features: {} });
      }
      const result = await db.query(
        `SELECT feature_code, is_enabled FROM organization_features
         WHERE organization_id = $1 AND feature_code = ANY($2)`,
        [targetOrgId, GATED_FEATURE_CODES]
      );
      const features = {};
      GATED_FEATURE_CODES.forEach(code => {
        features[code] = true;
      });
      result.rows.forEach(row => {
        features[row.feature_code] = row.is_enabled === true;
      });
      res.json({ features });
    } catch (error) {
      console.error('Error fetching organization features:', error);
      res.status(500).json({ error: 'Failed to fetch features' });
    }
  });

  // Create new organization (System Owner only)
  router.post('/', requireAuth, async (req, res) => {
    try {
      const isSystemOwner = req.session.roles?.includes('system_owner') || 
                           req.session.role === 'system_owner';
      
      if (!isSystemOwner) {
        return res.status(403).json({ error: 'Only system owners can create organizations' });
      }

      const { name, slug, is_active = true, first_user: firstUser } = req.body;
      
      if (!name || !slug) {
        return res.status(400).json({ error: 'Name and slug are required' });
      }
      if (firstUser && (!firstUser.username || !firstUser.email || !firstUser.full_name)) {
        return res.status(400).json({ error: 'First user requires username, email, and full_name' });
      }
      if (firstUser && firstUser.password && firstUser.password.length < 6) {
        return res.status(400).json({ error: 'First user password must be at least 6 characters' });
      }

      const db = getDb(req, pool);
      
      // Check if slug already exists
      const slugCheck = await db.query(
        'SELECT id FROM organizations WHERE slug = $1',
        [slug]
      );
      
      if (slugCheck.rows.length > 0) {
        return res.status(400).json({ error: 'Slug already exists' });
      }

      const orgId = uuidv4();
      const result = await db.query(`
        INSERT INTO organizations (id, name, slug, is_active, created_at, updated_at)
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING *
      `, [orgId, name, slug, is_active]);
      
      // Create organization directory structure using slug
      try {
        await ensureCompanyDirs(slug);
        console.log(`Created storage directories for organization: ${name} (${slug})`);
      } catch (dirError) {
        console.error('Error creating organization directories:', dirError);
        // Don't fail organization creation if directory creation fails
      }

      // Initialize default configurations for new organization
      try {
        await initializeDefaultConfigurations(db, orgId);
      } catch (configError) {
        console.error('Error initializing default configurations:', configError);
        // Don't fail organization creation if config initialization fails
      }

      // Initialize default branding with display name
      try {
        const displayName = getCompanyDisplayName(name);
        await db.query(`
          INSERT INTO organization_branding (
            organization_id,
            company_name_display,
            primary_color,
            secondary_color,
            branding_config,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT (organization_id) DO NOTHING
        `, [orgId, displayName, '#1A73E8', '#4285F4']);
      } catch (brandingError) {
        console.error('Error initializing default branding:', brandingError);
        // Don't fail organization creation if branding initialization fails
      }

      // Clone system templates to the new organization
      try {
        const cloneResult = await cloneSystemTemplatesToOrganization(db, orgId);
        console.log(`Cloned ${cloneResult.cloned} system templates for organization: ${name} (${slug})`);
      } catch (cloneError) {
        console.error('Error cloning system templates:', cloneError);
        // Don't fail organization creation if template cloning fails
      }

      let firstUserCreated = null;
      if (firstUser && firstUser.username && firstUser.email && firstUser.full_name) {
        try {
          const username = firstUser.username.trim();
          const email = firstUser.email.trim();
          const fullName = firstUser.full_name.trim();
          const DEFAULT_PASSWORD = process.env.DEFAULT_USER_PASSWORD || '000001';
          const password = (firstUser.password && firstUser.password.trim()) ? firstUser.password.trim() : DEFAULT_PASSWORD;
          const passwordHash = await bcrypt.hash(password, 10);
          const userId = uuidv4();
          await db.query(
            `INSERT INTO users (id, username, email, full_name, role, roles, password_hash, is_active, password_changed, organization_id)
             VALUES ($1, $2, $3, $4, 'operations_admin', '["operations_admin"]'::jsonb, $5, true, $6, $7)`,
            [userId, username, email, fullName, passwordHash, password === DEFAULT_PASSWORD, orgId]
          );
          const roleRow = await pool.query('SELECT id FROM roles WHERE role_code = $1', ['operations_admin']);
          if (roleRow.rows.length > 0) {
            await pool.query(
              `INSERT INTO user_roles (user_id, role_id, assigned_at, assigned_by)
               VALUES ($1, $2, CURRENT_TIMESTAMP, $3)
               ON CONFLICT (user_id, role_id) DO NOTHING`,
              [userId, roleRow.rows[0].id, req.session.userId]
            );
          }
          firstUserCreated = { id: userId, username, email, full_name: fullName };
        } catch (userErr) {
          console.error('Error creating first user for organization:', userErr);
          if (userErr.code === '23505') {
            return res.status(400).json({ error: 'First user username or email already exists' });
          }
          return res.status(500).json({ error: 'Failed to create first user', details: userErr.message });
        }
      }
      
      const responsePayload = result.rows[0];
      if (firstUserCreated) {
        responsePayload.first_user = firstUserCreated;
      }
      res.status(201).json(responsePayload);
    } catch (error) {
      console.error('Error creating organization:', error);
      res.status(500).json({ error: 'Failed to create organization' });
    }
  });

  // Update organization (System Owner only)
  router.put('/:id', requireAuth, async (req, res) => {
    try {
      const isSystemOwner = req.session.roles?.includes('system_owner') || 
                           req.session.role === 'system_owner';
      
      if (!isSystemOwner) {
        return res.status(403).json({ error: 'Only system owners can update organizations' });
      }

      const { id } = req.params;
      const { name, slug, is_active } = req.body;
      
      const db = getDb(req, pool);
      
      // Check if organization exists
      const orgCheck = await db.query('SELECT id FROM organizations WHERE id = $1', [id]);
      if (orgCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Organization not found' });
      }

      // Check slug uniqueness if changing slug
      if (slug) {
        const slugCheck = await db.query(
          'SELECT id FROM organizations WHERE slug = $1 AND id != $2',
          [slug, id]
        );
        if (slugCheck.rows.length > 0) {
          return res.status(400).json({ error: 'Slug already exists' });
        }
      }

      const updates = [];
      const params = [];
      let paramCount = 1;

      if (name !== undefined) {
        updates.push(`name = $${paramCount++}`);
        params.push(name);
      }
      if (slug !== undefined) {
        updates.push(`slug = $${paramCount++}`);
        params.push(slug);
      }
      if (is_active !== undefined) {
        updates.push(`is_active = $${paramCount++}`);
        params.push(is_active);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      params.push(id);

      const result = await db.query(`
        UPDATE organizations
        SET ${updates.join(', ')}
        WHERE id = $${paramCount}
        RETURNING *
      `, params);
      
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error updating organization:', error);
      res.status(500).json({ error: 'Failed to update organization' });
    }
  });

  // Delete organization (System Owner only, hard delete - removes all data and files)
  router.delete('/:id', requireAuth, async (req, res) => {
    const client = await pool.connect();
    
    try {
      const isSystemOwner = req.session.roles?.includes('system_owner') || 
                           req.session.role === 'system_owner';
      
      if (!isSystemOwner) {
        return res.status(403).json({ error: 'Only system owners can delete organizations' });
      }

      const { id } = req.params;
      
      // Start transaction
      await client.query('BEGIN');
      
      // Get organization details before deletion (for file cleanup)
      const orgResult = await client.query(
        'SELECT id, name, slug FROM organizations WHERE id = $1',
        [id]
      );
      
      if (orgResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Organization not found' });
      }
      
      const org = orgResult.rows[0];
      const orgSlug = org.slug;
      
      console.log(`[DELETE ORGANIZATION] Starting deletion of: ${org.name} (${org.id})`);
      
      // Delete organization (cascading deletes will handle related records)
      // Due to CASCADE constraints, this will automatically delete:
      // - users, assets, tasks, checklist_templates, checklist_responses
      // - cm_letters, inventory_items, calendar_events, etc.
      await client.query('DELETE FROM organizations WHERE id = $1', [id]);
      
      console.log(`[DELETE ORGANIZATION] Database records deleted for: ${org.name}`);
      
      // Delete company folder structure
      try {
        const companyDir = getCompanyDir(orgSlug);
        const sanitizedSlug = sanitizeSlug(orgSlug);
        const companyDirPath = path.join(__dirname, '..', 'uploads', 'companies', sanitizedSlug);
        
        if (fs.existsSync(companyDirPath)) {
          // Recursively delete the entire company folder
          fs.rmSync(companyDirPath, { recursive: true, force: true });
          console.log(`[DELETE ORGANIZATION] Deleted folder: ${companyDirPath}`);
        } else {
          console.log(`[DELETE ORGANIZATION] Folder not found (may not exist): ${companyDirPath}`);
        }
      } catch (fileError) {
        console.error(`[DELETE ORGANIZATION] Error deleting company folder:`, fileError);
        // Don't fail the deletion if folder deletion fails, but log it
      }
      
      // Commit transaction
      await client.query('COMMIT');
      
      console.log(`[DELETE ORGANIZATION] Successfully deleted: ${org.name}`);
      
      res.json({ 
        message: 'Organization and all associated data deleted successfully',
        deleted_organization: {
          id: org.id,
          name: org.name,
          slug: org.slug
        }
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[DELETE ORGANIZATION] Error deleting organization:', error);
      res.status(500).json({ 
        error: 'Failed to delete organization',
        details: error.message 
      });
    } finally {
      client.release();
    }
  });

  // ========== SETTINGS MANAGEMENT ==========

  // Get organization settings
  router.get('/:id/settings', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const isSystemOwner = req.session.roles?.includes('system_owner') || 
                           req.session.role === 'system_owner';
      
      const db = getDb(req, pool);
      
      // Check access
      if (!isSystemOwner && id !== (req.session.organizationId || req.tenantContext?.organizationId)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const result = await db.query(`
        SELECT setting_key, setting_value, description, created_at, updated_at
        FROM organization_settings
        WHERE organization_id = $1
        ORDER BY setting_key
      `, [id]);
      
      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching settings:', error);
      res.status(500).json({ error: 'Failed to fetch settings' });
    }
  });

  // Update organization settings
  router.put('/:id/settings', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const isSystemOwner = req.session.roles?.includes('system_owner') || 
                           req.session.role === 'system_owner';
      
      const db = getDb(req, pool);
      
      // Check access
      if (!isSystemOwner && id !== (req.session.organizationId || req.tenantContext?.organizationId)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const { settings } = req.body; // Array of {setting_key, setting_value, description}
      
      if (!Array.isArray(settings)) {
        return res.status(400).json({ error: 'Settings must be an array' });
      }

      const results = [];
      
      for (const setting of settings) {
        const { setting_key, setting_value, description } = setting;
        
        if (!setting_key) {
          continue;
        }

        const result = await db.query(`
          INSERT INTO organization_settings (organization_id, setting_key, setting_value, description, updated_at)
          VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
          ON CONFLICT (organization_id, setting_key)
          DO UPDATE SET
            setting_value = EXCLUDED.setting_value,
            description = EXCLUDED.description,
            updated_at = CURRENT_TIMESTAMP
          RETURNING *
        `, [id, setting_key, JSON.stringify(setting_value), description]);
        
        results.push(result.rows[0]);
      }
      
      res.json(results);
    } catch (error) {
      console.error('Error updating settings:', error);
      res.status(500).json({ error: 'Failed to update settings' });
    }
  });

  // ========== FEATURES MANAGEMENT ==========

  // Get organization features
  router.get('/:id/features', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const isSystemOwner = req.session.roles?.includes('system_owner') || 
                           req.session.role === 'system_owner';
      
      const db = getDb(req, pool);
      
      // Check access
      if (!isSystemOwner && id !== (req.session.organizationId || req.tenantContext?.organizationId)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const result = await db.query(`
        SELECT feature_code, is_enabled, config, created_at, updated_at
        FROM organization_features
        WHERE organization_id = $1
        ORDER BY feature_code
      `, [id]);
      
      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching features:', error);
      res.status(500).json({ error: 'Failed to fetch features' });
    }
  });

  // Update organization features
  router.put('/:id/features', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const isSystemOwner = req.session.roles?.includes('system_owner') || 
                           req.session.role === 'system_owner';
      
      const db = getDb(req, pool);
      
      // Check access
      if (!isSystemOwner && id !== (req.session.organizationId || req.tenantContext?.organizationId)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const { features } = req.body; // Array of {feature_code, is_enabled, config}
      
      if (!Array.isArray(features)) {
        return res.status(400).json({ error: 'Features must be an array' });
      }

      const results = [];
      
      for (const feature of features) {
        const { feature_code, is_enabled, config = {} } = feature;
        
        if (!feature_code) {
          continue;
        }

        const result = await db.query(`
          INSERT INTO organization_features (organization_id, feature_code, is_enabled, config, updated_at)
          VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
          ON CONFLICT (organization_id, feature_code)
          DO UPDATE SET
            is_enabled = EXCLUDED.is_enabled,
            config = EXCLUDED.config,
            updated_at = CURRENT_TIMESTAMP
          RETURNING *
        `, [id, feature_code, is_enabled, JSON.stringify(config)]);
        
        results.push(result.rows[0]);
      }
      
      res.json(results);
    } catch (error) {
      console.error('Error updating features:', error);
      res.status(500).json({ error: 'Failed to update features' });
    }
  });

  // ========== BRANDING MANAGEMENT ==========

  // Get current organization's branding (for logged-in user)
  router.get('/current/branding', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);
      
      // Get organization ID from tenant context
      let organizationId = null;
      if (req.tenantContext && req.tenantContext.organizationId) {
        organizationId = req.tenantContext.organizationId;
      } else if (req.session && req.session.selectedOrganizationId) {
        organizationId = req.session.selectedOrganizationId;
      } else if (req.user && req.user.organization_id) {
        organizationId = req.user.organization_id;
      }
      
      if (!organizationId) {
        // No organization context - return default/null branding
        return res.json(null);
      }
      
      const result = await db.query(`
        SELECT * FROM organization_branding
        WHERE organization_id = $1
      `, [organizationId]);
      
      if (result.rows.length === 0) {
        return res.json(null);
      }
      
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error fetching current organization branding:', error);
      res.status(500).json({ error: 'Failed to fetch branding' });
    }
  });

  // Get organization branding
  router.get('/:id/branding', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const isSystemOwner = req.session.roles?.includes('system_owner') || 
                           req.session.role === 'system_owner';
      
      const db = getDb(req, pool);
      
      // Check access
      if (!isSystemOwner && id !== (req.session.organizationId || req.tenantContext?.organizationId)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const result = await db.query(`
        SELECT * FROM organization_branding
        WHERE organization_id = $1
      `, [id]);
      
      if (result.rows.length === 0) {
        return res.json(null);
      }
      
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error fetching branding:', error);
      res.status(500).json({ error: 'Failed to fetch branding' });
    }
  });

  // Upload company logo
  router.post('/:id/logo', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const isSystemOwner = req.session.roles?.includes('system_owner') || 
                           req.session.role === 'system_owner';
      
      if (!isSystemOwner) {
        return res.status(403).json({ error: 'Only system owners can upload logos' });
      }

      const db = getDb(req, pool);
      
      // Get organization slug
      const orgResult = await db.query('SELECT slug FROM organizations WHERE id = $1', [id]);
      if (orgResult.rows.length === 0) {
        return res.status(404).json({ error: 'Organization not found' });
      }
      
      const organizationSlug = orgResult.rows[0].slug;
      
      // Configure multer for logo upload
      const logoStorage = multer.diskStorage({
        destination: async (req, file, cb) => {
          try {
            await ensureCompanyDirs(organizationSlug);
            const logosDir = getStoragePath(organizationSlug, 'logos');
            cb(null, logosDir);
          } catch (error) {
            cb(error);
          }
        },
        filename: (req, file, cb) => {
          // Always save as logo.png (overwrite existing)
          cb(null, 'logo.png');
        }
      });

      const logoUpload = multer({
        storage: logoStorage,
        limits: {
          fileSize: 5 * 1024 * 1024 // 5MB limit
        },
        fileFilter: (req, file, cb) => {
          const allowedTypes = /jpeg|jpg|png|gif|webp|svg/;
          const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
          const mimetype = allowedTypes.test(file.mimetype);

          if (mimetype && extname) {
            return cb(null, true);
          } else {
            cb(new Error('Only image files are allowed (jpeg, jpg, png, gif, webp, svg)'));
          }
        }
      });

      // Handle upload
      logoUpload.single('logo')(req, res, async (err) => {
        if (err) {
          return res.status(400).json({ error: err.message });
        }

        if (!req.file) {
          return res.status(400).json({ error: 'No logo file provided' });
        }

        try {
          // Get file URL
          const logoUrl = getFileUrl(organizationSlug, 'logos', 'logo.png');
          
          // Update branding record with logo URL
          await db.query(`
            INSERT INTO organization_branding (organization_id, logo_url, updated_at)
            VALUES ($1, $2, CURRENT_TIMESTAMP)
            ON CONFLICT (organization_id)
            DO UPDATE SET logo_url = EXCLUDED.logo_url, updated_at = CURRENT_TIMESTAMP
          `, [id, logoUrl]);

          res.json({ 
            success: true, 
            logo_url: logoUrl,
            message: 'Logo uploaded successfully' 
          });
        } catch (error) {
          console.error('Error saving logo:', error);
          // Delete uploaded file on error
          if (req.file && req.file.path) {
            try {
              fs.unlinkSync(req.file.path);
            } catch (unlinkError) {
              console.error('Error deleting uploaded file:', unlinkError);
            }
          }
          res.status(500).json({ error: 'Failed to save logo' });
        }
      });
    } catch (error) {
      console.error('Error uploading logo:', error);
      res.status(500).json({ error: 'Failed to upload logo' });
    }
  });

  // Delete organization logo
  router.delete('/:id/logo', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const isSystemOwner = req.session.roles?.includes('system_owner') ||
                           req.session.role === 'system_owner';

      if (!isSystemOwner) {
        return res.status(403).json({ error: 'Only system owners can delete logos' });
      }

      const db = getDb(req, pool);

      // Get organization slug
      const orgResult = await db.query('SELECT slug, name FROM organizations WHERE id = $1', [id]);
      if (orgResult.rows.length === 0) {
        return res.status(404).json({ error: 'Organization not found' });
      }

      const organizationSlug = orgResult.rows[0].slug;
      const organizationName = orgResult.rows[0].name;

      console.log(`[Logo Delete] Starting logo deletion for: ${organizationName} (${id})`);

      let fileDeleted = false;
      try {
        // Delete logo file from disk
        const logosDir = getStoragePath(organizationSlug, 'logos');
        const logoPath = path.join(logosDir, 'logo.png');

        console.log(`[Logo Delete] Logo path: ${logoPath}`);

        if (fs.existsSync(logoPath)) {
          fs.unlinkSync(logoPath);
          fileDeleted = true;
          console.log(`[Logo Delete] Successfully deleted logo file at: ${logoPath}`);
        } else {
          console.log(`[Logo Delete] Logo file does not exist at: ${logoPath}`);
        }
      } catch (fileError) {
        console.error(`[Logo Delete] Error deleting logo file for ${organizationName}:`, fileError);
        // Continue - we'll still clear the database entry
      }

      // Clear logo_url from database
      const brandingResult = await db.query(`
        INSERT INTO organization_branding (organization_id, logo_url, updated_at)
        VALUES ($1, NULL, CURRENT_TIMESTAMP)
        ON CONFLICT (organization_id)
        DO UPDATE SET logo_url = NULL, updated_at = CURRENT_TIMESTAMP
        RETURNING logo_url
      `, [id]);

      console.log(`[Logo Delete] Database updated for ${organizationName}. Logo URL is now: ${brandingResult.rows[0]?.logo_url || 'NULL'}`);

      res.json({
        success: true,
        message: 'Logo deleted successfully',
        file_deleted: fileDeleted,
        database_updated: true
      });

      console.log(`[Logo Delete] Successfully completed logo deletion for: ${organizationName}`);
    } catch (error) {
      console.error('[Logo Delete] Error deleting logo:', error);
      res.status(500).json({
        error: 'Failed to delete logo',
        details: error.message
      });
    }
  });

  // Update organization branding
  router.put('/:id/branding', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const isSystemOwner = req.session.roles?.includes('system_owner') || 
                           req.session.role === 'system_owner';
      
      const db = getDb(req, pool);
      
      // Check access
      if (!isSystemOwner && id !== (req.session.organizationId || req.tenantContext?.organizationId)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const { logo_url, primary_color, secondary_color, company_name_display, favicon_url, custom_domain, site_map_name, branding_config = {} } = req.body;

      const result = await db.query(`
        INSERT INTO organization_branding (
          organization_id, logo_url, primary_color, secondary_color,
          company_name_display, favicon_url, custom_domain, site_map_name, branding_config, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
        ON CONFLICT (organization_id)
        DO UPDATE SET
          logo_url = COALESCE(EXCLUDED.logo_url, organization_branding.logo_url),
          primary_color = COALESCE(EXCLUDED.primary_color, organization_branding.primary_color),
          secondary_color = COALESCE(EXCLUDED.secondary_color, organization_branding.secondary_color),
          company_name_display = COALESCE(EXCLUDED.company_name_display, organization_branding.company_name_display),
          favicon_url = COALESCE(EXCLUDED.favicon_url, organization_branding.favicon_url),
          custom_domain = COALESCE(EXCLUDED.custom_domain, organization_branding.custom_domain),
          site_map_name = COALESCE(EXCLUDED.site_map_name, organization_branding.site_map_name, 'Site Map'),
          branding_config = COALESCE(EXCLUDED.branding_config, organization_branding.branding_config),
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `, [id, logo_url, primary_color, secondary_color, company_name_display, favicon_url, custom_domain, site_map_name || 'Site Map', JSON.stringify(branding_config)]);
      
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error updating branding:', error);
      res.status(500).json({ error: 'Failed to update branding' });
    }
  });

  // Set selected organization for system owner entering a company
  router.post('/:id/enter', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const isSystemOwner = req.session.roles?.includes('system_owner') || 
                           req.session.role === 'system_owner';
      
      if (!isSystemOwner) {
        return res.status(403).json({ error: 'Only system owners can enter companies' });
      }

      const db = getDb(req, pool);
      
      // Verify organization exists and is active
      const orgResult = await db.query(
        'SELECT id, name, slug, is_active FROM organizations WHERE id = $1',
        [id]
      );
      
      if (orgResult.rows.length === 0) {
        return res.status(404).json({ error: 'Organization not found' });
      }
      
      const org = orgResult.rows[0];
      
      if (!org.is_active) {
        return res.status(400).json({ error: 'Cannot enter inactive organization' });
      }
      
      req.session.selectedOrganizationId = id;
      req.session.selectedOrganizationName = org.name;
      req.session.selectedOrganizationSlug = org.slug;
      logAudit(pool, req, { action: AUDIT_ACTIONS.ORG_ENTERED, entityType: AUDIT_ENTITY_TYPES.ORGANIZATION, entityId: id, details: { organization_name: org.name } }).catch(() => {});
      req.session.save((err) => {
        if (err) {
          console.error('Error saving session:', err);
          return res.status(500).json({ error: 'Failed to save session' });
        }
        
        res.json({
          success: true,
          organization: {
            id: org.id,
            name: org.name,
            slug: org.slug
          },
          message: `Entered ${org.name}`
        });
      });
    } catch (error) {
      console.error('Error entering organization:', error);
      res.status(500).json({ error: 'Failed to enter organization' });
    }
  });

  // Exit company (clear selected organization)
  router.post('/exit', requireAuth, async (req, res) => {
    try {
      const isSystemOwner = req.session.roles?.includes('system_owner') || 
                           req.session.role === 'system_owner';
      
      if (!isSystemOwner) {
        return res.status(403).json({ error: 'Only system owners can exit companies' });
      }
      const exitedOrgId = req.session.selectedOrganizationId;
      const exitedOrgName = req.session.selectedOrganizationName;
      logAudit(pool, req, { action: AUDIT_ACTIONS.ORG_EXITED, entityType: AUDIT_ENTITY_TYPES.ORGANIZATION, entityId: exitedOrgId || undefined, details: { organization_name: exitedOrgName } }).catch(() => {});
      req.session.selectedOrganizationId = null;
      req.session.selectedOrganizationName = null;
      req.session.selectedOrganizationSlug = null;
      req.session.save((err) => {
        if (err) {
          console.error('Error saving session:', err);
          return res.status(500).json({ error: 'Failed to save session' });
        }
        
        res.json({
          success: true,
          message: 'Exited company'
        });
      });
    } catch (error) {
      console.error('Error exiting organization:', error);
      res.status(500).json({ error: 'Failed to exit organization' });
    }
  });

  // Verify data isolation for an organization (System Owner only)
  // This endpoint helps verify that organizations have the expected data (or lack thereof)
  router.get('/:id/verify-data', requireAuth, async (req, res) => {
    try {
      const isSystemOwner = req.session.roles?.includes('system_owner') || 
                           req.session.role === 'system_owner';
      
      if (!isSystemOwner) {
        return res.status(403).json({ error: 'Only system owners can verify organization data' });
      }

      const { id } = req.params;
      const db = getDb(req, pool);

      // Get organization info
      const orgResult = await db.query(
        'SELECT id, name, slug, is_active FROM organizations WHERE id = $1',
        [id]
      );

      if (orgResult.rows.length === 0) {
        return res.status(404).json({ error: 'Organization not found' });
      }

      const org = orgResult.rows[0];
      const isSIE = id === '00000000-0000-0000-0000-000000000001';

      // Count data for this organization
      const dataCounts = {
        users: 0,
        assets: 0,
        tasks: 0,
        templates: 0,
        notifications: 0,
        tracker_status_requests: 0
      };

      try {
        const usersResult = await db.query(
          `SELECT COUNT(*) as count FROM users
           WHERE organization_id = $1
           AND (role != 'system_owner' OR role IS NULL)`,
          [id]
        );
        dataCounts.users = parseInt(usersResult.rows[0]?.count || 0);
      } catch (countError) {
        console.warn('Failed to count users:', {
          error: countError.message,
          organizationId: id
        });
        // Continue with partial verification - table may not exist
      }

      try {
        const assetsResult = await db.query(
          'SELECT COUNT(*) as count FROM assets WHERE organization_id = $1',
          [id]
        );
        dataCounts.assets = parseInt(assetsResult.rows[0]?.count || 0);
      } catch (countError) {
        console.warn('Failed to count assets:', {
          error: countError.message,
          organizationId: id
        });
      }

      try {
        const tasksResult = await db.query(
          'SELECT COUNT(*) as count FROM tasks WHERE organization_id = $1 AND task_type = \'PM\'',
          [id]
        );
        dataCounts.tasks = parseInt(tasksResult.rows[0]?.count || 0);
      } catch (countError) {
        console.warn('Failed to count tasks:', {
          error: countError.message,
          organizationId: id
        });
      }

      try {
        const templatesResult = await db.query(
          'SELECT COUNT(*) as count FROM checklist_templates WHERE organization_id = $1',
          [id]
        );
        dataCounts.templates = parseInt(templatesResult.rows[0]?.count || 0);
      } catch (countError) {
        console.warn('Failed to count templates:', {
          error: countError.message,
          organizationId: id
        });
      }

      try {
        const notificationsResult = await db.query(
          'SELECT COUNT(*) as count FROM notifications WHERE organization_id = $1',
          [id]
        );
        dataCounts.notifications = parseInt(notificationsResult.rows[0]?.count || 0);
      } catch (countError) {
        console.warn('Failed to count notifications:', {
          error: countError.message,
          organizationId: id
        });
      }

      try {
        const trackerResult = await db.query(
          'SELECT COUNT(*) as count FROM tracker_status_requests WHERE organization_id = $1',
          [id]
        );
        dataCounts.tracker_status_requests = parseInt(trackerResult.rows[0]?.count || 0);
      } catch (e) {
        console.warn('Could not count tracker_status_requests (table may not exist):', e.message);
      }

      const totalRecords = Object.values(dataCounts).reduce((sum, count) => sum + count, 0);

      res.json({
        organization: {
          id: org.id,
          name: org.name,
          slug: org.slug,
          is_active: org.is_active,
          is_smart_innovations_energy: isSIE
        },
        data_counts: dataCounts,
        total_records: totalRecords,
        expected_state: isSIE 
          ? 'Should have data (all existing data belongs to Smart Innovations Energy)'
          : 'Should have zero data (new organizations start empty)',
        verification_status: isSIE
          ? (totalRecords > 0 ? '✅ PASS' : '⚠️  WARNING: No data found')
          : (totalRecords === 0 ? '✅ PASS' : '❌ FAIL: Has data when it should be empty')
      });
    } catch (error) {
      console.error('Error verifying organization data:', error);
      res.status(500).json({ error: 'Failed to verify organization data' });
    }
  });

  return router;
};
