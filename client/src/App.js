import React, { useState, useEffect } from 'react';
import { getApiBaseUrl } from './api/api';
import { BrowserRouter as Router, Routes, Route, Link, useLocation, useNavigate, Navigate, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { getUnreadNotificationCount, getCurrentOrganizationBranding } from './api/api';
import Dashboard from './components/Dashboard';
import Tasks from './components/Tasks';
import Inspection from './components/Inspection';
import TaskDetail from './components/TaskDetail';
import ChecklistForm from './components/ChecklistForm';
import CMLetters from './components/CMLetters';
import ChecklistTemplates from './components/ChecklistTemplates';
import Inventory from './components/Inventory';
import Login from './components/Login';
import UserManagement from './components/UserManagement';
import Profile from './components/Profile';
// LicenseManagement removed - no longer needed
// import LicenseManagement from './components/LicenseManagement';
import Notifications from './components/Notifications';
import Calendar from './components/Calendar';
import Plant from './components/Plant';
import OrganizationManagement from './components/OrganizationManagement';
import OrganizationSettings from './components/OrganizationSettings';
import OrganizationBranding from './components/OrganizationBranding';
import PlatformDashboard from './components/PlatformDashboard';
import PlatformUsers from './components/PlatformUsers';
import PlatformAnalytics from './components/PlatformAnalytics';
import ScadaConfig from './components/ScadaConfig';
import ScadaDashboard from './components/ScadaDashboard';
import AuditLog from './components/AuditLog';
import PlatformSettings from './components/PlatformSettings';
import ProtectedRoute from './components/ProtectedRoute';
import PasswordChangeModal from './components/PasswordChangeModal';
// LicenseStatus removed - no longer needed
// import LicenseStatus from './components/LicenseStatus';
import OfflineIndicator from './components/OfflineIndicator';
import InactivityWarningModal from './components/InactivityWarningModal';
import FeedbackWidget from './components/FeedbackWidget';
import { useInactivityTimeout } from './hooks/useInactivityTimeout';
import { usePageTitle } from './hooks/usePageTitle';
import { OrganizationFeaturesProvider, useOrganizationFeatures } from './context/OrganizationFeaturesContext';
import FeatureGate from './components/FeatureGate';
import syncManager from './utils/syncManager';
import { loadAndApplyCompanyColors, resetCompanyColors } from './utils/companyColors';
import './App.css';

// Helper component for redirects with route parameters
function ParamRedirect({ to }) {
  const params = useParams();
  let path = to;
  for (const [key, value] of Object.entries(params)) {
    path = path.replace(`:${key}`, value);
  }
  // Handle splat/wildcard params
  if (params['*']) {
    path = path.replace('*', params['*']);
  }
  return <Navigate to={path} replace />;
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <OrganizationFeaturesProvider>
          <div className="App">
            <AppContent />
          </div>
        </OrganizationFeaturesProvider>
      </Router>
    </AuthProvider>
  );
}

// Redirect component for default route
// System owners go to platform dashboard, others go to tenant dashboard
function DefaultRouteRedirect() {
  const { isSuperAdmin } = useAuth();
  const navigate = useNavigate();
  
  useEffect(() => {
    if (isSuperAdmin()) {
      navigate('/platform/dashboard', { replace: true });
    } else {
      navigate('/tenant/dashboard', { replace: true });
    }
  }, [isSuperAdmin, navigate]);
  
  return <div className="loading">Redirecting...</div>;
}

