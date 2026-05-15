const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const { getRedisClient, isRedisAvailable } = require('../utils/redis');
const logger = require('../utils/logger');
const { isProduction, isDevelopment } = require('../utils/env');

function getClientIP(req) {
  if (req.headers['cf-connecting-ip']) {
    return req.headers['cf-connecting-ip'];
  }
  if (req.ip) {
    return req.ip;
  }
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = forwarded.split(',').map(ip => ip.trim());
    return ips[0];
  }
  if (req.headers['x-real-ip']) {
    return req.headers['x-real-ip'];
  }
  if (req.connection && req.connection.remoteAddress) {
    return req.connection.remoteAddress;
  }
  return 'unknown';
}

function getClientIdentifier(req) {
  if (req.session && req.session.userId) {
    return `user:${req.session.userId}`;
  }
  const ip = getClientIP(req);
  return `ip:${ip}`;
}

function getAccountIdentifier(req) {
  const username = req.body?.username || req.body?.email || null;
  if (username) {
    return `account:${username.toLowerCase().trim()}`;
  }
  return null;
}

function createStore() {
  return undefined;
}

function getRetryAfterSeconds(windowMs) {
  return Math.ceil(windowMs / 1000);
}

function formatRetryTime(retryAfterSeconds) {
  if (retryAfterSeconds < 60) {
    return `${retryAfterSeconds} second${retryAfterSeconds !== 1 ? 's' : ''}`;
  } else if (retryAfterSeconds < 3600) {
    const minutes = Math.ceil(retryAfterSeconds / 60);
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  } else {
    const hours = Math.ceil(retryAfterSeconds / 3600);
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  }
}

const standardLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
  max: parseInt(process.env.RATE_LIMIT_MAX || '1000', 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIdentifier(req),
  skip: (req) => {
    if (isDevelopment()) return true;
    return false;
  },
  handler: (req, res) => {
    const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10);
    const retryAfter = getRetryAfterSeconds(windowMs);
    res.status(429).json({
      error: 'Too many requests',
      message: `Rate limit exceeded. Please try again in ${formatRetryTime(retryAfter)}.`,
      retryAfter: retryAfter,
      retryAfterFormatted: formatRetryTime(retryAfter)
    });
  },
  skipSuccessfulRequests: false,
  skipFailedRequests: false
});

const authLimiter = rateLimit({
  windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || '900000', 10),
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '10', 10),
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isDevelopment(),
  keyGenerator: (req) => {
    const ip = getClientIP(req);
    return `ip:${ip}`;
  },
  skipSuccessfulRequests: true,
  skipFailedRequests: false,
  handler: (req, res, next, options) => {
    const windowMs = parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || '900000', 10);
    const retryAfter = getRetryAfterSeconds(windowMs);
    const retryAfterFormatted = formatRetryTime(retryAfter);
    const resetTime = res.getHeader('RateLimit-Reset');
    const remainingTime = resetTime ? Math.max(0, Math.ceil((resetTime * 1000 - Date.now()) / 1000)) : retryAfter;
    logger.warn('[RATE_LIMIT] Login rate limit exceeded', {
      ip: req.ip,
      username: req.body?.username || req.body?.email || 'unknown',
      retryAfter: remainingTime
    });
    res.status(429).json({
      error: 'Too many login attempts',
      message: `Too many failed login attempts from this IP. Please try again in ${formatRetryTime(remainingTime)}.`,
      retryAfter: remainingTime,
      retryAfterFormatted: formatRetryTime(remainingTime),
      suggestions: [
        'Wait for the rate limit to reset',
        'Use the "Forgot Password" feature if you\'ve forgotten your password',
        'Contact your administrator if you believe this is an error'
      ]
    });
  }
});

const loginSlowDown = slowDown({
  windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || '900000', 10),
  delayAfter: 3,
  skip: () => isDevelopment(),
  delayMs: (used, req) => {
    if (used <= 3) return 0;
    else if (used <= 6) return 1000;
    else if (used <= 9) return 3000;
    else return 5000;
  },
  keyGenerator: (req) => {
    const ip = getClientIP(req);
    return `ip:${ip}`;
  },
  skipSuccessfulRequests: true,
  skipFailedRequests: false
});

async function checkAccountLockout(req) {
  if (isDevelopment()) return null;
  const accountId = getAccountIdentifier(req);
  if (!accountId || !isRedisAvailable()) return null;
  try {
    const redisClient = getRedisClient();
    const lockoutKey = `account_lockout:${accountId}`;
    const lockoutData = await redisClient.get(lockoutKey);
    if (lockoutData) {
      const data = JSON.parse(lockoutData);
      const now = Date.now();
      if (data.lockedUntil > now) {
        const remainingSeconds = Math.ceil((data.lockedUntil - now) / 1000);
        return {
          locked: true,
          remainingSeconds,
          remainingFormatted: formatRetryTime(remainingSeconds),
          attempts: data.attempts
        };
      } else {
        await redisClient.del(lockoutKey);
      }
    }
    return null;
  } catch (error) {
    logger.error('[RATE_LIMIT] Error checking account lockout', { error: error.message });
    return null;
  }
}

