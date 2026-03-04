require('dotenv').config();

// Load logger and environment utilities FIRST (before other modules that might use console.log)
const logger = require('./utils/logger');
const { isProduction, isDevelopment } = require('./utils/env');
const { validateEnvironment } = require('./utils/envValidator');

// Validate environment variables at startup
try {
  validateEnvironment();
} catch (error) {
  logger.error('Environment validation failed:', error.message);
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const { Pool } = require('pg');
const { initRedis } = require('./utils/redis');

// Security middleware
const { securityHeaders, sanitizeRequestBody, limitRequestSize, validateUUIDParams } = require('./middleware/security');
// Rate limiting removed for frequent use - can be re-enabled if needed
// const { standardLimiter, authLimiter, sensitiveOperationLimiter, speedLimiter } = require('./middleware/rateLimiter');

const app = express();
const PORT = process.env.PORT || 3001;

// Create uploads directory FIRST
const fs = require('fs');
const path = require('path');
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  logger.info('Created uploads directory');
}
// Create companies directory for organization-scoped storage
const companiesDir = path.join(__dirname, 'uploads', 'companies');
if (!fs.existsSync(companiesDir)) {
  fs.mkdirSync(companiesDir, { recursive: true });
  logger.info('Created uploads/companies directory');
}
// Create profiles subdirectory (legacy, for backward compatibility)
const profilesDir = path.join(__dirname, 'uploads', 'profiles');
if (!fs.existsSync(profilesDir)) {
  fs.mkdirSync(profilesDir, { recursive: true });
  logger.info('Created uploads/profiles directory');
}

// ============================================================================
// CRITICAL: Image serving route MUST be FIRST, before ALL middleware
// This prevents any middleware from interfering with CORS/CORP headers
// ============================================================================

// Removed debug logging - images confirmed working in Chrome

// Serve company-scoped files: /uploads/companies/{slug}/{file_type}/{filename}
app.get('/uploads/companies/:slug/:fileType/:filename', (req, res) => {
  const { slug, fileType, filename } = req.params;
  
              // Validate file type
              const validTypes = [
                'templates', 'images', 'cm_letters', 'inventory', 
                'profiles', 'reports', 'exports', 'logs', 'documents', 'logos', 'plant'
              ];
  if (!validTypes.includes(fileType)) {
    logger.warn('[UPLOADS] Invalid file type', { fileType, ip: req.ip });
    return res.status(400).send('Invalid file type');
  }
  
  // Sanitize slug to prevent directory traversal
  const sanitizedSlug = slug.replace(/[^a-z0-9_-]/g, '').toLowerCase();
  const filePath = path.join(__dirname, 'uploads', 'companies', sanitizedSlug, fileType, filename);
  
  // Security check: prevent directory traversal
  const resolvedPath = path.resolve(filePath);
  const companyDir = path.resolve(__dirname, 'uploads', 'companies', sanitizedSlug);
  if (!resolvedPath.startsWith(companyDir)) {
    logger.warn('[UPLOADS] Directory traversal blocked', { filename, slug, ip: req.ip });
    return res.status(403).send('Forbidden');
  }
  
  // Check if file exists
  if (!fs.existsSync(filePath)) {
    logger.warn('[UPLOADS] File not found', { filePath, ip: req.ip });
    return res.status(404).send('Not found');
  }
  
  // Determine content type
  const ext = path.extname(filename).toLowerCase();
  const contentTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.pdf': 'application/pdf'
  };
  const contentType = contentTypes[ext] || 'application/octet-stream';
  
  // Read and serve file with proper headers
  fs.readFile(filePath, (err, data) => {
    if (err) {
      logger.error('[UPLOADS] Error reading file', { filePath, error: err.message });
      return res.status(500).send('Error reading file');
    }
    
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': data.length,
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Cache-Control': 'public, max-age=31536000'
    });
    res.end(data, 'binary');
  });
});

// Legacy routes removed - all files now use company-scoped structure: /uploads/companies/{slug}/{fileType}/{filename}
// If you need backward compatibility, uncomment these routes temporarily during migration

