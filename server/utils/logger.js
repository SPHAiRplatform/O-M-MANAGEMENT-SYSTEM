/**
 * Structured Logging Utility
 * 
 * Provides centralized logging using Winston with:
 * - Log levels (error, warn, info, debug)
 * - Log rotation (daily)
 * - Console output (development)
 * - File output (production)
 * - Sensitive data sanitization
 */

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// #region agent log
fetch('http://127.0.0.1:7313/ingest/c5746654-2a7b-4acb-bbb4-39f42c9032ba', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Debug-Session-Id': '77165b'
  },
  body: JSON.stringify({
    sessionId: '77165b',
    runId: 'pre-fix',
    hypothesisId: 'H1',
    location: 'server/utils/logger.js:logsDir-init',
    message: 'Logger initialized and logs directory checked',
    data: {
      nodeEnv: process.env.NODE_ENV || 'undefined',
      isProductionEnv: process.env.NODE_ENV === 'production',
      logsDir,
      logsDirExists: fs.existsSync(logsDir)
    },
    timestamp: Date.now()
  })
}).catch(() => {});
// #endregion

const isProduction = process.env.NODE_ENV === 'production';

// Define log levels
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

// Custom log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Console format (more readable for development)
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

// Sanitize sensitive data from log messages
function sanitizeMessage(message) {
  if (typeof message !== 'string') {
    return message;
  }

  // Remove passwords, tokens, secrets
  let sanitized = message
    .replace(/password["\s:=]+[^\s"'}]+/gi, 'password: [REDACTED]')
    .replace(/token["\s:=]+[^\s"'}]+/gi, 'token: [REDACTED]')
    .replace(/secret["\s:=]+[^\s"'}]+/gi, 'secret: [REDACTED]')
    .replace(/api[_-]?key["\s:=]+[^\s"'}]+/gi, 'api_key: [REDACTED]')
    .replace(/session[_-]?secret["\s:=]+[^\s"'}]+/gi, 'session_secret: [REDACTED]')
    .replace(/jwt[_-]?secret["\s:=]+[^\s"'}]+/gi, 'jwt_secret: [REDACTED]');

  return sanitized;
}

// Sanitize objects recursively
function sanitizeObject(obj) {
  if (obj === null || typeof obj !== 'object') {
    return sanitizeMessage(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }

  const sanitized = {};
  const sensitiveKeys = ['password', 'token', 'secret', 'api_key', 'session_secret', 'jwt_secret', 'authorization'];

  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof obj[key] === 'object') {
        sanitized[key] = sanitizeObject(obj[key]);
      } else {
        sanitized[key] = sanitizeMessage(obj[key]);
      }
    }
  }

  return sanitized;
}

// Create file transports only in production so file-stream-rotator is never used in development
// (constructing DailyRotateFile calls getStream() which can open files asynchronously and emit
// unhandled 'error' if the logs directory is missing or inaccessible, crashing the process)
function buildFileTransports() {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  return [
    new DailyRotateFile({
      filename: path.join(logsDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '20m',
      maxFiles: '30d',
      format: logFormat,
      zippedArchive: true
    }),
    new DailyRotateFile({
      filename: path.join(logsDir, 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
      format: logFormat,
      zippedArchive: true
    })
  ];
}

const fileTransports = isProduction ? buildFileTransports() : [];

// #region agent log
fetch('http://127.0.0.1:7313/ingest/c5746654-2a7b-4acb-bbb4-39f42c9032ba', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Debug-Session-Id': '77165b'
  },
  body: JSON.stringify({
    sessionId: '77165b',
    runId: 'post-fix',
    hypothesisId: 'H2',
    location: 'server/utils/logger.js:fileTransports-init',
    message: 'File transports conditional',
    data: {
      nodeEnv: process.env.NODE_ENV || 'undefined',
      isProductionEnv: isProduction,
      fileTransportCount: fileTransports.length
    },
    timestamp: Date.now()
  })
}).catch(() => {});
// #endregion

// Create logger instance
const logger = winston.createLogger({
  levels: logLevels,
  level: isProduction ? 'info' : 'debug', // Only info+ in production
  format: logFormat,
  transports: [
    ...fileTransports,
    new winston.transports.Console({
      format: isProduction ? logFormat : consoleFormat,
      level: isProduction ? 'info' : 'debug'
    })
  ],
  // Don't exit on handled exceptions
  exitOnError: false
});

// Create wrapper functions with sanitization
const originalLog = logger.log.bind(logger);

logger.log = function(level, message, meta = {}) {
  const sanitizedMessage = sanitizeMessage(message);
  const sanitizedMeta = meta && typeof meta === 'object' ? sanitizeObject(meta) : meta;
  return originalLog(level, sanitizedMessage, sanitizedMeta);
};

// Override each log level method
['error', 'warn', 'info', 'debug'].forEach(level => {
  const originalMethod = logger[level].bind(logger);
  logger[level] = function(message, meta = {}) {
    const sanitizedMessage = sanitizeMessage(message);
    const sanitizedMeta = meta && typeof meta === 'object' ? sanitizeObject(meta) : meta;
    return originalMethod(sanitizedMessage, sanitizedMeta);
  };
});

// Stream for HTTP request logging (if needed)
logger.stream = {
  write: function(message) {
    logger.info(message.trim());
  }
};

module.exports = logger;
