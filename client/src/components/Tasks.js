import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { getTasks, createTask, bulkDeleteTasks, getChecklistTemplates, getUsers } from '../api/api';
import { useAuth } from '../context/AuthContext';
import { hasOrganizationContext, isSystemOwnerWithoutCompany } from '../utils/organizationContext';
import { getErrorMessage } from '../utils/errorHandler';
import { ErrorAlert, SuccessAlert } from './ErrorAlert';
import './Tasks.css';

function Tasks() {
  const { isAdmin, isSuperAdmin, isTechnician, user, loading: authLoading } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [users, setUsers] = useState([]);
  const [filters, setFilters] = useState({
    status: '',
    task_type: '',
    completed_date: '',
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const tasksPerPage = 10;

  const [newTask, setNewTask] = useState({
    checklist_template_id: '',
    location: '',
    assigned_to: [], // Changed to array for multiple users
    task_type: 'PM',
    scheduled_date: '',
    hours_worked: '',
    budgeted_hours: ''
  });
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [creating, setCreating] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState([]);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [assignToDropdownOpen, setAssignToDropdownOpen] = useState(false);
  const [assignToSearch, setAssignToSearch] = useState('');
  const assignToDropdownRef = useRef(null);

  useEffect(() => {
    // Wait for AuthContext to finish loading before checking organization context
    if (authLoading) {
      return; // Don't check until auth is loaded
    }
    
    loadTasks();
    loadTemplates();
    if (isAdmin() || isTechnician()) {
      loadUsers();
    }
  }, [filters, isAdmin, isTechnician, authLoading]);

  const loadTasks = async () => {
    try {
      // Check if user has organization context
      if (!hasOrganizationContext(user)) {
        // System owner without company: show empty tasks
        setTasks([]);
        setLoading(false);
        return;
      }
      
      const params = { task_type: 'PM' }; // Filter for PM tasks only
      if (filters.status) params.status = filters.status;
      if (filters.completed_date) params.completed_date = filters.completed_date;
      
      const response = await getTasks(params);
      setTasks(response.data);
      setSelectedTaskIds([]); // Clear selection on reload
      setLoading(false);
    } catch (error) {
      console.error('Error loading tasks:', error);
      setLoading(false);
    }
  };


  const loadTemplates = async () => {
    try {
      // Check if user has organization context
      if (!hasOrganizationContext(user)) {
        // System owner without company: show empty templates
        setTemplates([]);
        return;
      }
      
      console.log('Loading templates for task creation...');
      const response = await getChecklistTemplates();
      console.log('Templates loaded:', response.data);
      setTemplates(response.data);
    } catch (error) {
      console.error('Error loading templates:', error);
      // Error will be shown inline if needed
    }
  };

  const loadUsers = async () => {
    try {
      const response = await getUsers();
      setUsers(response.data);
    } catch (error) {
      console.error('Error loading users:', error);
    }
  };

  const handleCreateTask = async (e) => {
    e.preventDefault();
    
    // Frontend validation: Ensure required fields are present
    if (!newTask.checklist_template_id || newTask.checklist_template_id.trim() === '') {
      // Validation error - can be shown inline in form
      return;
    }
    
    setCreating(true);
    try {
      // Allow manual scheduling for all task types
      // If not provided, backend will set appropriate defaults
      // Convert empty strings to undefined to match validation expectations
      const taskData = {
        ...newTask,
        checklist_template_id: newTask.checklist_template_id.trim(), // Required - ensure it's not empty
        location: newTask.location && newTask.location.trim() ? newTask.location.trim() : undefined,
        assigned_to: newTask.assigned_to && newTask.assigned_to.length > 0 ? newTask.assigned_to : undefined,
        task_type: newTask.task_type || 'PM',
        scheduled_date: newTask.scheduled_date || undefined, // Send if provided, otherwise let backend decide
        hours_worked: newTask.hours_worked ? parseFloat(newTask.hours_worked) : undefined,
        budgeted_hours: isSuperAdmin() && newTask.budgeted_hours ? parseFloat(newTask.budgeted_hours) : undefined
      };
      
      const response = await createTask(taskData);
      console.log('Task created successfully:', response.data);
      
      setShowCreateForm(false);
      setNewTask({
        checklist_template_id: '',
        location: '',
        assigned_to: [],
        task_type: 'PM',
        scheduled_date: '',
        hours_worked: '',
        budgeted_hours: ''
      });
      loadTasks();
      const taskLabel = (response.data.template_name && response.data.template_name.trim()) ? response.data.template_name : response.data.task_code;
      setSuccess(`Task created successfully! Task: ${taskLabel}`);
    } catch (err) {
      console.error('Error creating task:', err);
      const errorMessage = getErrorMessage(err, 'Failed to create task');
      setError({ message: `Failed to create task: ${errorMessage}` });
    } finally {
      setCreating(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedTaskIds.length === 0) return;
    setDeleting(true);
    try {
      const response = await bulkDeleteTasks(selectedTaskIds);
      setSuccess(response.data.message);
      setSelectedTaskIds([]);
      setShowDeleteConfirm(false);
      loadTasks();
    } catch (err) {
      console.error('Error deleting tasks:', err);
      const errorMessage = getErrorMessage(err, 'Failed to delete tasks');
      setError({ message: errorMessage });
    } finally {
      setDeleting(false);
    }
  };

  const toggleTaskSelection = (taskId) => {
    setSelectedTaskIds(prev =>
      prev.includes(taskId) ? prev.filter(id => id !== taskId) : [...prev, taskId]
    );
  };

  const toggleSelectAll = (filteredTasks) => {
    const currentPageIds = filteredTasks
      .slice((currentPage - 1) * tasksPerPage, currentPage * tasksPerPage)
      .map(t => t.id);
    const allSelected = currentPageIds.every(id => selectedTaskIds.includes(id));
    if (allSelected) {
      setSelectedTaskIds(prev => prev.filter(id => !currentPageIds.includes(id)));
    } else {
      setSelectedTaskIds(prev => [...new Set([...prev, ...currentPageIds])]);
    }
  };

  const assignableUsers = users.filter(u => {
    if (!u.is_active) return false;
    const userRoles = Array.isArray(u.roles) ? u.roles : (u.role ? [u.role] : []);
    return userRoles.some(r => r === 'admin' || r === 'technician');
  });
  const assignToFilteredUsers = assignToSearch.trim()
    ? assignableUsers.filter(u => {
        const name = (u.full_name || u.username || '').toLowerCase();
        return name.includes(assignToSearch.trim().toLowerCase());
      })
    : assignableUsers;

  useEffect(() => {
    if (!assignToDropdownOpen) return;
    const handleClickOutside = (e) => {
      if (assignToDropdownRef.current && !assignToDropdownRef.current.contains(e.target)) {
        setAssignToDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [assignToDropdownOpen]);

  if (loading) {
    return <div className="loading">Loading tasks...</div>;
  }

  return (
    <div>
      <ErrorAlert error={error} onClose={() => setError(null)} title="Task Error" />
      <SuccessAlert message={success} onClose={() => setSuccess(null)} title="Success" />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h2 className="page-title" style={{ marginBottom: 0 }}>PM Tasks</h2>
        {(isAdmin() || isTechnician()) && (
          <button className="btn btn-sm btn-primary" onClick={() => setShowCreateForm(!showCreateForm)}>
            {showCreateForm ? 'Cancel' : 'New'}
          </button>
        )}
      </div>

      {showCreateForm && (
        <div className="card">
          <h3>New Task</h3>
          <form onSubmit={handleCreateTask}>
            <div className="form-group">
              <label>Task Name</label>
              <select
                value={newTask.checklist_template_id}
                onChange={(e) => setNewTask({ ...newTask, checklist_template_id: e.target.value })}
                required
              >
                <option value="">Select task...</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.template_name} ({t.template_code})
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Location (Optional)</label>
              <input
                type="text"
                value={newTask.location}
                onChange={(e) => setNewTask({ ...newTask, location: e.target.value })}
                placeholder="Enter location (e.g., DC Combiner Board, Inverter 1, etc.)"
                style={{ width: '100%', padding: '8px 12px', fontSize: '14px', border: '1px solid #ddd', borderRadius: '4px' }}
              />
              <small style={{ display: 'block', marginTop: '5px', color: '#666' }}>
                Optional: Specify the location for this task
              </small>
            </div>
            {(isAdmin() || isTechnician()) && (
              <div className="form-group assign-to-users-wrap" ref={assignToDropdownRef}>
                <label>Assign To (Users)</label>
                <div
                  className="assign-to-users-field"
                  role="combobox"
                  aria-expanded={assignToDropdownOpen}
                  aria-haspopup="listbox"
                  aria-label="Select users to assign"
                >
                  <div className="assign-to-users-chips">
                    {newTask.assigned_to.length === 0 ? (
                      <span className="assign-to-users-placeholder">Select users to assign...</span>
                    ) : (
                      newTask.assigned_to.map(userId => {
                        const u = users.find(x => x.id === userId);
                        return u ? (
                          <span key={userId} className="assign-to-chip">
                            {u.full_name || u.username}
                            <button
                              type="button"
                              className="assign-to-chip-remove"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setNewTask({ ...newTask, assigned_to: newTask.assigned_to.filter(id => id !== userId) });
                              }}
                              aria-label={`Remove ${u.full_name || u.username}`}
                            >
                              ×
                            </button>
                          </span>
                        ) : null;
                      })
                    )}
                  </div>
                  <button
                    type="button"
                    className="assign-to-users-trigger"
                    onClick={() => { setAssignToDropdownOpen(!assignToDropdownOpen); setAssignToSearch(''); }}
                    aria-label={assignToDropdownOpen ? 'Close user list' : 'Open user list'}
                  >
                    {assignToDropdownOpen ? '▲' : '▼'}
                  </button>
                </div>
                {assignToDropdownOpen && (
                  <div className="assign-to-users-dropdown">
                    <input
                      type="text"
                      className="assign-to-users-search"
                      placeholder="Search by name..."
                      value={assignToSearch}
                      onChange={(e) => setAssignToSearch(e.target.value)}
                      autoFocus
                    />
                    <ul className="assign-to-users-list" role="listbox">
                      {assignToFilteredUsers.length === 0 ? (
                        <li className="assign-to-users-list-empty">No users match</li>
                      ) : (
                        assignToFilteredUsers.map((u) => {
                          const isSelected = newTask.assigned_to.includes(u.id);
                          return (
                            <li
                              key={u.id}
                              role="option"
                              aria-selected={isSelected}
                              className={`assign-to-users-option ${isSelected ? 'selected' : ''}`}
                              onClick={() => {
                                setNewTask({
                                  ...newTask,
                                  assigned_to: isSelected
                                    ? newTask.assigned_to.filter(id => id !== u.id)
                                    : [...newTask.assigned_to, u.id]
                                });
                              }}
                            >
                              <span className="assign-to-users-option-name">{u.full_name || u.username}</span>
                              {isSelected && <span className="assign-to-users-option-check">✓</span>}
                            </li>
                          );
                        })
                      )}
                    </ul>
                  </div>
                )}
                {newTask.assigned_to.length > 0 && (
                  <div className="assign-to-users-count">
                    {newTask.assigned_to.length} user{newTask.assigned_to.length !== 1 ? 's' : ''} selected
                  </div>
                )}
              </div>
            )}
            <div className="form-group">
              <label>Task Type</label>
              <select
                value={newTask.task_type}
                  onChange={(e) => {
                    const taskType = e.target.value;
                    setNewTask({
                      ...newTask,
                      task_type: taskType
                      // Keep scheduled_date when switching task types
                    });
                  }}
                required
              >
                <option value="PM">Preventive Maintenance (PM)</option>
                <option value="PCM">Planned Corrective Maintenance (PCM)</option>
                <option value="UCM">Unplanned Corrective Maintenance (UCM)</option>
              </select>
            </div>
            <div className="form-group">
              <label>
                Scheduled Date
              </label>
              <input
                type="date"
                value={newTask.scheduled_date}
                onChange={(e) => setNewTask({ ...newTask, scheduled_date: e.target.value })}
                min={new Date().toISOString().split('T')[0]} // Prevent selecting past dates
              />
            </div>
            <div className="form-group">
              <label>Hours Worked (Optional)</label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={newTask.hours_worked}
                onChange={(e) => setNewTask({ ...newTask, hours_worked: e.target.value })}
                placeholder="0.0"
              />
              <small style={{ display: 'block', marginTop: '5px', color: '#666' }}>
                Number of hours worked on this task (if already started)
              </small>
            </div>
            {isSuperAdmin() && (
              <div className="form-group">
                <label>Budgeted Hours (Super Admin Only)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={newTask.budgeted_hours}
                  onChange={(e) => setNewTask({ ...newTask, budgeted_hours: e.target.value })}
                  placeholder="0.0"
                />
                <small style={{ display: 'block', marginTop: '5px', color: '#666' }}>
                  Maximum hours allocated for this task. Task will be flagged if exceeded.
                </small>
              </div>
            )}
            <button type="submit" className={`btn btn-primary ${creating ? 'btn-loading' : ''}`} disabled={creating}>
              <span>Create</span>
            </button>
          </form>
        </div>
      )}

      <div className="card">
        <div className="tasks-filters" style={{ marginBottom: '15px' }}>
          <h3 style={{ marginTop: 0, marginBottom: '12px' }}>Filters</h3>
          <div style={{ marginBottom: '12px' }}>
              <input
                type="text"
                className="tasks-search-input"
                placeholder="Search by task code, task name, location, or assignee..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                style={{ width: '100%', padding: '10px 12px', fontSize: '14px', border: '1px solid #ddd', borderRadius: '6px', boxSizing: 'border-box' }}
              />
            </div>
          <div className="filters-container" style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ flex: 1, minWidth: '200px' }}>
              <label>Status</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              >
                <option value="">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
              </select>
            </div>
            <div className="form-group" style={{ flex: 1, minWidth: '200px' }}>
              <label>Task Type</label>
              <select
                value={filters.task_type}
                onChange={(e) => setFilters({ ...filters, task_type: e.target.value })}
              >
                <option value="">All Types</option>
                <option value="PM">PM</option>
                <option value="PCM">PCM</option>
                <option value="UCM">UCM</option>
              </select>
            </div>
            <div className="form-group" style={{ flex: 1, minWidth: '200px' }}>
              <label>Completed Date</label>
              <input
                type="date"
                value={filters.completed_date}
                onChange={(e) => setFilters({ ...filters, completed_date: e.target.value })}
                title="Filter by task completion date"
              />
            </div>
          </div>
          {filters.completed_date && (
            <div style={{ marginTop: '10px' }}>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => setFilters({ ...filters, completed_date: '' })}
              >
                Clear Date Filter
              </button>
            </div>
          )}
        </div>

        {tasks.length === 0 ? (
          <p style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
            No tasks found matching the selected filters
          </p>
        ) : (
          <>
            {(filters.status || filters.task_type || filters.completed_date || searchQuery.trim()) && (
              <div style={{ marginBottom: '15px', padding: '12px', background: '#e3f2fd', borderRadius: '8px', borderLeft: '4px solid #1A73E8' }}>
                <div style={{ fontSize: '14px', color: '#666' }}>
                  Active filters:
                  {searchQuery.trim() && <span style={{ marginLeft: '8px', padding: '4px 8px', background: '#fff', borderRadius: '4px' }}>Search: "{searchQuery.trim()}"</span>}
                  {filters.status && <span style={{ marginLeft: '8px', padding: '4px 8px', background: '#fff', borderRadius: '4px' }}>Status: {filters.status}</span>}
                  {filters.task_type && <span style={{ marginLeft: '8px', padding: '4px 8px', background: '#fff', borderRadius: '4px' }}>Type: {filters.task_type}</span>}
                  {filters.completed_date && <span style={{ marginLeft: '8px', padding: '4px 8px', background: '#fff', borderRadius: '4px' }}>Completed: {new Date(filters.completed_date).toLocaleDateString()}</span>}
                </div>
              </div>
            )}
            
            {/* Delete confirmation modal */}
            {showDeleteConfirm && (
              <div style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                background: 'rgba(0,0,0,0.5)', zIndex: 2000,
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <div style={{
                  background: '#fff', borderRadius: '8px', padding: '24px',
                  maxWidth: '420px', width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.2)'
                }}>
                  <h3 style={{ margin: '0 0 12px 0', color: '#dc3545' }}>
                    <i className="bi bi-exclamation-triangle-fill" style={{ marginRight: '8px' }}></i>
                    Confirm Delete
                  </h3>
                  <p style={{ margin: '0 0 8px 0', color: '#333' }}>
                    Are you sure you want to permanently delete <strong>{selectedTaskIds.length}</strong> task{selectedTaskIds.length !== 1 ? 's' : ''}?
                  </p>
                  <p style={{ margin: '0 0 20px 0', color: '#999', fontSize: '13px' }}>
                    This will also delete all associated checklist responses, assignments, and reports. This action cannot be undone.
                  </p>
                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                    <button
                      className="btn btn-secondary"
                      onClick={() => setShowDeleteConfirm(false)}
                      disabled={deleting}
                    >
                      Cancel
                    </button>
                    <button
                      className={`btn btn-danger ${deleting ? 'btn-loading' : ''}`}
                      onClick={handleBulkDelete}
                      disabled={deleting}
                      style={{ background: '#dc3545', color: '#fff', border: 'none' }}
                    >
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Selection action bar */}
            {isSuperAdmin() && selectedTaskIds.length > 0 && (
              <div style={{
                marginBottom: '12px', padding: '10px 16px',
                background: '#fff3cd', borderRadius: '8px',
                borderLeft: '4px solid #ffc107',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                flexWrap: 'wrap', gap: '8px'
              }}>
                <span style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>
                  {selectedTaskIds.length} task{selectedTaskIds.length !== 1 ? 's' : ''} selected
                </span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => setSelectedTaskIds([])}
                  >
                    Clear
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => setShowDeleteConfirm(true)}
                    style={{ background: '#dc3545', color: '#fff', border: 'none' }}
                  >
                    <i className="bi bi-trash" style={{ marginRight: '4px' }}></i>
                    Delete
                  </button>
                </div>
              </div>
            )}

            {(() => {
              // Apply text search filter
              const filteredTasks = searchQuery.trim()
                ? tasks.filter(t => {
                    const q = searchQuery.toLowerCase();
                    return (t.task_code || '').toLowerCase().includes(q) ||
                           (t.template_name || '').toLowerCase().includes(q) ||
                           (t.location || '').toLowerCase().includes(q) ||
                           (t.assigned_to_names || []).some(n => n.toLowerCase().includes(q));
                  })
                : tasks;

              const totalPages = Math.ceil(filteredTasks.length / tasksPerPage);
              const startIndex = (currentPage - 1) * tasksPerPage;
              const endIndex = startIndex + tasksPerPage;
              const currentTasks = filteredTasks.slice(startIndex, endIndex);
              const startTask = filteredTasks.length > 0 ? startIndex + 1 : 0;
              const endTask = Math.min(endIndex, filteredTasks.length);

              return (
                <>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #ddd' }}>
                        {isSuperAdmin() && (
                          <th style={{ padding: '10px', textAlign: 'center', width: '40px' }}>
                            <input
                              type="checkbox"
                              checked={currentTasks.length > 0 && currentTasks.every(t => selectedTaskIds.includes(t.id))}
                              onChange={() => toggleSelectAll(filteredTasks)}
                              title="Select all on this page"
                              style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                            />
                          </th>
                        )}
                        <th style={{ padding: '10px', textAlign: 'left' }}>Task Code</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Task Name</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Type</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Location</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Assigned To</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Status</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Hours</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Scheduled</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentTasks.map((task) => {
                        const isFlagged = task.is_flagged;
                        const hoursExceeded = task.budgeted_hours && task.hours_worked && 
                                             task.hours_worked > task.budgeted_hours && 
                                             task.status !== 'completed';
                        
                        const isSelected = selectedTaskIds.includes(task.id);
                        return (
                        <tr
                          key={task.id}
                          style={{
                            borderBottom: '1px solid #eee',
                            backgroundColor: isSelected ? '#e3f2fd' : (isFlagged ? '#fff3cd' : 'transparent'),
                            borderLeft: isFlagged ? '4px solid #ffc107' : 'none'
                          }}
                        >
                          {isSuperAdmin() && (
                            <td style={{ padding: '10px', textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleTaskSelection(task.id)}
                                style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                              />
                            </td>
                          )}
                          <td data-label="Task Code" style={{ padding: '10px' }}>
                            {task.task_code}
                            {isFlagged && (
                              <span style={{ 
                                marginLeft: '8px', 
                                padding: '2px 6px', 
                                background: '#ffc107', 
                                color: '#000',
                                borderRadius: '4px',
                                fontSize: '10px',
                                fontWeight: 'bold'
                              }}>
                                FLAGGED
                              </span>
                            )}
                          </td>
                          <td data-label="Task Name" style={{ padding: '10px' }}>{task.template_name || 'N/A'}</td>
                          <td data-label="Type" style={{ padding: '10px' }}>
                            <span className={`task-badge ${task.task_type}`} style={{ fontSize: '11px', padding: '4px 8px' }}>{task.task_type}</span>
                          </td>
                          <td data-label="Location" style={{ padding: '10px' }}>{task.location || task.asset_name || 'N/A'}</td>
                          <td data-label="Assigned To" style={{ padding: '10px' }}>
                            {task.assigned_users && task.assigned_users.length > 0 ? (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                {task.assigned_users.map((user, idx) => {
                                  // Extract first name from full_name or use username
                                  const displayName = user.full_name 
                                    ? user.full_name.split(' ')[0]
                                    : (user.username ? user.username.split(' ')[0] : 'Unknown');
                                  return (
                                    <span 
                                      key={user.id || idx} 
                                      style={{ 
                                        fontSize: '12px',
                                        color: '#333',
                                        whiteSpace: 'nowrap'
                                      }}
                                    >
                                      {displayName}
                                      {idx < task.assigned_users.length - 1 && ','}
                                    </span>
                                  );
                                })}
                              </div>
                            ) : (
                              <span style={{ color: '#999', fontStyle: 'italic', fontSize: '12px' }}>Unassigned</span>
                            )}
                          </td>
                          <td data-label="Status" style={{ padding: '10px' }}>
                            <span className={`task-badge ${task.status}`} style={{ fontSize: '10px', padding: '4px 8px', lineHeight: '1.2' }}>
                              {task.status.replace('_', ' ')}
                            </span>
                          </td>
                          <td data-label="Hours" style={{ padding: '10px' }}>
                            <div style={{ fontSize: '13px' }}>
                              {task.hours_worked ? (
                                <span style={{ color: hoursExceeded ? '#dc3545' : '#333', fontWeight: hoursExceeded ? 'bold' : 'normal' }}>
                                  {parseFloat(task.hours_worked).toFixed(1)}h
                                </span>
                              ) : (
                                <span style={{ color: '#999' }}>0h</span>
                              )}
                              {task.budgeted_hours && (
                                <span style={{ color: '#666', marginLeft: '4px' }}>
                                  / {parseFloat(task.budgeted_hours).toFixed(1)}h
                                </span>
                              )}
                              {hoursExceeded && (
                                <div style={{ fontSize: '11px', color: '#dc3545', marginTop: '2px' }}>
                                  Budget exceeded!
                                </div>
                              )}
                            </div>
                          </td>
                          <td data-label="Scheduled" style={{ padding: '10px' }}>
                            {task.scheduled_date ? new Date(task.scheduled_date).toLocaleDateString() : 'N/A'}
                          </td>
                          <td data-label="Action" style={{ padding: '10px' }}>
                            <Link to={`/tasks/${task.id}`} className="btn btn-sm btn-primary" style={{ width: 'auto', minWidth: 'auto' }}>
                              View
                            </Link>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center', 
                    marginTop: '15px',
                    flexWrap: 'wrap',
                    gap: '10px',
                    paddingTop: '12px',
                    borderTop: '1px solid #eee'
                  }}>
                    <div style={{ fontSize: '12px', color: '#666' }}>
                      Showing {startTask}-{endTask} of {tasks.length} task{tasks.length !== 1 ? 's' : ''}
                    </div>
                    {totalPages > 1 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span
                          onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                          style={{
                            fontSize: '18px',
                            color: currentPage === 1 ? '#ccc' : '#007bff',
                            cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                            userSelect: 'none',
                            padding: '4px 8px',
                            lineHeight: '1'
                          }}
                          title="Previous page"
                        >
                          ‹
                        </span>
                        <span style={{ fontSize: '12px', color: '#666', padding: '0 4px' }}>
                          Page {currentPage} of {totalPages}
                        </span>
                        <span
                          onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                          style={{
                            fontSize: '18px',
                            color: currentPage === totalPages ? '#ccc' : '#007bff',
                            cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                            userSelect: 'none',
                            padding: '4px 8px',
                            lineHeight: '1'
                          }}
                          title="Next page"
                        >
                          ›
                        </span>
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}

export default Tasks;

