const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { validateUploadedFile } = require('../utils/fileValidator');
const logger = require('../utils/logger');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../middleware/tenantContext');
const {
  getOrganizationSlugFromRequest,
  getStoragePath,
  getFileUrl,
  ensureCompanyDirs,
  getOrganizationSlugById
} = require('../utils/organizationStorage');

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
      
      // Get company-scoped images directory
      const uploadDir = getStoragePath(organizationSlug, 'images');
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    // Generate unique filename: timestamp-uuid-originalname
    const uniqueName = `${Date.now()}-${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only image files
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed (jpeg, jpg, png, gif, webp)'));
    }
  }
});

/**
 * Safely delete uploaded file - handles errors gracefully
 * @param {string} filePath - Path to file to delete
 * @param {object} logContext - Additional context for logging
 */
function safeUnlinkFile(filePath, logContext = {}) {
  if (!filePath) return;

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.debug('Deleted uploaded file', { filePath, ...logContext });
    }
  } catch (unlinkError) {
    logger.error('Failed to delete uploaded file', {
      filePath,
      error: unlinkError.message,
      code: unlinkError.code,
      ...logContext
    });
    // Don't throw - file deletion failure shouldn't crash request
  }
}

module.exports = (pool) => {
  const router = express.Router();

  // Upload image for failed checklist item
  router.post('/failed-item', requireAuth, upload.single('image'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
      }

      // Validate file using magic number detection (prevents MIME type spoofing)
      try {
        await validateUploadedFile(req.file);
        logger.debug('File type validation passed', { filename: req.file.originalname });
      } catch (validationError) {
        // Delete uploaded file if validation fails
        if (req.file && req.file.path) {
          try {
            fs.unlinkSync(req.file.path);
          } catch (unlinkError) {
            logger.error('Error deleting invalid file', { error: unlinkError.message });
          }
        }
        logger.warn('File upload rejected - validation failed', {
          filename: req.file.originalname,
          error: validationError.message
        });
        return res.status(400).json({ 
          error: 'Invalid file type',
          message: validationError.message
        });
      }

      const { task_id, checklist_response_id, item_id, section_id, comment } = req.body;

      if (!task_id || !item_id || !section_id) {
        // Delete uploaded file if validation fails
        safeUnlinkFile(req.file.path, { reason: 'validation_failed', taskId: task_id });
        return res.status(400).json({ error: 'task_id, item_id, and section_id are required' });
      }

      // Get organization slug from request context
      const db = getDb(req, pool);
      let organizationSlug = await getOrganizationSlugFromRequest(req, pool);
      if (!organizationSlug) {
        // Try to get from task's organization_id as fallback
        const taskResult = await db.query(
          'SELECT organization_id FROM tasks WHERE id = $1',
          [task_id]
        );
        if (taskResult.rows.length === 0 || !taskResult.rows[0].organization_id) {
          safeUnlinkFile(req.file.path, { reason: 'missing_organization', taskId: task_id });
          return res.status(400).json({ error: 'Unable to determine organization context' });
        }
        organizationSlug = await getOrganizationSlugById(pool, taskResult.rows[0].organization_id);
        if (!organizationSlug) {
          safeUnlinkFile(req.file.path, { reason: 'organization_lookup_failed', taskId: task_id });
          return res.status(400).json({ error: 'Unable to determine organization context' });
        }
      }

      // Save image record to database
      const result = await db.query(
        `INSERT INTO failed_item_images (
          task_id, checklist_response_id, item_id, section_id,
          image_path, image_filename, comment, uploaded_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          task_id,
          checklist_response_id || null,
          item_id,
          section_id,
          getFileUrl(organizationSlug, 'images', req.file.filename), // Company-scoped path
          req.file.originalname,
          comment || null,
          req.body.uploaded_by || null
        ]
      );

      res.status(201).json({
        id: result.rows[0].id,
        image_path: result.rows[0].image_path,
        image_filename: result.rows[0].image_filename,
        message: 'Image uploaded successfully'
      });
    } catch (error) {
      logger.error('Error uploading image', { error: error.message, stack: error.stack });
      // Delete uploaded file if database insert fails
      if (req.file && req.file.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (unlinkError) {
          logger.error('Error deleting uploaded file', { error: unlinkError.message });
        }
      }
      res.status(500).json({ error: 'Failed to upload image', details: error.message });
    }
  });

  // Get images for a task
  router.get('/task/:taskId', requireAuth, async (req, res) => {
    try {
      const db = getDb(req, pool);
      const result = await db.query(
        'SELECT * FROM failed_item_images WHERE task_id = $1 ORDER BY uploaded_at DESC',
        [req.params.taskId]
      );
      res.json(result.rows);
    } catch (error) {
      logger.error('Error fetching images', { error: error.message, taskId: req.params.taskId });
      res.status(500).json({ error: 'Failed to fetch images' });
    }
  });

  // Legacy route removed - images are now served via company-scoped routes: /uploads/companies/{slug}/images/{filename}
  // Use the main file serving route in server/index.js instead

  return router;
};