// Trust proxy for accurate IP addresses (important for rate limiting)
// Dev Tunnels acts as a reverse proxy, so we need to trust it
// This also allows req.secure to work correctly for HTTPS detection
// MUST be set BEFORE CORS and other middleware
// Only enable if explicitly set (not for localhost)
if (process.env.TRUST_PROXY === 'true' || process.env.DEV_TUNNELS === 'true') {
  app.set('trust proxy', 1);
  logger.info('Trust proxy enabled (for Dev Tunnels/port forwarding)');
}

// Explicit OPTIONS handler for CORS preflight - MUST be first
// This ensures preflight requests are handled immediately
app.options('*', (req, res) => {
  const origin = req.headers.origin;
  const corsOrigin = process.env.CORS_ORIGIN || 'true';
  let allowedOrigin = '*';
  
  if (corsOrigin === 'true' || corsOrigin === true) {
    allowedOrigin = origin || '*';
  } else if (typeof corsOrigin === 'string' && corsOrigin !== 'true') {
    const allowedOrigins = corsOrigin.split(',').map(o => o.trim());
    if (origin && allowedOrigins.includes(origin)) {
      allowedOrigin = origin;
    } else {
      allowedOrigin = allowedOrigins[0] || '*';
    }
  } else if (origin) {
    allowedOrigin = origin;
  }
  
  res.header('Access-Control-Allow-Origin', allowedOrigin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Max-Age', '86400');
  res.sendStatus(200);
});

// CORS configuration - MUST be applied BEFORE Helmet and other middleware
// In production, set CORS_ORIGIN to specific allowed origins
const corsOrigin = process.env.CORS_ORIGIN || 'true'; // Allow all in dev, specific origins in prod
let corsOriginConfig;
if (corsOrigin === 'true' || corsOrigin === true) {
  corsOriginConfig = true; // Allow all origins
} else if (typeof corsOrigin === 'string') {
  corsOriginConfig = corsOrigin.split(',').map(origin => origin.trim());
} else {
  corsOriginConfig = true; // Default to allow all
}

// Apply CORS to all routes EXCEPT /uploads (static files have their own CORS handling)
// This MUST be before Helmet to ensure CORS headers are set correctly
const corsMiddleware = cors({
  origin: corsOriginConfig,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Type'],
  maxAge: 86400, // 24 hours
  preflightContinue: false, // Let CORS handle OPTIONS requests
  optionsSuccessStatus: 200 // Some legacy browsers (IE11) choke on 204
});

app.use((req, res, next) => {
  // Skip CORS for static files - they have their own middleware
  if (req.path.startsWith('/uploads')) {
    return next();
  }
  // Apply CORS to all other routes
  corsMiddleware(req, res, next);
});

// Security headers (Helmet.js) - After CORS, before API routes
// Exclude /uploads from Helmet to prevent interference with image serving
app.use((req, res, next) => {
  if (req.path.startsWith('/uploads')) {
    return next(); // Skip Helmet for static files
  }
  securityHeaders(req, res, next);
});

// Request size limits (prevent DoS via large payloads)
// Default: 10MB for JSON, 50MB for file uploads
const jsonLimit = process.env.API_JSON_LIMIT || '10mb';
app.use(bodyParser.json({ limit: jsonLimit }));
app.use(bodyParser.urlencoded({ extended: true, limit: jsonLimit }));
app.use(limitRequestSize(jsonLimit));

// Sanitize request body (remove dangerous characters)
app.use(sanitizeRequestBody);

// Validate UUID parameters (secondary SQL injection defense)
// Only apply to routes that actually have UUID parameters
// NOTE: Do NOT apply to /api/upload/:filename (uses filenames, not UUIDs)
// NOTE: Do NOT apply to /api/inventory/:id (inventory routes don't use UUID paths, except slips)
// Apply to specific patterns that use UUIDs:
app.use('/api/users/:id', validateUUIDParams);
app.use('/api/tasks/:id', (req, res, next) => {
  // Skip validation for bulk-delete route
  if (req.params.id === 'bulk-delete') {
    return next();
  }
  validateUUIDParams(req, res, next);
});
app.use('/api/assets/:id', validateUUIDParams);
app.use('/api/checklist-templates/:id', validateUUIDParams);
app.use('/api/checklist-responses/:id', (req, res, next) => {
  // Skip validation for draft routes
  if (req.params.id === 'draft') {
    return next();
  }
  validateUUIDParams(req, res, next);
});
// Apply UUID validation to CM letters routes, but exclude fault-log route
app.use('/api/cm-letters/:id', (req, res, next) => {
  // Skip validation for fault-log routes
  if (req.params.id && req.params.id.includes('fault-log')) {
    return next();
  }
  validateUUIDParams(req, res, next);
});
app.use('/api/api-tokens/:id', validateUUIDParams);
app.use('/api/webhooks/:id', validateUUIDParams);
app.use('/api/inventory/slips/:id', validateUUIDParams); // Only slips use UUIDs
// Also apply to nested routes like /api/tasks/:id/start
app.use('/api/tasks/:id/:action', validateUUIDParams);
app.use('/api/cm-letters/:id/:action', (req, res, next) => {
  // Skip validation for fault-log routes
  if (req.params.id && req.params.id.includes('fault-log')) {
    return next();
  }
  validateUUIDParams(req, res, next);
});
app.use('/api/api-tokens/:id/:action', validateUUIDParams);
app.use('/api/webhooks/:id/:action', validateUUIDParams);
app.use('/api/users/:id/:action', validateUUIDParams);

// Session configuration with secure defaults
// SESSION_SECRET validation is now handled by envValidator.js
// It will generate a random secret for development or fail in production
const sessionSecret = process.env.SESSION_SECRET || 'CHANGE-THIS-SECRET-IN-PRODUCTION-USE-RANDOM-STRING';

// Determine cookie settings based on environment
// For localhost (HTTP), we need secure: false and sameSite: 'lax'
// For Dev Tunnels/port forwarding (HTTPS), we need secure: true and sameSite: 'none'
const isDevTunnels = process.env.DEV_TUNNELS === 'true' || 
                     process.env.PORT_FORWARDING === 'true' ||
                     process.env.ALLOW_CROSS_ORIGIN_COOKIES === 'true';

// For localhost, we're using HTTP, so secure must be false
// Only use secure: true if explicitly using HTTPS or in production with HTTPS
const isHTTPS = process.env.HTTPS_ENABLED === 'true' || 
                (process.env.NODE_ENV === 'production' && !process.env.ALLOW_HTTP);

// For localhost (HTTP): secure=false, sameSite='lax'
// For HTTPS/Dev Tunnels: secure=true, sameSite='none'
const cookieSecure = isHTTPS && (isDevTunnels || process.env.NODE_ENV === 'production');
const cookieSameSite = isDevTunnels && cookieSecure ? 'none' : 'lax';

// Request logging middleware - Log all API requests
app.use((req, res, next) => {
  const method = req.method;
  const path = req.path;
  const query = Object.keys(req.query).length > 0 ? `?${new URLSearchParams(req.query).toString()}` : '';
  const user = req.session?.username || req.session?.userId || 'anonymous';
  const role = req.session?.role || 'none';
  
  // Log request
  const logData = {
    method,
    path: path + query,
    user,
    role,
    ip: req.ip || req.connection.remoteAddress
  };
  
  logger.debug(`${method} ${path}${query}`, logData);
  
  // Log request body for POST/PUT/PATCH (debug only, skip multipart)
  const contentType = req.headers['content-type'] || '';
  if (!isProduction() && ['POST', 'PUT', 'PATCH'].includes(method) && 
      !contentType.includes('multipart/form-data') && req.body && Object.keys(req.body).length > 0) {
    const bodyStr = JSON.stringify(req.body);
    if (bodyStr.length < 500) {
      logger.debug('Request body', { body: req.body });
    }
  }
  
  // Log response when it finishes
  const originalSend = res.send;
  res.send = function(data) {
    const statusLevel = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'debug';
    logger[statusLevel](`${method} ${path}${query} - Response: ${res.statusCode}`, logData);
    originalSend.apply(res, arguments);
  };
  
  next();
});

// Attach database pool to request object for use in middleware
app.use((req, res, next) => {
  req.db = pool;
  next();
});

app.use(session({
  secret: sessionSecret || 'CHANGE-THIS-SECRET-IN-PRODUCTION-USE-RANDOM-STRING',
  resave: false, // Don't save session if unmodified
  saveUninitialized: false, // Don't create session until something is stored
  name: 'sessionId', // Don't use default 'connect.sid' for security
  cookie: {
    secure: cookieSecure, // false for localhost (HTTP), true for HTTPS
    httpOnly: true, // Prevent XSS attacks
    sameSite: cookieSameSite, // 'none' for cross-origin (Dev Tunnels), 'lax' for same-origin (localhost)
    maxAge: isDevelopment() 
      ? parseInt(process.env.SESSION_MAX_AGE_MS || '604800000', 10) // 7 days in development
      : parseInt(process.env.SESSION_MAX_AGE_MS || '86400000', 10), // 24 hours in production
    domain: undefined // Don't set domain to allow cross-subdomain cookies
  },
  // Use secure session store in production (Redis recommended)
  // For now using memory store (not suitable for production with multiple servers)
  // Important: session is saved automatically when response is sent if session was modified
}));

logger.info(`Session cookie configuration: secure=${cookieSecure}, sameSite=${cookieSameSite}, isHTTPS=${isHTTPS}, isDevTunnels=${isDevTunnels}`);

// Uploads directory and static file serving moved to the top (before security headers)
// fs and path are already declared at the top of the file

// Serve uploaded images - MUST be AFTER CORS but BEFORE rate limiting and routes
// Static files should be accessible without authentication or rate limiting
// This allows images to be served directly via /uploads/filename
// Use a custom middleware to ensure CORS headers are set correctly
app.use('/uploads', (req, res, next) => {
  // Set CORS headers before serving the file
  // For static files (images), we allow all origins since they're public resources
  // Images loaded via <img> tags may not send Origin headers, so we use *
  const origin = req.headers.origin;
  
  // Always allow all origins for static files (no credentials needed)
  // This works for both XHR/fetch requests (with Origin) and <img> tags (without Origin)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
  
  // Handle OPTIONS preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
}, express.static(path.join(__dirname, 'uploads')));

// Rate limiting - Production-ready limits
// Automatically disabled in development mode
const { standardLimiter, authLimiter, sensitiveOperationLimiter } = require('./middleware/rateLimiter');

if (process.env.DISABLE_RATE_LIMITING !== 'true' && isProduction()) {
  // Apply standard rate limiting to all API routes (only in production)
  app.use('/api', standardLimiter);
  logger.info('Rate limiting enabled', {
    standardLimit: process.env.RATE_LIMIT_MAX || '100 requests per 15 minutes',
    authLimit: process.env.AUTH_RATE_LIMIT_MAX || '5 requests per 15 minutes'
  });
} else {
  logger.info('Rate limiting is DISABLED (development mode or DISABLE_RATE_LIMITING=true)');
}

// Database connection with connection pooling
const { getEnvInt } = require('./utils/env');
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'solar_om_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: getEnvInt('DB_MAX_CONNECTIONS', 20), // Maximum number of clients in the pool
  min: getEnvInt('DB_MIN_CONNECTIONS', 2), // Minimum number of clients in the pool
  idleTimeoutMillis: getEnvInt('DB_IDLE_TIMEOUT', 30000), // Close idle clients after 30 seconds
  connectionTimeoutMillis: getEnvInt('DB_CONNECTION_TIMEOUT', 2000), // Return an error after 2 seconds if connection could not be established
});