function AppContent() {
  // Set page title dynamically based on organization
  usePageTitle();
  const { user, checkAuth } = useAuth();
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  
  // Initialize inactivity timeout detection
  const { showWarning, timeRemaining, extendSession, trackApiActivity } = useInactivityTimeout();
  
  // Expose trackApiActivity globally for API interceptor
  useEffect(() => {
    window.trackApiActivity = trackApiActivity;
    return () => {
      delete window.trackApiActivity;
    };
  }, [trackApiActivity]);

  // Check if user needs to change password on mount or when user changes
  useEffect(() => {
    if (user && user.password_changed === false) {
      setShowPasswordModal(true);
    }
  }, [user]);

  // Initialize offline sync when app loads
  useEffect(() => {
    if (user) {
      // Start auto-sync every 30 seconds
      syncManager.startAutoSync(30000);
      
      return () => {
        syncManager.stopAutoSync();
      };
    }
  }, [user]);

  // Load and apply company colors when user logs in or organization changes
  useEffect(() => {
    if (user) {
      loadAndApplyCompanyColors().catch(error => {
        console.error('Failed to load company colors:', error);
      });
    } else {
      // Reset to defaults when logged out
      resetCompanyColors();
    }
  }, [user]);
  
  // Also reload colors when organization selection changes (for system owners)
  useEffect(() => {
    if (user) {
      const handleStorageChange = () => {
        loadAndApplyCompanyColors().catch(error => {
          console.error('Failed to reload company colors:', error);
        });
      };
      
      // Listen for organization selection changes
      window.addEventListener('storage', handleStorageChange);
      // Also check sessionStorage changes (same origin)
      const checkInterval = setInterval(() => {
        const currentOrg = sessionStorage.getItem('selectedOrganizationId');
        if (currentOrg !== (window._lastOrgId || null)) {
          window._lastOrgId = currentOrg;
          handleStorageChange();
        }
      }, 1000);
      
      return () => {
        window.removeEventListener('storage', handleStorageChange);
        clearInterval(checkInterval);
      };
    }
  }, [user]);

  const handlePasswordChangeSuccess = async () => {
    // Refresh user data to update password_changed flag
    try {
      await checkAuth();
      setShowPasswordModal(false);
    } catch (error) {
      console.error('Error refreshing user data:', error);
      window.location.reload();
    }
  };

  // Make modal non-dismissible - user must change password
  const handleModalClose = () => {
    // Do nothing - modal cannot be closed until password is changed
  };

  return (
    <>
      <OfflineIndicator />
      {!showPasswordModal && <Header />}
      {/* LicenseStatus removed - no longer needed */}
      {/* {!showPasswordModal && <LicenseStatus />} */}
      <PasswordChangeModal
        isOpen={showPasswordModal}
        onClose={handleModalClose}
        onSuccess={handlePasswordChangeSuccess}
      />
      <InactivityWarningModal
        show={showWarning && !showPasswordModal}
        timeRemaining={timeRemaining}
        onExtendSession={extendSession}
      />
      {user && !showPasswordModal && <FeedbackWidget />}
      <div className="container">
        <Routes>
          <Route path="/login" element={<Login />} />
          
          {/* Platform Routes - System Owners Only */}
          <Route 
            path="/platform/dashboard" 
            element={
              <ProtectedRoute requireRole="system_owner">
                <PlatformDashboard />
              </ProtectedRoute>
            } 
          />
          
          {/* Platform Organization Management Routes */}
          <Route 
            path="/platform/organizations" 
            element={
              <ProtectedRoute requireRole="system_owner">
                <OrganizationManagement />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/platform/organizations/:id/settings" 
            element={
              <ProtectedRoute requireRole="system_owner">
                <OrganizationSettings />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/platform/organizations/:id/branding" 
            element={
              <ProtectedRoute requireRole="system_owner">
                <OrganizationBranding />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/platform/users" 
            element={
              <ProtectedRoute requireRole="system_owner">
                <PlatformUsers />
              </ProtectedRoute>
            } 
          />
          <Route
            path="/platform/analytics"
            element={
              <ProtectedRoute requireRole="system_owner">
                <PlatformAnalytics />
              </ProtectedRoute>
            }
          />
          <Route
            path="/platform/scada"
            element={
              <ProtectedRoute requireRole="system_owner">
                <ScadaConfig />
              </ProtectedRoute>
            }
          />
          <Route
            path="/platform/audit-log"
            element={
              <ProtectedRoute requireRole="system_owner">
                <AuditLog />
              </ProtectedRoute>
            }
          />
          <Route
            path="/platform/settings"
            element={
              <ProtectedRoute requireRole="system_owner">
                <PlatformSettings />
              </ProtectedRoute>
            }
          />

          {/* Default route - redirects system owners to platform dashboard, others to tenant dashboard */}
          <Route 
            path="/" 
            element={
              <ProtectedRoute>
                <DefaultRouteRedirect />
              </ProtectedRoute>
            } 
          />
          
          {/* Tenant Routes - Company-Specific Operations */}
          <Route 
            path="/tenant/dashboard" 
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/tenant/tasks/pm" 
            element={
              <ProtectedRoute>
                <Tasks />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/tenant/tasks/inspection" 
            element={
              <ProtectedRoute>
                <Inspection />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/tenant/tasks" 
            element={
              <ProtectedRoute>
                <Tasks />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/tenant/tasks/:id" 
            element={
              <ProtectedRoute>
                <TaskDetail />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/tenant/tasks/:id/checklist" 
            element={
              <ProtectedRoute>
                <ChecklistForm />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/tenant/checklist-templates" 
            element={
              <ProtectedRoute requireRole="system_owner">
                <FeatureGate feature="templates">
                  <ChecklistTemplates />
                </FeatureGate>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/tenant/cm-letters" 
            element={
              <ProtectedRoute>
                <FeatureGate feature="cm_letters">
                  <CMLetters />
                </FeatureGate>
              </ProtectedRoute>
            } 
          />
          <Route
            path="/tenant/inventory"
            element={
              <ProtectedRoute>
                <FeatureGate feature="inventory">
                  <Inventory />
                </FeatureGate>
              </ProtectedRoute>
            }
          />
          <Route 
            path="/tenant/users" 
            element={
              <ProtectedRoute requireAdmin={true}>
                <FeatureGate feature="users">
                  <UserManagement />
                </FeatureGate>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/tenant/profile" 
            element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/tenant/notifications" 
            element={
              <ProtectedRoute>
                <Notifications />
              </ProtectedRoute>
            } 
          />
          {/* Audit Log route — platform only (see /platform/audit-log) */}
          <Route 
            path="/tenant/calendar" 
            element={
              <ProtectedRoute>
                <FeatureGate feature="calendar">
                  <Calendar />
                </FeatureGate>
              </ProtectedRoute>
            } 
          />
          {/* License route removed - no longer needed */}
          {/* <Route 
            path="/tenant/license" 
            element={
              <ProtectedRoute requireAdmin={true}>
                <LicenseManagement />
              </ProtectedRoute>
            } 
          /> */}
          <Route
            path="/tenant/plant"
            element={
              <ProtectedRoute>
                <FeatureGate feature="plant">
                  <Plant />
                </FeatureGate>
              </ProtectedRoute>
            }
          />
          <Route
            path="/tenant/scada"
            element={
              <ProtectedRoute>
                <FeatureGate feature="scada">
                  <ScadaDashboard />
                </FeatureGate>
              </ProtectedRoute>
            }
          />

          {/* Backward compatibility: Redirect old routes to tenant routes */}
          <Route path="/dashboard" element={<Navigate to="/tenant/dashboard" replace />} />
          <Route path="/tasks/pm" element={<Navigate to="/tenant/tasks/pm" replace />} />
          <Route path="/tasks/inspection" element={<Navigate to="/tenant/tasks/inspection" replace />} />
          <Route path="/tasks" element={<Navigate to="/tenant/tasks" replace />} />
          <Route path="/tasks/:id" element={<ParamRedirect to="/tenant/tasks/:id" />} />
          <Route path="/tasks/:id/checklist" element={<ParamRedirect to="/tenant/tasks/:id/checklist" />} />
          <Route path="/checklist-templates" element={<Navigate to="/tenant/checklist-templates" replace />} />
          <Route path="/cm-letters" element={<Navigate to="/tenant/cm-letters" replace />} />
          <Route path="/inventory" element={<Navigate to="/tenant/inventory" replace />} />
          <Route path="/users" element={<Navigate to="/tenant/users" replace />} />
          <Route path="/profile" element={<Navigate to="/tenant/profile" replace />} />
          <Route path="/notifications" element={<Navigate to="/tenant/notifications" replace />} />
          <Route path="/calendar" element={<Navigate to="/tenant/calendar" replace />} />
          <Route path="/license" element={<Navigate to="/tenant/license" replace />} />
          <Route path="/plant" element={<Navigate to="/tenant/plant" replace />} />
          
          {/* Backward compatibility: Redirect old organization routes to platform routes */}
          <Route path="/organizations" element={<Navigate to="/platform/organizations" replace />} />
          <Route path="/organizations/:id/settings" element={<ParamRedirect to="/platform/organizations/:id/settings" />} />
          <Route path="/organizations/:id/branding" element={<ParamRedirect to="/platform/organizations/:id/branding" />} />
        </Routes>
      </div>
    </>
  );
}

function NotificationBadge() {
  const [unreadCount, setUnreadCount] = useState(0);
  const location = useLocation();
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    loadCount();
    const interval = setInterval(loadCount, 30000);
    return () => clearInterval(interval);
  }, [user]);

  const loadCount = async () => {
    try {
      const response = await getUnreadNotificationCount();
      setUnreadCount(response.data.count);
    } catch (error) {
      // Silently ignore - user may have logged out between interval ticks
    }
  };

  return (
    <Link 
      to="/tenant/notifications" 
      className={location.pathname === '/tenant/notifications' ? 'active' : ''}
      style={{ position: 'relative', display: 'inline-block' }}
    >
      Notifications
      {unreadCount > 0 && (
        <span style={{
          position: 'absolute',
          top: '-8px',
          right: '-8px',
          background: '#dc3545',
          color: 'white',
          borderRadius: '50%',
          width: '20px',
          height: '20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '11px',
          fontWeight: 'bold'
        }}>
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </Link>
  );
}

function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, isAdmin, isSuperAdmin, isTechnician, hasRole } = useAuth();
  const { hasFeature } = useOrganizationFeatures();
  const [tasksDropdownOpen, setTasksDropdownOpen] = useState(false);
  const [tasksDropdownTimeout, setTasksDropdownTimeout] = useState(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [selectedOrgName, setSelectedOrgName] = useState(null);
  const [userOrgName, setUserOrgName] = useState(null);
  const [orgList, setOrgList] = useState([]);
  const [orgSwitcherOpen, setOrgSwitcherOpen] = useState(false);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);

  // Load unread notification count (so mobile users see badge next to name before opening menu)
  useEffect(() => {
    if (!user) return;
    const loadUnreadCount = async () => {
      try {
        const response = await getUnreadNotificationCount();
        setUnreadNotificationCount(response.data?.count ?? 0);
      } catch (e) {
        // ignore
      }
    };
    loadUnreadCount();
    const interval = setInterval(loadUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [user]);

  // Helper function to get company abbreviation
  const getCompanyAbbreviation = (name) => {
    if (!name) return '';
    const words = name.split(' ');
    if (words.length === 1) {
      return name.substring(0, 3).toUpperCase();
    }
    return words.map(word => word.charAt(0).toUpperCase()).join('').substring(0, 5);
  };

  // Load selected organization name from sessionStorage (for system owners)
  useEffect(() => {
    const orgName = sessionStorage.getItem('selectedOrganizationName');
    setSelectedOrgName(orgName);
  }, [location.pathname]);

  // Load user's organization name and branding (for regular users)
  useEffect(() => {
    const loadUserOrganization = async () => {
      if (!user || isSuperAdmin()) return; // Skip for system owners
      
      try {
        // Try to get organization name from user object first (set during login)
        if (user.organization_name) {
          setUserOrgName(user.organization_name);
          return;
        }
        
        // If not in user object, try to get from branding API (has company_name_display)
        if (user.organization_id) {
          try {
            const brandingResponse = await fetch(`${getApiBaseUrl()}/organizations/current/branding`, {
              credentials: 'include'
            });
            if (brandingResponse.ok) {
              const branding = await brandingResponse.json();
              if (branding?.company_name_display) {
                // Extract organization name from "SIE O&M System" format
                const displayName = branding.company_name_display.trim();
                if (displayName.includes(' O&M System')) {
                  const orgName = displayName.split(' O&M System')[0].trim();
                  // If it's just the abbreviation (like "SIE"), fetch full name
                  if (orgName.length <= 5 && orgName === orgName.toUpperCase()) {
                    // It's an abbreviation, fetch full organization name
                    const orgResponse = await fetch(`${getApiBaseUrl()}/organizations/${user.organization_id}`, {
                      credentials: 'include'
                    });
                    if (orgResponse.ok) {
                      const org = await orgResponse.json();
                      setUserOrgName(org.name);
                      return;
                    }
                  } else {
                    // It's the full name, use it
                    setUserOrgName(orgName);
                    return;
                  }
                }
              }
            }
          } catch (brandingError) {
            console.warn('Error loading branding, falling back to organization API:', brandingError);
          }
          
          // Fallback: fetch organization name from API
          const response = await fetch(`${getApiBaseUrl()}/organizations/${user.organization_id}`, {
            credentials: 'include'
          });
          if (response.ok) {
            const org = await response.json();
            setUserOrgName(org.name);
          }
        }
      } catch (error) {
        console.error('Error loading user organization:', error);
      }
    };
    
    loadUserOrganization();
  }, [user, isSuperAdmin]);

  // Close org switcher when clicking outside
  useEffect(() => {
    if (!orgSwitcherOpen) return;
    const handleClick = () => setOrgSwitcherOpen(false);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [orgSwitcherOpen]);

  // Load organizations for system_owner org-switcher
  // Re-fetch whenever navigating (e.g. after deleting an org on the platform page)
  useEffect(() => {
    if (user && isSuperAdmin()) {
      const loadOrgs = async () => {
        try {
          const response = await fetch(`${getApiBaseUrl()}/platform/organizations`, { credentials: 'include' });
          if (response.ok) {
            const data = await response.json();
            setOrgList((data || []).filter(o => o.is_active !== false));
          }
        } catch (err) {
          console.error('Error loading organizations for switcher:', err);
        }
      };
      loadOrgs();
    }
  }, [user, isSuperAdmin, location.pathname]);

  const handleSwitchOrg = (org) => {
    // Set session storage and navigate instantly
    sessionStorage.setItem('selectedOrganizationId', org.id);
    sessionStorage.setItem('selectedOrganizationSlug', org.slug);
    sessionStorage.setItem('selectedOrganizationName', org.name);
    setSelectedOrgName(org.name);
    setOrgSwitcherOpen(false);
    navigate('/tenant/dashboard');

    // Fire the API call in the background (sets server-side session)
    fetch(`${getApiBaseUrl()}/organizations/${org.id}/enter`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    }).catch(err => console.error('Error setting org session:', err));
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleExitCompany = async () => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/organizations/exit`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to exit company');
      }

      // Clear sessionStorage
      sessionStorage.removeItem('selectedOrganizationId');
      sessionStorage.removeItem('selectedOrganizationSlug');
      sessionStorage.removeItem('selectedOrganizationName');
      
      // Navigate back to platform dashboard
      navigate('/platform/dashboard');
    } catch (error) {
      console.error('Error exiting company:', error);
      // Still navigate even if API call fails
      sessionStorage.removeItem('selectedOrganizationId');
      sessionStorage.removeItem('selectedOrganizationSlug');
      sessionStorage.removeItem('selectedOrganizationName');
      navigate('/platform/dashboard');
    }
  };

  // Check if we're in tenant mode (system owner in a company)
  const isInTenantMode = isSuperAdmin() && 
                         location.pathname.startsWith('/tenant/') && 
                         selectedOrgName;

  // Determine which organization name to display
  const displayOrgName = isInTenantMode ? selectedOrgName : userOrgName;
  const companyAbbreviation = displayOrgName ? getCompanyAbbreviation(displayOrgName) : null;
  const isInTenantRoute = location.pathname.startsWith('/tenant/');

  if (!user) {
    return null; // Don't show header on login page
  }

  const isTasksActive = location.pathname.startsWith('/tenant/tasks') || location.pathname.startsWith('/tasks');

  return (
    <div className="header">
      <div className="header-top">
        <Link
          to={isInTenantRoute ? '/tenant/dashboard' : '/platform/dashboard'}
          className="header-title-link"
          aria-label="Go to dashboard"
        >
          <h1>
            {isInTenantRoute && companyAbbreviation ? (
              `${companyAbbreviation} O&M System`
            ) : (
              'O&M System'
            )}
          </h1>
        </Link>
        <div className="header-user">
          {isSuperAdmin() && isInTenantMode && orgList.length > 1 && (
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <button
                className="btn btn-sm btn-secondary"
                onClick={(e) => { e.stopPropagation(); setOrgSwitcherOpen(!orgSwitcherOpen); }}
                style={{ marginRight: '4px', fontSize: '11px', padding: '4px 10px' }}
                title="Switch company"
              >
                Switch
              </button>
              {orgSwitcherOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    background: '#fff',
                    border: '1px solid #ddd',
                    borderRadius: '6px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    zIndex: 1100,
                    minWidth: '200px',
                    maxHeight: '250px',
                    overflowY: 'auto',
                    marginTop: '4px'
                  }}
                >
                  {orgList.map(org => (
                    <div
                      key={org.id}
                      onClick={() => handleSwitchOrg(org)}
                      style={{
                        padding: '10px 14px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        color: '#333',
                        borderBottom: '1px solid #f0f0f0',
                        background: sessionStorage.getItem('selectedOrganizationId') === org.id ? '#e3f2fd' : 'transparent',
                        fontWeight: sessionStorage.getItem('selectedOrganizationId') === org.id ? '600' : '400'
                      }}
                      onMouseEnter={(e) => e.target.style.background = '#f5f5f5'}
                      onMouseLeave={(e) => e.target.style.background = sessionStorage.getItem('selectedOrganizationId') === org.id ? '#e3f2fd' : 'transparent'}
                    >
                      {org.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {isInTenantMode && (
            <button
              className="btn btn-sm btn-secondary"
              onClick={handleExitCompany}
              style={{ marginRight: '10px' }}
              title={`Exit ${selectedOrgName}`}
            >
              Exit
            </button>
          )}
          <span className="user-name-with-badge">
            <Link to="/tenant/notifications" className="user-name" title="Notifications">
              {(() => {
                const full = (user.full_name || user.username || '').trim();
                const firstName = full ? full.split(/\s+/)[0] : full;
                return firstName || 'User';
              })()}
            </Link>
            {unreadNotificationCount > 0 && location.pathname !== '/tenant/notifications' && (
              <span className="header-notification-badge" title={`${unreadNotificationCount} unread notification${unreadNotificationCount !== 1 ? 's' : ''}`}>
                {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
              </span>
            )}
          </span>
          <button className="btn btn-sm btn-secondary header-logout" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>
      <button
        className="hamburger-btn"
        onClick={() => setMobileNavOpen(!mobileNavOpen)}
        aria-label="Toggle navigation"
      >
        <span className={`hamburger-icon ${mobileNavOpen ? 'open' : ''}`}>
          <span></span>
          <span></span>
          <span></span>
        </span>
      </button>
      <nav className={`nav ${mobileNavOpen ? 'nav-open' : ''}`} onClick={(e) => { if (e.target.tagName === 'A') setMobileNavOpen(false); }}>
        {/* Platform Dashboard link for system owners */}
        {isSuperAdmin() && (
          <Link 
            to="/platform/dashboard" 
            className={location.pathname === '/platform/dashboard' ? 'active' : ''}
          >
            Platform Dashboard
          </Link>
        )}
        {/* Tenant Dashboard link */}
        <Link 
          to="/tenant/dashboard" 
          className={location.pathname === '/tenant/dashboard' ? 'active' : ''}
        >
          Dashboard
        </Link>
        <div 
          className="nav-dropdown"
          onMouseEnter={() => {
            if (tasksDropdownTimeout) {
              clearTimeout(tasksDropdownTimeout);
              setTasksDropdownTimeout(null);
            }
            setTasksDropdownOpen(true);
          }}
          onMouseLeave={() => {
            const timeout = setTimeout(() => {
              setTasksDropdownOpen(false);
            }, 150); // Small delay to allow moving to dropdown
            setTasksDropdownTimeout(timeout);
          }}
          style={{ position: 'relative', display: 'inline-block' }}
        >
          <Link 
            to="/tenant/tasks/pm" 
            className={isTasksActive ? 'active' : ''}
            style={{ display: 'inline-block' }}
          >
            Tasks
          </Link>
          {tasksDropdownOpen && (
            <div 
              className="nav-dropdown-menu" 
              onMouseEnter={() => {
                if (tasksDropdownTimeout) {
                  clearTimeout(tasksDropdownTimeout);
                  setTasksDropdownTimeout(null);
                }
                setTasksDropdownOpen(true);
              }}
              onMouseLeave={() => {
                const timeout = setTimeout(() => {
                  setTasksDropdownOpen(false);
                }, 150);
                setTasksDropdownTimeout(timeout);
              }}
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                backgroundColor: '#fff',
                border: '1px solid #ddd',
                borderRadius: '4px',
                boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                zIndex: 1000,
                minWidth: '150px',
                marginTop: '-2px', // Small overlap to prevent gap
                paddingTop: '6px'
              }}
            >
              <Link 
                to="/tenant/tasks/pm" 
                className={location.pathname === '/tenant/tasks/pm' || (location.pathname === '/tenant/tasks' && !location.pathname.includes('/inspection')) ? 'active' : ''}
                style={{
                  display: 'block',
                  padding: '10px 16px',
                  color: '#333',
                  textDecoration: 'none',
                  borderBottom: '1px solid #eee',
                  transition: 'background-color 0.2s ease'
                }}
                onMouseEnter={(e) => e.target.style.backgroundColor = '#f5f5f5'}
                onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
              >
                PM
              </Link>
              <Link 
                to="/tenant/tasks/inspection" 
                className={location.pathname === '/tenant/tasks/inspection' ? 'active' : ''}
                style={{
                  display: 'block',
                  padding: '10px 16px',
                  color: '#333',
                  textDecoration: 'none',
                  transition: 'background-color 0.2s ease'
                }}
                onMouseEnter={(e) => e.target.style.backgroundColor = '#f5f5f5'}
                onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
              >
                Inspection
              </Link>
            </div>
          )}
        </div>
        {(() => {
          // Hide Templates for GENERAL_WORKER, TECHNICIAN, Inventory Controller, and SUPERVISOR; also gate by feature
          const canViewTemplates = hasFeature('templates') && !hasRole('general_worker') && 
                                   !hasRole('technician') && 
                                   !hasRole('inventory_controller') && 
                                   !hasRole('supervisor');
          return canViewTemplates && isSuperAdmin() && (
            <Link to="/tenant/checklist-templates" className={location.pathname === '/tenant/checklist-templates' ? 'active' : ''}>
              Templates
            </Link>
          );
        })()}
        {hasFeature('cm_letters') && (
          <Link to="/tenant/cm-letters" className={location.pathname === '/tenant/cm-letters' ? 'active' : ''}>
            CM Letters
          </Link>
        )}
        {hasFeature('inventory') && (
          <Link to="/tenant/inventory" className={location.pathname === '/tenant/inventory' ? 'active' : ''}>
            Inventory
          </Link>
        )}
        {hasFeature('calendar') && (
          <Link to="/tenant/calendar" className={location.pathname === '/tenant/calendar' ? 'active' : ''}>
            Calendar
          </Link>
        )}
        {hasFeature('plant') && (
          <Link to="/tenant/plant" className={location.pathname === '/tenant/plant' ? 'active' : ''}>
            Plant
          </Link>
        )}
        {hasFeature('scada') && (
          <Link to="/tenant/scada" className={location.pathname === '/tenant/scada' ? 'active' : ''}>
            SCADA
          </Link>
        )}
        {isAdmin() && hasFeature('users') && (
          <Link to="/tenant/users" className={location.pathname === '/tenant/users' ? 'active' : ''}>
            Users
          </Link>
        )}
        {/* Audit Log moved to platform sidebar — accessible only for system_owner */}
        {/* License link removed - no longer needed */}
        {/* {isAdmin() && (
          <Link to="/tenant/license" className={location.pathname === '/tenant/license' ? 'active' : ''}>
            License
          </Link>
        )} */}
        {isSuperAdmin() && (
          <>
            <Link to="/platform/organizations" className={location.pathname.startsWith('/platform/organizations') ? 'active' : ''}>
              Organizations
            </Link>
            <Link to="/platform/users" className={location.pathname === '/platform/users' ? 'active' : ''}>
              Platform Users
            </Link>
            <Link to="/platform/analytics" className={location.pathname === '/platform/analytics' ? 'active' : ''}>
              Analytics
            </Link>
            <Link to="/platform/scada" className={location.pathname === '/platform/scada' ? 'active' : ''}>
              SCADA
            </Link>
            <Link to="/platform/audit-log" className={location.pathname === '/platform/audit-log' ? 'active' : ''}>
              Audit Log
            </Link>
            <Link to="/platform/settings" className={location.pathname === '/platform/settings' ? 'active' : ''}>
              Settings
            </Link>
          </>
        )}
        <NotificationBadge />
        <Link to="/tenant/profile" className={location.pathname === '/tenant/profile' ? 'active' : ''}>
          Profile
        </Link>
      </nav>
    </div>
  );
}

export default App;

;