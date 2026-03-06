/**
 * Environment Variable Validator
 * 
 * Validates required environment variables at startup
 * Provides helpful error messages for missing configuration
 */

const { isProduction } = require('./env');
const logger = require('./logger');

/**
 * Required environment variables for production
 */
const REQUIRED_PROD_VARS = [
  'SESSION_SECRET',
  'JWT_SECRET',
  'DB_HOST',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
  'DEFAULT_USER_PASSWORD'
];

/**
 * Required environment variables for all environments
 */
const REQUIRED_VARS = [
  'NODE_ENV'
];

/**
 * Optional but recommended environment variables
 */
const RECOMMENDED_VARS = [
  'REDIS_ENABLED',
  'REDIS_URL',
  'CORS_ORIGIN',
  'PLATFORM_SERVICE_TOKEN',
  'SENDGRID_API_KEY',
  'SENTRY_DSN'
];

/**
 * Validate environment variables
 * @throws {Error} If required variables are missing
 */
function validateEnvironment() {
  const missing = [];
  const warnings = [];

  // Check required variables
  const requiredVars = isProduction() 
    ? [...REQUIRED_VARS, ...REQUIRED_PROD_VARS]
    : REQUIRED_VARS;

  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  // Check recommended variables
  for (const varName of RECOMMENDED_VARS) {
    if (!process.env[varName]) {
      warnings.push(varName);
    }
  }

  // Report missing required variables
  if (missing.length > 0) {
    const errorMessage = `
========================================
❌ MISSING REQUIRED ENVIRONMENT VARIABLES
========================================

The following required environment variables are not set:

${missing.map(v => `  - ${v}`).join('\n')}

Please set these variables in your .env file or environment.

${isProduction() ? `
⚠️  PRODUCTION MODE:
These variables are REQUIRED in production for security and functionality.
The application cannot start without them.
` : `
💡 DEVELOPMENT MODE:
These variables are required for proper application functionality.
You can create a .env file in the server directory.
`}

========================================
    `.trim();

    logger.error(errorMessage);
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // Report recommended variables (warnings only)
  if (warnings.length > 0 && isProduction()) {
    const warningMessage = `
========================================
⚠️  RECOMMENDED ENVIRONMENT VARIABLES
========================================

The following recommended environment variables are not set:

${warnings.map(v => `  - ${v}`).join('\n')}

These are optional but recommended for production:
- REDIS_ENABLED: Enable Redis for session management (recommended for production)
- REDIS_URL: Redis connection URL
- CORS_ORIGIN: Specific allowed origins (defaults to allowing all)
- SENDGRID_API_KEY: For email functionality
- SENTRY_DSN: For error tracking

========================================
    `.trim();

    logger.warn(warningMessage);
  }

  // Generate SESSION_SECRET warning for development
  if (!isProduction() && !process.env.SESSION_SECRET) {
    const devSecret = require('crypto').randomBytes(32).toString('hex');
    logger.warn(`
========================================
⚠️  DEVELOPMENT MODE: SESSION_SECRET
========================================

SESSION_SECRET is not set. Using a random generated secret for development.

To set a permanent secret, add SESSION_SECRET to your .env file.

Generated secret: ${devSecret.substring(0, 16)}... (use for development only)

========================================
    `.trim());
    
    // Set a generated secret for development (with warning)
    process.env.SESSION_SECRET = devSecret;
  }

  // Log successful validation
  logger.info(`Environment validation passed. Running in ${process.env.NODE_ENV || 'development'} mode.`);

  if (isProduction()) {
    logger.info('Production mode enabled. Security features and optimizations active.');
  }
}

module.exports = {
  validateEnvironment,
  REQUIRED_VARS,
  REQUIRED_PROD_VARS,
  RECOMMENDED_VARS
};
