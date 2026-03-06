const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { Pool } = require('pg');
const { validateLogin, validateChangePassword } = require('../middleware/inputValidation');
const { generateToken } = require('../utils/jwt');
const { storeToken, storeUserSession, getUserSession, deleteUserSession, deleteToken } = require('../utils/redis');
const { recordFailedLoginAttempt, clearAccountLockout } = require('../middleware/rateLimiter');
const { ValidationError, AuthenticationError } = require('../utils/errors');
const { sendEmail } = require('../utils/email');
const logger = require('../utils/logger');
const { logAudit, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require('../utils/auditLogger');
const deleteRedisToken = deleteToken; // Alias for clarity

module.exports = (pool) => {
  const router = express.Router();

  // Login endpoint
  // Rate limiting applied in index.js (authLimiter)
  // Input validation applied via middleware
  router.post('/login', validateLogin, async (req, res) => {
    try {
      let { username, password } = req.body;

      // Mobile keyboards / autofill can introduce leading/trailing spaces.
      // Normalize username/email input so "admin " works the same as "admin".
      if (typeof username === 'string') username = username.trim();

      logger.debug('Login attempt', { username, hasPassword: !!password });

      if (!username || !password) {
        throw new ValidationError('Username and password are required');
      }

      // Find user by username
      // Support both 'role' (single) and 'roles' (array) for backward compatibility
      // Try to query with roles column, fallback if it doesn't exist
      let userResult;
      let hasRolesColumn = false;
      
      try {
        // Try query with roles column first (include organization_id for data isolation)
        userResult = await pool.query(
          `SELECT id, username, email, full_name, 
                  COALESCE(roles, jsonb_build_array(role)) as roles,
                  role, profile_image, password_hash, is_active, organization_id
           FROM users 
           WHERE username = $1 OR email = $1`,
          [username]
        );
        hasRolesColumn = true;
      } catch (error) {
        // If roles column doesn't exist, use fallback query
        if (error.code === '42703' || error.message.includes('roles')) {
          logger.debug('roles column not found, using fallback query');
            userResult = await pool.query(
              `SELECT id, username, email, full_name, 
                      role, profile_image, password_hash, is_active, organization_id
               FROM users 
               WHERE username = $1 OR email = $1`,
              [username]
            );
            hasRolesColumn = false;
        } else {
          // Re-throw if it's a different error
          throw error;
        }
      }

      logger.debug('User query result', { found: userResult.rows.length > 0, username: username });

      if (userResult.rows.length === 0) {
        logger.warn('User not found for login attempt', { username });
        await recordFailedLoginAttempt(req);
        logAudit(pool, req, { action: AUDIT_ACTIONS.LOGIN_FAILED, entityType: AUDIT_ENTITY_TYPES.AUTH, details: { username, reason: 'user_not_found' } }).catch(() => {});
        throw new AuthenticationError('Invalid username or password');
      }

      const user = userResult.rows[0];
      logger.debug('User found', { id: user.id, username: user.username, role: user.role, is_active: user.is_active, has_password: !!user.password_hash });

      // Check if user is active
      if (!user.is_active) {
        logger.warn('Login attempt for deactivated account', { username, userId: user.id });
        logAudit(pool, req, { action: AUDIT_ACTIONS.LOGIN_FAILED, entityType: AUDIT_ENTITY_TYPES.AUTH, details: { username, reason: 'account_deactivated', user_id: user.id } }).catch(() => {});
        
        // Get admin email for the error message
        let adminEmail = 'the administrator';
        try {
          // Try to get super_admin first, then admin
          let adminResult;
          try {
            // Try query with roles column
            adminResult = await pool.query(
              `SELECT email FROM users 
               WHERE (
                 role = 'super_admin' 
                 OR role = 'admin'
                 OR (roles IS NOT NULL AND (roles @> '["super_admin"]'::jsonb OR roles @> '["admin"]'::jsonb))
               )
               AND is_active = true 
               AND email IS NOT NULL 
               ORDER BY 
                 CASE 
                   WHEN role = 'super_admin' OR (roles IS NOT NULL AND roles @> '["super_admin"]'::jsonb) THEN 1
                   WHEN role = 'admin' OR (roles IS NOT NULL AND roles @> '["admin"]'::jsonb) THEN 2
                   ELSE 3
                 END
               LIMIT 1`
            );
          } catch (rolesError) {
            // Fallback if roles column doesn't exist
            if (rolesError.code === '42703' || rolesError.message.includes('roles')) {
              adminResult = await pool.query(
                `SELECT email FROM users 
                 WHERE (role = 'super_admin' OR role = 'admin')
                 AND is_active = true 
                 AND email IS NOT NULL 
                 ORDER BY CASE WHEN role = 'super_admin' THEN 1 ELSE 2 END
                 LIMIT 1`
              );
            } else {
              throw rolesError;
            }
          }
          
          if (adminResult.rows.length > 0 && adminResult.rows[0].email) {
            adminEmail = adminResult.rows[0].email;
          }
        } catch (err) {
          logger.error('Error fetching admin email', { error: err.message });
          // Use default message if query fails
        }
        
        if (!res.headersSent) {
          return res.status(403).json({ 
            error: 'ACCESS RESTRICTED',
            message: `Your account access has been restricted. Please contact the administrator at ${adminEmail} for assistance.`,
            admin_email: adminEmail
          });
        }
        return;
      }

      // Check if user has a password set
      if (!user.password_hash) {
        logger.warn('Login attempt for user with no password set', { username, userId: user.id });
        if (!res.headersSent) {
          return res.status(401).json({ 
            error: 'Account not set up. Please contact administrator to set your password.' 
          });
        }
        return;
      }

      // Verify password
      logger.debug('Comparing password');
      const passwordMatch = await bcrypt.compare(password, user.password_hash);
      logger.debug('Password match result', { match: passwordMatch });

      if (!passwordMatch) {
        logger.warn('Password mismatch for login attempt', { username });
        await recordFailedLoginAttempt(req);
        logAudit(pool, req, { action: AUDIT_ACTIONS.LOGIN_FAILED, entityType: AUDIT_ENTITY_TYPES.AUTH, details: { username, reason: 'invalid_password' } }).catch(() => {});
        if (!res.headersSent) {
          return res.status(401).json({ error: 'Invalid username or password' });
        }
        return;
      }

      // Password matched - clear any account lockout
      await clearAccountLockout(req);

      // Check if user is using default password
      const DEFAULT_PASSWORD = process.env.DEFAULT_USER_PASSWORD;
      const isDefaultPassword = DEFAULT_PASSWORD ? await bcrypt.compare(DEFAULT_PASSWORD, user.password_hash) : false;

      // Check password_changed column if it exists
      let passwordChanged = true; // Default to true for backward compatibility
      try {
        const passwordChangedResult = await pool.query(
          `SELECT password_changed FROM users WHERE id = $1`,
          [user.id]
        );
        if (passwordChangedResult.rows.length > 0 && passwordChangedResult.rows[0].password_changed !== null) {
          passwordChanged = passwordChangedResult.rows[0].password_changed;
        } else {
          // If column doesn't exist or is null, check by comparing with default password
          passwordChanged = !isDefaultPassword;
        }
      } catch (e) {
        // Column might not exist yet, use password comparison
        passwordChanged = !isDefaultPassword;
      }

      // Update last login
      await pool.query(
        'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
        [user.id]
      );

      // Parse roles (support both array and single role)
      let userRoles = [];
      try {
        if (hasRolesColumn && user.roles) {
          if (Array.isArray(user.roles)) {
            userRoles = user.roles;
          } else if (typeof user.roles === 'string') {
            try {
              userRoles = JSON.parse(user.roles);
            } catch (e) {
              logger.warn('Failed to parse roles JSON, using role field', { error: e.message });
              userRoles = [user.role || 'technician']; // Fallback
            }
          }
        } else if (user.role) {
          userRoles = [user.role]; // Backward compatibility
        } else {
          userRoles = ['technician']; // Default
        }
      } catch (error) {
        logger.error('Error parsing roles', { error: error.message });
        // Fallback to role field
        userRoles = [user.role || 'technician'];
      }

      // Load RBAC permissions and roles from database
      let userPermissions = [];
      let rbacRoles = [];
      
      try {
        const { loadUserPermissions, loadUserRoles } = require('../middleware/rbac');
        userPermissions = await loadUserPermissions(user.id, pool);
        rbacRoles = await loadUserRoles(user.id, pool);
        
        // If RBAC roles exist, use them; otherwise use legacy roles
        if (rbacRoles.length > 0) {
          userRoles = rbacRoles;
        }
      } catch (rbacError) {
        logger.warn('RBAC tables may not exist yet, using legacy roles', { error: rbacError.message });
        // Continue with legacy roles
      }
      
      // Set session (store both for backward compatibility)
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.roles = userRoles; // Array of roles (new)
      req.session.role = userRoles[0] || user.role || 'technician'; // Primary role (backward compatibility)
      req.session.fullName = user.full_name;
      req.session.permissions = userPermissions; // RBAC permissions

      logger.debug('Session set', { 
        userId: req.session.userId, 
        username: req.session.username, 
        roles: req.session.roles,
        role: req.session.role, // Primary role for backward compatibility
        sessionId: req.sessionID 
      });

      // Explicitly save session to ensure cookie is set
      // This is important for session persistence
      req.session.save(async (err) => {
        if (err) {
          logger.error('Error saving session', { error: err.message });
          if (!res.headersSent) {
            return res.status(500).json({ error: 'Failed to save session' });
          }
          return;
        }

        logger.debug('Session saved successfully');

        // Single-Device-Per-Session: Check for existing active session
        // Disabled in development to allow multiple devices/tabs
        const { isDevelopment } = require('../utils/env');
        if (!isDevelopment()) {
          const existingToken = await getUserSession(user.id);
          if (existingToken) {
            console.log(`[AUTH] User ${user.id} has existing session, invalidating old session`);
            // Delete the old token from Redis
            await deleteRedisToken(existingToken);
            // Destroy the old session if it exists in the database
            // Note: We can't destroy another session, but the token is now invalid
          }
        }

        // Generate JWT token
        const jwtToken = generateToken({
          id: user.id,
          username: user.username,
          full_name: user.full_name,
          roles: userRoles,
          role: userRoles[0] || user.role,
          permissions: userPermissions
        });

        // Store JWT token in Redis (if available)
        // Extended expiration in development
        const tokenExpiration = isDevelopment() ? 604800 : 86400; // 7 days in dev, 24 hours in prod
        await storeToken(jwtToken, {
          userId: user.id,
          username: user.username,
          roles: userRoles,
          role: userRoles[0] || user.role,
          fullName: user.full_name,
          permissions: userPermissions
        }, tokenExpiration);

        // Store active session for user (single-device-per-session)
        // Only in production - disabled in development
        if (!isDevelopment()) {
          await storeUserSession(user.id, jwtToken, 86400); // 24 hours
        }

        // Load organization info for regular users (not system owners)
        let organizationInfo = null;
        const isSystemOwnerUser = userRoles.includes('system_owner') || 
                                  user.role === 'system_owner' ||
                                  userRoles.includes('super_admin') ||
                                  user.role === 'super_admin';
        
        if (!isSystemOwnerUser && user.organization_id) {
          try {
            const orgResult = await pool.query(
              `SELECT id, name, slug FROM organizations WHERE id = $1`,
              [user.organization_id]
            );
            if (orgResult.rows.length > 0) {
              organizationInfo = {
                id: orgResult.rows[0].id,
                name: orgResult.rows[0].name,
                slug: orgResult.rows[0].slug
              };
            }
          } catch (orgError) {
            logger.warn('Error loading organization info on login', { error: orgError.message });
            // Continue without organization info - not critical for login
          }
        }

        // Return user info (without password) with JWT token
        // Make sure we only send response once
        if (!res.headersSent) {
        res.json({
          message: 'Login successful',
          token: jwtToken, // JWT token for stateless authentication
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            full_name: user.full_name,
            profile_image: user.profile_image || null,
            role: userRoles[0] || user.role, // Primary role for backward compatibility
            roles: userRoles, // Array of all roles
            permissions: userPermissions, // RBAC permissions
            password_changed: passwordChanged, // Flag to indicate if password needs to be changed
            organization_id: user.organization_id || null, // Organization ID for data isolation
            organization_name: organizationInfo?.name || null, // Organization name for display
            organization_slug: organizationInfo?.slug || null // Organization slug for file paths
          },
          requires_password_change: !passwordChanged // Flag for frontend to show password change modal
        });
        } else {
          console.error('Attempted to send login response but headers already sent');
        }
      });
    } catch (error) {
      logger.error('Login error', { 
        error: error.message, 
        code: error.code, 
        stack: error.stack 
      });
      
      // Only send response if headers haven't been sent
      if (!res.headersSent) {
        // Provide more helpful error messages
        if (error.code === '42703') {
          // Column doesn't exist
          res.status(500).json({ 
            error: 'Database schema error', 
            details: 'Please run database migrations. The roles column may be missing.' 
          });
        } else if (error.code === '42P01') {
          // Table doesn't exist
          res.status(500).json({ 
            error: 'Database schema error', 
            details: 'Required database tables are missing. Please run database migrations.' 
          });
        } else {
          res.status(500).json({ 
            error: 'Login failed', 
            details: error.message 
          });
        }
      }
    }
  });

  // Logout endpoint
  router.post('/logout', async (req, res) => {
    // Delete JWT token from Redis if provided
    const { extractToken } = require('../utils/jwt');
    const token = extractToken(req);
    const userId = req.session?.userId;
    
    // Delete user session (single-device-per-session)
    if (userId) {
      await deleteUserSession(userId);
    } else if (token) {
      // Fallback: delete token directly if no userId
      await deleteRedisToken(token);
    }

    // Get the session name from the session store configuration
    const sessionName = 'sessionId'; // Matches the name set in index.js
    
    // Clear cookie first, then destroy session
    res.clearCookie(sessionName, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' && process.env.HTTPS_ENABLED === 'true',
      sameSite: 'strict',
      path: '/'
    });
    
    req.session.destroy((err) => {
      if (err) {
        console.error('Logout error:', err);
        // Don't try to send response if headers already sent
        if (!res.headersSent) {
          return res.status(500).json({ error: 'Logout failed' });
        }
        return;
      }
      // Only send response if headers haven't been sent
      if (!res.headersSent) {
        res.json({ message: 'Logout successful' });
      }
    });
  });

  // Check current session
  router.get('/me', async (req, res) => {
    try {
      if (!req.session || !req.session.userId) {
        if (!res.headersSent) {
          return res.status(401).json({ error: 'Not authenticated' });
        }
        return;
      }

      // Get fresh user data from database (with roles support if column exists)
      // Check if roles column exists first
      const columnCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'roles'
      `);
      const hasRolesColumn = columnCheck.rows.length > 0;

      let userResult;
      if (hasRolesColumn) {
        userResult = await pool.query(
          `SELECT id, username, email, full_name, role,
                  COALESCE(roles, jsonb_build_array(role)) as roles,
                  profile_image, is_active, last_login, organization_id,
                  COALESCE(password_changed, true) as password_changed
           FROM users 
           WHERE id = $1`,
          [req.session.userId]
        );
      } else {
        userResult = await pool.query(
          `SELECT id, username, email, full_name, role,
                  profile_image, is_active, last_login, organization_id,
                  COALESCE(password_changed, true) as password_changed
           FROM users 
           WHERE id = $1`,
          [req.session.userId]
        );
      }

      if (userResult.rows.length === 0) {
        req.session.destroy(() => {
          // Session destroyed, but don't send response if headers already sent
        });
        if (!res.headersSent) {
          return res.status(401).json({ error: 'User not found' });
        }
        return;
      }

      const user = userResult.rows[0];

      if (!user.is_active) {
        req.session.destroy(() => {
          // Session destroyed, but don't send response if headers already sent
        });
        if (!res.headersSent) {
          return res.status(403).json({ error: 'Account is deactivated' });
        }
        return;
      }

      // Parse roles
      let userRoles = [];
      if (hasRolesColumn && user.roles) {
        if (Array.isArray(user.roles)) {
          userRoles = user.roles;
        } else if (typeof user.roles === 'string') {
          try {
            userRoles = JSON.parse(user.roles);
          } catch (e) {
            userRoles = [user.role || 'technician'];
          }
        }
      } else if (user.role) {
        userRoles = [user.role];
      } else {
        userRoles = ['technician'];
      }

      // Load RBAC permissions and roles
      let userPermissions = [];
      let rbacRoles = [];
      
      try {
        const { loadUserPermissions, loadUserRoles } = require('../middleware/rbac');
        userPermissions = await loadUserPermissions(req.session.userId, pool);
        rbacRoles = await loadUserRoles(req.session.userId, pool);
        
        // If RBAC roles exist, use them; otherwise use legacy roles
        if (rbacRoles.length > 0) {
          userRoles = rbacRoles;
        }
      } catch (rbacError) {
        logger.warn('RBAC tables may not exist yet, using legacy roles', { error: rbacError.message });
        // Continue with legacy roles
      }

      // Get password_changed status
      const passwordChanged = user.password_changed !== false; // Default to true if null (backward compatibility)

      // Update session with fresh roles and permissions
      req.session.roles = userRoles;
      req.session.role = userRoles[0] || user.role || 'technician';
      req.session.permissions = userPermissions;

      // Load organization info for regular users (not system owners)
      // This ensures organization context persists on page refresh
      let organizationInfo = null;
      const isSystemOwnerUser = userRoles.includes('system_owner') || 
                                user.role === 'system_owner' ||
                                userRoles.includes('super_admin') ||
                                user.role === 'super_admin';
      
      if (!isSystemOwnerUser && user.organization_id) {
        try {
          const orgResult = await pool.query(
            `SELECT id, name, slug FROM organizations WHERE id = $1 AND is_active = true`,
            [user.organization_id]
          );
          if (orgResult.rows.length > 0) {
            organizationInfo = {
              id: orgResult.rows[0].id,
              name: orgResult.rows[0].name,
              slug: orgResult.rows[0].slug
            };
          }
        } catch (orgError) {
          logger.warn('Error loading organization info in /me endpoint', { error: orgError.message });
          // Continue without organization info - not critical
        }
      }

      if (!res.headersSent) {
        res.json({
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            full_name: user.full_name,
            profile_image: user.profile_image || null,
            role: userRoles[0] || user.role, // Primary role for backward compatibility
            roles: userRoles, // Array of all roles
            permissions: userPermissions, // RBAC permissions
            last_login: user.last_login,
            password_changed: passwordChanged,
            organization_id: user.organization_id || null, // Always include organization_id
            organization_name: organizationInfo?.name || null, // Include organization name if available
            organization_slug: organizationInfo?.slug || null // Include organization slug if available
          }
        });
      }
    } catch (error) {
      console.error('Session check error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Session check failed', details: error.message });
      }
    }
  });

  // Forgot password — send a 6-digit code to the user's email
  router.post('/forgot-password', async (req, res) => {
    try {
      const { email } = req.body;
      if (!email || typeof email !== 'string') {
        return res.status(400).json({ error: 'Email is required' });
      }
      const trimmed = email.trim().toLowerCase();

      const userResult = await pool.query(
        `SELECT id, email, full_name, username, is_active FROM users WHERE LOWER(email) = $1 OR LOWER(username) = $1`,
        [trimmed]
      );

      // Always respond with success to avoid leaking whether the account exists
      if (userResult.rows.length === 0 || !userResult.rows[0].is_active) {
        return res.json({ success: true, message: 'If an account with that email exists, a reset code has been sent.' });
      }

      const user = userResult.rows[0];

      // Generate a 6-digit numeric code (easy to type)
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const hashedCode = crypto.createHash('sha256').update(code).digest('hex');
      const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      await pool.query(
        `UPDATE users SET password_reset_token = $1, password_reset_expires = $2 WHERE id = $3`,
        [hashedCode, expires, user.id]
      );

      // Send the code via email
      const emailResult = await sendEmail({
        to: user.email,
        subject: 'Your Password Reset Code — SPHAiRDigital',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
            <h2 style="color:#333;margin-bottom:8px;">Password Reset</h2>
            <p>Hello ${user.full_name || user.username},</p>
            <p>You requested a password reset. Use the code below to set a new password:</p>
            <div style="text-align:center;margin:24px 0;">
              <span style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#007bff;background:#f0f4ff;padding:12px 24px;border-radius:8px;">${code}</span>
            </div>
            <p style="color:#666;font-size:13px;">This code expires in <strong>15 minutes</strong>. If you didn't request this, you can ignore this email.</p>
            <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
            <p style="color:#999;font-size:12px;text-align:center;">SPHAiRDigital &mdash; Do not share this code with anyone.</p>
          </div>
        `
      });

      if (!emailResult.success) {
        logger.warn('Failed to send password reset email', { userId: user.id, reason: emailResult.reason || emailResult.error });
      }

      res.json({ success: true, message: 'If an account with that email exists, a reset code has been sent.' });
    } catch (error) {
      logger.error('Forgot password error', { error: error.message });
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });

  // Reset password — verify the code and set a new password
  router.post('/reset-password', async (req, res) => {
    try {
      const { email, code, newPassword } = req.body;
      if (!email || !code || !newPassword) {
        return res.status(400).json({ error: 'Email, code, and new password are required' });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
      }

      const trimmedEmail = email.trim().toLowerCase();
      const hashedCode = crypto.createHash('sha256').update(String(code).trim()).digest('hex');

      const userResult = await pool.query(
        `SELECT id, password_reset_token, password_reset_expires FROM users
         WHERE (LOWER(email) = $1 OR LOWER(username) = $1) AND is_active = true`,
        [trimmedEmail]
      );

      if (userResult.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid or expired reset code' });
      }

      const user = userResult.rows[0];

      if (!user.password_reset_token || user.password_reset_token !== hashedCode) {
        return res.status(400).json({ error: 'Invalid or expired reset code' });
      }

      if (!user.password_reset_expires || new Date(user.password_reset_expires) < new Date()) {
        return res.status(400).json({ error: 'Reset code has expired. Please request a new one.' });
      }

      const newHash = await bcrypt.hash(newPassword, 10);

      await pool.query(
        `UPDATE users
         SET password_hash = $1, password_changed = true, password_reset_token = NULL, password_reset_expires = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [newHash, user.id]
      );

      res.json({ success: true, message: 'Password reset successfully. You can now sign in.' });
    } catch (error) {
      logger.error('Reset password error', { error: error.message });
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });

  // Change password (for authenticated users)
  router.post('/change-password', validateChangePassword, async (req, res) => {
    try {
      if (!req.session || !req.session.userId) {
        if (!res.headersSent) {
          return res.status(401).json({ error: 'Authentication required' });
        }
        return;
      }

      const { currentPassword, newPassword } = req.body;

      // Validation is handled by validateChangePassword middleware
      // But keep these checks as fallback
      if (!currentPassword || !newPassword) {
        if (!res.headersSent) {
          return res.status(400).json({ error: 'Current password and new password are required' });
        }
        return;
      }

      if (newPassword.length < 6) {
        if (!res.headersSent) {
          return res.status(400).json({ error: 'New password must be at least 6 characters long' });
        }
        return;
      }

      // Get user's current password hash
      const userResult = await pool.query(
        'SELECT password_hash FROM users WHERE id = $1',
        [req.session.userId]
      );

      if (userResult.rows.length === 0) {
        if (!res.headersSent) {
          return res.status(404).json({ error: 'User not found' });
        }
        return;
      }

      const user = userResult.rows[0];

      // Verify current password
      if (user.password_hash) {
        const passwordMatch = await bcrypt.compare(currentPassword, user.password_hash);
        if (!passwordMatch) {
          if (!res.headersSent) {
            return res.status(401).json({ error: 'Current password is incorrect' });
          }
          return;
        }
      }

      // Hash new password
      const saltRounds = 10;
      const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

      // Update password and set password_changed flag to true
      await pool.query(
        `UPDATE users 
         SET password_hash = $1, 
             password_changed = true, 
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2`,
        [newPasswordHash, req.session.userId]
      );

      // Update session to reflect password change
      if (req.session) {
        req.session.passwordChanged = true;
      }

      if (!res.headersSent) {
        res.json({ 
          message: 'Password changed successfully',
          password_changed: true
        });
      }
    } catch (error) {
      console.error('Change password error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to change password', details: error.message });
      }
    }
  });

  return router;
};

