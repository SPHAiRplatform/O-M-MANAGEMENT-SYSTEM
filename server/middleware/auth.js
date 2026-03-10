// Authentication middleware
const { verifyToken, extractToken } = require('../utils/jwt');
const { isRedisAvailable } = require('../utils/redis');
const { loadUserRBAC, loadUserPermissions, loadUserRoles } = require('./rbac');
const { isDevelopment } = require('../utils/env');

/**
 * Middleware factory to check if password change is required
 * Returns a middleware function that uses the provided pool
 */
function requirePasswordChange(pool) {
  return async (req, res, next) => {
    // Skip password check for password change and logout endpoints
    if (req.path.includes('/change-password') || req.path.includes('/logout') || req.path.includes('/auth/login')) {
      return next();
    }

    const userId = req.session?.userId;
    if (!userId) {
      return next(); // Let requireAuth handle authentication
    }

    try {
      const passwordCheck = await pool.query(
        'SELECT password_changed FROM users WHERE id = $1',
        [userId]
      );
      
      if (passwordCheck.rows.length > 0) {
        const passwordChanged = passwordCheck.rows[0].password_changed;
        if (passwordChanged === false) {
          return res.status(403).json({ 
            error: 'Password change required',
            requires_password_change: true,
            message: 'You must change your default password before accessing the application.'
          });
        }
      }
    } catch (error) {
      console.error('Error checking password change status:', error);
      // Continue if column doesn't exist (backward compatibility)
    }

    next();
  };
}

/**
 * Middleware to check if user is authenticated
 * Supports both JWT tokens (Bearer token) and session-based authentication
 */
async function requireAuth(req, res, next) {
  // If session already populated by JWT fallback middleware, skip JWT check
  if (req.session && req.session.userId && req.session._fromJwt) {
    return next();
  }

  // Try JWT token first (Bearer token in Authorization header)
  const token = extractToken(req);
  
  if (token) {
    try {
      // Verify JWT token
      const decoded = verifyToken(token);
      
      // Check Redis for single-device enforcement (if available)
      // A valid JWT is sufficient for auth — Redis is optional for enrichment/revocation
      if (isRedisAvailable() && !isDevelopment()) {
        // Single-Device-Per-Session: only reject if another device explicitly logged in
        // TEMPORARILY DISABLED - causes issues with multiple tabs/restarts
       // const { getUserSession } = require('../utils/redis');
       // const existingSession = await getUserSession(decoded.userId);
        //if (existingSession && existingSession !== token) {
          //return res.status(401).json({
            //error: 'Session expired',
            //message: 'You have logged in from another device. Please log in again.'
          //});
        //}
      }

      // JWT is valid — populate session from decoded token
      req.session = req.session || {};
      req.session.userId = decoded.userId;
      req.session.username = decoded.username;
      req.session.roles = decoded.roles;
      req.session.role = decoded.role;
      req.session.fullName = decoded.fullName;
      req.session.permissions = decoded.permissions || [];
      req.session.isJWT = true;
      
      return next();
    } catch (error) {
      if (isDevelopment()) console.log('JWT authentication failed:', error.message);
      // Fall through to session-based authentication
    }
  }

  // Fallback to session-based authentication
  if (isDevelopment()) {
    console.log('Auth check (session):', {
      hasSession: !!req.session,
      hasUserId: !!(req.session && req.session.userId),
      sessionId: req.sessionID,
      userId: req.session?.userId,
      username: req.session?.username,
      role: req.session?.role
    });
  }

  if (!req.session || !req.session.userId) {
    if (isDevelopment()) console.log('Authentication failed - no session or userId');
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  // Load RBAC data if not already loaded (for session-based auth)
  if (req.db && (!req.session.permissions || !req.session.roles || req.session.roles.length === 0)) {
    try {
      const { loadUserRBAC } = require('./rbac');
      await loadUserRBAC(req, res, () => {});
    } catch (error) {
      console.error('Error loading RBAC in requireAuth:', error);
      // Continue anyway
    }
  }
  
  next();
}

/**
 * Helper function to get user roles from session
 * Supports both single role (backward compatibility) and multiple roles
 */
function getUserRoles(req) {
  if (!req.session || !req.session.userId) {
    return [];
  }
  
  // Check if roles array exists (new format)
  if (req.session.roles && Array.isArray(req.session.roles)) {
    return req.session.roles;
  }
  
  // Fallback to single role (backward compatibility)
  if (req.session.role) {
    return [req.session.role];
  }
  
  return [];
}

/**
 * Helper function to normalize role codes (maps legacy to RBAC)
 */
function normalizeRole(role) {
  const roleMapping = {
    'super_admin': 'system_owner',
    'admin': 'operations_admin',
    'supervisor': 'supervisor',
    'technician': 'technician'
  };
  return roleMapping[role] || role;
}

/**
 * Helper function to check if user has a specific role
 * Supports both legacy roles (super_admin, admin) and RBAC roles (system_owner, operations_admin)
 */
function hasRole(req, role) {
  const roles = getUserRoles(req);
  const normalizedRole = normalizeRole(role);
  
  // Check if user has the role (either exact match or normalized)
  return roles.some(userRole => {
    const normalizedUserRole = normalizeRole(userRole);
    return normalizedUserRole === normalizedRole || userRole === role;
  });
}

/**
 * Helper function to check if user has any of the specified roles
 * Supports both legacy roles and RBAC roles
 */
function hasAnyRole(req, ...roles) {
  const userRoles = getUserRoles(req);
  const normalizedRoles = roles.map(normalizeRole);
  
  return userRoles.some(userRole => {
    const normalizedUserRole = normalizeRole(userRole);
    return normalizedRoles.includes(normalizedUserRole) || roles.includes(userRole);
  });
}

/**
 * Middleware to check if user has super_admin or system_owner role
 * system_owner is the RBAC equivalent of super_admin
 */
function requireSuperAdmin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  // Check for both legacy super_admin and RBAC system_owner
  if (!hasAnyRole(req, 'super_admin', 'system_owner')) {
    return res.status(403).json({ error: 'Super admin or system owner access required' });
  }
  next();
}

