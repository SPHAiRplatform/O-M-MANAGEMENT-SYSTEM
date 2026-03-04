const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || 'CHANGE-THIS-SECRET-IN-PRODUCTION-USE-RANDOM-STRING';
const { isDevelopment } = require('./env');
const JWT_EXPIRES_IN = isDevelopment() 
  ? (process.env.JWT_EXPIRES_IN || '168h') // 7 days in development
  : (process.env.JWT_EXPIRES_IN || '24h'); // 24 hours in production

/**
 * Generate JWT token for authenticated user
 * @param {Object} user - User object with id, username, roles
 * @returns {string} JWT token
 */
function generateToken(user) {
  const payload = {
    userId: user.id,
    username: user.username,
    roles: user.roles || [user.role || 'technician'],
    role: user.roles?.[0] || user.role || 'technician', // Primary role for backward compatibility
    fullName: user.full_name
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
    issuer: 'SPHAiRDigital',
    audience: 'SPHAiRDigital-Client'
  });
}

/**
 * Verify and decode JWT token
 * @param {string} token - JWT token to verify
 * @returns {Object} Decoded token payload
 * @throws {Error} If token is invalid or expired
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET, {
      issuer: 'SPHAiRDigital',
      audience: 'SPHAiRDigital-Client'
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token expired');
    } else if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid token');
    }
    throw error;
  }
}

/**
 * Extract token from Authorization header
 * @param {Object} req - Express request object
 * @returns {string|null} JWT token or null
 */
function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return null;
}

module.exports = {
  generateToken,
  verifyToken,
  extractToken,
  JWT_SECRET,
  JWT_EXPIRES_IN
};
