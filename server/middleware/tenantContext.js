/**
 * Tenant Context Middleware
 * Sets PostgreSQL session variables for Row-Level Security (RLS)
 * This ensures data isolation at the database level
 * 
 * Implementation: Request-scoped connection with connection-level session variables
 * - Acquires a connection at request start
 * - Sets session variables on the connection (persists for connection lifetime)
 * - Attaches connection to req.db for routes to use
 * - Releases connection at request end
 * 
 * Application-Level Filtering:
 * - Platform routes (/api/platform/*) + system owner = skip RLS (application-level filtering)
 * - Tenant routes (all other routes) = RLS active (database-level filtering)
 */

/**
 * Validate UUID format to prevent injection in SET commands
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUUID(value) {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

/**
 * Safely set a PostgreSQL session variable — only allows valid UUIDs, empty string, or 'true'/'false'
 */
async function safeSetVar(client, varName, value) {
  if (value === '' || value === 'true' || value === 'false') {
    await client.query(`SET ${varName} = '${value}'`);
  } else if (isValidUUID(value)) {
    await client.query(`SET ${varName} = '${value}'`);
  } else {
    throw new Error(`Invalid value for ${varName}: ${String(value).substring(0, 50)}`);
  }
}

/**
 * Helper function to check if route is a platform route
 * Platform routes are for system-wide administration
 */
function isPlatformRoute(req) {
  const url = req.originalUrl || req.path || '';
  return url.startsWith('/api/platform/') || url.startsWith('/api/platform');
}

/**
 * Helper function to check if route is a tenant route
 * Tenant routes are for company-specific operations
 */
function isTenantRoute(req) {
  return req.path && req.path.startsWith('/api/tenant/');
}

/**
 * Helper function to check if RLS should be skipped
 * RLS is skipped for platform routes when accessed by system owners
 */
function shouldSkipRLS(req) {
  return req.platformMode === true && req.skipRLS === true;
}

/**
 * Middleware to set tenant context for RLS policies
 * Must be called after authentication middleware
 * Acquires a connection and sets app.current_organization_id and app.current_user_id
 * 
 * For platform routes + system owners: Application-level filtering (skip RLS)
 * For tenant routes or regular users: Database-level filtering (RLS active)
 */
