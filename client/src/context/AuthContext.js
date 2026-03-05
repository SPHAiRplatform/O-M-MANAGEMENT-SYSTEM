import React, { createContext, useState, useEffect, useContext } from 'react';
import { getCurrentUser, login as apiLogin, logout as apiLogout, setAuthToken } from '../api/api';
import { getErrorMessage } from '../utils/errorHandler';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if user is already logged in
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const response = await getCurrentUser();
      setUser(response.data.user);
    } catch (error) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const login = async (username, password, rememberMe = false) => {
    try {
      console.log('Attempting login with:', { username, rememberMe });
      const response = await apiLogin(username, password, rememberMe);
      console.log('Login response:', response.data);
      
      if (response.data && response.data.user) {
        if (response.data.token) {
          setAuthToken(response.data.token);
        }
        const userData = {
          ...response.data.user,
          permissions: response.data.user.permissions || []
        };
        setUser(userData);
        return { 
          success: true, 
          user: userData,
          requires_password_change: response.data.requires_password_change || false
        };
      } else {
        console.error('Unexpected login response format:', response.data);
        return { 
          success: false, 
          error: 'Unexpected response from server' 
        };
      }
    } catch (error) {
      console.error('Login error:', error);
      console.error('Error response:', error.response?.data);
      
      // Handle ACCESS RESTRICTED error with admin email
      if (error.response?.status === 403 && error.response?.data?.error === 'ACCESS RESTRICTED') {
        return {
          success: false,
          error: 'ACCESS RESTRICTED',
          admin_email: error.response.data.admin_email || 'the administrator',
          message: error.response.data.message
        };
      }
      
      // Use error handler utility for consistent error extraction
      const { getErrorMessage } = require('../utils/errorHandler');
      
      return { 
        success: false, 
        error: getErrorMessage(error, 'Incorrect password'),
        admin_email: error.response?.data?.admin_email
      };
    }
  };

  const logout = async () => {
    try {
      await apiLogout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setAuthToken(null);
      setUser(null);
    }
  };

  // Support both single role (backward compatibility) and multiple roles
  const getUserRoles = () => {
    if (!user) return [];
    if (user.roles && Array.isArray(user.roles)) {
      return user.roles;
    }
    if (user.role) {
      return [user.role];
    }
    return [];
  };

  // Helper function to normalize role codes (maps legacy to RBAC)
  const normalizeRole = (role) => {
    const roleMapping = {
      'super_admin': 'system_owner',
      'admin': 'operations_admin',
      'supervisor': 'supervisor',
      'technician': 'technician'
    };
    return roleMapping[role] || role;
  };

  const hasRole = (role) => {
    const userRoles = getUserRoles();
    const normalizedRole = normalizeRole(role);
    
    // Check if user has the role (either exact match or normalized)
    return userRoles.some(userRole => {
      const normalizedUserRole = normalizeRole(userRole);
      return normalizedUserRole === normalizedRole || userRole === role;
    });
  };

  const hasAnyRole = (...roles) => {
    const userRoles = getUserRoles();
    const normalizedRoles = roles.map(normalizeRole);
    
    return userRoles.some(userRole => {
      const normalizedUserRole = normalizeRole(userRole);
      return normalizedRoles.includes(normalizedUserRole) || roles.includes(userRole);
    });
  };

  // isAdmin: checks for admin, super_admin, operations_admin, or system_owner
  const isAdmin = () => hasAnyRole('admin', 'super_admin', 'operations_admin', 'system_owner');
  
  // isSuperAdmin: checks for super_admin or system_owner
  const isSuperAdmin = () => hasAnyRole('super_admin', 'system_owner');
  
  // isSupervisor: checks for admin, super_admin, operations_admin, system_owner, or supervisor
  const isSupervisor = () => hasAnyRole('admin', 'super_admin', 'operations_admin', 'system_owner', 'supervisor');
  
  const isTechnician = () => hasRole('technician');
  const isAuthenticated = () => !!user;

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      login,
      logout,
      checkAuth,
      isAdmin,
      isSuperAdmin,
      isSupervisor,
      isTechnician,
      hasRole,
      hasAnyRole,
      getUserRoles,
      isAuthenticated
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

