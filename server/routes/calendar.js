const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const { requireFeature } = require('../middleware/requireFeature');
const { requireSystemOwner } = require('../middleware/tenantContext');
const { parseYearCalendarExcel } = require('../utils/parseYearCalendarExcel');
const {
  getOrganizationIdFromRequest,
  isSystemOwnerWithoutCompany
} = require('../utils/organizationFilter');
const {
  getOrganizationSlugFromRequest,
  ensureCompanyDirs,
  getStoragePath
} = require('../utils/organizationStorage');
const { getOrganizationSetting, setOrganizationSetting } = require('../utils/organizationConfig');
const fs = require('fs');
const path = require('path');

const YEAR_CALENDAR_TEMPLATE_FILENAME = 'year-calendar-template.xlsx';

const CANONICAL_FREQUENCY_KEYS = [
  'weekly', 'monthly', 'quarterly', 'bi-monthly', 'bi-annually', 'annually', 'public holiday'
];

const DEFAULT_CALENDAR_LEGEND = {
  'weekly':         { color: '#ffff00', label: 'Weekly' },
  'monthly':        { color: '#92d050', label: 'Monthly' },
  'quarterly':      { color: '#00b0f0', label: 'Quarterly' },
  'bi-monthly':     { color: '#F9B380', label: 'Bi-Monthly' },
  'bi-annually':    { color: '#BFBFBF', label: 'Bi-Annual' },
  'annually':       { color: '#CC5C0B', label: 'Annual' },
  'public holiday': { color: '#808080', label: 'Holiday' }
};

const uploadStorage = multer.memoryStorage();
const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 10 * 1024 * 1024 }
});

