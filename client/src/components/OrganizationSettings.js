import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getApiBaseUrl, authFetch } from '../api/api';
import { getErrorMessage } from '../utils/errorHandler';
import { SuccessAlert } from './ErrorAlert';
import { ConfirmDialog } from './ConfirmDialog';
import './OrganizationManagement.css';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Classify a setting key into one of the four sections. */
function classifySetting(key) {
  if (key === 'subscription_plan' || key === 'user_limit') return 'subscription';
  const lower = key.toLowerCase();
  if (lower.includes('workflow') || lower.includes('task') || lower.includes('checklist')) return 'operations';
  if (lower.includes('notification') || lower.includes('email') || lower.includes('alert')) return 'notifications';
  return 'custom';
}

const SECTION_META = [
  { id: 'subscription',  icon: 'bi-credit-card', title: 'Subscription & Limits' },
  { id: 'operations',    icon: 'bi-gear',        title: 'Operations' },
  { id: 'notifications', icon: 'bi-bell',        title: 'Notifications' },
  { id: 'custom',        icon: 'bi-sliders',     title: 'Custom Settings' }
];

// ─── Component ────────────────────────────────────────────────────────────────

function OrganizationSettings() {
  const { id } = useParams();
  const { user: currentUser } = useAuth();

  const [organization, setOrganization] = useState(null);
  const [settings, setSettings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [alertSuccess, setAlertSuccess] = useState(null);

  // Top-level fields
  const [subscriptionPlan, setSubscriptionPlan] = useState('');
  const [userLimit, setUserLimit] = useState('');

  // Add form
  const [newSetting, setNewSetting] = useState({ setting_key: '', setting_value: '', description: '' });
  const [showAddForm, setShowAddForm] = useState(false);

  const [confirmDialog, setConfirmDialog] = useState(null);

  // Collapsible section state — all expanded by default
  const [expandedSections, setExpandedSections] = useState({
    subscription: true,
    operations: true,
    notifications: true,
    custom: true
  });

  const toggleSection = (sectionId) => {
    setExpandedSections(prev => ({ ...prev, [sectionId]: !prev[sectionId] }));
  };

  // ── Data loading ──

  useEffect(() => {
    if (id) {
      loadOrganization();
      loadSettings();
    }
  }, [id]);

  const loadOrganization = async () => {
    try {
      const response = await authFetch(`${getApiBaseUrl()}/organizations/${id}`);
      if (response.ok) {
        const data = await response.json();
        setOrganization(data);
      }
    } catch (err) {
      console.error('Error loading organization:', err);
    }
  };

  const loadSettings = async () => {
    try {
      setLoading(true);
      const response = await authFetch(`${getApiBaseUrl()}/organizations/${id}/settings`);
      if (!response.ok) throw new Error('Failed to load settings');

      const data = await response.json();
      setSettings(data);

      const subPlan = data.find(s => s.setting_key === 'subscription_plan');
      const uLimit = data.find(s => s.setting_key === 'user_limit');
      setSubscriptionPlan(
        subPlan != null && subPlan.setting_value != null
          ? (typeof subPlan.setting_value === 'string' ? subPlan.setting_value : String(subPlan.setting_value))
          : ''
      );
      setUserLimit(
        uLimit != null && uLimit.setting_value != null
          ? (typeof uLimit.setting_value === 'number' ? String(uLimit.setting_value) : String(uLimit.setting_value))
          : ''
      );
    } catch (err) {
      setError('Failed to load settings: ' + getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  // ── Save all ──

  const handleSave = async () => {
    try {
      setSaving(true);
      setError('');

      const settingsToSave = settings
        .filter(s => s.setting_key !== 'subscription_plan' && s.setting_key !== 'user_limit')
        .map(s => ({
          setting_key: s.setting_key,
          setting_value: typeof s.setting_value === 'string'
            ? (() => { try { return JSON.parse(s.setting_value); } catch (_) { return s.setting_value; } })()
            : s.setting_value,
          description: s.description
        }));

      settingsToSave.push({
        setting_key: 'subscription_plan',
        setting_value: subscriptionPlan.trim() || null,
        description: 'Plan agreed with customer'
      });

      const parsedLimit = userLimit.trim() ? parseInt(userLimit.trim(), 10) : null;
      settingsToSave.push({
        setting_key: 'user_limit',
        setting_value: (parsedLimit != null && !isNaN(parsedLimit) && parsedLimit > 0) ? parsedLimit : null,
        description: 'Maximum users for this organization'
      });

      const response = await authFetch(`${getApiBaseUrl()}/organizations/${id}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: settingsToSave })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save settings');
      }

      await loadSettings();
      setAlertSuccess('Settings saved successfully');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  // ── Add / delete setting ──

  const handleAddSetting = async () => {
    if (!newSetting.setting_key) {
      setError('Setting key is required');
      return;
    }

    try {
      const settingValue = newSetting.setting_value ? JSON.parse(newSetting.setting_value) : null;

      const response = await authFetch(`${getApiBaseUrl()}/organizations/${id}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: [{
            setting_key: newSetting.setting_key,
            setting_value: settingValue,
            description: newSetting.description
          }]
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to add setting');
      }

      await loadSettings();
      setNewSetting({ setting_key: '', setting_value: '', description: '' });
      setShowAddForm(false);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const handleDeleteSetting = (settingKey) => {
    setConfirmDialog({
      title: 'Delete Setting',
      message: 'Are you sure you want to delete this setting?',
      confirmLabel: 'Delete',
      variant: 'danger',
      onConfirm: async () => {
        setSettings(prev => prev.filter(s => s.setting_key !== settingKey));
      }
    });
  };

  const handleSettingChange = (index, field, value) => {
    const updated = [...settings];
    updated[index][field] = value;
    setSettings(updated);
  };

  // ── Group settings by section ──

  const groupedSettings = useMemo(() => {
    const groups = { subscription: [], operations: [], notifications: [], custom: [] };
    settings.forEach((s, index) => {
      const section = classifySetting(s.setting_key);
      groups[section].push({ ...s, _index: index });
    });
    return groups;
  }, [settings]);

  // ── Render helpers ──

  /** Render a table of settings for a given section (excluding subscription which has its own UI). */
  const renderSettingsTable = (sectionSettings) => {
    if (sectionSettings.length === 0) {
      return <p className="no-data" style={{ textAlign: 'center', color: '#94a3b8', padding: '12px 0' }}>No settings in this category</p>;
    }
    return (
      <table className="users-table" style={{ marginTop: 0 }}>
        <thead>
          <tr>
            <th>Setting Key</th>
            <th>Value</th>
            <th>Description</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {sectionSettings.map((setting) => (
            <tr key={setting.setting_key}>
              <td>{setting.setting_key}</td>
              <td>
                <textarea
                  value={typeof setting.setting_value === 'string'
                    ? setting.setting_value
                    : JSON.stringify(setting.setting_value, null, 2)}
                  onChange={(e) => handleSettingChange(setting._index, 'setting_value', e.target.value)}
                  rows={2}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: '13px' }}
                />
              </td>
              <td>
                <input
                  type="text"
                  value={setting.description || ''}
                  onChange={(e) => handleSettingChange(setting._index, 'description', e.target.value)}
                  placeholder="Description"
                />
              </td>
              <td>
                <button className="btn btn-sm btn-danger" onClick={() => handleDeleteSetting(setting.setting_key)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  // ── Render ──

  if (loading) {
    return <div className="org-management-container"><div className="loading">Loading settings...</div></div>;
  }

  return (
    <div className="org-management-container">
      <SuccessAlert message={alertSuccess} onClose={() => setAlertSuccess(null)} />

      {/* Breadcrumb */}
      <nav className="settings-breadcrumb">
        <Link to="/platform">Platform</Link>
        <span className="separator">&rsaquo;</span>
        <Link to="/platform/organizations">Organizations</Link>
        <span className="separator">&rsaquo;</span>
        {organization ? <span>{organization.name}</span> : <span>...</span>}
        <span className="separator">&rsaquo;</span>
        <span>Settings</span>
      </nav>

      <div className="org-management-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Link to="/platform/organizations" className="btn btn-sm btn-secondary" style={{ textDecoration: 'none' }}>
            <i className="bi bi-arrow-left"></i> Back
          </Link>
          <h2>Organization Settings{organization ? ` - ${organization.name}` : ''}</h2>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? 'Cancel' : 'Add'}
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}

      {/* Add New Setting form (shown inside Custom section, but also accessible from header) */}
      {showAddForm && (
        <div className="user-form-container" style={{ marginBottom: '16px' }}>
          <h3>Add New Setting</h3>
          <div className="form-group">
            <label>Setting Key *</label>
            <input
              type="text"
              value={newSetting.setting_key}
              onChange={(e) => setNewSetting({ ...newSetting, setting_key: e.target.value })}
              placeholder="e.g., workflow_type"
            />
          </div>
          <div className="form-group">
            <label>Setting Value (JSON)</label>
            <textarea
              value={newSetting.setting_value}
              onChange={(e) => setNewSetting({ ...newSetting, setting_value: e.target.value })}
              placeholder='{"key": "value"}'
              rows={3}
            />
          </div>
          <div className="form-group">
            <label>Description</label>
            <input
              type="text"
              value={newSetting.description}
              onChange={(e) => setNewSetting({ ...newSetting, description: e.target.value })}
              placeholder="Setting description"
            />
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-primary" onClick={handleAddSetting}>Add</button>
            <button type="button" className="btn btn-secondary" onClick={() => setShowAddForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Collapsible sections ── */}
      {SECTION_META.map(section => {
        const isExpanded = expandedSections[section.id];

        return (
          <div key={section.id} className="settings-section-card">
            <div className="settings-section-header" onClick={() => toggleSection(section.id)}>
              <i className={`bi ${section.icon}`}></i>
              <span className="section-title">{section.title}</span>
              <i className={`bi ${isExpanded ? 'bi-chevron-up' : 'bi-chevron-down'} chevron`}></i>
            </div>

            {isExpanded && (
              <div className="settings-section-body">
                {section.id === 'subscription' && (
                  <>
                    <div className="form-group">
                      <label>Subscription plan</label>
                      <p className="settings-field-desc">Set the plan agreed with the customer (e.g. Starter, Professional, Enterprise).</p>
                      <input
                        type="text"
                        value={subscriptionPlan}
                        onChange={(e) => setSubscriptionPlan(e.target.value)}
                        placeholder="e.g. Starter, Professional, Enterprise"
                      />
                    </div>
                    <div className="form-group">
                      <label>User limit</label>
                      <p className="settings-field-desc">Maximum number of users allowed in this organization. Leave empty for unlimited.</p>
                      <input
                        type="number"
                        min="1"
                        value={userLimit}
                        onChange={(e) => setUserLimit(e.target.value)}
                        placeholder="Leave empty for unlimited"
                      />
                    </div>
                    {/* Also show any other settings classified here that are not the two managed fields */}
                    {groupedSettings.subscription
                      .filter(s => s.setting_key !== 'subscription_plan' && s.setting_key !== 'user_limit')
                      .length > 0 &&
                      renderSettingsTable(
                        groupedSettings.subscription.filter(s => s.setting_key !== 'subscription_plan' && s.setting_key !== 'user_limit')
                      )
                    }
                  </>
                )}

                {section.id === 'operations' && renderSettingsTable(groupedSettings.operations)}
                {section.id === 'notifications' && renderSettingsTable(groupedSettings.notifications)}

                {section.id === 'custom' && (
                  <>
                    {renderSettingsTable(groupedSettings.custom)}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Save button */}
      <div className="form-actions" style={{ marginTop: '20px' }}>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save All Settings'}
        </button>
      </div>

      <ConfirmDialog dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />
    </div>
  );
}

export default OrganizationSettings;
