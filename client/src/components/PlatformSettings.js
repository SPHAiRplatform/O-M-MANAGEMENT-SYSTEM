import React, { useState, useEffect } from 'react';
import { getApiBaseUrl, authFetch, getPlatformSettings, updatePlatformSettings } from '../api/api';
import './PlatformSettings.css';

function PlatformSettings() {
  const [feedbackContactEmail, setFeedbackContactEmail] = useState('');
  const [editingContactEmail, setEditingContactEmail] = useState(false);
  const [settings, setSettings] = useState({
    defaultPlan: 'Professional',
    defaultUserLimit: 10,
    defaultFeatures: {
      calendar: true,
      inventory: true,
      cm_letters: true,
      plant: true,
      templates: true,
      users: true
    },
    sessionTimeout: '1hr',
    passwordMinLength: 8,
    forcePasswordChange: false,
    maxLoginAttempts: 5
  });

  const [health, setHealth] = useState(null);
  const [stats, setStats] = useState(null);
  const [expandedSections, setExpandedSections] = useState({
    defaults: true,
    security: true,
    contact: true,
    system: true
  });

  useEffect(() => {
    // Load settings from localStorage
    const saved = localStorage.getItem('platform_settings');
    if (saved) {
      setSettings(JSON.parse(saved));
    }
    // Load platform settings from server (Contact Developer email, etc.)
    getPlatformSettings()
      .then((data) => setFeedbackContactEmail(data.feedback_contact_email || ''))
      .catch(() => {});

    // Load health and stats
    loadSystemInfo();
  }, []);

  const loadSystemInfo = async () => {
    try {
      const [healthRes, statsRes] = await Promise.all([
        authFetch(`${getApiBaseUrl()}/platform/health`),
        authFetch(`${getApiBaseUrl()}/platform/stats`)
      ]);

      if (healthRes.ok) {
        const data = await healthRes.json();
        setHealth(data);
      }
      if (statsRes.ok) {
        const data = await statsRes.json();
        setStats(data);
      }
    } catch (err) {
      console.error('Failed to load system info:', err);
    }
  };

  const handleSave = async () => {
    localStorage.setItem('platform_settings', JSON.stringify(settings));
    try {
      const data = await updatePlatformSettings({ feedback_contact_email: feedbackContactEmail.trim() || '' });
      setFeedbackContactEmail(data.feedback_contact_email || '');
      setEditingContactEmail(false);
      alert('Settings saved successfully.');
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to save';
      alert(msg === 'Failed to save' ? 'Could not save Contact Developer email. You may need system owner access.' : msg);
    }
  };

  const loadContactEmail = () => {
    getPlatformSettings()
      .then((data) => {
        setFeedbackContactEmail(data.feedback_contact_email || '');
        setEditingContactEmail(false);
      })
      .catch(() => {});
  };

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const handleFeatureToggle = (feature) => {
    setSettings(prev => ({
      ...prev,
      defaultFeatures: {
        ...prev.defaultFeatures,
        [feature]: !prev.defaultFeatures[feature]
      }
    }));
  };

  const FEATURE_DESCRIPTIONS = {
    calendar: 'Event scheduling and team calendar',
    inventory: 'Spare parts and materials tracking',
    cm_letters: 'Corrective maintenance letter generation',
    plant: 'Plant map and equipment visualization',
    templates: 'Custom checklist template editor',
    users: 'User management within organization'
  };

  return (
    <div className="platform-settings-container">
      <div className="settings-header">
        <h1><i className="bi bi-sliders"></i> Platform Settings</h1>
        <p className="settings-subtitle">Configure system-wide defaults and security</p>
      </div>

      {/* Default Organization Settings */}
      <div className="settings-section-card">
        <div className="settings-section-header" onClick={() => toggleSection('defaults')}>
          <i className="bi bi-building"></i>
          <span className="section-title">Default Organization Settings</span>
          <i className={`bi ${expandedSections.defaults ? 'bi-chevron-up' : 'bi-chevron-down'} chevron`}></i>
        </div>

        {expandedSections.defaults && (
          <div className="settings-section-body">
            <div className="form-group">
              <label>Default Subscription Plan</label>
              <p className="settings-field-desc">Plan assigned to new organizations by default</p>
              <input
                type="text"
                value={settings.defaultPlan}
                onChange={(e) => setSettings({ ...settings, defaultPlan: e.target.value })}
                placeholder="e.g. Starter, Professional, Enterprise"
              />
            </div>

            <div className="form-group">
              <label>Default User Limit</label>
              <p className="settings-field-desc">Maximum users allowed in new organizations</p>
              <input
                type="number"
                min="1"
                value={settings.defaultUserLimit}
                onChange={(e) => setSettings({ ...settings, defaultUserLimit: parseInt(e.target.value) })}
              />
            </div>

            <div className="form-group">
              <label>Default Features for New Organizations</label>
              <div className="feature-checklist">
                {Object.entries(FEATURE_DESCRIPTIONS).map(([key, desc]) => (
                  <label key={key} className="feature-item">
                    <input
                      type="checkbox"
                      checked={settings.defaultFeatures[key] || false}
                      onChange={() => handleFeatureToggle(key)}
                    />
                    <div className="feature-item-info">
                      <span className="feature-item-label">{key}</span>
                      <span className="feature-item-desc">{desc}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Security Settings */}
      <div className="settings-section-card">
        <div className="settings-section-header" onClick={() => toggleSection('security')}>
          <i className="bi bi-shield-lock"></i>
          <span className="section-title">Security Settings</span>
          <i className={`bi ${expandedSections.security ? 'bi-chevron-up' : 'bi-chevron-down'} chevron`}></i>
        </div>

        {expandedSections.security && (
          <div className="settings-section-body">
            <div className="form-group">
              <label>Session Timeout</label>
              <select
                value={settings.sessionTimeout}
                onChange={(e) => setSettings({ ...settings, sessionTimeout: e.target.value })}
              >
                <option value="30min">30 minutes</option>
                <option value="1hr">1 hour</option>
                <option value="2hr">2 hours</option>
                <option value="4hr">4 hours</option>
                <option value="8hr">8 hours</option>
              </select>
            </div>

            <div className="form-group">
              <label>Password Minimum Length</label>
              <input
                type="number"
                min="6"
                max="20"
                value={settings.passwordMinLength}
                onChange={(e) => setSettings({ ...settings, passwordMinLength: parseInt(e.target.value) })}
              />
            </div>

            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.forcePasswordChange}
                  onChange={(e) => setSettings({ ...settings, forcePasswordChange: e.target.checked })}
                />
                Force password change on first login
              </label>
            </div>

            <div className="form-group">
              <label>Max Login Attempts Before Lockout</label>
              <input
                type="number"
                min="1"
                max="10"
                value={settings.maxLoginAttempts}
                onChange={(e) => setSettings({ ...settings, maxLoginAttempts: parseInt(e.target.value) })}
              />
            </div>
          </div>
        )}
      </div>

      {/* Contact Developer - email for feedback messages (system owner) */}
      <div className="settings-section-card">
        <div className="settings-section-header" onClick={() => toggleSection('contact')}>
          <i className="bi bi-envelope"></i>
          <span className="section-title">Contact Developer</span>
          <i className={`bi ${expandedSections.contact ? 'bi-chevron-up' : 'bi-chevron-down'} chevron`}></i>
        </div>

        {expandedSections.contact && (
          <div className="settings-section-body">
            <div className="form-group">
              <label>Email for Contact Developer messages</label>
              <p className="settings-field-desc">Messages sent from the &quot;Contact Developer&quot; form will be delivered to this address. Leave blank to use the server default (FEEDBACK_EMAIL or SMTP user).</p>
              {editingContactEmail ? (
                <>
                  <input
                    type="email"
                    value={feedbackContactEmail}
                    onChange={(e) => setFeedbackContactEmail(e.target.value)}
                    placeholder="e.g. support@yourcompany.com"
                  />
                  <button type="button" className="btn btn-secondary" style={{ marginTop: '8px', marginRight: '8px' }} onClick={loadContactEmail}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <div className="info-item" style={{ marginBottom: '8px' }}>
                    <span className="info-label">Current address</span>
                    <span className="info-value">{feedbackContactEmail || '(not set – uses server default)'}</span>
                  </div>
                  <button type="button" className="btn btn-secondary" onClick={() => setEditingContactEmail(true)}>
                    <i className="bi bi-pencil"></i> Edit
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* System Information (Read-Only) */}
      <div className="settings-section-card">
        <div className="settings-section-header" onClick={() => toggleSection('system')}>
          <i className="bi bi-info-circle"></i>
          <span className="section-title">System Information</span>
          <i className={`bi ${expandedSections.system ? 'bi-chevron-up' : 'bi-chevron-down'} chevron`}></i>
        </div>

        {expandedSections.system && (
          <div className="settings-section-body">
            <div className="info-item">
              <span className="info-label">App Version</span>
              <span className="info-value">1.0.0</span>
            </div>

            {health && (
              <>
                <div className="info-item">
                  <span className="info-label">Database Status</span>
                  <span className={`info-value status-${health.database ? 'ok' : 'error'}`}>
                    {health.database ? '✓ Connected' : '✗ Disconnected'}
                  </span>
                </div>

                <div className="info-item">
                  <span className="info-label">Cache Status</span>
                  <span className={`info-value status-${health.cache ? 'ok' : 'error'}`}>
                    {health.cache ? '✓ Connected' : '✗ Disconnected'}
                  </span>
                </div>
              </>
            )}

            {stats && (
              <>
                <div className="info-item">
                  <span className="info-label">Total Organizations</span>
                  <span className="info-value">{stats.organizations || 0}</span>
                </div>

                <div className="info-item">
                  <span className="info-label">Total Users</span>
                  <span className="info-value">{stats.users || 0}</span>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Save Button */}
      <div className="settings-actions">
        <button className="btn btn-primary" onClick={handleSave}>
          <i className="bi bi-check-lg"></i> Save Settings
        </button>
        <p className="settings-note">Organization defaults and security options are stored in your browser. Contact Developer email is saved on the server (system owner only).</p>
      </div>
    </div>
  );
}

export default PlatformSettings;
