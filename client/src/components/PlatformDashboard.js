import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getApiBaseUrl, authFetch } from '../api/api';
import { getErrorMessage } from '../utils/errorHandler';
import './PlatformDashboard.css';

function PlatformDashboard() {
  const navigate = useNavigate();
  const { isSuperAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stats, setStats] = useState({
    totalOrganizations: 0,
    activeOrganizations: 0,
    inactiveOrganizations: 0,
    totalUsers: 0,
    totalAssets: 0,
    totalTasks: 0,
  });
  const [organizations, setOrganizations] = useState([]);
  const [health, setHealth] = useState(null);
  const [activities, setActivities] = useState([]);

  const loadPlatformData = useCallback(async () => {
    try {
      setError('');

      const [statsResponse, orgsResponse, healthResponse, activityResponse] = await Promise.all([
        authFetch(`${getApiBaseUrl()}/platform/stats`),
        authFetch(`${getApiBaseUrl()}/platform/organizations`),
        authFetch(`${getApiBaseUrl()}/platform/health`).catch(() => null),
        authFetch(`${getApiBaseUrl()}/platform/activity?limit=10`).catch(() => null)
      ]);

      if (!statsResponse.ok || !orgsResponse.ok) {
        throw new Error('Failed to load platform data');
      }

      const statsData = await statsResponse.json();
      const orgsData = await orgsResponse.json();
      const healthData = healthResponse?.ok ? await healthResponse.json() : null;
      const activityData = activityResponse?.ok ? await activityResponse.json() : [];

      setOrganizations(orgsData);
      setStats(statsData);
      setHealth(healthData);
      setActivities(activityData);
      setLoading(false);
    } catch (error) {
      console.error('Error loading platform data:', error);
      setError('Failed to load platform data: ' + getErrorMessage(error));
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isSuperAdmin()) {
      setError('Access denied. System owner privileges required.');
      setLoading(false);
      return;
    }
    loadPlatformData();

    const refreshInterval = setInterval(() => {
      loadPlatformData();
    }, 30000);

    return () => clearInterval(refreshInterval);
  }, [isSuperAdmin, loadPlatformData]);

  const handleEnterCompany = async (organizationId, organizationSlug) => {
    try {
      const response = await authFetch(`${getApiBaseUrl()}/organizations/${organizationId}/enter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to enter company');
      }

      const data = await response.json();
      sessionStorage.setItem('selectedOrganizationId', organizationId);
      sessionStorage.setItem('selectedOrganizationSlug', organizationSlug);
      sessionStorage.setItem('selectedOrganizationName', data.organization.name);
      navigate('/tenant/dashboard');
    } catch (error) {
      console.error('Error entering company:', error);
      setError('Failed to enter company: ' + getErrorMessage(error));
    }
  };

  const getCompanyAbbreviation = (name) => {
    if (!name) return '';
    const words = name.split(' ');
    if (words.length === 1) return name.substring(0, 3).toUpperCase();
    return words.map(word => word.charAt(0).toUpperCase()).join('').substring(0, 5);
  };

  const getTimeAgo = (timestamp) => {
    if (!timestamp) return '';
    const now = new Date();
    const then = new Date(timestamp);
    const diffMs = now - then;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return then.toLocaleDateString();
  };

  const getActivityIcon = (type) => {
    switch (type) {
      case 'task': return 'bi-check2-square';
      case 'user_created': return 'bi-person-plus';
      case 'user_login': return 'bi-box-arrow-in-right';
      default: return 'bi-activity';
    }
  };

  const getActivityColor = (type) => {
    switch (type) {
      case 'task': return 'activity-icon-blue';
      case 'user_created': return 'activity-icon-green';
      case 'user_login': return 'activity-icon-gray';
      default: return 'activity-icon-gray';
    }
  };

  if (loading) {
    return (
      <div className="platform-dashboard-container">
        <div className="platform-dashboard-header">
          <h1>Platform Dashboard</h1>
          <p className="platform-subtitle">System-wide administration and management</p>
        </div>
        <div className="platform-stats-grid">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="platform-stat-card skeleton-card">
              <div className="skeleton-line skeleton-short"></div>
              <div className="skeleton-line skeleton-large"></div>
              <div className="skeleton-line skeleton-medium"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="platform-dashboard-container">
        <div className="error-message">{error}</div>
      </div>
    );
  }

  return (
    <div className="platform-dashboard-container">
      <div className="platform-dashboard-header">
        <div className="header-left">
          <h1>Platform Dashboard</h1>
          <p className="platform-subtitle">System-wide administration and management</p>
        </div>
        {health && (
          <div className={`system-health-badge ${health.status === 'healthy' ? 'health-ok' : 'health-error'}`}>
            <i className={`bi ${health.status === 'healthy' ? 'bi-check-circle-fill' : 'bi-exclamation-circle-fill'}`}></i>
            <div className="health-info">
              <span className="health-label">System Status</span>
              <span className="health-value">{health.status === 'healthy' ? 'All Systems Operational' : 'Issues Detected'}</span>
            </div>
          </div>
        )}
      </div>

      {/* System Health Bar */}
      {health && (
        <div className="health-bar">
          <div className="health-item">
            <i className={`bi bi-database ${health.database === 'connected' ? 'text-success' : 'text-danger'}`}></i>
            <span>Database</span>
            <span className={`health-status ${health.database === 'connected' ? 'status-ok' : 'status-error'}`}>
              {health.database === 'connected' ? 'Connected' : 'Error'}
            </span>
          </div>
          <div className="health-item">
            <i className={`bi bi-hdd-stack ${health.redis === 'connected' ? 'text-success' : 'text-muted'}`}></i>
            <span>Cache</span>
            <span className={`health-status ${health.redis === 'connected' ? 'status-ok' : 'status-na'}`}>
              {health.redis === 'connected' ? 'Active' : 'N/A'}
            </span>
          </div>
          <div className="health-item">
            <i className="bi bi-tag text-muted"></i>
            <span>Version</span>
            <span className="health-status">{health.version || '1.0.0'}</span>
          </div>
        </div>
      )}

      {/* System Overview Stats */}
      <div className="platform-stats-grid">
        <div className="platform-stat-card" onClick={() => navigate('/platform/organizations')} role="button" tabIndex={0}>
          <div className="stat-card-top">
            <div className="stat-icon stat-icon-blue"><i className="bi bi-building"></i></div>
            <div className="stat-info">
              <div className="stat-label">Organizations</div>
              <div className="stat-value">{stats.totalOrganizations}</div>
            </div>
          </div>
          <div className="stat-detail">
            <span className="stat-detail-active">{stats.activeOrganizations} active</span>
            <span className="stat-detail-separator">&middot;</span>
            <span className="stat-detail-inactive">{stats.inactiveOrganizations} inactive</span>
          </div>
        </div>

        <div className="platform-stat-card" onClick={() => navigate('/platform/users')} role="button" tabIndex={0}>
          <div className="stat-card-top">
            <div className="stat-icon stat-icon-green"><i className="bi bi-people"></i></div>
            <div className="stat-info">
              <div className="stat-label">Total Users</div>
              <div className="stat-value">{stats.totalUsers}</div>
            </div>
          </div>
          <div className="stat-detail">Across all organizations</div>
        </div>

        <div className="platform-stat-card">
          <div className="stat-card-top">
            <div className="stat-icon stat-icon-orange"><i className="bi bi-box-seam"></i></div>
            <div className="stat-info">
              <div className="stat-label">Total Assets</div>
              <div className="stat-value">{stats.totalAssets}</div>
            </div>
          </div>
          <div className="stat-detail">Across all organizations</div>
        </div>

        <div className="platform-stat-card">
          <div className="stat-card-top">
            <div className="stat-icon stat-icon-purple"><i className="bi bi-list-task"></i></div>
            <div className="stat-info">
              <div className="stat-label">Total Tasks</div>
              <div className="stat-value">{stats.totalTasks}</div>
            </div>
          </div>
          <div className="stat-detail">Across all organizations</div>
        </div>
      </div>

      {/* Two-Column Layout: Organizations + Activity Feed */}
      <div className="dashboard-columns">
        {/* Organizations List */}
        <div className="organizations-section">
          <div className="section-header">
            <h2>Organizations</h2>
            <button
              className="btn btn-primary"
              onClick={() => navigate('/platform/organizations')}
            >
              <i className="bi bi-plus-lg"></i> Manage
            </button>
          </div>

          {organizations.length === 0 ? (
            <div className="empty-state">
              <i className="bi bi-building empty-state-icon"></i>
              <h3>No organizations yet</h3>
              <p>Create your first organization to get started managing solar plant operations.</p>
              <button className="btn btn-primary" onClick={() => navigate('/platform/organizations')}>
                <i className="bi bi-plus-lg"></i> Create Organization
              </button>
            </div>
          ) : (
            <div className="organizations-grid">
              {organizations.map(org => (
                <div key={org.id} className="organization-card">
                  <div className="org-card-header">
                    <div className="org-abbreviation">
                      {getCompanyAbbreviation(org.name)}
                    </div>
                    <div className="org-status-badge">
                      <span className={org.is_active ? 'status-active' : 'status-inactive'}>
                        {org.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </div>

                  <div className="org-card-body">
                    <h3 className="org-name">{org.name}</h3>
                    <div className="org-slug">{org.slug}</div>

                    <div className="org-stats">
                      <div className="org-stat">
                        <span className="stat-number">{org.user_count || 0}</span>
                        <span className="stat-label">Users</span>
                      </div>
                      <div className="org-stat">
                        <span className="stat-number">{org.asset_count || 0}</span>
                        <span className="stat-label">Assets</span>
                      </div>
                      <div className="org-stat">
                        <span className="stat-number">{org.task_count || 0}</span>
                        <span className="stat-label">Tasks</span>
                      </div>
                    </div>
                  </div>

                  <div className="org-card-actions">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleEnterCompany(org.id, org.slug)}
                      disabled={!org.is_active}
                    >
                      <i className="bi bi-box-arrow-in-right"></i> Enter
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => navigate(`/platform/organizations/${org.id}/settings`)}
                    >
                      <i className="bi bi-gear"></i> Settings
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Activity Feed */}
        <div className="activity-section">
          <div className="section-header">
            <h2>Recent Activity</h2>
          </div>
          {activities.length === 0 ? (
            <div className="activity-empty">
              <i className="bi bi-clock-history"></i>
              <p>No recent activity</p>
            </div>
          ) : (
            <div className="activity-feed">
              {activities.map((activity, index) => (
                <div key={activity.id + '-' + index} className="activity-item">
                  <div className={`activity-icon ${getActivityColor(activity.type)}`}>
                    <i className={`bi ${getActivityIcon(activity.type)}`}></i>
                  </div>
                  <div className="activity-content">
                    <p className="activity-title">{activity.title}</p>
                    <div className="activity-meta">
                      {activity.organization && (
                        <span className="activity-org">{activity.organization}</span>
                      )}
                      <span className="activity-time">{getTimeAgo(activity.timestamp)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="quick-actions-section">
        <h2>Quick Actions</h2>
        <div className="quick-actions-grid">
          <button className="quick-action-btn" onClick={() => navigate('/platform/organizations')}>
            <div className="action-icon"><i className="bi bi-building"></i></div>
            <div className="action-label">Manage Organizations</div>
          </button>
          <button className="quick-action-btn" onClick={() => navigate('/platform/users')}>
            <div className="action-icon"><i className="bi bi-people"></i></div>
            <div className="action-label">View All Users</div>
          </button>
          <button className="quick-action-btn" onClick={() => navigate('/platform/analytics')}>
            <div className="action-icon"><i className="bi bi-graph-up"></i></div>
            <div className="action-label">System Analytics</div>
          </button>
          <button className="quick-action-btn" onClick={() => navigate('/platform/scada')}>
            <div className="action-icon"><i className="bi bi-broadcast"></i></div>
            <div className="action-label">SCADA Config</div>
          </button>
        </div>
      </div>
    </div>
  );
}

export default PlatformDashboard;