/**
 * Middleware to check if user has admin, super_admin, operations_admin, or system_owner role
 * operations_admin is the RBAC equivalent of admin
 * system_owner also has admin privileges
 */
function requireAdmin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  // Check for both legacy roles (admin, super_admin) and RBAC roles (operations_admin, system_owner)
  if (!hasAnyRole(req, 'admin', 'super_admin', 'operations_admin', 'system_owner')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/**
 * Middleware to check if user has admin, super_admin, operations_admin, system_owner, or supervisor role
 */
function requireAdminOrSupervisor(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  // Check for both legacy roles (admin, super_admin, supervisor) and RBAC roles (operations_admin, system_owner, supervisor)
  if (!hasAnyRole(req, 'admin', 'super_admin', 'operations_admin', 'system_owner', 'supervisor')) {
    return res.status(403).json({ error: 'Admin or supervisor access required' });
  }
  next();
}

/**
 * Helper function to check if user is super admin
 */
function isSuperAdmin(req) {
  // Check for both legacy super_admin and RBAC system_owner
  return hasAnyRole(req, 'super_admin', 'system_owner');
}

/**
 * Helper function to check if user is admin, super admin, operations admin, or system owner
 */
function isAdmin(req) {
  // Check for both legacy roles (admin, super_admin) and RBAC roles (operations_admin, system_owner)
  return hasAnyRole(req, 'admin', 'super_admin', 'operations_admin', 'system_owner');
}

/**
 * Helper function to check if user is technician
 */
function isTechnician(req) {
  return hasRole(req, 'technician');
}

module.exports = {
  requireAuth,
  requirePasswordChange,
  requireSuperAdmin,
  requireAdmin,
  requireAdminOrSupervisor,
  isSuperAdmin,
  isAdmin,
  isTechnician
};