module.exports = (pool) => {
  const router = express.Router();
  router.use(requireFeature(pool, 'calendar'));

  // Get all calendar events for a date range
  router.get('/', requireAuth, async (req, res) => {
    try {
      // System owners without a selected company should see no calendar events
      const { isSystemOwnerWithoutCompany } = require('../utils/organizationFilter');
      if (isSystemOwnerWithoutCompany(req)) {
        return res.json([]);
      }
      
      // Get organization ID from request context (for explicit filtering)
      const { getOrganizationIdFromRequest } = require('../utils/organizationFilter');
      const organizationId = getOrganizationIdFromRequest(req);
      
      if (!organizationId) {
        return res.json([]);
      }
      
      const { start_date, end_date, year } = req.query;
      
      // Use getDb to ensure RLS is applied
      const { getDb } = require('../middleware/tenantContext');
      const db = getDb(req, pool);
      
      let query = 'SELECT * FROM calendar_events WHERE organization_id = $1';
      const params = [organizationId];
      let paramCount = 2;
      
      if (year) {
        query += ` AND EXTRACT(YEAR FROM event_date) = $${paramCount++}`;
        params.push(year);
      } else if (start_date && end_date) {
        query += ` AND event_date >= $${paramCount++} AND event_date <= $${paramCount++}`;
        params.push(start_date, end_date);
      } else if (start_date) {
        query += ` AND event_date >= $${paramCount++}`;
        params.push(start_date);
      }
      
      query += ' ORDER BY event_date, task_title';
      
      const result = await db.query(query, params);
      
      // Format dates properly (avoid UTC conversion that shifts days)
      const formatDate = (date) => {
        if (!date) return null;
        // Use local date parts to avoid timezone shift
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };
      
      const events = result.rows.map(event => ({
        ...event,
        event_date: formatDate(event.event_date)
      }));
      
      res.json(events);
    } catch (error) {
      console.error('Error fetching calendar events:', error);
      res.status(500).json({ error: 'Failed to fetch calendar events' });
    }
  });

  // Get calendar events for a specific date
  router.get('/date/:date', requireAuth, async (req, res) => {
    try {
      // System owners without a selected company should see no calendar events
      const { isSystemOwnerWithoutCompany, getOrganizationIdFromRequest } = require('../utils/organizationFilter');
      if (isSystemOwnerWithoutCompany(req)) {
        return res.json([]);
      }
      
      // Get organization ID from request context (for explicit filtering)
      const organizationId = getOrganizationIdFromRequest(req);
      if (!organizationId) {
        return res.json([]);
      }
      
      const { date } = req.params;
      
      // Use getDb to ensure RLS is applied
      const { getDb } = require('../middleware/tenantContext');
      const db = getDb(req, pool);
      
      // Explicitly filter by organization_id (backup to RLS)
      const result = await db.query(
        'SELECT * FROM calendar_events WHERE organization_id = $1 AND event_date = $2 ORDER BY task_title',
        [organizationId, date]
      );
      
      // Format dates properly (avoid UTC conversion that shifts days)
      const formatDate = (date) => {
        if (!date) return null;
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };
      
      const events = result.rows.map(event => ({
        ...event,
        event_date: formatDate(event.event_date)
      }));
      
      res.json(events);
    } catch (error) {
      console.error('Error fetching calendar events for date:', error);
      res.status(500).json({ error: 'Failed to fetch calendar events' });
    }
  });

  // Create a new calendar event
  router.post('/', requireAuth, async (req, res) => {
    try {
      // System owners without a selected company cannot create calendar events
      const { isSystemOwnerWithoutCompany } = require('../utils/organizationFilter');
      if (isSystemOwnerWithoutCompany(req)) {
        return res.status(403).json({ error: 'Please select a company to create calendar events' });
      }
      
      const {
        event_date,
        task_title,
        procedure_code,
        description,
        task_id,
        checklist_template_id,
        asset_id,
        frequency
      } = req.body;

      if (!event_date || !task_title) {
        return res.status(400).json({ error: 'event_date and task_title are required' });
      }

      // Use getDb to ensure RLS is applied
      const { getDb } = require('../middleware/tenantContext');
      const db = getDb(req, pool);
      
      // Get organization_id from tenant context
      const { getOrganizationIdFromRequest } = require('../utils/organizationFilter');
      const organizationId = getOrganizationIdFromRequest(req);

      const result = await db.query(
        `INSERT INTO calendar_events
         (event_date, task_title, procedure_code, description, task_id, checklist_template_id, asset_id, frequency, created_by, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          event_date,
          task_title,
          procedure_code || null,
          description || null,
          task_id || null,
          checklist_template_id || null,
          asset_id || null,
          frequency || null,
          req.session.userId,
          organizationId
        ]
      );

      const event = result.rows[0];
      // Format date without UTC conversion
      const d = event.event_date;
      event.event_date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

      res.status(201).json(event);
    } catch (error) {
      console.error('Error creating calendar event:', error);
      res.status(500).json({ error: 'Failed to create calendar event' });
    }
  });

  // Update a calendar event
  router.put('/:id', requireAuth, async (req, res) => {
    try {
      // System owners without a selected company cannot update calendar events
      const { isSystemOwnerWithoutCompany } = require('../utils/organizationFilter');
      if (isSystemOwnerWithoutCompany(req)) {
        return res.status(403).json({ error: 'Please select a company to update calendar events' });
      }
      
      const { id } = req.params;
      const {
        event_date,
        task_title,
        procedure_code,
        description,
        task_id,
        checklist_template_id,
        asset_id,
        frequency
      } = req.body;

      // Use getDb to ensure RLS is applied
      const { getDb } = require('../middleware/tenantContext');
      const db = getDb(req, pool);
      
      const result = await db.query(
        `UPDATE calendar_events 
         SET event_date = $1,
             task_title = $2,
             procedure_code = $3,
             description = $4,
             task_id = $5,
             checklist_template_id = $6,
             asset_id = $7,
             frequency = $8,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $9
         RETURNING *`,
        [
          event_date,
          task_title,
          procedure_code || null,
          description || null,
          task_id || null,
          checklist_template_id || null,
          asset_id || null,
          frequency || null,
          id
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Calendar event not found' });
      }

      const event = result.rows[0];
      // Format date without UTC conversion
      const d = event.event_date;
      event.event_date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

      res.json(event);
    } catch (error) {
      console.error('Error updating calendar event:', error);
      res.status(500).json({ error: 'Failed to update calendar event' });
    }
  });

  // Delete a calendar event
  router.delete('/:id', requireAuth, async (req, res) => {
    try {
      // System owners without a selected company cannot delete calendar events
      const { isSystemOwnerWithoutCompany } = require('../utils/organizationFilter');
      if (isSystemOwnerWithoutCompany(req)) {
        return res.status(403).json({ error: 'Please select a company to delete calendar events' });
      }
      
      const { id } = req.params;
      
      // Use getDb to ensure RLS is applied
      const { getDb } = require('../middleware/tenantContext');
      const db = getDb(req, pool);
      
      const result = await db.query(
        'DELETE FROM calendar_events WHERE id = $1 RETURNING *',
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Calendar event not found' });
      }

      res.json({ message: 'Calendar event deleted successfully' });
    } catch (error) {
      console.error('Error deleting calendar event:', error);
      res.status(500).json({ error: 'Failed to delete calendar event' });
    }
  });

  // Upload Year Calendar Excel (system owner only) – import events and save template for download
  router.post('/upload', requireAuth, requireSystemOwner, upload.single('file'), async (req, res) => {
    try {
      if (isSystemOwnerWithoutCompany(req)) {
        return res.status(403).json({ error: 'Please select a company to upload the year calendar' });
      }
      const organizationId = getOrganizationIdFromRequest(req);
      if (!organizationId) {
        return res.status(403).json({ error: 'Company context required' });
      }
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({ error: 'No file uploaded. Please select an Excel (.xlsx) file.' });
      }
      const isExcel = req.file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        (req.file.originalname && req.file.originalname.toLowerCase().endsWith('.xlsx'));
      if (!isExcel) {
        return res.status(400).json({ error: 'Only Excel (.xlsx) files are allowed.' });
      }

      const events = await parseYearCalendarExcel(req.file.buffer);
      const { getDb } = require('../middleware/tenantContext');
      const db = getDb(req, pool);

      let imported = 0;
      for (const ev of events) {
        try {
          await db.query(
            `INSERT INTO calendar_events 
             (organization_id, event_date, task_title, procedure_code, frequency, created_by)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              organizationId,
              ev.date,
              ev.task_title,
              ev.procedure_code || null,
              ev.frequency || null,
              req.session.userId
            ]
          );
          imported++;
        } catch (e) {
          if (e.code !== '23505') throw e;
        }
      }
      // Save uploaded file as year calendar template for this company
      const slug = await getOrganizationSlugFromRequest(req, pool);
      if (slug) {
        await ensureCompanyDirs(slug);
        const templatePath = getStoragePath(slug, 'calendar', YEAR_CALENDAR_TEMPLATE_FILENAME);
        fs.writeFileSync(templatePath, req.file.buffer);
      }

      res.status(200).json({
        message: 'Year calendar uploaded successfully',
        imported,
        total: events.length,
        templateSaved: !!slug
      });
    } catch (error) {
      console.error('Error uploading year calendar:', error);
      res.status(500).json({
        error: 'Failed to upload year calendar',
        details: error.message
      });
    }
  });

  // Get saved year calendar template file (for download) – available when template was uploaded
  router.get('/year-template', requireAuth, async (req, res) => {
    try {
      if (isSystemOwnerWithoutCompany(req)) {
        return res.status(404).json({ error: 'No company selected' });
      }
      const organizationId = getOrganizationIdFromRequest(req);
      if (!organizationId) return res.status(404).json({ error: 'Company context required' });

      const slug = await getOrganizationSlugFromRequest(req, pool);
      if (!slug) return res.status(404).json({ error: 'Organization not found' });

      const templatePath = getStoragePath(slug, 'calendar', YEAR_CALENDAR_TEMPLATE_FILENAME);
      if (!fs.existsSync(templatePath)) {
        return res.status(404).json({ error: 'No year calendar template has been uploaded for this company yet.' });
      }

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${YEAR_CALENDAR_TEMPLATE_FILENAME}"`);
      res.sendFile(path.resolve(templatePath));
    } catch (error) {
      console.error('Error serving year calendar template:', error);
      res.status(500).json({ error: 'Failed to get year calendar template', details: error.message });
    }
  });

  // Get calendar legend config for the current organization (or defaults)
  router.get('/legend', requireAuth, async (req, res) => {
    try {
      if (isSystemOwnerWithoutCompany(req)) {
        return res.json({ legend: DEFAULT_CALENDAR_LEGEND });
      }

      const organizationId = getOrganizationIdFromRequest(req);
      if (!organizationId) {
        return res.json({ legend: DEFAULT_CALENDAR_LEGEND });
      }

      const { getDb } = require('../middleware/tenantContext');
      const db = getDb(req, pool);
      const stored = await getOrganizationSetting(db, organizationId, 'calendar_legend', null);

      if (!stored || typeof stored !== 'object') {
        return res.json({ legend: DEFAULT_CALENDAR_LEGEND });
      }

      const merged = {};
      for (const key of CANONICAL_FREQUENCY_KEYS) {
        if (stored[key] && stored[key].color && stored[key].label) {
          merged[key] = { color: stored[key].color, label: stored[key].label };
        } else {
          merged[key] = DEFAULT_CALENDAR_LEGEND[key];
        }
      }

      res.json({ legend: merged });
    } catch (error) {
      console.error('Error fetching calendar legend:', error);
      res.json({ legend: DEFAULT_CALENDAR_LEGEND });
    }
  });

  // Update calendar legend config (system owner only, requires tenant context)
  router.put('/legend', requireAuth, requireSystemOwner, async (req, res) => {
    try {
      if (isSystemOwnerWithoutCompany(req)) {
        return res.status(403).json({ error: 'Please select a company to customize the legend' });
      }

      const organizationId = getOrganizationIdFromRequest(req);
      if (!organizationId) {
        return res.status(403).json({ error: 'Company context required' });
      }

      const { legend } = req.body;
      if (!legend || typeof legend !== 'object') {
        return res.status(400).json({ error: 'legend object is required' });
      }

      const hexRegex = /^#[0-9a-fA-F]{6}$/;
      for (const key of CANONICAL_FREQUENCY_KEYS) {
        if (!legend[key] || !legend[key].color || !legend[key].label) {
          return res.status(400).json({ error: `Missing color or label for frequency: ${key}` });
        }
        if (!hexRegex.test(legend[key].color)) {
          return res.status(400).json({ error: `Invalid hex color for frequency: ${key}` });
        }
        if (typeof legend[key].label !== 'string' || legend[key].label.trim().length === 0) {
          return res.status(400).json({ error: `Label must be a non-empty string for frequency: ${key}` });
        }
        if (legend[key].label.length > 30) {
          return res.status(400).json({ error: `Label too long for frequency: ${key} (max 30 chars)` });
        }
      }

      const cleaned = {};
      for (const key of CANONICAL_FREQUENCY_KEYS) {
        cleaned[key] = { color: legend[key].color, label: legend[key].label.trim() };
      }

      const { getDb } = require('../middleware/tenantContext');
      const db = getDb(req, pool);
      await setOrganizationSetting(db, organizationId, 'calendar_legend', cleaned, 'Calendar frequency legend colors and labels');

      res.json({ legend: cleaned });
    } catch (error) {
      console.error('Error updating calendar legend:', error);
      res.status(500).json({ error: 'Failed to update calendar legend' });
    }
  });

  return router;
};
