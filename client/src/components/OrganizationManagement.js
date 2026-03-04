import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getApiBaseUrl } from '../api/api';
import { getErrorMessage } from '../utils/errorHandler';
import { ConfirmDialog } from './ConfirmDialog';
import { SuccessAlert } from './ErrorAlert';
import FormField from './FormField';
import './OrganizationManagement.css';

// ─── Constants ────────────────────────────────────────────────────────────────

const FEATURE_KEYS = [
  'dashboard',
  'tasks',
  'calendar',
  'inventory',
  'cm_letters',
  'plant',
  'templates',
  'users',
  'scada'
];

const FEATURE_DESCRIPTIONS = {
  dashboard: 'Operations dashboard with KPIs and overview cards',
  tasks: 'Preventive and corrective maintenance task management',
  calendar: 'Event scheduling and team calendar',
  inventory: 'Spare parts and materials tracking',
  cm_letters: 'Corrective maintenance letter generation',
  plant: 'Plant map and equipment visualization',
  templates: 'Custom checklist template editor',
  users: 'User management within organization',
  scada: 'SCADA faults/trips, alarms, and real-time plant performance'
};

const FEATURE_BADGE_CLASS = {
  dashboard: 'fb-dashboard',
  tasks: 'fb-tasks',
  calendar: 'fb-calendar',
  inventory: 'fb-inventory',
  cm_letters: 'fb-cm_letters',
  plant: 'fb-plant',
  templates: 'fb-templates',
  users: 'fb-users',
  scada: 'fb-scada'
};

const WIZARD_STEP_DESCRIPTIONS = {
  1: 'Enter basic information about your organization. The slug will be used in URLs and must be unique.',
  2: 'Select which features this organization can access. You can change these later from the organization settings.',
  3: 'Optionally create the first administrator user for this organization. They will have full access to manage the organization.'
};

// ─── Utility Functions ────────────────────────────────────────────────────────────────

/**
 * Formats a feature key into a human-readable display name.
 * Examples:
 *   'cm_letters' → 'CM Letters'
 *   'plant' → 'Plant'
 */