// Optional API token auth (Bearer tok_...)
const apiTokenAuth = require('./middleware/apiTokenAuth');
app.use(apiTokenAuth(pool));

// Test database connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    logger.error('Database connection error', { error: err.message });
  } else {
    logger.info('Database connected successfully', { 
      host: process.env.DB_HOST, 
      database: process.env.DB_NAME,
      maxConnections: pool.totalCount 
    });
  }
});

// Log pool errors
pool.on('error', (err) => {
  logger.error('Unexpected database pool error', { error: err.message, stack: err.stack });
});

// Test CORS endpoint (for debugging)
app.get('/api/test-cors', (req, res) => {
  res.json({ 
    message: 'CORS is working!',
    origin: req.headers.origin,
    timestamp: new Date().toISOString()
  });
});

// Routes
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const assetsRoutes = require('./routes/assets');
const checklistTemplatesRoutes = require('./routes/checklistTemplates');
const tasksRoutes = require('./routes/tasks');
const checklistResponsesRoutes = require('./routes/checklistResponses');
const cmLettersRoutes = require('./routes/cmLetters');
const uploadRoutes = require('./routes/upload');
const apiTokensRoutes = require('./routes/apiTokens');
const webhooksRoutes = require('./routes/webhooks');
const inventoryRoutes = require('./routes/inventory');
const earlyCompletionRequestsRoutes = require('./routes/earlyCompletionRequests');
const notificationsRoutes = require('./routes/notifications');
const platformRoutes = require('./routes/platform');
const calendarRoutes = require('./routes/calendar');
// License routes removed - no longer needed
const syncRoutes = require('./routes/sync');
const overtimeRequestsRoutes = require('./routes/overtimeRequests');
const plantRoutes = require('./routes/plant');
const feedbackRoutes = require('./routes/feedback');
const organizationsRoutes = require('./routes/organizations');
const scadaRoutes = require('./routes/scada');
const auditLogRoutes = require('./routes/auditLog');

