import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getTasks, createTask, bulkDeleteTasks, getChecklistTemplates, getUsers } from '../api/api';
import { useAuth } from '../context/AuthContext';
import { ErrorAlert, SuccessAlert } from './ErrorAlert';

function Inspection() {
  const { isAdmin, isSuperAdmin } = useAuth();
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
  const [currentPage, setCurrentPage] = useState(1);
  const [alertError, setAlertError] = useState(null);
  const [alertSuccess, setAlertSuccess] = useState(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState([]);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const tasksPerPage = 10;

  const [newTask, setNewTask] = useState({
    checklist_template_id: '',
    location: '',
    assigned_to: [],
    task_type: 'INSPECTION',
    scheduled_date: '',
    hours_worked: '',
    budgeted_hours: ''
  });

  useEffect(() => {
    loadTasks();
    loadTemplates();
    if (isAdmin()) {
      loadUsers();
    }
  }, [filters, isAdmin]);

  const loadTasks = async () => {
    try {
      const params = { task_type: 'INSPECTION' }; // Filter for inspection tasks only
      if (filters.status) params.status = filters.status;
      if (filters.completed_date) params.completed_date = filters.completed_date;
      
      const response = await getTasks(params);
      setTasks(response.data);
      setSelectedTaskIds([]);
      setLoading(false);
    } catch (error) {
      console.error('Error loading inspection tasks:', error);
      setLoading(false);
    }
  };

  const loadTemplates = async () => {
    try {
      console.log('Loading templates for inspection creation...');
      const response = await getChecklistTemplates();
      // Filter templates for inspection type
      const inspectionTemplates = response.data.filter(t => 
        t.task_type === 'INSPECTION' || t.task_type === 'PM'
      );
      setTemplates(inspectionTemplates);
    } catch (error) {
      console.error('Error loading templates:', error);
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

    if (!newTask.checklist_template_id || !newTask.location) {
      setAlertError('Please fill in all required fields');
      return;
    }
    
    try {
      const taskData = {
        ...newTask,
        scheduled_date: newTask.scheduled_date || undefined,
        hours_worked: newTask.hours_worked ? parseFloat(newTask.hours_worked) : undefined,
        budgeted_hours: isSuperAdmin() && newTask.budgeted_hours ? parseFloat(newTask.budgeted_hours) : undefined
      };
      
      const response = await createTask(taskData);
      console.log('Inspection task created successfully:', response.data);
      
      setShowCreateForm(false);
      setNewTask({
        checklist_template_id: '',
        location: '',
        assigned_to: [],
        task_type: 'INSPECTION',
        scheduled_date: '',
        hours_worked: '',
        budgeted_hours: ''
      });
      loadTasks();
      setAlertSuccess(`Inspection task created successfully! Task Code: ${response.data.task_code}`);
    } catch (error) {
      console.error('Error creating inspection task:', error);
      const errorMessage = error.response?.data?.error || error.response?.data?.details || error.message || 'Failed to create inspection task';
      setAlertError(`Failed to create inspection task: ${errorMessage}`);
    }
  };

  if (loading) {
    return <div className="loading">Loading inspection tasks...</div>;
  }

  // Pagination
  const indexOfLastTask = currentPage * tasksPerPage;
  const indexOfFirstTask = indexOfLastTask - tasksPerPage;
  const currentTasks = tasks.slice(indexOfFirstTask, indexOfLastTask);
  const totalPages = Math.ceil(tasks.length / tasksPerPage);

  const handleBulkDelete = async () => {
    if (selectedTaskIds.length === 0) return;
    setDeleting(true);
    try {
      const response = await bulkDeleteTasks(selectedTaskIds);
      setAlertSuccess(response.data.message);
      setSelectedTaskIds([]);
      setShowDeleteConfirm(false);
      loadTasks();
    } catch (err) {
      console.error('Error deleting tasks:', err);
      setAlertError({ message: err.response?.data?.error || 'Failed to delete tasks' });
    } finally {
      setDeleting(false);
    }
  };

  const toggleTaskSelection = (taskId) => {
    setSelectedTaskIds(prev =>
      prev.includes(taskId) ? prev.filter(id => id !== taskId) : [...prev, taskId]
    );
  };

  const toggleSelectAll = () => {
    const allSelected = currentTasks.every(t => selectedTaskIds.includes(t.id));
    if (allSelected) {
      setSelectedTaskIds(prev => prev.filter(id => !currentTasks.some(t => t.id === id)));
    } else {
      setSelectedTaskIds(prev => [...new Set([...prev, ...currentTasks.map(t => t.id)])]);
    }
  };

  return (
    <div>
      <ErrorAlert error={alertError} onClose={() => setAlertError(null)} />
      <SuccessAlert message={alertSuccess} onClose={() => setAlertSuccess(null)} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h2 className="page-title" style={{ marginBottom: 0 }}>Inspections</h2>
        {isAdmin() && (
          <button className="btn btn-sm btn-primary" onClick={() => setShowCreateForm(!showCreateForm)}>
            {showCreateForm ? 'Cancel' : 'New Inspection'}
          </button>
        )}
      </div>

      {showCreateForm && (
        <div className="card">
          <h3>Create New Inspection</h3>
          <form onSubmit={handleCreateTask}>
            <div className="form-group">
              <label>Checklist Template</label>
              <select
                value={newTask.checklist_template_id}
                onChange={(e) => setNewTask({ ...newTask, checklist_template_id: e.target.value })}
                required
              >
                <option value="">Select template...</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.template_name} ({t.template_code})
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Location</label>
              <input
                type="text"
                value={newTask.location}
                onChange={(e) => setNewTask({ ...newTask, location: e.target.value })}
                placeholder="Enter location (e.g., DC Combiner Board, Inverter 1, etc.)"
                required
                style={{ width: '100%', padding: '8px 12px', fontSize: '14px', border: '1px solid #ddd', borderRadius: '4px' }}
              />
            </div>
            {isAdmin() && (
              <div className="form-group">
                <label>Assign To (Users)</label>
                <select
                  multiple
                  value={newTask.assigned_to}
                  onChange={(e) => {
                    const selectedOptions = Array.from(e.target.selectedOptions, option => option.value);
                    setNewTask({ ...newTask, assigned_to: selectedOptions });
                  }}
                  style={{
                    width: '100%',
                    padding: '8px',
                    fontSize: '14px',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    minHeight: '100px'
                  }}
                >
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.full_name || user.username} ({user.role})
                    </option>
                  ))}
                </select>
                <small style={{ color: '#666', fontSize: '12px', marginTop: '4px', display: 'block' }}>
                  Hold Ctrl (Windows) or Cmd (Mac) to select multiple users
                </small>
                {newTask.assigned_to.length > 0 && (
                  <div style={{
                    display: 'flex', 
                    flexWrap: 'wrap', 
                    gap: '6px',
                    padding: '8px',
                    backgroundColor: '#f8f9fa',
                    borderRadius: '4px',
                    border: '1px solid #e9ecef',
                    marginTop: '8px'
                  }}>
                    {newTask.assigned_to.map(userId => {
                      const user = users.find(u => u.id === userId);
                      return user ? (
                        <span 
                          key={userId}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            padding: '4px 10px',
                            backgroundColor: '#007bff',
                            color: '#fff',
                            borderRadius: '16px',
                            fontSize: '12px',
                            fontWeight: '500'
                          }}
                        >
                          {user.full_name || user.username}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              setNewTask({ 
                                ...newTask, 
                                assigned_to: newTask.assigned_to.filter(id => id !== userId) 
                              });
                            }}
                            style={{
                              marginLeft: '6px',
                              background: 'rgba(255,255,255,0.3)',
                              border: 'none',
                              color: '#fff',
                              borderRadius: '50%',
                              width: '18px',
                              height: '18px',
                              cursor: 'pointer',
                              fontSize: '14px',
                              lineHeight: '1',
                              padding: '0',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                          >
                            ×
                          </button>
                        </span>
                      ) : null;
                    })}
                  </div>
                )}
              </div>
            )}
            <div className="form-group">
              <label>Scheduled Date</label>
              <input
                type="date"
                value={newTask.scheduled_date}
                onChange={(e) => setNewTask({ ...newTask, scheduled_date: e.target.value })}
                min={new Date().toISOString().split('T')[0]}
              />
            </div>
            {isSuperAdmin() && (
              <div className="form-group">
                <label>Budgeted Hours</label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  value={newTask.budgeted_hours}
                  onChange={(e) => setNewTask({ ...newTask, budgeted_hours: e.target.value })}
                  placeholder="Optional"
                />
              </div>
            )}
            <div className="form-group">
              <label>Estimated Hours</label>
              <input
                type="number"
                step="0.5"
                min="0"
                value={newTask.hours_worked}
                onChange={(e) => setNewTask({ ...newTask, hours_worked: e.target.value })}
                placeholder="Optional"
              />
            </div>
            <button type="submit" className="btn btn-primary">
              Create Inspection
            </button>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: '1', minWidth: '150px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: '500' }}>Status</label>
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              style={{ width: '100%', padding: '6px 10px', fontSize: '13px', border: '1px solid #ddd', borderRadius: '4px' }}
            >
              <option value="">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div style={{ flex: '1', minWidth: '150px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: '500' }}>Completed Date</label>
            <input
              type="date"
              value={filters.completed_date}
              onChange={(e) => setFilters({ ...filters, completed_date: e.target.value })}
              style={{ width: '100%', padding: '6px 10px', fontSize: '13px', border: '1px solid #ddd', borderRadius: '4px' }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => setFilters({ status: '', task_type: '', completed_date: '' })}
            >
              Clear
            </button>
          </div>
        </div>
      </div>

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
              <button className="btn btn-secondary" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>Cancel</button>
              <button
                className={`btn btn-danger ${deleting ? 'btn-loading' : ''}`}
                onClick={handleBulkDelete}
                disabled={deleting}
                style={{ background: '#dc3545', color: '#fff', border: 'none' }}
              >
                <span>Delete {selectedTaskIds.length} Task{selectedTaskIds.length !== 1 ? 's' : ''}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Selection action bar */}
      {isSuperAdmin() && selectedTaskIds.length > 0 && (
        <div style={{
          marginBottom: '12px', padding: '10px 16px',
          background: '#fff3cd', borderRadius: '8px', borderLeft: '4px solid #ffc107',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px'
        }}>
          <span style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>
            {selectedTaskIds.length} task{selectedTaskIds.length !== 1 ? 's' : ''} selected
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-sm btn-secondary" onClick={() => setSelectedTaskIds([])}>Clear</button>
            <button
              className="btn btn-sm btn-danger"
              onClick={() => setShowDeleteConfirm(true)}
              style={{ background: '#dc3545', color: '#fff', border: 'none' }}
            >
              <i className="bi bi-trash" style={{ marginRight: '4px' }}></i>Delete Selected
            </button>
          </div>
        </div>
      )}

      {/* Tasks Table */}
      {tasks.length === 0 ? (
        <div className="card">
          <p style={{ textAlign: 'center', color: '#666', padding: '20px' }}>
            No inspection tasks found. {isAdmin() && 'Create your first inspection task above.'}
          </p>
        </div>
      ) : (
        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #ddd' }}>
                  {isSuperAdmin() && (
                    <th style={{ padding: '10px', textAlign: 'center', width: '40px' }}>
                      <input
                        type="checkbox"
                        checked={currentTasks.length > 0 && currentTasks.every(t => selectedTaskIds.includes(t.id))}
                        onChange={toggleSelectAll}
                        title="Select all on this page"
                        style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                      />
                    </th>
                  )}
                  <th style={{ padding: '10px', textAlign: 'left' }}>Task Code</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Template</th>
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
                    <td data-label="Template" style={{ padding: '10px' }}>{task.template_name || 'N/A'}</td>
                    <td data-label="Type" style={{ padding: '10px' }}>
                      <span className={`task-badge ${task.task_type}`} style={{ fontSize: '11px', padding: '4px 8px' }}>{task.task_type}</span>
                    </td>
                    <td data-label="Location" style={{ padding: '10px' }}>{task.location || task.asset_name || 'N/A'}</td>
                    <td data-label="Assigned To" style={{ padding: '10px' }}>
                      {task.assigned_users && task.assigned_users.length > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {task.assigned_users.map((user, idx) => {
                            const displayName = user.full_name 
                              ? user.full_name.split(' ')[0] 
                              : user.username;
                            return (
                              <span 
                                key={user.id || idx}
                                style={{
                                  padding: '2px 8px',
                                  background: '#e3f2fd',
                                  color: '#1976d2',
                                  borderRadius: '12px',
                                  fontSize: '11px',
                                  fontWeight: '500'
                                }}
                                title={user.full_name || user.username}
                              >
                                {displayName}
                              </span>
                            );
                          })}
                        </div>
                      ) : (
                        <span style={{ color: '#999', fontStyle: 'italic' }}>Unassigned</span>
                      )}
                    </td>
                    <td data-label="Status" style={{ padding: '10px' }}>
                      <span className={`task-badge ${task.status}`}>
                        {task.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td data-label="Hours" style={{ padding: '10px' }}>
                      <div style={{ fontSize: '13px' }}>
                        {task.hours_worked || 0}h
                        {task.budgeted_hours && (
                          <span style={{ color: hoursExceeded ? '#dc3545' : '#666', marginLeft: '4px' }}>
                            / {task.budgeted_hours}h
                          </span>
                        )}
                      </div>
                    </td>
                    <td data-label="Scheduled" style={{ padding: '10px', fontSize: '13px', color: '#666' }}>
                      {task.scheduled_date ? new Date(task.scheduled_date).toLocaleDateString() : 'N/A'}
                    </td>
                    <td data-label="Action" style={{ padding: '10px' }}>
                      <Link to={`/tasks/${task.id}`} className="btn btn-sm btn-primary">
                        View
                      </Link>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                style={{ padding: '6px 12px', fontSize: '12px' }}
              >
                Previous
              </button>
              <span style={{ fontSize: '14px', color: '#666' }}>
                Page {currentPage} of {totalPages}
              </span>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                style={{ padding: '6px 12px', fontSize: '12px' }}
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Inspection;