async function recordFailedLoginAttempt(req) {
  if (isDevelopment()) return;
  const accountId = getAccountIdentifier(req);
  if (!accountId || !isRedisAvailable()) return;
  try {
    const redisClient = getRedisClient();
    const lockoutKey = `account_lockout:${accountId}`;
    const windowMs = parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || '900000', 10);
    const maxAttempts = parseInt(process.env.AUTH_ACCOUNT_LOCKOUT_MAX || '15', 10);
    const existingData = await redisClient.get(lockoutKey);
    let data = existingData ? JSON.parse(existingData) : { attempts: 0, lockedUntil: 0 };
    data.attempts += 1;
    if (data.attempts >= maxAttempts) {
      data.lockedUntil = Date.now() + windowMs;
      logger.warn('[RATE_LIMIT] Account locked due to too many failed attempts', {
        account: accountId,
        attempts: data.attempts
      });
    }
    await redisClient.setEx(lockoutKey, Math.ceil(windowMs / 1000), JSON.stringify(data));
  } catch (error) {
    logger.error('[RATE_LIMIT] Error recording failed login attempt', { error: error.message });
  }
}

async function clearAccountLockout(req) {
  const accountId = getAccountIdentifier(req);
  if (!accountId || !isRedisAvailable()) return;
  try {
    const redisClient = getRedisClient();
    const lockoutKey = `account_lockout:${accountId}`;
    await redisClient.del(lockoutKey);
    logger.debug('[RATE_LIMIT] Account lockout cleared', { account: accountId });
  } catch (error) {
    logger.error('[RATE_LIMIT] Error clearing account lockout', { error: error.message });
  }
}

function accountLockoutMiddleware(req, res, next) {
  checkAccountLockout(req)
    .then(lockout => {
      if (lockout && lockout.locked) {
        logger.warn('[RATE_LIMIT] Login blocked by account lockout', {
          account: getAccountIdentifier(req),
          remaining: lockout.remainingFormatted
        });
        return res.status(429).json({
          error: 'Account temporarily locked',
          message: `This account has been temporarily locked due to too many failed login attempts. Please try again in ${lockout.remainingFormatted}.`,
          retryAfter: lockout.remainingSeconds,
          retryAfterFormatted: lockout.remainingFormatted,
          suggestions: [
            'Wait for the lockout period to expire',
            'Use the "Forgot Password" feature to reset your password',
            'Contact your administrator if you need immediate access'
          ]
        });
      }
      next();
    })
    .catch(error => {
      logger.error('[RATE_LIMIT] Error checking account lockout', { error: error.message });
      next();
    });
}

const sensitiveOperationLimiter = rateLimit({
  windowMs: parseInt(process.env.SENSITIVE_RATE_LIMIT_WINDOW_MS || '3600000', 10),
  max: parseInt(process.env.SENSITIVE_RATE_LIMIT_MAX || '50', 10),
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isDevelopment(),
  keyGenerator: (req) => getClientIdentifier(req),
  handler: (req, res) => {
    const windowMs = parseInt(process.env.SENSITIVE_RATE_LIMIT_WINDOW_MS || '3600000', 10);
    const retryAfter = getRetryAfterSeconds(windowMs);
    res.status(429).json({
      error: 'Rate limit exceeded',
      message: `Too many requests for this sensitive operation. Please try again in ${formatRetryTime(retryAfter)}.`,
      retryAfter: retryAfter,
      retryAfterFormatted: formatRetryTime(retryAfter)
    });
  }
});

const speedLimiter = slowDown({
  windowMs: parseInt(process.env.SPEED_LIMIT_WINDOW_MS || '60000', 10),
  delayAfter: parseInt(process.env.SPEED_LIMIT_DELAY_AFTER || '200', 10),
  skip: () => isDevelopment(),
  delayMs: (used, req) => {
    const delayPerRequest = parseInt(process.env.SPEED_LIMIT_DELAY_MS || '100', 10);
    const maxDelay = parseInt(process.env.SPEED_LIMIT_MAX_DELAY_MS || '2000', 10);
    const delayAfter = parseInt(process.env.SPEED_LIMIT_DELAY_AFTER || '200', 10);
    if (used <= delayAfter) return 0;
    const calculatedDelay = (used - delayAfter) * delayPerRequest;
    return Math.min(calculatedDelay, maxDelay);
  },
  keyGenerator: (req) => getClientIdentifier(req),
  skipSuccessfulRequests: false,
  skipFailedRequests: false
});

module.exports = {
  standardLimiter,
  authLimiter,
  loginSlowDown,
  sensitiveOperationLimiter,
  speedLimiter,
  accountLockoutMiddleware,
  checkAccountLockout,
  recordFailedLoginAttempt,
  clearAccountLockout
};
