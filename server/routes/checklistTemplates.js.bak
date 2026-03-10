const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { requireFeature } = require('../middleware/requireFeature');
const { getDb } = require('../middleware/tenantContext');
const {
  getOrganizationSlugFromRequest,
  getStoragePath,
  getFileUrl,
  ensureCompanyDirs
} = require('../utils/organizationStorage');

module.exports = (pool) => {
  const router = express.Router();
  router.use(requireFeature(pool, 'templates'));
  // Configure multer for file uploads (company-scoped by slug)
  const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        const organizationSlug = await getOrganizationSlugFromRequest(req, pool);
        
        if (!organizationSlug) {
          return cb(new Error('Organization context is required for file uploads'));
        }

        // Ensure company directories exist
        await ensureCompanyDirs(organizationSlug);
        
        // Get company-scoped templates directory
        const uploadDir = getStoragePath(organizationSlug, 'templates');
        cb(null, uploadDir);
      } catch (error) {
        cb(error);
      }
    },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

  const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (['.xlsx', '.xls', '.docx'].includes(ext)) {
        cb(null, true);
      } else {
        cb(new Error('Only Excel (.xlsx, .xls) and Word (.docx) files are allowed'));
      }
    }
  });

  // Get all checklist templates
  router.get('/', async (req, res) => {
    try {
      // System owners without a selected company should see no templates
      const { isSystemOwnerWithoutCompany, getOrganizationIdFromRequest } = require('../utils/organizationFilter');
      if (isSystemOwnerWithoutCompany(req)) {
        return res.json([]);
      }
      
      // Get organization ID from request context (for explicit filtering)
      const organizationId = getOrganizationIdFromRequest(req);
      if (!organizationId) {
        return res.json([]);
      }
      
      // Use getDb to ensure RLS is applied
      const db = getDb(req, pool);
      const result = await db.query('SELECT * FROM checklist_templates WHERE organization_id = $1 ORDER BY template_code', [organizationId]);
      // Parse JSONB fields for all templates
      const templates = result.rows.map(template => {
        if (template.checklist_structure && typeof template.checklist_structure === 'string') {
          template.checklist_structure = JSON.parse(template.checklist_structure);
        }
        if (template.validation_rules && typeof template.validation_rules === 'string') {
          template.validation_rules = JSON.parse(template.validation_rules);
        }
        if (template.cm_generation_rules && typeof template.cm_generation_rules === 'string') {
          template.cm_generation_rules = JSON.parse(template.cm_generation_rules);
        }
        return template;
      });
      res.json(templates);
    } catch (error) {
      console.error('Error fetching checklist templates:', error);
      res.status(500).json({ error: 'Failed to fetch checklist templates' });
    }
  });

  // Get checklist template by ID
  router.get('/:id', requireAuth, async (req, res) => {
    try {
      // System owners without a selected company should see no templates
      const { isSystemOwnerWithoutCompany } = require('../utils/organizationFilter');
      if (isSystemOwnerWithoutCompany(req)) {
        return res.status(404).json({ error: 'Template not found' });
      }
      
      // Use getDb to ensure RLS is applied
      const db = getDb(req, pool);

      const result = await db.query('SELECT * FROM checklist_templates WHERE id = $1', [req.params.id]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Checklist template not found' });
      }
      
      // Parse JSONB fields
      const template = result.rows[0];
      if (template.checklist_structure && typeof template.checklist_structure === 'string') {
        template.checklist_structure = JSON.parse(template.checklist_structure);
      }
      if (template.validation_rules && typeof template.validation_rules === 'string') {
        template.validation_rules = JSON.parse(template.validation_rules);
      }
      if (template.cm_generation_rules && typeof template.cm_generation_rules === 'string') {
        template.cm_generation_rules = JSON.parse(template.cm_generation_rules);
      }
      
      res.json(template);
    } catch (error) {
      console.error('Error fetching checklist template:', error);
      res.status(500).json({ error: 'Failed to fetch checklist template' });
    }
  });

  // Get checklist templates by asset type
  router.get('/asset-type/:assetType', requireAuth, async (req, res) => {
    try {
      // System owners without a selected company should see no templates
      const { isSystemOwnerWithoutCompany } = require('../utils/organizationFilter');
      if (isSystemOwnerWithoutCompany(req)) {
        return res.json([]);
      }
      
      // Use getDb to ensure RLS is applied
      const db = getDb(req, pool);

      const result = await db.query(
        'SELECT * FROM checklist_templates WHERE asset_type = $1 ORDER BY template_code',
        [req.params.assetType]
      );
      // Parse JSONB fields for all templates
      const templates = result.rows.map(template => {
        if (template.checklist_structure && typeof template.checklist_structure === 'string') {
          template.checklist_structure = JSON.parse(template.checklist_structure);
        }
        if (template.validation_rules && typeof template.validation_rules === 'string') {
          template.validation_rules = JSON.parse(template.validation_rules);
        }
        if (template.cm_generation_rules && typeof template.cm_generation_rules === 'string') {
          template.cm_generation_rules = JSON.parse(template.cm_generation_rules);
        }
        return template;
      });
      res.json(templates);
    } catch (error) {
      console.error('Error fetching checklist templates by asset type:', error);
      res.status(500).json({ error: 'Failed to fetch checklist templates' });
    }
  });

  // Upload and parse template file (Excel or Word)
  router.post('/upload', requireAuth, requirePermission('templates:create'), upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const { asset_type, asset_prefix } = req.body;
      if (!asset_type || !asset_prefix) {
        // Clean up uploaded file
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'asset_type and asset_prefix are required' });
      }

      const filePath = req.file.path;
      const fileName = req.file.originalname;

      try {
        // Lazy load templateParser to avoid circular dependency issues
        const { parseTemplateFile } = require('../utils/templateParser');
        const db = getDb(req, pool);
        // Parse the file
        const parsedData = await parseTemplateFile(filePath, asset_type, asset_prefix, fileName);

        // Override with user-provided values if any
        const templateData = {
          template_code: req.body.template_code || parsedData.template_code,
          template_name: req.body.template_name || parsedData.template_name,
          description: req.body.description || '',
          asset_type: asset_type,
          task_type: req.body.task_type || parsedData.task_type || 'PM',
          frequency: req.body.frequency || parsedData.frequency || 'monthly',
          checklist_structure: parsedData.checklist_structure,
          validation_rules: {},
          cm_generation_rules: {}
        };

        // Check if template code already exists
        const existing = await db.query(
          'SELECT id FROM checklist_templates WHERE template_code = $1',
          [templateData.template_code]
        );

        if (existing.rows.length > 0 && !req.body.update_existing) {
          fs.unlinkSync(filePath);
          return res.status(400).json({ 
            error: 'Template code already exists',
            existing_id: existing.rows[0].id
          });
        }

        let result;
        if (existing.rows.length > 0 && req.body.update_existing) {
          // Update existing template
          result = await db.query(
            `UPDATE checklist_templates
             SET template_name = $1, description = $2, asset_type = $3, task_type = $4,
                 frequency = $5, checklist_structure = $6::jsonb, updated_at = CURRENT_TIMESTAMP
             WHERE template_code = $7
             RETURNING *`,
            [
              templateData.template_name,
              templateData.description,
              templateData.asset_type,
              templateData.task_type,
              templateData.frequency,
              JSON.stringify(templateData.checklist_structure),
              templateData.template_code
            ]
          );
        } else {
          // Create new template
          const { getOrganizationIdFromRequest } = require('../utils/organizationFilter');
          const organizationId = getOrganizationIdFromRequest(req);
          if (!organizationId) {
            fs.unlinkSync(filePath);
            return res.status(400).json({ error: 'Organization context is required to create templates' });
          }
          result = await db.query(
            `INSERT INTO checklist_templates
             (organization_id, template_code, template_name, description, asset_type, task_type, frequency,
              checklist_structure, validation_rules, cm_generation_rules)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)
             RETURNING *`,
            [
              organizationId,
              templateData.template_code,
              templateData.template_name,
              templateData.description,
              templateData.asset_type,
              templateData.task_type,
              templateData.frequency,
              JSON.stringify(templateData.checklist_structure),
              JSON.stringify(templateData.validation_rules),
              JSON.stringify(templateData.cm_generation_rules)
            ]
          );
        }

        // Clean up uploaded file
        fs.unlinkSync(filePath);

        // Parse JSONB fields
        const template = result.rows[0];
        if (template.checklist_structure && typeof template.checklist_structure === 'string') {
          template.checklist_structure = JSON.parse(template.checklist_structure);
        }

        res.status(existing.rows.length > 0 ? 200 : 201).json(template);
      } catch (parseError) {
        // Clean up uploaded file on error
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        console.error('Error parsing template file:', parseError);
        res.status(400).json({ 
          error: 'Failed to parse template file', 
          details: parseError.message 
        });
      }
    } catch (error) {
      console.error('Error uploading template:', error);
      res.status(500).json({ error: 'Failed to upload template', details: error.message });
    }
  });

  // Create checklist template (manual creation)
  router.post('/', requireAuth, requirePermission('templates:create'), async (req, res) => {
    try {
      const db = getDb(req, pool);
      const { getOrganizationIdFromRequest } = require('../utils/organizationFilter');
      const organizationId = getOrganizationIdFromRequest(req);
      if (!organizationId) {
        return res.status(400).json({ error: 'Organization context is required to create templates' });
      }

      const {
        template_code,
        template_name,
        description,
        asset_type,
        task_type,
        frequency,
        checklist_structure,
        validation_rules,
        cm_generation_rules
      } = req.body;

      const result = await db.query(
        `INSERT INTO checklist_templates (
          organization_id, template_code, template_name, description, asset_type, task_type, frequency,
          checklist_structure, validation_rules, cm_generation_rules
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb) RETURNING *`,
        [
          organizationId,
          template_code,
          template_name,
          description,
          asset_type,
          task_type || 'PM',
          frequency,
          JSON.stringify(checklist_structure),
          JSON.stringify(validation_rules || {}),
          JSON.stringify(cm_generation_rules || {})
        ]
      );
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('Error creating checklist template:', error);
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Template code already exists' });
      }
      res.status(500).json({ error: 'Failed to create checklist template' });
    }
  });

  // Update checklist template
  router.put('/:id', requireAuth, requirePermission('templates:update'), async (req, res) => {
    try {
      const db = getDb(req, pool);
      const {
        template_code,
        template_name,
        description,
        asset_type,
        task_type,
        frequency,
        checklist_structure,
        validation_rules,
        cm_generation_rules
      } = req.body;

      // Check if template exists
      const existing = await db.query(
        'SELECT id, template_code FROM checklist_templates WHERE id = $1',
        [req.params.id]
      );

      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Checklist template not found' });
      }

      // Check if template_code is being changed and if new code already exists
      if (template_code && template_code !== existing.rows[0].template_code) {
        const codeCheck = await db.query(
          'SELECT id FROM checklist_templates WHERE template_code = $1 AND id != $2',
          [template_code, req.params.id]
        );
        if (codeCheck.rows.length > 0) {
          return res.status(400).json({ error: 'Template code already exists' });
        }
      }

      const result = await db.query(
        `UPDATE checklist_templates 
         SET template_code = COALESCE($1, template_code),
             template_name = COALESCE($2, template_name),
             description = COALESCE($3, description),
             asset_type = COALESCE($4, asset_type),
             task_type = COALESCE($5, task_type),
             frequency = COALESCE($6, frequency),
             checklist_structure = COALESCE($7::jsonb, checklist_structure),
             validation_rules = COALESCE($8::jsonb, validation_rules),
             cm_generation_rules = COALESCE($9::jsonb, cm_generation_rules),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $10
         RETURNING *`,
        [
          template_code,
          template_name,
          description,
          asset_type,
          task_type,
          frequency,
          checklist_structure ? JSON.stringify(checklist_structure) : null,
          validation_rules ? JSON.stringify(validation_rules) : null,
          cm_generation_rules ? JSON.stringify(cm_generation_rules) : null,
          req.params.id
        ]
      );

      const template = result.rows[0];
      if (template.checklist_structure && typeof template.checklist_structure === 'string') {
        template.checklist_structure = JSON.parse(template.checklist_structure);
      }
      if (template.validation_rules && typeof template.validation_rules === 'string') {
        template.validation_rules = JSON.parse(template.validation_rules);
      }
      if (template.cm_generation_rules && typeof template.cm_generation_rules === 'string') {
        template.cm_generation_rules = JSON.parse(template.cm_generation_rules);
      }

      res.json(template);
    } catch (error) {
      console.error('Error updating checklist template:', error);
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Template code already exists' });
      }
      res.status(500).json({ error: 'Failed to update checklist template', details: error.message });
    }
  });

  // Delete checklist template
  router.delete('/:id', requireAuth, requirePermission('templates:delete'), async (req, res) => {
    try {
      const db = getDb(req, pool);
      const result = await db.query(
        'DELETE FROM checklist_templates WHERE id = $1 RETURNING id, template_code',
        [req.params.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Checklist template not found' });
      }

      res.json({ 
        message: 'Template deleted successfully',
        template_code: result.rows[0].template_code
      });
    } catch (error) {
      console.error('Error deleting checklist template:', error);
      res.status(500).json({ error: 'Failed to delete checklist template', details: error.message });
    }
  });

  /**
   * Update template metadata (admin only)
   * Allows manual edits like last_revision_date without changing checklist items.
   */
  router.patch('/:id/metadata', requireAuth, requirePermission('templates:update'), async (req, res) => {
    try {
      const db = getDb(req, pool);
      const { last_revision_date, checklist_made_by, last_revision_approved_by } = req.body;
      const templateId = req.params.id;

      const result = await db.query(
        'SELECT id, checklist_structure FROM checklist_templates WHERE id = $1',
        [templateId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Checklist template not found' });
      }

      let checklistStructure = result.rows[0].checklist_structure;
      if (checklistStructure && typeof checklistStructure === 'string') {
        checklistStructure = JSON.parse(checklistStructure);
      }
      if (!checklistStructure || typeof checklistStructure !== 'object') {
        checklistStructure = {};
      }
      if (!checklistStructure.metadata || typeof checklistStructure.metadata !== 'object') {
        checklistStructure.metadata = {};
      }

      // Manual template-level metadata fields
      if (last_revision_date !== undefined) {
        checklistStructure.metadata.last_revision_date = last_revision_date || '';
      }
      if (checklist_made_by !== undefined) {
        checklistStructure.metadata.checklist_made_by = checklist_made_by || '';
      }
      if (last_revision_approved_by !== undefined) {
        checklistStructure.metadata.last_revision_approved_by = last_revision_approved_by || '';
      }

      const update = await db.query(
        `UPDATE checklist_templates
         SET checklist_structure = $1::jsonb, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING *`,
        [JSON.stringify(checklistStructure), templateId]
      );

      const updatedTemplate = update.rows[0];
      if (updatedTemplate.checklist_structure && typeof updatedTemplate.checklist_structure === 'string') {
        updatedTemplate.checklist_structure = JSON.parse(updatedTemplate.checklist_structure);
      }

      res.json(updatedTemplate);
    } catch (error) {
      console.error('Error updating checklist template metadata:', error);
      res.status(500).json({ error: 'Failed to update template metadata', details: error.message });
    }
  });

  return router;
};

