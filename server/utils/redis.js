const logger = require('./logger');
const { isProduction } = require('./env');

let redis = null;
let redisClient = null;
let isRedisEnabled = false;

// Try to require redis, but don't fail if it's not installed
try {
  redis = require('redis');
} catch (error) {
  logger.warn('[REDIS] Redis module not installed. Install with: npm install redis');
  if (isProduction()) {
    logger.error('[REDIS] CRITICAL: Redis is required in production but module is not installed.');
    logger.error('[REDIS] Please install Redis: npm install redis');
    process.exit(1);
  }
  logger.warn('[REDIS] System will continue without Redis support (development mode only).');
}

/**
 * Initialize Redis client
 * @returns {Promise<redis.RedisClient>} Redis client instance
 */
async function initRedis() {
  // Check if redis module is available
  if (!redis) {
    if (isProduction()) {
      logger.error('[REDIS] CRITICAL: Redis module is required in production but not available.');
      logger.error('[REDIS] Please install Redis: npm install redis');
      process.exit(1);
    }
    logger.warn('[REDIS] Redis module not available. Install with: npm install redis');
    return null;
  }

  // Check if Redis is enabled via environment variable
  if (process.env.REDIS_ENABLED !== 'true') {
    if (isProduction()) {
      logger.error('[REDIS] CRITICAL: Redis is required in production but REDIS_ENABLED is not set to "true".');
      logger.error('[REDIS] Please set REDIS_ENABLED=true in your environment variables.');
      process.exit(1);
    }
    logger.warn('[REDIS] Redis is disabled. Set REDIS_ENABLED=true to enable.');
    return null;
  }

  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  
  try {
    redisClient = redis.createClient({
      url: redisUrl,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            console.error('[REDIS] Max reconnection attempts reached');
            return new Error('Max reconnection attempts reached');
          }
          return Math.min(retries * 100, 3000);
        }
      }
    });

    redisClient.on('error', (err) => {
      logger.error('[REDIS] Error', { error: err.message });
      isRedisEnabled = false;
      if (isProduction()) {
        logger.error('[REDIS] CRITICAL: Redis connection error in production. Server will continue but sessions may be lost.');
      }
    });

    redisClient.on('connect', () => {
      logger.info('[REDIS] Connected to Redis');
      isRedisEnabled = true;
    });

    redisClient.on('ready', () => {
      logger.info('[REDIS] Redis client ready');
      isRedisEnabled = true;
    });

    redisClient.on('end', () => {
      logger.warn('[REDIS] Connection ended');
      isRedisEnabled = false;
      if (isProduction()) {
        logger.error('[REDIS] CRITICAL: Redis connection ended in production. Sessions may be lost.');
      }
    });

    await redisClient.connect();
    isRedisEnabled = true;
    logger.info('[REDIS] Successfully initialized and connected');
    return redisClient;
  } catch (error) {
    logger.error('[REDIS] Failed to connect to Redis', { error: error.message, stack: error.stack });
    if (isProduction()) {
      logger.error('[REDIS] CRITICAL: Redis is required in production but connection failed.');
      logger.error('[REDIS] Please ensure Redis is running and REDIS_URL is correct.');
      logger.error('[REDIS] Server will exit to prevent using insecure memory store.');
      process.exit(1);
    }
    logger.warn('[REDIS] Continuing without Redis. Sessions will use memory store (development only).');
    isRedisEnabled = false;
    return null;
  }
}

/**
 * Get Redis client instance
 * @returns {redis.RedisClient|null} Redis client or null if not available
 */
function getRedisClient() {
  return redisClient;
}

/**
 * Check if Redis is enabled and connected
 * @returns {boolean}
 */
function isRedisAvailable() {
  return isRedisEnabled && redisClient !== null;
}

/**
 * Store JWT token in Redis with expiration
 * @param {string} token - JWT token
 * @param {Object} userData - User data to store
 * @param {number} ttlSeconds - Time to live in seconds (default: 24 hours)
 * @returns {Promise<void>}
 */
async function storeToken(token, userData, ttlSeconds = 86400) {
  if (!isRedisAvailable()) {
    return; // Silently fail if Redis is not available
  }

  try {
    const key = `jwt:${token}`;
    await redisClient.setEx(key, ttlSeconds, JSON.stringify(userData));
  } catch (error) {
    logger.error('[REDIS] Error storing token', { error: error.message });
  }
}

/**
 * Get user data from Redis by token
 * @param {string} token - JWT token
 * @returns {Promise<Object|null>} User data or null
 */
async function getTokenData(token) {
  if (!isRedisAvailable()) {
    return null;
  }

  try {
    const key = `jwt:${token}`;
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    logger.error('[REDIS] Error getting token data', { error: error.message });
    return null;
  }
}

/**
 * Delete token from Redis
 * @param {string} token - JWT token
 * @returns {Promise<void>}
 */
