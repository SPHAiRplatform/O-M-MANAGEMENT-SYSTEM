import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getTask, startTask, pauseTask, resumeTask, completeTask, downloadTaskReport, getEarlyCompletionRequests, createEarlyCompletionRequest } from '../api/api';
import { useAuth } from '../context/AuthContext';
import { ErrorAlert, SuccessAlert, InfoAlert } from './ErrorAlert';
import { ConfirmDialog } from './ConfirmDialog';

function TaskDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isAdmin, isSupervisor } = useAuth();
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [duration, setDuration] = useState(0);
  const [showEarlyCompletionModal, setShowEarlyCompletionModal] = useState(false);
  const [earlyCompletionMotivation, setEarlyCompletionMotivation] = useState('');
  const [earlyCompletionRequests, setEarlyCompletionRequests] = useState([]);
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const [showPauseModal, setShowPauseModal] = useState(false);
  const [pauseReason, setPauseReason] = useState('');
  const [alertError, setAlertError] = useState(null);
  const [alertSuccess, setAlertSuccess] = useState(null);
  const [alertInfo, setAlertInfo] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);

  useEffect(() => {
    loadTask();
    loadEarlyCompletionRequests();
  }, [id]);
  
  const loadEarlyCompletionRequests = async () => {
    try {
      const response = await getEarlyCompletionRequests(id);
      setEarlyCompletionRequests(response.data);
    } catch (error) {
      console.error('Error loading early completion requests:', error);
    }
  };


  const loadTask = async () => {
    try {
      if (!id) {
        console.error('No task ID provided');
        setLoading(false);
        return;
      }
      console.log('Loading task with ID:', id);
      const response = await getTask(id);
      setTask(response.data);
      console.log('Task loaded successfully:', response.data?.task_code);
      setLoading(false);
    } catch (error) {
      console.error('Error loading task:', error);
      if (error.response) {
        console.error('Error response:', error.response.data);
        console.error('Error status:', error.response.status);
      }
      setLoading(false);
    }
  };

  const handleStartTask = async () => {
    try {
      // Start task - overtime request will be created automatically if outside working hours
      const response = await startTask(id);
      loadTask();
      
      // Check if overtime request was created
      if (response.data?.overtime_request) {
        const now = new Date();
        const hour = now.getHours();
        const isOutsideWorkingHours = hour < 7 || hour >= 16;

        if (isOutsideWorkingHours) {
          setAlertInfo({ message: 'Task started outside normal working hours. Super admin has been notified for acknowledgement of your overtime work.' });
        }
      }
    } catch (error) {
      console.error('Error starting task:', error);
      const errorMessage = error.response?.data?.error || 'Failed to start task';
      const scheduledDate = error.response?.data?.scheduled_date;
      if (scheduledDate) {
        setAlertError({
          message: errorMessage,
          details: `Scheduled date: ${new Date(scheduledDate).toLocaleDateString()}. You can request early completion if needed.`
        });
      } else {
        setAlertError({ message: errorMessage });
      }
    }
  };
  
  const handleRequestEarlyCompletion = async () => {
    if (!earlyCompletionMotivation.trim() || earlyCompletionMotivation.trim().length < 10) {
      setAlertError({ message: 'Please provide a motivation (at least 10 characters)' });
      return;
    }

    try {
      setSubmittingRequest(true);
      await createEarlyCompletionRequest({
        task_id: id,
        motivation: earlyCompletionMotivation.trim()
      });
      setShowEarlyCompletionModal(false);
      setEarlyCompletionMotivation('');
      loadEarlyCompletionRequests();
      setAlertSuccess({ message: 'Early completion request submitted. Waiting for super admin approval.' });
    } catch (error) {
      console.error('Error creating early completion request:', error);
      setAlertError({ message: error.response?.data?.error || 'Failed to submit early completion request' });
    } finally {
      setSubmittingRequest(false);
    }
  };

  const handlePauseTask = async () => {
    if (!pauseReason.trim()) {
      setAlertError({ message: 'Please provide a reason for pausing the task' });
      return;
    }

    try {
      await pauseTask(id, pauseReason.trim());
      setShowPauseModal(false);
      setPauseReason('');
      loadTask();
      setAlertSuccess({ message: 'Task paused successfully. Super admin has been notified.' });
    } catch (error) {
      console.error('Error pausing task:', error);
      setAlertError({ message: error.response?.data?.error || 'Failed to pause task' });
    }
  };

  const handleResumeTask = async () => {
    try {
      await resumeTask(id);
      loadTask();
      setAlertSuccess({ message: 'Task resumed successfully' });
    } catch (error) {
      console.error('Error resuming task:', error);
      setAlertError({ message: error.response?.data?.error || 'Failed to resume task' });
    }
  };

  const handleCompleteTask = async () => {
    setConfirmDialog({
      title: 'Complete Task',
      message: 'Are you sure you want to complete this task? Make sure you have submitted the checklist.',
      confirmLabel: 'Complete',
      variant: 'warning',
      onConfirm: async () => {
        try {
          await completeTask(id, {
            overall_status: task.overall_status || 'pass',
            duration_minutes: duration,
          });
          loadTask();
          setAlertSuccess({ message: 'Task completed successfully!' });
        } catch (error) {
          console.error('Error completing task:', error);
          setAlertError({ message: 'Failed to complete task' });
        }
      }
    });
  };

  if (loading) {
    return <div className="loading">Loading task...</div>;
  }

  if (!task) {
    return <div>Task not found</div>;
  }

  return (
    <div>
      <ErrorAlert
        error={alertError}
        onClose={() => setAlertError(null)}
        title="Task Error"
      />
      <SuccessAlert
        message={alertSuccess?.message}
        onClose={() => setAlertSuccess(null)}
        title="Success"
      />
      <InfoAlert
        message={alertInfo?.message}
        onClose={() => setAlertInfo(null)}
        title="Information"
      />
      <div style={{ marginBottom: '20px' }}>
        <button className="btn btn-secondary" onClick={() => navigate(-1)}>Back</button>
      </div>

      <div className="card">
        <h2>Task Details</h2>
        <div className="task-details-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px', marginTop: '20px' }}>
          <div>
            <strong>Task Code:</strong> {task.task_code}
          </div>
          <div>
            <strong>Type:</strong> <span className={`task-badge ${task.task_type}`}>{task.task_type}</span>
          </div>
          <div>
            <strong>Task Name:</strong> {task.template_name || 'N/A'} ({task.template_code || 'N/A'})
          </div>
          <div>
            <strong>Asset:</strong> {task.asset_name || 'N/A'} ({task.asset_code || 'N/A'})
          </div>
          <div>
            <strong>Status:</strong> <span className={`task-badge ${task.status}`}>
              {task.status.replace('_', ' ')}
            </span>
            {task.is_paused && (
              <span className="task-badge" style={{ marginLeft: '8px', background: '#ffc107', color: '#000' }}>
                Paused
              </span>
            )}
          </div>
          <div>
            <strong>Overall Status:</strong> {task.overall_status ? (
              <span className={`task-badge ${task.overall_status}`}>{task.overall_status}</span>
            ) : 'N/A'}
          </div>
          <div>
            <strong>Assigned To:</strong>{' '}
            {task.assigned_users && task.assigned_users.length > 0 ? (
              <div style={{ marginTop: '5px' }}>
                {task.assigned_users.map((u, idx) => (
                  <div key={u.id || idx} style={{ marginBottom: '4px' }}>
                    {u.full_name || u.username}
                  </div>
                ))}
              </div>
            ) : (
              'Unassigned'
            )}
          </div>
          <div>
            <strong>Scheduled Date:</strong> {task.scheduled_date ? new Date(task.scheduled_date).toLocaleDateString() : 'N/A'}
          </div>
          {task.hours_worked !== undefined && task.hours_worked !== null && (
            <div>
              <strong>Hours Worked:</strong> {parseFloat(task.hours_worked).toFixed(1)}h
              {task.budgeted_hours && (
                <span style={{ color: '#666', marginLeft: '8px' }}>
                  (Budget: {parseFloat(task.budgeted_hours).toFixed(1)}h)
                </span>
              )}
            </div>
          )}
          {task.is_flagged && (
            <div style={{ color: '#dc3545', fontWeight: 'bold' }}>
              <strong>WARNING - FLAGGED:</strong> {task.flag_reason || 'Task has exceeded budgeted hours'}
            </div>
          )}
          {task.can_open_before_scheduled && (
            <div style={{ color: '#28a745', fontWeight: 'bold' }}>
              <strong>Early completion approved</strong> - Task can be started before scheduled date
            </div>
          )}
          {task.started_at && (
            <div>
              <strong>Started At:</strong> {new Date(task.started_at).toLocaleString()}
            </div>
          )}
          {task.completed_at && (
            <div>
              <strong>Completed At:</strong> {new Date(task.completed_at).toLocaleString()}
            </div>
          )}
          {task.duration_minutes && (
            <div>
              <strong>Duration:</strong> {task.duration_minutes} minutes
              {task.total_pause_duration_minutes > 0 && (
                <span style={{ color: '#666', marginLeft: '8px', fontSize: '13px' }}>
                  (Paused: {task.total_pause_duration_minutes} min)
                </span>
              )}
            </div>
          )}
          {task.is_paused && task.paused_at && (
            <div style={{ color: '#ffc107', fontWeight: '500' }}>
              <strong>Paused At:</strong> {new Date(task.paused_at).toLocaleString()}
              {task.pause_reason && (
                <div style={{ marginTop: '4px', fontSize: '13px', color: '#666' }}>
                  <strong>Reason:</strong> {task.pause_reason}
                </div>
              )}
            </div>
          )}
          {(task.task_type === 'PCM' || task.task_type === 'UCM') && task.parent_task_id && (
            <div>
              <strong>PM Task Performed By:</strong>{' '}
              {task.pm_performed_by_name || 'Not available'}
            </div>
          )}
        </div>

        <div style={{ marginTop: '30px', padding: '20px', background: '#f9f9f9', borderRadius: '4px' }}>
          <h3>Task Identification</h3>
          <p>Task Name: <strong>{task.template_name}</strong> ({task.template_code})</p>
          {(task.task_type === 'PCM' || task.task_type === 'UCM') && task.parent_task_id && (
            <p style={{ marginTop: '10px', color: '#666' }}>
              This CM task was generated from a failed PM task. The PM task was performed by: <strong>{task.pm_performed_by_name || 'Unknown'}</strong>
            </p>
          )}
        </div>

        {/* Task Progress — visible to Admin, Supervisor, Super Admin, System Owner */}
        {(isAdmin() || isSupervisor()) && (
          <div style={{ marginTop: '20px', padding: '20px', background: '#fff', borderRadius: '8px', border: '1px solid #e0e0e0', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', color: '#333', borderBottom: '2px solid #1A73E8', paddingBottom: '8px' }}>Task Progress</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
              {/* Task Started */}
              <div style={{ padding: '12px 16px', background: '#f8f9fa', borderRadius: '6px', borderLeft: `4px solid ${task.started_at ? '#28a745' : '#dc3545'}` }}>
                <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Task Started</div>
                <div style={{ fontSize: '15px', fontWeight: '600', color: task.started_at ? '#28a745' : '#dc3545' }}>
                  {task.started_at ? 'Yes' : 'No'}
                </div>
                {task.started_at && (
                  <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                    {new Date(task.started_at).toLocaleString()}
                  </div>
                )}
              </div>

              {/* Current Status */}
              <div style={{ padding: '12px 16px', background: '#f8f9fa', borderRadius: '6px', borderLeft: `4px solid ${task.status === 'completed' ? '#28a745' : task.status === 'in_progress' ? '#17a2b8' : '#ffc107'}` }}>
                <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Current Status</div>
                <div style={{ fontSize: '15px', fontWeight: '600', color: task.status === 'completed' ? '#28a745' : task.status === 'in_progress' ? '#17a2b8' : '#ffc107' }}>
                  {task.status === 'in_progress' ? 'In Progress' : task.status.charAt(0).toUpperCase() + task.status.slice(1)}
                </div>
              </div>

              {/* Task Paused */}
              <div style={{ padding: '12px 16px', background: '#f8f9fa', borderRadius: '6px', borderLeft: `4px solid ${task.is_paused ? '#ffc107' : '#28a745'}` }}>
                <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Currently Paused</div>
                <div style={{ fontSize: '15px', fontWeight: '600', color: task.is_paused ? '#ffc107' : '#28a745' }}>
                  {task.is_paused ? 'Yes' : 'No'}
                </div>
                {task.is_paused && task.pause_reason && (
                  <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                    Reason: {task.pause_reason}
                  </div>
                )}
              </div>

              {/* Time Elapsed — live timer for in-progress tasks */}
              <div style={{ padding: '12px 16px', background: '#f8f9fa', borderRadius: '6px', borderLeft: '4px solid #17a2b8' }}>
                <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
                  {task.status === 'completed' ? 'Total Duration' : 'Time Elapsed'}
                </div>
                <div style={{ fontSize: '15px', fontWeight: '600', color: '#17a2b8' }}>
                  {task.status === 'completed' && task.duration_minutes
                    ? `${task.duration_minutes} min`
                    : task.started_at
                      ? (() => {
                          const elapsed = Math.floor((new Date() - new Date(task.started_at)) / 60000);
                          const pauseMin = task.total_pause_duration_minutes || 0;
                          const active = Math.max(0, elapsed - pauseMin);
                          const hrs = Math.floor(active / 60);
                          const mins = active % 60;
                          return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
                        })()
                      : '—'
                  }
                </div>
                {task.total_pause_duration_minutes > 0 && (
                  <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                    Paused for {task.total_pause_duration_minutes} min total
                  </div>
                )}
              </div>

              {/* Hours Worked vs Budget */}
              {task.budgeted_hours != null && (
                <div style={{ padding: '12px 16px', background: '#f8f9fa', borderRadius: '6px', borderLeft: `4px solid ${task.is_flagged ? '#dc3545' : '#1A73E8'}` }}>
                  <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Hours Worked / Budget</div>
                  <div style={{ fontSize: '15px', fontWeight: '600', color: task.is_flagged ? '#dc3545' : '#1A73E8' }}>
                    {task.hours_worked != null ? parseFloat(task.hours_worked).toFixed(1) : '0.0'}h / {parseFloat(task.budgeted_hours).toFixed(1)}h
                  </div>
                  {task.is_flagged && (
                    <div style={{ fontSize: '12px', color: '#dc3545', marginTop: '4px', fontWeight: '500' }}>
                      Exceeded budgeted hours
                    </div>
                  )}
                </div>
              )}

              {/* Completed At */}
              {task.completed_at && (
                <div style={{ padding: '12px 16px', background: '#f8f9fa', borderRadius: '6px', borderLeft: '4px solid #28a745' }}>
                  <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Completed At</div>
                  <div style={{ fontSize: '15px', fontWeight: '600', color: '#28a745' }}>
                    {new Date(task.completed_at).toLocaleString()}
                  </div>
                </div>
              )}

              {/* Overall Result */}
              {task.overall_status && (
                <div style={{ padding: '12px 16px', background: '#f8f9fa', borderRadius: '6px', borderLeft: `4px solid ${task.overall_status === 'pass' ? '#28a745' : task.overall_status === 'fail' ? '#dc3545' : '#ffc107'}` }}>
                  <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Overall Result</div>
                  <div style={{ fontSize: '15px', fontWeight: '600', color: task.overall_status === 'pass' ? '#28a745' : task.overall_status === 'fail' ? '#dc3545' : '#ffc107' }}>
                    {task.overall_status === 'pass' ? 'Pass' : task.overall_status === 'fail' ? 'Fail' : task.overall_status.charAt(0).toUpperCase() + task.overall_status.slice(1)}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Early Completion Request Section - only show for future-dated tasks */}
        {task.status === 'pending' && task.scheduled_date &&
         (() => { const s = new Date(task.scheduled_date); s.setHours(0,0,0,0); const t = new Date(); t.setHours(0,0,0,0); return s > t; })() &&
         task.assigned_users && task.assigned_users.some(u => u.id === user?.id) &&
         !task.can_open_before_scheduled && (
          <div style={{ 
            marginTop: '20px', 
            padding: '15px', 
            background: '#fff3cd', 
            borderLeft: '4px solid #ffc107',
            borderRadius: '4px'
          }}>
            <h4 style={{ marginTop: 0 }}>Task Scheduled for {new Date(task.scheduled_date).toLocaleDateString()}</h4>
            <p style={{ marginBottom: '10px' }}>
              This task is scheduled for a future date. You can request to complete it early if needed.
            </p>
            {earlyCompletionRequests.some(r => r.status === 'pending') ? (
              <div style={{ padding: '10px', background: '#e3f2fd', borderRadius: '4px' }}>
                <strong>Early completion request pending approval</strong>
              </div>
            ) : earlyCompletionRequests.some(r => r.status === 'approved') ? (
              <div style={{ padding: '10px', background: '#d4edda', borderRadius: '4px', color: '#155724' }}>
                <strong>Early completion approved!</strong> You can now start this task.
              </div>
            ) : (
              <button 
                className="btn btn-secondary"
                onClick={() => setShowEarlyCompletionModal(true)}
              >
                Request
              </button>
            )}
          </div>
        )}

        <div style={{ marginTop: '30px', display: 'flex', gap: '10px', flexWrap: 'wrap', flexDirection: 'column' }}>
          {/* Only show Start Task button if user is assigned to the task */}
          {task.status === 'pending' && 
           task.assigned_users && 
           task.assigned_users.some(u => u.id === user?.id) && (
            <button className="btn btn-primary" onClick={handleStartTask}>
              Start
            </button>
          )}
          {/* Show message if user is not assigned but task is pending */}
          {task.status === 'pending' && 
           (!task.assigned_users || !task.assigned_users.some(u => u.id === user?.id)) && (
            <div style={{ 
              padding: '12px', 
              background: '#fff3cd', 
              borderLeft: '4px solid #ffc107',
              borderRadius: '4px',
              color: '#856404'
            }}>
              <strong>View Only:</strong> This task is not assigned to you. You can view details and download reports, but cannot start or modify this task.
            </div>
          )}
          {/* Show Pause/Resume buttons if task is in progress */}
          {task.status === 'in_progress' && 
           task.assigned_users && 
           task.assigned_users.some(u => u.id === user?.id) && (
            <>
              {!task.is_paused && (
                <button 
                  className="btn btn-warning" 
                  onClick={() => setShowPauseModal(true)}
                  style={{ marginLeft: '10px' }}
                >
                  Pause
                </button>
              )}
              {task.is_paused && (
                <button 
                  className="btn btn-info" 
                  onClick={handleResumeTask}
                  style={{ marginLeft: '10px' }}
                >
                  Resume
                </button>
              )}
            </>
          )}
          {/* Only show Fill Checklist and Complete Task if user is assigned */}
          {task.status === 'in_progress' && 
           task.assigned_users && 
           task.assigned_users.some(u => u.id === user?.id) && (
            <>
              <Link to={`/tasks/${id}/checklist`} className="btn btn-success">
                Fill
              </Link>
              <div className="form-group" style={{ marginLeft: '20px', width: '200px' }}>
                <label>Duration (minutes)</label>
                <input
                  type="number"
                  value={duration}
                  onChange={(e) => setDuration(parseInt(e.target.value) || 0)}
                  min="0"
                />
              </div>
              <button className="btn btn-success" onClick={handleCompleteTask} style={{ marginLeft: '10px' }}>
                Complete
              </button>
            </>
          )}
          {/* Show message if user is not assigned but task is in progress */}
          {task.status === 'in_progress' && 
           (!task.assigned_users || !task.assigned_users.some(u => u.id === user?.id)) && (
            <div style={{ 
              padding: '12px', 
              background: '#fff3cd', 
              borderLeft: '4px solid #ffc107',
              borderRadius: '4px',
              color: '#856404'
            }}>
              <strong>View Only:</strong> This task is not assigned to you. You can view details and download reports, but cannot fill the checklist or complete this task.
            </div>
          )}
          {task.status === 'completed' && task.overall_status === 'fail' && (
            <div className="success" style={{ width: '100%' }}>
              A Corrective Maintenance (CM) task has been automatically generated from this failed PM task.
            </div>
          )}
        </div>

        {task.status === 'completed' && (
          <div style={{ 
            marginTop: '30px', 
            padding: '25px', 
            background: 'linear-gradient(135deg, #e7f3ff 0%, #cfe2ff 100%)', 
            borderRadius: '8px', 
            border: '3px solid #007bff',
            boxShadow: '0 4px 6px rgba(0, 123, 255, 0.2)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '15px' }}>
              <div>
                <h3 style={{ margin: 0, color: '#007bff' }}>Download Task Report</h3>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
              <a
                href={downloadTaskReport(id)}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary"
                style={{ 
                  textDecoration: 'none', 
                  display: 'inline-block',
                  padding: '12px 24px',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  boxShadow: '0 2px 4px rgba(0, 123, 255, 0.3)'
                }}
                onClick={(e) => {
                  if (!id) {
                    e.preventDefault();
                    setAlertError({ message: 'Error: Task ID not found. Please refresh the page.' });
                    return;
                  }
                  console.log('Downloading report for task:', id);
                }}
              >
                Download
              </a>
            </div>
            {task.overall_status === 'fail' && (
              <div style={{ 
                marginTop: '15px', 
                padding: '12px', 
                background: '#fff3cd', 
                borderRadius: '4px',
                border: '1px solid #ffc107'
              }}>
                <strong>Note:</strong> This task failed. A Corrective Maintenance (CM) task has been automatically created.
              </div>
            )}
          </div>
        )}
        
        {/* Show notice if not completed */}
        {task.status !== 'completed' && task.overall_status && (
          <div style={{ 
            marginTop: '30px', 
            padding: '20px', 
            background: '#fff3cd', 
            borderRadius: '4px', 
            border: '2px solid #ffc107' 
          }}>
            <h3 style={{ marginBottom: '15px' }}>Task Not Yet Completed</h3>
            <p style={{ marginBottom: '15px' }}>
              The checklist has been submitted, but the task is not yet marked as completed. 
              Please complete the task to download the report.
            </p>
            {task.status === 'in_progress' && (
              <button className="btn btn-success" onClick={handleCompleteTask}>
                Mark Task as Completed
              </button>
            )}
          </div>
        )}
      </div>

      {/* Early Completion Request Modal */}
      {showEarlyCompletionModal && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000
          }}
          onClick={() => setShowEarlyCompletionModal(false)}
        >
          <div 
            style={{
              background: 'white',
              padding: '30px',
              borderRadius: '8px',
              maxWidth: '500px',
              width: '90%',
              maxHeight: '80vh',
              overflowY: 'auto'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>Request Early Completion</h3>
            <p style={{ color: '#666', fontSize: '14px', marginBottom: '20px' }}>
              Please provide a reason for completing this task before its scheduled date ({task.scheduled_date ? new Date(task.scheduled_date).toLocaleDateString() : 'N/A'}).
            </p>
            <div className="form-group">
              <label>
                Motivation/Reason <span style={{ color: 'red' }}>*</span>
              </label>
              <textarea
                value={earlyCompletionMotivation}
                onChange={(e) => setEarlyCompletionMotivation(e.target.value)}
                placeholder="Explain why you need to complete this task early..."
                rows="5"
                required
                minLength={10}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '2px solid #ddd',
                  borderRadius: '6px',
                  fontSize: '14px',
                  resize: 'vertical'
                }}
              />
              <small style={{ color: '#666', fontSize: '12px', marginTop: '4px', display: 'block' }}>
                Minimum 10 characters. This request will be reviewed by a super admin.
              </small>
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setShowEarlyCompletionModal(false);
                  setEarlyCompletionMotivation('');
                }}
                disabled={submittingRequest}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleRequestEarlyCompletion}
                disabled={submittingRequest || !earlyCompletionMotivation.trim() || earlyCompletionMotivation.trim().length < 10}
              >
                {submittingRequest ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />

      {/* Pause Task Modal */}
      {showPauseModal && (
        <div className="modal-overlay" onClick={() => setShowPauseModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px', padding: '20px' }}>
            <div className="modal-header" style={{ marginBottom: '16px', paddingBottom: '12px' }}>
              <h2 style={{ margin: 0, fontSize: '20px' }}>Pause Task</h2>
              <button className="modal-close" onClick={() => setShowPauseModal(false)} style={{ fontSize: '24px', width: '28px', height: '28px' }}>×</button>
            </div>
            <div style={{ marginBottom: '16px', padding: '10px', background: '#f8f9fa', borderRadius: '4px', fontSize: '12px', color: '#666' }}>
              <p style={{ margin: 0 }}>Please provide a reason for pausing this task. The super admin will be notified.</p>
            </div>
            <form onSubmit={(e) => {
              e.preventDefault();
              handlePauseTask();
            }}>
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '13px', marginBottom: '6px', display: 'block', fontWeight: '500' }}>
                  Reason for Pausing *
                </label>
                <textarea
                  value={pauseReason}
                  onChange={(e) => setPauseReason(e.target.value)}
                  required
                  placeholder="e.g., Waiting for spare parts, equipment issue, break time..."
                  rows="4"
                  style={{ width: '100%', padding: '8px 12px', fontSize: '14px', border: '1px solid #ddd', borderRadius: '4px', resize: 'vertical' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #eee' }}>
                <button 
                  type="submit" 
                  className="btn btn-sm btn-warning" 
                  style={{ flex: 1, padding: '8px 16px', fontSize: '13px' }}
                >
                  Pause
                </button>
                <button 
                  type="button" 
                  className="btn btn-sm btn-secondary" 
                  onClick={() => {
                    setShowPauseModal(false);
                    setPauseReason('');
                  }} 
                  style={{ flex: 1, padding: '8px 16px', fontSize: '13px' }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

export default TaskDetail;