// Swagger (OpenAPI) docs
const swaggerUi = require('swagger-ui-express');
const swaggerJSDoc = require('swagger-jsdoc');
const openapiSpec = swaggerJSDoc({
  definition: {
    openapi: '3.0.0',
    info: { title: 'SPHAiRDigital API', version: '1.0.0' },
    servers: [{ url: '/api' }, { url: '/api/v1' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'connect.sid' }
      }
    }
  },
  apis: [] // minimal spec for now (we can expand with annotations later)
});
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));

// Authentication routes (no auth required)
// Apply strict rate limiting to auth endpoints (only in production)
if (process.env.DISABLE_RATE_LIMITING !== 'true' && isProduction()) {
  const { authLimiter, loginSlowDown, accountLockoutMiddleware } = require('./middleware/rateLimiter');
  // Apply progressive delays first (slows down repeated attempts)
  app.use('/api/auth/login', loginSlowDown);
  // Then apply account-based lockout check
  app.use('/api/auth/login', accountLockoutMiddleware);
  // Finally apply IP-based rate limiting
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/change-password', sensitiveOperationLimiter);
}
app.use('/api/auth', authRoutes(pool));

// Tenant context middleware (sets organization_id for RLS)
const { setTenantContext } = require('./middleware/tenantContext');
const tenantContextMiddleware = setTenantContext(pool);