async function deleteToken(token) {
  if (!isRedisAvailable()) {
    return;
  }

  try {
    const key = `jwt:${token}`;
    await redisClient.del(key);
  } catch (error) {
    logger.error('[REDIS] Error deleting token', { error: error.message });
  }
}

/**
 * Store active session for a user (single-device-per-session)
 * @param {string} userId - User ID
 * @param {string} token - JWT token
 * @param {number} ttlSeconds - Time to live in seconds (default: 24 hours)
 * @returns {Promise<void>}
 */
async function storeUserSession(userId, token, ttlSeconds = 86400) {
  if (!isRedisAvailable()) {
    return; // Silently fail if Redis is not available
  }

  try {
    const userSessionKey = `user:session:${userId}`;
    // Store the active token for this user
    await redisClient.setEx(userSessionKey, ttlSeconds, token);
    logger.debug(`[REDIS] Stored active session for user ${userId}`);
  } catch (error) {
    logger.error('[REDIS] Error storing user session', { error: error.message, userId });
  }
}

/**
 * Get active session token for a user
 * @param {string} userId - User ID
 * @returns {Promise<string|null>} Active token or null
 */
async function getUserSession(userId) {
  if (!isRedisAvailable()) {
    return null;
  }

  try {
    const userSessionKey = `user:session:${userId}`;
    const token = await redisClient.get(userSessionKey);
    return token;
  } catch (error) {
    logger.error('[REDIS] Error getting user session', { error: error.message, userId });
    return null;
  }
}

/**
 * Delete active session for a user (single-device-per-session)
 * @param {string} userId - User ID
 * @returns {Promise<void>}
 */
async function deleteUserSession(userId) {
  if (!isRedisAvailable()) {
    return;
  }

  try {
    const userSessionKey = `user:session:${userId}`;
    const activeToken = await redisClient.get(userSessionKey);
    
    // Delete the user session
    await redisClient.del(userSessionKey);
    
    // Also delete the token if it exists
    if (activeToken) {
      const tokenKey = `jwt:${activeToken}`;
      await redisClient.del(tokenKey);
      logger.debug(`[REDIS] Deleted active session for user ${userId}`);
    }
  } catch (error) {
    logger.error('[REDIS] Error deleting user session', { error: error.message, userId });
  }
}

/**
 * Check if a token is the active session for a user
 * @param {string} userId - User ID
 * @param {string} token - JWT token to check
 * @returns {Promise<boolean>} True if token matches active session
 */
async function isActiveSession(userId, token) {
  if (!isRedisAvailable()) {
    return true; // If Redis is not available, allow the session (backward compatibility)
  }

  try {
    const activeToken = await getUserSession(userId);
    if (!activeToken) {
      // No active session stored, allow this token (first login or Redis cleared)
      return true;
    }
    return activeToken === token;
  } catch (error) {
    logger.error('[REDIS] Error checking active session', { error: error.message, userId });
    return true; // On error, allow the session to prevent lockouts
  }
}

/**
 * Store selected organization for a system owner (persists across JWT requests)
 * @param {string} userId - User ID
 * @param {Object} orgData - { organizationId, organizationName, organizationSlug }
 * @param {number} ttlSeconds - Time to live in seconds (default: 24 hours)
 * @returns {Promise<void>}
 */
async function storeUserOrgContext(userId, orgData, ttlSeconds = 86400) {
  if (!isRedisAvailable()) return;
  try {
    const key = `user:org:${userId}`;
    await redisClient.setEx(key, ttlSeconds, JSON.stringify(orgData));
  } catch (error) {
    logger.error('[REDIS] Error storing user org context', { error: error.message, userId });
  }
}

/**
 * Get selected organization for a system owner
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} { organizationId, organizationName, organizationSlug } or null
 */
async function getUserOrgContext(userId) {
  if (!isRedisAvailable()) return null;
  try {
    const key = `user:org:${userId}`;
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    logger.error('[REDIS] Error getting user org context', { error: error.message, userId });
    return null;
  }
}

/**
 * Clear selected organization for a system owner
 * @param {string} userId - User ID
 * @returns {Promise<void>}
 */
async function clearUserOrgContext(userId) {
  if (!isRedisAvailable()) return;
  try {
    const key = `user:org:${userId}`;
    await redisClient.del(key);
  } catch (error) {
    logger.error('[REDIS] Error clearing user org context', { error: error.message, userId });
  }
}

/**
 * Close Redis connection
 * @returns {Promise<void>}
 */
async function closeRedis() {
  if (redisClient) {
    try {
      await redisClient.quit();
      logger.info('[REDIS] Connection closed');
    } catch (error) {
      logger.error('[REDIS] Error closing connection', { error: error.message });
    }
    redisClient = null;
    isRedisEnabled = false;
  }
}

module.exports = {
  initRedis,
  getRedisClient,
  isRedisAvailable,
  storeToken,
  getTokenData,
  deleteToken,
  storeUserSession,
  getUserSession,
  deleteUserSession,
  isActiveSession,
  storeUserOrgContext,
  getUserOrgContext,
  clearUserOrgContext,
  closeRedis
};