function setTenantContext(pool) {
  return async (req, res, next) => {
    // Skip if no session or user
    if (!req.session || !req.session.userId) {
      return next();
    }

    let client = null;

    try {
      const userId = req.session.userId;
      
      // Detect if this is a platform route or tenant route
      const isPlatform = isPlatformRoute(req);
      const isTenant = isTenantRoute(req);

      // Get user's organization_id and roles
      // Use a temporary connection for this lookup
      const tempClient = await pool.connect();
      try {
        const userResult = await tempClient.query(
          `SELECT organization_id, role, roles FROM users WHERE id = $1`,
          [userId]
        );

        if (userResult.rows.length === 0) {
          tempClient.release();
          return next();
        }

        const user = userResult.rows[0];
        
        // Check if user is system_owner (platform creator - no organization)
        const userRoles = user.roles 
          ? (typeof user.roles === 'string' ? JSON.parse(user.roles) : user.roles) 
          : [user.role];
        
        const isSystemOwner = 
          userRoles.includes('system_owner') || 
          user.role === 'system_owner' || 
          userRoles.includes('super_admin') || 
          user.role === 'super_admin';

        // Acquire a connection for this request
        client = await pool.connect();

        // PLATFORM MODE: Platform routes + system owner = Application-level filtering (skip RLS)
        // Note: Tenant routes (/api/tenant/*) are NOT platform routes, so they use tenant mode
        if (isPlatform && isSystemOwner && !isTenant) {
          // Platform mode - skip RLS, use application-level filtering
          // Don't set organization_id in session variables
          await safeSetVar(client, 'app.current_organization_id', '');
          await safeSetVar(client, 'app.current_user_id', userId);
          await safeSetVar(client, 'app.current_user_is_system_owner', 'true');

          // Store platform context
          req.platformMode = true;
          req.skipRLS = true;
          req.tenantContext = {
            organizationId: null,
            userId: userId,
            isSystemOwner: true,
            platformMode: true
          };

          console.log('[TENANT CONTEXT] Platform mode enabled - RLS bypassed for system owner');
        } 
        // TENANT MODE: Regular routes or regular users = Database-level filtering (RLS active)
        else {
          // Tenant mode - RLS active, filter by organization_id
          let organizationId = null;
          
          if (isSystemOwner) {
            // System owner entering a company: use selected organization from session
            // This is set when they click "Enter Company" on Platform Dashboard
            organizationId = req.session.selectedOrganizationId || null;
            
            if (organizationId) {
              // Verify the organization exists and is active
              const orgCheck = await tempClient.query(
                'SELECT id, name, is_active FROM organizations WHERE id = $1',
                [organizationId]
              );
              
              if (orgCheck.rows.length === 0 || !orgCheck.rows[0].is_active) {
                // Invalid or inactive organization, clear selection
                req.session.selectedOrganizationId = null;
                organizationId = null;
                console.log('[TENANT CONTEXT] Invalid or inactive organization selected, clearing selection');
              }
            }
          } else {
            // Regular user: use their assigned organization_id
            organizationId = user.organization_id || null;
          }

          // Set connection-level session variables (persist for connection lifetime)
          // These are used by RLS policies via get_current_organization_id() function
          // Note: Using SET (not SET LOCAL) so variables persist for the connection
          if (organizationId) {
            await safeSetVar(client, 'app.current_organization_id', organizationId);
          } else {
            await safeSetVar(client, 'app.current_organization_id', '');
          }

          await safeSetVar(client, 'app.current_user_id', userId);

          // Cache system owner status for optimized RLS policies (once per request)
          await safeSetVar(client, 'app.current_user_is_system_owner', String(isSystemOwner));

          // Fetch organization slug for file storage
          let organizationSlug = null;
          if (organizationId) {
            try {
              const slugResult = await tempClient.query(
                'SELECT slug FROM organizations WHERE id = $1',
                [organizationId]
              );
              if (slugResult.rows.length > 0) {
                organizationSlug = slugResult.rows[0].slug;
              }
            } catch (error) {
              console.error('[TENANT CONTEXT] Error fetching organization slug:', error);
            }
          }

          // Store tenant context (includes slug for file storage)
          req.platformMode = false;
          req.skipRLS = false;
          req.tenantContext = {
            organizationId: organizationId,
            organizationSlug: organizationSlug,
            userId: userId,
            isSystemOwner: isSystemOwner,
            platformMode: false,
            selectedOrganizationId: isSystemOwner ? organizationId : null
          };
          
          if (isSystemOwner && organizationId) {
            console.log(`[TENANT CONTEXT] System owner entering company: ${organizationId}`);
          }
        }

        // Attach connection to request for routes to use
        // Routes should use req.db.query() instead of pool.query()
        // This connection has session variables set, so RLS will work automatically
        req.db = client;

        // Release connection when response finishes (success or error)
        const originalEnd = res.end.bind(res);
        res.end = function(...args) {
          if (client) {
            client.release();
            client = null;
            req.db = null;
          }
          return originalEnd.apply(this, args);
        };

        tempClient.release();
        next();
      } catch (error) {
        tempClient.release();
        throw error;
      }
    } catch (error) {
      console.error('[TENANT CONTEXT] Error setting tenant context:', error);
      // Release connection if acquired
      if (client) {
        client.release();
        client = null;
        req.db = null;
      }
      // Don't block request, but log error
      // Routes will fall back to pool if req.db is not set
      next();
    }
  };
}

/**
 * Helper function for routes to get the database connection
 * Returns req.db if available (with tenant context), otherwise falls back to pool
 * This allows gradual migration - routes can use getDb(req, pool) instead of pool
 */
function getDb(req, pool) {
  return req.db || pool;
}

/**
 * Middleware factory to require organization context
 * Ensures user belongs to an organization (not system_owner)
 */
function requireOrganization(req, res, next) {
  if (!req.tenantContext || !req.tenantContext.organizationId) {
    return res.status(403).json({ 
      error: 'Organization context required',
      message: 'This operation requires an organization context'
    });
  }
  next();
}

/**
 * Middleware factory to allow only system owners
 * Allows only system_owner users (platform creators)
 */
function requireSystemOwner(req, res, next) {
  if (!req.tenantContext || !req.tenantContext.isSystemOwner) {
    return res.status(403).json({ 
      error: 'System owner access required',
      message: 'This operation requires system owner privileges'
    });
  }
  next();
}

module.exports = {
  setTenantContext,
  getDb,
  requireOrganization,
  requireSystemOwner,
  isPlatformRoute,
  shouldSkipRLS
};