// License validation middleware removed - no longer needed
// const { requireValidLicense } = require('./middleware/license');
// const licenseCheck = requireValidLicense(pool);

// Protected routes (require valid license and tenant context)
app.use('/api/users', tenantContextMiddleware, usersRoutes(pool));
app.use('/api/assets', tenantContextMiddleware, assetsRoutes(pool));
app.use('/api/checklist-templates', tenantContextMiddleware, checklistTemplatesRoutes(pool));
app.use('/api/tasks', tenantContextMiddleware, tasksRoutes(pool));
app.use('/api/checklist-responses', tenantContextMiddleware, checklistResponsesRoutes(pool));
app.use('/api/cm-letters', tenantContextMiddleware, cmLettersRoutes(pool));
app.use('/api/upload', tenantContextMiddleware, uploadRoutes(pool));
app.use('/api/api-tokens', tenantContextMiddleware, apiTokensRoutes(pool));
app.use('/api/webhooks', tenantContextMiddleware, webhooksRoutes(pool));
app.use('/api/inventory', tenantContextMiddleware, inventoryRoutes(pool));
app.use('/api/early-completion-requests', tenantContextMiddleware, earlyCompletionRequestsRoutes(pool));
app.use('/api/notifications', tenantContextMiddleware, notificationsRoutes(pool));
app.use('/api/platform', tenantContextMiddleware, platformRoutes(pool));
app.use('/api/calendar', tenantContextMiddleware, calendarRoutes(pool));
// License route removed - no longer needed
// app.use('/api/license', licenseRoutes(pool));
app.use('/api', syncRoutes(pool));
app.use('/api/overtime-requests', tenantContextMiddleware, overtimeRequestsRoutes(pool));
app.use('/api/plant', tenantContextMiddleware, plantRoutes(pool));
app.use('/api/feedback', tenantContextMiddleware, feedbackRoutes(pool));
app.use('/api/organizations', tenantContextMiddleware, organizationsRoutes(pool));
app.use('/api/scada', tenantContextMiddleware, scadaRoutes(pool));
app.use('/api/audit-log', tenantContextMiddleware, auditLogRoutes(pool));

