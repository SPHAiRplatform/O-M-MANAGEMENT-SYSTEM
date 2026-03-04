import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { getApiBaseUrl } from '../api/api';
import { getErrorMessage } from '../utils/errorHandler';
import { ConfirmDialog } from './ConfirmDialog';
import './ScadaConfig.css';

const PROVIDER_TEMPLATES = {
  huawei: { label: 'Huawei FusionSolar', authType: 'bearer', defaultUrl: 'https://intl.fusionsolar.huawei.com/thirdData' },
  sma: { label: 'SMA Sunny Portal', authType: 'bearer', defaultUrl: 'https://monitoring.sma.de/api/v1' },
  solaredge: { label: 'SolarEdge', authType: 'api_key', defaultUrl: 'https://monitoringapi.solaredge.com' },
  growatt: { label: 'Growatt ShineServer', authType: 'basic', defaultUrl: 'https://openapi.growatt.com' },
  custom: { label: 'Custom API', authType: 'bearer', defaultUrl: '' }
};

const DEFAULT_FIELD_MAPPING = {
  power: 'activePower',
  energy_today: 'dailyEnergy',
  energy_total: 'totalEnergy',
  grid_voltage: 'gridVoltage',
  temperature: 'temperature',
  irradiance: 'irradiance'
};