function formatFeatureName(key) {
  const specialCases = {
    dashboard: 'Dashboard',
    tasks: 'Tasks',
    cm_letters: 'CM Letters',
    calendar: 'Calendar',
    inventory: 'Inventory',
    plant: 'Plant',
    templates: 'Templates',
    users: 'Users',
    scada: 'SCADA'
  };

  return specialCases[key] || key
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// ─── Delete Confirmation Modal ────────────────────────────────────────────────

function DeleteConfirmationModal({ isOpen, organization, onConfirm, onCancel }) {
  const [confirmationText, setConfirmationText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  if (!isOpen || !organization) return null;

  const requiredText = organization.name.toUpperCase();
  const isConfirmed = confirmationText.trim().toUpperCase() === requiredText;

  const handleConfirm = async () => {
    if (!isConfirmed) return;
    setIsDeleting(true);
    try {
      await onConfirm();
    } finally {
      setIsDeleting(false);
      setConfirmationText('');
    }
  };

  const handleCancel = () => {
    setConfirmationText('');
    onCancel();
  };

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal-content delete-confirmation-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2><i className="bi bi-exclamation-triangle" style={{ color: '#f59e0b', marginRight: '8px' }}></i>Delete Organization</h2>
        </div>
        <div className="modal-body">
          <div className="warning-message">
            <p><strong>WARNING: This action cannot be undone!</strong></p>
            <p>You are about to permanently delete:</p>
            <div className="organization-details">
              <p><strong>Name:</strong> {organization.name}</p>
              <p><strong>Slug:</strong> {organization.slug}</p>
              <p><strong>Users:</strong> {organization.user_count || 0}</p>
              <p><strong>Assets:</strong> {organization.asset_count || 0}</p>
              <p><strong>Tasks:</strong> {organization.task_count || 0}</p>
            </div>
            <p className="danger-text">
              This will delete <strong>ALL</strong> data associated with this organization including:
            </p>
            <ul className="deletion-list">
              <li>All users and their profiles</li>
              <li>All assets and equipment</li>
              <li>All tasks and checklist responses</li>
              <li>All CM letters and reports</li>
              <li>All inventory records</li>
              <li>All calendar events</li>
              <li>All files and documents</li>
              <li>All configuration settings</li>
            </ul>
          </div>
          <div className="confirmation-input">
            <label>
              Type <strong>{requiredText}</strong> to confirm deletion (case-insensitive):
            </label>
            <input
              type="text"
              value={confirmationText}
              onChange={(e) => setConfirmationText(e.target.value)}
              placeholder={`Type "${organization.name}" here`}
              disabled={isDeleting}
              autoFocus
            />
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-danger" onClick={handleConfirm} disabled={!isConfirmed || isDeleting}>
            {isDeleting ? 'Deleting...' : 'Delete'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleCancel} disabled={isDeleting}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

function OrganizationManagement() {
  const { user: currentUser } = useAuth();

  // Data
  const [organizations, setOrganizations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState(null);

  // UI state
  const [showForm, setShowForm] = useState(false);
  const [editingOrg, setEditingOrg] = useState(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [orgToDelete, setOrgToDelete] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);

  // Search, filter, sort
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'active' | 'inactive'
  const [sortColumn, setSortColumn] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');

  // Edit form data
  const [formData, setFormData] = useState({ name: '', slug: '', is_active: true });

  // Wizard state (create mode only)
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardFeatures, setWizardFeatures] = useState({
    dashboard: true,
    tasks: true,
    calendar: true,
    inventory: true,
    cm_letters: true,
    plant: true,
    templates: true,
    users: true,
    scada: false
  });
  const [firstUser, setFirstUser] = useState({ username: '', email: '', full_name: '', password: '' });

  // ── Load data ──

  useEffect(() => { loadOrganizations(); }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (openMenuId && !event.target.closest('.org-menu-container')) {
        setOpenMenuId(null);
      }
    };
    if (openMenuId) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [openMenuId]);

  const loadOrganizations = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${getApiBaseUrl()}/organizations`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to load organizations');
      const data = await response.json();
      setOrganizations(data);
    } catch (err) {
      setError('Failed to load organizations: ' + getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  // ── Filtering / sorting (client-side) ──

  const filteredOrganizations = useMemo(() => {
    let list = [...organizations];

    // Status filter
    if (statusFilter === 'active') list = list.filter(o => o.is_active);
    else if (statusFilter === 'inactive') list = list.filter(o => !o.is_active);

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(o =>
        (o.name && o.name.toLowerCase().includes(q)) ||
        (o.slug && o.slug.toLowerCase().includes(q))
      );
    }

    // Sort
    list.sort((a, b) => {
      let valA, valB;
      switch (sortColumn) {
        case 'name':    valA = (a.name || '').toLowerCase();   valB = (b.name || '').toLowerCase();   break;
        case 'users':   valA = a.user_count || 0;              valB = b.user_count || 0;              break;
        case 'assets':  valA = a.asset_count || 0;             valB = b.asset_count || 0;             break;
        case 'tasks':   valA = a.task_count || 0;              valB = b.task_count || 0;              break;
        case 'status':  valA = a.is_active ? 1 : 0;           valB = b.is_active ? 1 : 0;            break;
        case 'created': valA = a.created_at || '';             valB = b.created_at || '';              break;
        default:        valA = '';                              valB = '';
      }
      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  }, [organizations, statusFilter, searchQuery, sortColumn, sortDirection]);

  const handleSort = useCallback((col) => {
    if (sortColumn === col) {
      setSortDirection(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(col);
      setSortDirection('asc');
    }
  }, [sortColumn]);

  const renderSortArrow = (col) => {
    if (sortColumn !== col) return null;
    return (
      <i className={`bi ${sortDirection === 'asc' ? 'bi-chevron-up' : 'bi-chevron-down'} sort-arrow`}></i>
    );
  };

  // ── Form handlers ──

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    setError('');

    try {
      if (editingOrg) {
        // Simple edit - no wizard
        const response = await fetch(`${getApiBaseUrl()}/organizations/${editingOrg.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(formData)
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to save organization');
        }
      } else {
        // Create with wizard data
        const body = {
          ...formData,
          first_user:
            firstUser.username?.trim() && firstUser.email?.trim() && firstUser.full_name?.trim()
              ? {
                  username: firstUser.username.trim(),
                  email: firstUser.email.trim(),
                  full_name: firstUser.full_name.trim(),
                  password: firstUser.password?.trim() || undefined
                }
              : undefined
        };

        const response = await fetch(`${getApiBaseUrl()}/organizations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body)
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to create organization');
        }

        const newOrg = await response.json();
        const newOrgId = newOrg.id || newOrg.organization?.id;

        // Save selected features
        if (newOrgId) {
          const featuresPayload = FEATURE_KEYS.map(feature_code => ({
            feature_code,
            is_enabled: !!wizardFeatures[feature_code],
            config: {}
          }));
          try {
            await fetch(`${getApiBaseUrl()}/organizations/${newOrgId}/features`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ features: featuresPayload })
            });
          } catch (_) {
            // non-critical; org was created successfully
          }
        }
      }

      await loadOrganizations();
      setSuccessMessage(editingOrg
        ? `Organization "${formData.name}" updated successfully`
        : `Organization "${formData.name}" created successfully`
      );
      handleCancel();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const handleEdit = (org) => {
    setEditingOrg(org);
    setFormData({ name: org.name, slug: org.slug, is_active: org.is_active });
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingOrg(null);
    setFormData({ name: '', slug: '', is_active: true });
    setFirstUser({ username: '', email: '', full_name: '', password: '' });
    setWizardStep(1);
    setWizardFeatures({
      dashboard: true,
      tasks: true,
      calendar: true,
      inventory: true,
      cm_letters: true,
      plant: true,
      templates: true,
      users: true,
      scada: false
    });
    setError('');
  };

  // ── Delete ──

  const handleDeleteClick = (org) => { setOrgToDelete(org); setDeleteModalOpen(true); };

  const handleDeleteConfirm = async () => {
    if (!orgToDelete) return;
    try {
      setError('');
      const response = await fetch(`${getApiBaseUrl()}/organizations/${orgToDelete.id}`, { method: 'DELETE', credentials: 'include' });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete organization');
      }
      await loadOrganizations();
      setSuccessMessage(`Organization "${orgToDelete.name}" deleted successfully`);
      setDeleteModalOpen(false);
      setOrgToDelete(null);
    } catch (err) {
      setError(getErrorMessage(err));
      setDeleteModalOpen(false);
      setOrgToDelete(null);
    }
  };

  const handleDeleteCancel = () => { setDeleteModalOpen(false); setOrgToDelete(null); };

  // ── Deactivate / Reactivate ──

  const handleDeactivate = (org) => {
    setConfirmDialog({
      title: 'Deactivate Organization',
      message: `Are you sure you want to deactivate "${org.name}"? This will disable the organization but keep all data.`,
      confirmLabel: 'Deactivate',
      variant: 'warning',
      onConfirm: async () => {
        try {
          setError('');
          const response = await fetch(`${getApiBaseUrl()}/organizations/${org.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name: org.name, slug: org.slug, is_active: false })
          });
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to deactivate organization');
          }
          await loadOrganizations();
          setSuccessMessage(`Organization "${org.name}" deactivated successfully`);
        } catch (err) {
          setError(getErrorMessage(err));
        }
      }
    });
  };

  const handleReactivate = async (org) => {
    try {
      setError('');
      const response = await fetch(`${getApiBaseUrl()}/organizations/${org.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: org.name, slug: org.slug, is_active: true })
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to reactivate organization');
      }
      await loadOrganizations();
      setSuccessMessage(`Organization "${org.name}" reactivated successfully`);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  // ── Wizard navigation ──

  const handleStartCreate = () => {
    setEditingOrg(null);
    setFormData({ name: '', slug: '', is_active: true });
    setFirstUser({ username: '', email: '', full_name: '', password: '' });
    setWizardStep(1);
    setWizardFeatures({
      dashboard: true,
      tasks: true,
      calendar: true,
      inventory: true,
      cm_letters: true,
      plant: true,
      templates: true,
      users: true,
      scada: false
    });
    setShowForm(true);
  };

  const wizardCanGoNext = () => {
    if (wizardStep === 1) return formData.name.trim() && formData.slug.trim();
    return true;
  };

  // ── Render ──

  if (loading) {
    return <div className="org-management-container"><div className="loading">Loading organizations...</div></div>;
  }

  return (
    <div className="org-management-container">
      <div className="org-management-header">
        <h2>Organization Management</h2>
        <button className="btn btn-sm btn-primary" onClick={handleStartCreate} disabled={showForm}>
          Create
        </button>
      </div>

      <SuccessAlert message={successMessage} onClose={() => setSuccessMessage(null)} />

      {error && <div className="error-message">{error}</div>}

      {/* ── Create Wizard (3-step) ── */}
      {showForm && !editingOrg && (
        <div className="wizard-container">
          <div className="wizard-steps">
            {[
              { num: 1, label: 'Basic Info' },
              { num: 2, label: 'Features' },
              { num: 3, label: 'Admin User' }
            ].map(s => (
              <div
                key={s.num}
                className={`wizard-step ${wizardStep === s.num ? 'active' : ''} ${wizardStep > s.num ? 'completed' : ''}`}
              >
                <span className="step-number">
                  {wizardStep > s.num ? <i className="bi bi-check"></i> : s.num}
                </span>
                Step {s.num} of 3: {s.label}
              </div>
            ))}
          </div>

          <div className="wizard-body">
            <p className="wizard-step-description">{WIZARD_STEP_DESCRIPTIONS[wizardStep]}</p>

            {/* Step 1: Basic Info */}
            {wizardStep === 1 && (
              <>
                <div className="form-group">
                  <label>Name *</label>
                  <input type="text" name="name" value={formData.name} onChange={handleInputChange} required placeholder="Organization name" />
                </div>
                <FormField
                  label="Slug"
                  name="slug"
                  type="text"
                  value={formData.slug}
                  onChange={handleInputChange}
                  required
                  placeholder="organization-slug"
                  hint="URL-friendly identifier (e.g., 'acme-solar'). Used in URLs and API endpoints. Only lowercase letters, numbers, and hyphens."
                  validate={(value) => {
                    if (!/^[a-z0-9-]+$/.test(value)) {
                      return 'Only lowercase letters, numbers, and hyphens allowed';
                    }
                    return null;
                  }}
                />
                <div className="form-group">
                  <label>
                    <input type="checkbox" name="is_active" checked={formData.is_active} onChange={handleInputChange} /> Active
                  </label>
                </div>
              </>
            )}

            {/* Step 2: Features */}
            {wizardStep === 2 && (
              <div className="feature-checklist">
                {FEATURE_KEYS.map(k => (
                  <label key={k} className="feature-item">
                    <input
                      type="checkbox"
                      checked={wizardFeatures[k]}
                      onChange={(e) => setWizardFeatures(prev => ({ ...prev, [k]: e.target.checked }))}
                    />
                    <div className="feature-item-info">
                      <div className="feature-item-header">
                        <span className="feature-item-label">{formatFeatureName(k)}</span>
                        <i className="bi bi-info-circle feature-info-icon" title={FEATURE_DESCRIPTIONS[k]}></i>
                      </div>
                      <span className="feature-item-desc">{FEATURE_DESCRIPTIONS[k]}</span>
                    </div>
                  </label>
                ))}
              </div>
            )}

            {/* Step 3: First Admin User (optional) */}
            {wizardStep === 3 && (
              <>
                <h4 className="form-section-title">First admin user (optional)</h4>
                <p className="form-section-desc">Create an Operations Administrator for this organization so they can log in and add others.</p>
                <div className="form-group">
                  <label>Username</label>
                  <input type="text" value={firstUser.username} onChange={(e) => setFirstUser(prev => ({ ...prev, username: e.target.value }))} placeholder="Username for first admin" />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input type="email" value={firstUser.email} onChange={(e) => setFirstUser(prev => ({ ...prev, email: e.target.value }))} placeholder="Email for first admin" />
                </div>
                <div className="form-group">
                  <label>Full name</label>
                  <input type="text" value={firstUser.full_name} onChange={(e) => setFirstUser(prev => ({ ...prev, full_name: e.target.value }))} placeholder="Full name" />
                </div>
                <div className="form-group">
                  <label>Password (optional)</label>
                  <input type="password" value={firstUser.password} onChange={(e) => setFirstUser(prev => ({ ...prev, password: e.target.value }))} placeholder="Min 6 characters, or default will be used" />
                </div>
              </>
            )}
          </div>

          <div className="wizard-footer">
            <button type="button" className="btn btn-secondary" onClick={handleCancel}>Cancel</button>
            {wizardStep > 1 && (
              <button type="button" className="btn btn-secondary" onClick={() => setWizardStep(s => s - 1)}>Back</button>
            )}
            {wizardStep < 3 ? (
              <button type="button" className="btn btn-primary" onClick={() => setWizardStep(s => s + 1)} disabled={!wizardCanGoNext()}>Next</button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => handleSubmit()}>Create</button>
            )}
          </div>
        </div>
      )}

      {/* ── Edit Form (simple, no wizard) ── */}
      {showForm && editingOrg && (
        <div className="user-form-container">
          <h3>Edit Organization</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Name *</label>
              <input type="text" name="name" value={formData.name} onChange={handleInputChange} required placeholder="Organization name" />
            </div>
            <FormField
              label="Slug"
              name="slug"
              type="text"
              value={formData.slug}
              onChange={handleInputChange}
              required
              placeholder="organization-slug"
              hint="URL-friendly identifier (e.g., 'acme-solar'). Used in URLs and API endpoints. Only lowercase letters, numbers, and hyphens."
              validate={(value) => {
                if (!/^[a-z0-9-]+$/.test(value)) {
                  return 'Only lowercase letters, numbers, and hyphens allowed';
                }
                return null;
              }}
            />
            <div className="form-group">
              <label>
                <input type="checkbox" name="is_active" checked={formData.is_active} onChange={handleInputChange} /> Active
              </label>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">Update</button>
              <button type="button" className="btn btn-secondary" onClick={handleCancel}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Toolbar: search + filter + count ── */}
      <div className="org-toolbar">
        <div className="org-search-bar">
          <i className="bi bi-search search-icon"></i>
          <input
            type="text"
            placeholder="Search by name or slug..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="org-filter-buttons">
          {['all', 'active', 'inactive'].map(f => (
            <button
              key={f}
              className={`filter-btn ${statusFilter === f ? 'active' : ''}`}
              onClick={() => setStatusFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <span className="org-result-count">
          Showing {filteredOrganizations.length} of {organizations.length} organizations
        </span>
      </div>

      {/* ── Table ── */}
      <div className="users-table-container">
        <table className="users-table">
          <thead>
            <tr>
              <th className="sortable-th" onClick={() => handleSort('name')}>Name {renderSortArrow('name')}</th>
              <th>Slug <i className="bi bi-info-circle column-info-icon" title="URL-friendly identifier used in links and API calls"></i></th>
              <th>Plan <i className="bi bi-info-circle column-info-icon" title="Subscription plan. Edit in Settings page."></i></th>
              <th className="sortable-th" onClick={() => handleSort('users')}>Users {renderSortArrow('users')}</th>
              <th className="sortable-th" onClick={() => handleSort('assets')}>Assets {renderSortArrow('assets')}</th>
              <th className="sortable-th" onClick={() => handleSort('tasks')}>Tasks {renderSortArrow('tasks')}</th>
              <th className="sortable-th" onClick={() => handleSort('status')}>Status {renderSortArrow('status')}</th>
              <th className="sortable-th" onClick={() => handleSort('created')}>Created {renderSortArrow('created')}</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredOrganizations.length === 0 ? (
              <tr>
                <td colSpan="9" className="no-data">
                  <div className="table-empty-state">
                    <i className="bi bi-building" style={{ fontSize: '48px', color: '#cbd5e1', marginBottom: '12px' }}></i>
                    {organizations.length === 0 ? (
                      <>
                        <p style={{ fontWeight: 600, fontSize: '16px', marginBottom: '8px' }}>No Organizations Yet</p>
                        <p style={{ marginBottom: '0' }}>Create your first organization to get started managing solar installations.</p>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={handleStartCreate}
                          style={{ marginTop: '12px' }}
                        >
                          <i className="bi bi-plus-circle"></i> Create Organization
                        </button>
                      </>
                    ) : (
                      <>
                        <p style={{ fontWeight: 600, fontSize: '16px', marginBottom: '8px' }}>No Matching Organizations</p>
                        <p style={{ marginBottom: '8px' }}>
                          {searchQuery.trim()
                            ? <>No organizations match your search for "<strong>{searchQuery}</strong>".</>
                            : <>No organizations match your current filter ({statusFilter}).</>
                          }
                        </p>
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() => { setSearchQuery(''); setStatusFilter('all'); }}
                          style={{ marginTop: '8px' }}
                        >
                          Clear Filters
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              filteredOrganizations.map(org => (
                <tr key={org.id}>
                  <td>{org.name}</td>
                  <td>{org.slug}</td>
                  <td>{org.subscription_plan || '-'}</td>
                  <td>{org.user_limit != null ? `${org.user_count || 0} / ${org.user_limit}` : (org.user_count || 0)}</td>
                  <td>{org.asset_count || 0}</td>
                  <td>{org.task_count || 0}</td>
                  <td>
                    <span className={`status-badge ${org.is_active ? 'active' : 'inactive'}`}>
                      {org.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>{new Date(org.created_at).toLocaleDateString()}</td>
                  <td>
                    <div className="action-buttons">
                      <button className="btn btn-sm btn-secondary" onClick={() => handleEdit(org)} title="Edit organization">Edit</button>
                      {org.is_active ? (
                        <button className="btn btn-sm btn-warning" onClick={() => handleDeactivate(org)} title="Pause organization">
                          <i className="bi bi-pause-circle"></i> Pause
                        </button>
                      ) : (
                        <button className="btn btn-sm btn-success" onClick={() => handleReactivate(org)} title="Resume organization">
                          <i className="bi bi-play-circle"></i> Resume
                        </button>
                      )}
                      <button className="btn btn-sm btn-danger" onClick={() => handleDeleteClick(org)} title="Delete organization">
                        <i className="bi bi-trash3"></i> Delete
                      </button>
                      <div className="org-menu-container">
                        <button
                          className="btn btn-xs btn-secondary org-menu-btn"
                          onClick={() => setOpenMenuId(openMenuId === org.id ? null : org.id)}
                          title="Settings and branding"
                        >
                          <i className="bi bi-three-dots-vertical"></i>
                        </button>
                        {openMenuId === org.id && (
                          <div className={`org-menu-dropdown ${organizations.indexOf(org) === organizations.length - 1 ? 'org-menu-dropdown-up' : ''}`}>
                            <Link to={`/platform/organizations/${org.id}/settings`} className="org-menu-item" onClick={() => setOpenMenuId(null)}>Settings</Link>
                            <Link to={`/platform/organizations/${org.id}/branding`} className="org-menu-item" onClick={() => setOpenMenuId(null)}>Branding</Link>
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <DeleteConfirmationModal
        isOpen={deleteModalOpen}
        organization={orgToDelete}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />

      <ConfirmDialog
        dialog={confirmDialog}
        onClose={() => setConfirmDialog(null)}
      />
    </div>
  );
}

export default OrganizationManagement;