// Versioned API (v1) - mirrors /api for integration stability
app.use('/api/v1/auth', authRoutes(pool));
app.use('/api/v1/users', tenantContextMiddleware, usersRoutes(pool));
app.use('/api/v1/assets', tenantContextMiddleware, assetsRoutes(pool));
app.use('/api/v1/checklist-templates', tenantContextMiddleware, checklistTemplatesRoutes(pool));
app.use('/api/v1/tasks', tenantContextMiddleware, tasksRoutes(pool));
app.use('/api/v1/checklist-responses', tenantContextMiddleware, checklistResponsesRoutes(pool));
app.use('/api/v1/cm-letters', tenantContextMiddleware, cmLettersRoutes(pool));
app.use('/api/v1/upload', tenantContextMiddleware, uploadRoutes(pool));
app.use('/api/v1/api-tokens', tenantContextMiddleware, apiTokensRoutes(pool));
app.use('/api/v1/webhooks', tenantContextMiddleware, webhooksRoutes(pool));
app.use('/api/v1/inventory', tenantContextMiddleware, inventoryRoutes(pool));
// License route removed - no longer needed
// app.use('/api/v1/license', licenseRoutes(pool));

// Create reports directory if it doesn't exist - ALL REPORTS SAVED HERE
const reportsDir = path.join(__dirname, 'reports');
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
  logger.info('Created reports directory', { path: reportsDir, resolvedPath: path.resolve(reportsDir) });
} else {
  logger.debug('Reports directory exists', { path: path.resolve(reportsDir) });
}

// Create templates directory structure if it doesn't exist
const templatesDir = path.join(__dirname, 'templates');
const wordTemplatesDir = path.join(templatesDir, 'word');
const excelTemplatesDir = path.join(templatesDir, 'excel');