function ScadaConfig() {
  const { isSuperAdmin } = useAuth();
  const [connections, setConnections] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingConnection, setEditingConnection] = useState(null);
  const [testingId, setTestingId] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [formData, setFormData] = useState({
    organization_id: '',
    name: '',
    provider: 'huawei',
    base_url: PROVIDER_TEMPLATES.huawei.defaultUrl,
    api_key: '',
    auth_type: PROVIDER_TEMPLATES.huawei.authType,
    auth_config: '{}',
    poll_interval_minutes: 15,
    field_mapping: JSON.stringify(DEFAULT_FIELD_MAPPING, null, 2),
    is_active: true
  });

  const loadData = useCallback(async () => {
    try {
      setError('');
      const [connectionsRes, orgsRes] = await Promise.all([
        fetch(`${getApiBaseUrl()}/scada/connections`, { credentials: 'include' }),
        fetch(`${getApiBaseUrl()}/platform/organizations`, { credentials: 'include' })
      ]);

      if (!connectionsRes.ok) throw new Error('Failed to load SCADA connections');
      if (!orgsRes.ok) throw new Error('Failed to load organizations');

      const connectionsData = await connectionsRes.json();
      const orgsData = await orgsRes.json();

      setConnections(connectionsData);
      setOrganizations(orgsData);
      setLoading(false);
    } catch (err) {
      console.error('Error loading SCADA config:', err);
      setError(getErrorMessage(err));
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isSuperAdmin()) {
      setError('Access denied. System owner privileges required.');
      setLoading(false);
      return;
    }
    loadData();
  }, [isSuperAdmin, loadData]);

  const handleProviderChange = (provider) => {
    const template = PROVIDER_TEMPLATES[provider];
    setFormData(prev => ({
      ...prev,
      provider,
      base_url: template.defaultUrl,
      auth_type: template.authType
    }));
  };

  const resetForm = () => {
    setFormData({
      organization_id: '',
      name: '',
      provider: 'huawei',
      base_url: PROVIDER_TEMPLATES.huawei.defaultUrl,
      api_key: '',
      auth_type: PROVIDER_TEMPLATES.huawei.authType,
      auth_config: '{}',
      poll_interval_minutes: 15,
      field_mapping: JSON.stringify(DEFAULT_FIELD_MAPPING, null, 2),
      is_active: true
    });
    setEditingConnection(null);
    setShowForm(false);
    setTestResult(null);
  };

  const handleEdit = (conn) => {
    setFormData({
      organization_id: conn.organization_id,
      name: conn.name,
      provider: conn.provider,
      base_url: conn.base_url,
      api_key: '', // Never prefill API key
      auth_type: conn.auth_type,
      auth_config: JSON.stringify(conn.auth_config || {}, null, 2),
      poll_interval_minutes: conn.poll_interval_minutes,
      field_mapping: JSON.stringify(conn.field_mapping || DEFAULT_FIELD_MAPPING, null, 2),
      is_active: conn.is_active
    });
    setEditingConnection(conn);
    setShowForm(true);
    setTestResult(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setError('');

      let parsedAuthConfig, parsedFieldMapping;
      try {
        parsedAuthConfig = JSON.parse(formData.auth_config);
      } catch {
        setError('Invalid JSON in auth config');
        return;
      }
      try {
        parsedFieldMapping = JSON.parse(formData.field_mapping);
      } catch {
        setError('Invalid JSON in field mapping');
        return;
      }

      const payload = {
        ...formData,
        auth_config: parsedAuthConfig,
        field_mapping: parsedFieldMapping,
        poll_interval_minutes: parseInt(formData.poll_interval_minutes)
      };

      // Don't send empty api_key on edit (keep existing)
      if (editingConnection && !payload.api_key) {
        delete payload.api_key;
      }

      const url = editingConnection
        ? `${getApiBaseUrl()}/scada/connections/${editingConnection.id}`
        : `${getApiBaseUrl()}/scada/connections`;

      const response = await fetch(url, {
        method: editingConnection ? 'PUT' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save connection');
      }

      setSuccessMessage(editingConnection ? 'Connection updated successfully' : 'Connection created successfully');
      setTimeout(() => setSuccessMessage(''), 3000);
      resetForm();
      loadData();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const handleTestConnection = async (connectionId) => {
    try {
      setTestingId(connectionId);
      setTestResult(null);

      const response = await fetch(`${getApiBaseUrl()}/scada/connections/${connectionId}/test`, {
        method: 'POST',
        credentials: 'include'
      });

      const data = await response.json();
      setTestResult({ connectionId, success: data.success, message: data.message || data.error });
    } catch (err) {
      setTestResult({ connectionId, success: false, message: getErrorMessage(err) });
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = (conn) => {
    setConfirmDialog({
      title: 'Delete SCADA Connection',
      message: `Are you sure you want to delete the connection "${conn.name}"? This will also remove all associated data and alarms.`,
      confirmLabel: 'Delete',
      variant: 'danger',
      onConfirm: async () => {
        try {
          const response = await fetch(`${getApiBaseUrl()}/scada/connections/${conn.id}`, {
            method: 'DELETE',
            credentials: 'include'
          });
          if (!response.ok) throw new Error('Failed to delete connection');
          setSuccessMessage('Connection deleted successfully');
          setTimeout(() => setSuccessMessage(''), 3000);
          loadData();
        } catch (err) {
          setError(getErrorMessage(err));
        }
      }
    });
  };

  const handleToggleActive = async (conn) => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/scada/connections/${conn.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !conn.is_active })
      });
      if (!response.ok) throw new Error('Failed to update connection');
      loadData();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const getStatusBadge = (conn) => {
    if (!conn.is_active) return <span className="scada-badge scada-badge-inactive">Inactive</span>;
    switch (conn.status) {
      case 'connected': return <span className="scada-badge scada-badge-connected">Connected</span>;
      case 'error': return <span className="scada-badge scada-badge-error">Error</span>;
      default: return <span className="scada-badge scada-badge-pending">Pending</span>;
    }
  };

  const getTimeSince = (timestamp) => {
    if (!timestamp) return 'Never';
    const diff = Date.now() - new Date(timestamp).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const getOrgName = (orgId) => {
    const org = organizations.find(o => o.id === orgId);
    return org ? org.name : 'Unknown';
  };

  if (loading) {
    return (
      <div className="scada-config-container">
        <div className="scada-config-header">
          <h1><i className="bi bi-broadcast"></i> SCADA Configuration</h1>
          <p className="scada-subtitle">Manage SCADA API connections for organizations</p>
        </div>
        <div className="scada-loading">
          <div className="scada-skeleton-card"></div>
          <div className="scada-skeleton-card"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="scada-config-container">
      <ConfirmDialog dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />

      <div className="scada-config-header">
        <div className="header-left">
          <h1><i className="bi bi-broadcast"></i> SCADA Configuration</h1>
          <p className="scada-subtitle">Manage SCADA API connections for organizations</p>
        </div>
        <button className="btn btn-primary" onClick={() => { resetForm(); setShowForm(true); }}>
          <i className="bi bi-plus-lg"></i> Add Connection
        </button>
      </div>

      {error && (
        <div className="scada-alert scada-alert-error">
          <i className="bi bi-exclamation-triangle"></i>
          <span>{error}</span>
          <button className="scada-alert-close" onClick={() => setError('')}>&times;</button>
        </div>
      )}

      {successMessage && (
        <div className="scada-alert scada-alert-success">
          <i className="bi bi-check-circle"></i>
          <span>{successMessage}</span>
        </div>
      )}

      {/* Connection Form */}
      {showForm && (
        <div className="scada-form-card">
          <div className="scada-form-header">
            <h2>{editingConnection ? 'Edit Connection' : 'New SCADA Connection'}</h2>
            <button className="btn-icon-only" onClick={resetForm}>
              <i className="bi bi-x-lg"></i>
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="scada-form-grid">
              <div className="form-group">
                <label>Organization *</label>
                <select
                  value={formData.organization_id}
                  onChange={(e) => setFormData(prev => ({ ...prev, organization_id: e.target.value }))}
                  required
                  disabled={!!editingConnection}
                >
                  <option value="">Select organization...</option>
                  {organizations.filter(o => o.is_active).map(org => (
                    <option key={org.id} value={org.id}>{org.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Connection Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Main Plant FusionSolar"
                  required
                />
              </div>

              <div className="form-group">
                <label>SCADA Provider *</label>
                <select
                  value={formData.provider}
                  onChange={(e) => handleProviderChange(e.target.value)}
                >
                  {Object.entries(PROVIDER_TEMPLATES).map(([key, tmpl]) => (
                    <option key={key} value={key}>{tmpl.label}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Auth Type</label>
                <select
                  value={formData.auth_type}
                  onChange={(e) => setFormData(prev => ({ ...prev, auth_type: e.target.value }))}
                >
                  <option value="bearer">Bearer Token</option>
                  <option value="api_key">API Key (Query Param)</option>
                  <option value="basic">Basic Auth</option>
                  <option value="oauth2">OAuth 2.0</option>
                </select>
              </div>

              <div className="form-group form-group-full">
                <label>Base URL *</label>
                <input
                  type="url"
                  value={formData.base_url}
                  onChange={(e) => setFormData(prev => ({ ...prev, base_url: e.target.value }))}
                  placeholder="https://api.example.com/v1"
                  required
                />
              </div>

              <div className="form-group form-group-full">
                <label>
                  API Key / Token *
                  {editingConnection && <span className="form-hint"> (leave blank to keep current)</span>}
                </label>
                <input
                  type="password"
                  value={formData.api_key}
                  onChange={(e) => setFormData(prev => ({ ...prev, api_key: e.target.value }))}
                  placeholder={editingConnection ? '••••••••' : 'Enter API key or token'}
                  required={!editingConnection}
                />
              </div>

              <div className="form-group">
                <label>Poll Interval</label>
                <select
                  value={formData.poll_interval_minutes}
                  onChange={(e) => setFormData(prev => ({ ...prev, poll_interval_minutes: e.target.value }))}
                >
                  <option value="1">Every 1 minute</option>
                  <option value="5">Every 5 minutes</option>
                  <option value="15">Every 15 minutes</option>
                  <option value="30">Every 30 minutes</option>
                  <option value="60">Every 60 minutes</option>
                </select>
              </div>

              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
                  />
                  Active (enable data polling)
                </label>
              </div>

              <div className="form-group form-group-full">
                <label>Auth Config (JSON)</label>
                <textarea
                  value={formData.auth_config}
                  onChange={(e) => setFormData(prev => ({ ...prev, auth_config: e.target.value }))}
                  rows={3}
                  placeholder='{"username": "user", "password": "pass"}'
                  className="code-input"
                />
              </div>

              <div className="form-group form-group-full">
                <label>Field Mapping (JSON)</label>
                <textarea
                  value={formData.field_mapping}
                  onChange={(e) => setFormData(prev => ({ ...prev, field_mapping: e.target.value }))}
                  rows={6}
                  className="code-input"
                />
                <span className="form-hint">Maps SCADA API fields to platform data types</span>
              </div>
            </div>

            <div className="scada-form-actions">
              <button type="button" className="btn btn-secondary" onClick={resetForm}>Cancel</button>
              <button type="submit" className="btn btn-primary">
                <i className={`bi ${editingConnection ? 'bi-check-lg' : 'bi-plus-lg'}`}></i>
                {editingConnection ? 'Update Connection' : 'Create Connection'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Connections List */}
      {connections.length === 0 && !showForm ? (
        <div className="scada-empty-state">
          <i className="bi bi-broadcast"></i>
          <h3>No SCADA Connections</h3>
          <p>Connect your solar monitoring systems to pull real-time performance data.</p>
          <button className="btn btn-primary" onClick={() => { resetForm(); setShowForm(true); }}>
            <i className="bi bi-plus-lg"></i> Add First Connection
          </button>
        </div>
      ) : (
        <div className="scada-connections-grid">
          {connections.map(conn => (
            <div key={conn.id} className={`scada-connection-card ${!conn.is_active ? 'card-inactive' : ''}`}>
              <div className="conn-card-header">
                <div className="conn-provider">
                  <i className={`bi ${getProviderIcon(conn.provider)}`}></i>
                  <span className="conn-provider-label">{PROVIDER_TEMPLATES[conn.provider]?.label || conn.provider}</span>
                </div>
                {getStatusBadge(conn)}
              </div>

              <div className="conn-card-body">
                <h3 className="conn-name">{conn.name}</h3>
                <div className="conn-org">
                  <i className="bi bi-building"></i> {getOrgName(conn.organization_id)}
                </div>
                <div className="conn-url">{conn.base_url}</div>

                <div className="conn-stats">
                  <div className="conn-stat">
                    <span className="conn-stat-label">Poll Interval</span>
                    <span className="conn-stat-value">{conn.poll_interval_minutes}m</span>
                  </div>
                  <div className="conn-stat">
                    <span className="conn-stat-label">Last Sync</span>
                    <span className="conn-stat-value">{getTimeSince(conn.last_sync_at)}</span>
                  </div>
                </div>

                {conn.last_error && (
                  <div className="conn-error">
                    <i className="bi bi-exclamation-circle"></i>
                    <span>{conn.last_error}</span>
                  </div>
                )}

                {testResult && testResult.connectionId === conn.id && (
                  <div className={`conn-test-result ${testResult.success ? 'test-success' : 'test-failure'}`}>
                    <i className={`bi ${testResult.success ? 'bi-check-circle' : 'bi-x-circle'}`}></i>
                    <span>{testResult.message}</span>
                  </div>
                )}
              </div>

              <div className="conn-card-actions">
                <button
                  className="btn btn-sm btn-outline"
                  onClick={() => handleTestConnection(conn.id)}
                  disabled={testingId === conn.id}
                >
                  {testingId === conn.id ? (
                    <><i className="bi bi-arrow-repeat spinning"></i> Testing...</>
                  ) : (
                    <><i className="bi bi-lightning"></i> Test</>
                  )}
                </button>
                <button
                  className="btn btn-sm btn-outline"
                  onClick={() => handleToggleActive(conn)}
                >
                  <i className={`bi ${conn.is_active ? 'bi-pause-circle' : 'bi-play-circle'}`}></i>
                  {conn.is_active ? 'Pause' : 'Resume'}
                </button>
                <button className="btn btn-sm btn-outline" onClick={() => handleEdit(conn)}>
                  <i className="bi bi-pencil"></i> Edit
                </button>
                <button className="btn btn-sm btn-outline btn-danger-outline" onClick={() => handleDelete(conn)}>
                  <i className="bi bi-trash3"></i>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getProviderIcon(provider) {
  switch (provider) {
    case 'huawei': return 'bi-cpu';
    case 'sma': return 'bi-sun';
    case 'solaredge': return 'bi-lightning-charge';
    case 'growatt': return 'bi-tree';
    default: return 'bi-plug';
  }
}

export default ScadaConfig;