[wordTemplatesDir, excelTemplatesDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logger.info('Created templates directory', { path: dir });
  }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  const health = {
    status: 'ok',
    message: 'SPHAiRDigital API is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    database: 'unknown',
    redis: 'unknown',
    memory: {
      used: Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100,
      total: Math.round((process.memoryUsage().heapTotal / 1024 / 1024) * 100) / 100,
      unit: 'MB'
    }
  };

  // Check database connectivity
  try {
    await pool.query('SELECT NOW()');
    health.database = 'connected';
  } catch (error) {
    health.database = 'disconnected';
    health.status = 'degraded';
    health.message = 'Database connection failed';
  }

  // Check Redis connectivity
  try {
    const { isRedisAvailable } = require('./utils/redis');
    health.redis = isRedisAvailable() ? 'connected' : 'disabled';
  } catch (error) {
    health.redis = 'error';
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// Detailed health check endpoint (for monitoring)
app.get('/api/health/detailed', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    uptimeFormatted: formatUptime(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '1.0.0',
    nodeVersion: process.version,
    database: {
      status: 'unknown',
      host: process.env.DB_HOST || 'localhost',
      name: process.env.DB_NAME || 'solar_om_db',
      pool: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount
      }
    },
    redis: {
      status: 'unknown',
      enabled: process.env.REDIS_ENABLED === 'true'
    },
    memory: {
      heapUsed: Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100,
      heapTotal: Math.round((process.memoryUsage().heapTotal / 1024 / 1024) * 100) / 100,
      external: Math.round((process.memoryUsage().external / 1024 / 1024) * 100) / 100,
      rss: Math.round((process.memoryUsage().rss / 1024 / 1024) * 100) / 100,
      unit: 'MB'
    },
    cpu: {
      usage: process.cpuUsage(),
      uptime: process.uptime()
    }
  };

  // Check database connectivity
  try {
    const startTime = Date.now();
    await pool.query('SELECT NOW(), version()');
    const responseTime = Date.now() - startTime;
    health.database.status = 'connected';
    health.database.responseTime = `${responseTime}ms`;
  } catch (error) {
    health.database.status = 'disconnected';
    health.database.error = error.message;
    health.status = 'degraded';
  }

  // Check Redis connectivity
  try {
    const { isRedisAvailable } = require('./utils/redis');
    health.redis.status = isRedisAvailable() ? 'connected' : 'disabled';
  } catch (error) {
    health.redis.status = 'error';
    health.redis.error = error.message;
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// Helper function to format uptime
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  
  return parts.join(' ');
}

// Test auth endpoint
app.get('/api/auth/test', (req, res) => {
  res.json({ 
    message: 'Auth endpoint is accessible',
    timestamp: new Date().toISOString()
  });
});

// Schedule reminder notifications (check daily at midnight)
// This runs a check for tasks scheduled 3 days from now
const { scheduleReminders } = require('./utils/notifications');
setInterval(async () => {
  try {
    await scheduleReminders(pool);
  } catch (error) {
    logger.error('Error scheduling reminders', { error: error.message, stack: error.stack });
  }
}, 24 * 60 * 60 * 1000); // Run every 24 hours

// Also run on server start (after a short delay to ensure DB is ready)
setTimeout(async () => {
  try {
    await scheduleReminders(pool);
  } catch (error) {
    logger.error('Error running initial reminder check', { error: error.message, stack: error.stack });
  }
}, 5000); // Run 5 seconds after server start

// Initialize Redis and start server
// In production, Redis is required and initRedis will exit if it fails
initRedis().then(() => {
  const { isRedisAvailable } = require('./utils/redis');
  const redisStatus = isRedisAvailable() ? 'enabled' : 'disabled';
  
  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Server started successfully`, { 
      port: PORT, 
      environment: process.env.NODE_ENV || 'development',
      redis: redisStatus
    });
    logger.info(`Server running on port ${PORT}`);
    logger.info('Reminder notification scheduler started');
    
    if (isProduction() && !isRedisAvailable()) {
      logger.error('CRITICAL: Redis is required in production but is not available.');
      logger.error('Server started but will exit. Please configure Redis before deploying to production.');
      process.exit(1);
    }
  });
}).catch((error) => {
  if (isProduction()) {
    logger.error('CRITICAL: Failed to initialize Redis in production', { error: error.message });
    logger.error('Redis is required in production. Server will not start.');
    process.exit(1);
  }
  
  logger.warn('Failed to initialize Redis', { error: error.message });
  logger.warn('Server will use memory store for sessions (development only - NOT for production)');
  // Start server anyway in development (will use memory store for sessions)
  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Server started successfully`, { 
      port: PORT, 
      environment: process.env.NODE_ENV || 'development',
      redis: 'disabled'
    });
    logger.warn(`Server running on port ${PORT} (without Redis - development only)`);
    logger.info('Reminder notification scheduler started');
  });
});

// Global error handler (must be last middleware)
const { globalErrorHandler, notFoundHandler } = require('./utils/errors');

// Handle 404 errors (route not found)
app.use(notFoundHandler);

// Global error handler (catch all errors)
app.use(globalErrorHandler);

module.exports = app;

