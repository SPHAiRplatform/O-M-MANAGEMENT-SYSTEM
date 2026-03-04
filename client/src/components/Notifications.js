import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { getNotifications, getUnreadNotificationCount, markNotificationAsRead, markAllNotificationsAsRead, deleteNotification, getTrackerStatusRequests, reviewTrackerStatusRequest } from '../api/api';
import { useAuth } from '../context/AuthContext';
import { ErrorAlert, SuccessAlert, InfoAlert } from './ErrorAlert';
import { ConfirmDialog } from './ConfirmDialog';
import {
  FaTasks, 
  FaBell, 
  FaExclamationTriangle, 
  FaCheckCircle, 
  FaTimesCircle, 
  FaClipboardList,
  FaInfoCircle,
  FaCheck,
  FaTimes,
  FaTrash,
  FaEye,
  FaFilter,
  FaCalendarAlt,
  FaLeaf,
  FaTint,
  FaSearch,
  FaStar,
  FaArchive,
  FaReply,
  FaEllipsisV
} from 'react-icons/fa';
import './Notifications.css';

function Notifications() {
  const { isAdmin, isSuperAdmin } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [reviewingRequest, setReviewingRequest] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [processingRequest, setProcessingRequest] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNotification, setSelectedNotification] = useState(null);
  const [viewedNotifications, setViewedNotifications] = useState(new Set());
  const [hoveredNotification, setHoveredNotification] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [alertError, setAlertError] = useState(null);
  const [alertSuccess, setAlertSuccess] = useState(null);
  const [alertInfo, setAlertInfo] = useState(null);
  const autoMarkTimers = useRef({});
  const reviewDebounceTimer = useRef(null);
  const processingRequestId = useRef(null);

  // Get unique categories from notifications
  const categories = ['all', ...new Set(notifications.map(n => {
    if (n.type.startsWith('task_')) return 'tasks';
    if (n.type.startsWith('tracker_status_')) return 'tracker';
    if (n.type.startsWith('early_completion_')) return 'completion';
    return 'other';
  }))];

  // Define load functions first (before they're used in useEffect)
  const loadNotifications = useCallback(async () => {
    try {
      const params = showUnreadOnly ? { unread_only: 'true' } : {};
      const response = await getNotifications(params);
      setNotifications(response.data);
      setLoading(false);
    } catch (error) {
      console.error('Error loading notifications:', error);
      setLoading(false);
    }
  }, [showUnreadOnly]);

  const loadUnreadCount = useCallback(async () => {
    try {
      const response = await getUnreadNotificationCount();
      setUnreadCount(response.data.count);
    } catch (error) {
      console.error('Error loading unread count:', error);
    }
  }, []);

  // Define handleMarkAsRead before it's used in useEffect
  const handleMarkAsRead = useCallback(async (id, silent = false) => {
    try {
      await markNotificationAsRead(id);
      if (!silent) {
        loadNotifications();
        loadUnreadCount();
      } else {
        // Update local state without reloading
        setNotifications(prev => prev.map(n => 
          n.id === id ? { ...n, is_read: true } : n
        ));
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch (error) {
      console.error('Error marking notification as read:', error);
      if (!silent) {
        setAlertError('Failed to mark notification as read');
      }
    }
  }, [loadNotifications, loadUnreadCount]);

  useEffect(() => {
    loadNotifications();
    loadUnreadCount();
    
    // Refresh every 30 seconds
    const interval = setInterval(() => {
      loadNotifications();
      loadUnreadCount();
    }, 30000);
    
    return () => {
      clearInterval(interval);
      // Clear all auto-mark timers on unmount
      Object.values(autoMarkTimers.current).forEach(timer => clearTimeout(timer));
    };
  }, [showUnreadOnly, selectedCategory, loadNotifications, loadUnreadCount]);

  // Auto-mark notifications as read after 3 seconds of viewing
  useEffect(() => {
    notifications.forEach(notification => {
      if (!notification.is_read && !viewedNotifications.has(notification.id)) {
        // Mark as viewed immediately
        setViewedNotifications(prev => new Set([...prev, notification.id]));
        
        // Auto-mark as read after 3 seconds
        const timer = setTimeout(() => {
          handleMarkAsRead(notification.id, true); // silent = true to avoid reload
        }, 3000);
        
        autoMarkTimers.current[notification.id] = timer;
      }
    });

    return () => {
      // Clean up timers for notifications that are no longer in the list
      Object.keys(autoMarkTimers.current).forEach(id => {
        if (!notifications.find(n => n.id === id)) {
          clearTimeout(autoMarkTimers.current[id]);
          delete autoMarkTimers.current[id];
        }
      });
    };
  }, [notifications, handleMarkAsRead]);

  const handleNotificationClick = useCallback((notification, e) => {
    // Don't mark as read if clicking on action buttons or links
    if (e.target.closest('.notification-actions') || 
        e.target.closest('.notification-link') ||
        e.target.closest('button') ||
        e.target.closest('.notification-checkbox')) {
      return;
    }

    // Set selected notification for preview
    setSelectedNotification(notification);

    // Mark as read when clicking on notification
    if (!notification.is_read) {
      handleMarkAsRead(notification.id);
    }
  }, [handleMarkAsRead]);

  const handleMarkAllAsRead = useCallback(async () => {
    try {
      await markAllNotificationsAsRead();
      loadNotifications();
      loadUnreadCount();
    } catch (error) {
      console.error('Error marking all as read:', error);
      setAlertError('Failed to mark all notifications as read');
    }
  }, [loadNotifications, loadUnreadCount]);

  const handleDelete = useCallback(async (id, e) => {
    e.stopPropagation(); // Prevent marking as read when deleting
    setConfirmDialog({
      title: 'Delete Notification',
      message: 'Delete this notification?',
      confirmLabel: 'Delete',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await deleteNotification(id);
          if (selectedNotification?.id === id) {
            setSelectedNotification(null);
          }
          loadNotifications();
          loadUnreadCount();
        } catch (error) {
          console.error('Error deleting notification:', error);
          setAlertError('Failed to delete notification');
        }
      }
    });
  }, [loadNotifications, loadUnreadCount, selectedNotification]);

  const handleReviewRequest = useCallback(async (requestId, action) => {
    // Prevent double-clicks and rapid submissions
    if (processingRequest || processingRequestId.current === requestId) {
      console.log('[NOTIFICATIONS] Request already processing, ignoring duplicate call');
      return;
    }

    // Check if request is already reviewed
    const notificationToReview = notifications.find(n => 
      n.type === 'tracker_status_request' && 
      n.metadata?.request_id === requestId
    );

    if (notificationToReview) {
      const requestStatus = notificationToReview.metadata?.request_status;
      if (requestStatus && requestStatus !== 'pending') {
        // Request already reviewed - remove notification and refresh
        setAlertInfo(`This request has already been ${requestStatus}.`);
        setNotifications(prev => prev.filter(n => n.id !== notificationToReview.id));
        await loadNotifications();
        await loadUnreadCount();
        return;
      }
    }

    if (action === 'reject' && !rejectionReason.trim()) {
      setAlertError('Please provide a reason for rejection');
      return;
    }

    // Clear any existing debounce timer
    if (reviewDebounceTimer.current) {
      clearTimeout(reviewDebounceTimer.current);
    }

    // Debounce the request to prevent rapid clicks
    return new Promise((resolve, reject) => {
      reviewDebounceTimer.current = setTimeout(async () => {
        processingRequestId.current = requestId;
        setProcessingRequest(true);

        // Optimistic UI update: Remove the notification from the list immediately
        const notificationToRemove = notifications.find(n => 
          n.type === 'tracker_status_request' && 
          n.metadata?.request_id === requestId
        );
        
        if (notificationToRemove) {
          // Remove from state immediately (optimistic update)
          setNotifications(prev => prev.filter(n => n.id !== notificationToRemove.id));
          setUnreadCount(prev => Math.max(0, prev - 1));
          if (selectedNotification?.id === notificationToRemove.id) {
            setSelectedNotification(null);
          }
        }

        try {
          await reviewTrackerStatusRequest(requestId, action, rejectionReason || null);
          setAlertSuccess(`Request ${action === 'approve' ? 'approved' : 'rejected'} successfully!`);
          setReviewingRequest(null);
          setRejectionReason('');
          
          // Dispatch custom event to notify Plant page to reload
          if (action === 'approve') {
            window.dispatchEvent(new CustomEvent('trackerStatusApproved', {
              detail: { requestId, action }
            }));
          }
          
          // Reload notifications to get the updated state
          await loadNotifications();
          await loadUnreadCount();
          resolve();
        } catch (error) {
          console.error('Error reviewing request:', error);
          
          // Handle 400 error for already-reviewed requests gracefully
          if (error.response?.status === 400 && error.response?.data?.error?.includes('already been reviewed')) {
            // Request was already reviewed - just remove notification and refresh
            setAlertInfo(`This request has already been reviewed.`);
            await loadNotifications();
            await loadUnreadCount();
            resolve();
            return;
          }
          
          // Revert optimistic update on other errors
          if (notificationToRemove) {
            setNotifications(prev => [...prev, notificationToRemove].sort((a, b) =>
              new Date(b.created_at) - new Date(a.created_at)
            ));
            setUnreadCount(prev => prev + 1);
          }

          setAlertError(error.response?.data?.error || 'Failed to review request');
          reject(error);
        } finally {
          setProcessingRequest(false);
          processingRequestId.current = null;
        }
      }, 300); // 300ms debounce
    });
  }, [notifications, rejectionReason, processingRequest, selectedNotification, loadNotifications, loadUnreadCount]);

  const getNotificationIcon = (type) => {
    const iconProps = { size: 20, className: 'notification-icon-svg' };
    switch (type) {
      case 'task_assigned':
        return <FaTasks {...iconProps} style={{ color: '#0078d4' }} />;
      case 'task_reminder':
        return <FaBell {...iconProps} style={{ color: '#ffaa44' }} />;
      case 'task_flagged':
        return <FaExclamationTriangle {...iconProps} style={{ color: '#d13438' }} />;
      case 'early_completion_approved':
        return <FaCheckCircle {...iconProps} style={{ color: '#107c10' }} />;
      case 'early_completion_rejected':
        return <FaTimesCircle {...iconProps} style={{ color: '#d13438' }} />;
      case 'tracker_status_request':
        return <FaClipboardList {...iconProps} style={{ color: '#0078d4' }} />;
      case 'tracker_status_approved':
        return <FaCheckCircle {...iconProps} style={{ color: '#107c10' }} />;
      case 'tracker_status_rejected':
        return <FaTimesCircle {...iconProps} style={{ color: '#d13438' }} />;
      default:
        return <FaInfoCircle {...iconProps} style={{ color: '#605e5c' }} />;
    }
  };

  // Format time relative to now (Outlook-style)
  const formatTime = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    
    // For older dates, show date
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (date.toDateString() === today.toDateString()) {
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  };

  // Group notifications by date
  const groupNotificationsByDate = (notifications) => {
    const groups = {};
    notifications.forEach(notification => {
      const date = new Date(notification.created_at);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      
      let dateKey;
      if (date.toDateString() === today.toDateString()) {
        dateKey = 'Today';
      } else if (date.toDateString() === yesterday.toDateString()) {
        dateKey = 'Yesterday';
      } else {
        dateKey = date.toLocaleDateString('en-US', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        });
      }
      
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(notification);
    });
    return groups;
  };

  // Filter notifications by category, search, and exclude already-reviewed tracker status requests
  const filteredNotifications = useMemo(() => {
    // First, filter out tracker_status_request notifications that are already reviewed
    let filtered = notifications.filter(n => {
      if (n.type === 'tracker_status_request') {
        const requestStatus = n.metadata?.request_status;
        // Only show pending requests - hide already reviewed ones
        return requestStatus === 'pending' || requestStatus === undefined;
      }
      return true;
    });
    
    // Apply category filter
    if (selectedCategory !== 'all') {
      filtered = filtered.filter(n => {
        if (selectedCategory === 'tasks') return n.type.startsWith('task_');
        if (selectedCategory === 'tracker') return n.type.startsWith('tracker_status_');
        if (selectedCategory === 'completion') return n.type.startsWith('early_completion_');
        return true;
      });
    }
    
    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(n => 
        n.title?.toLowerCase().includes(query) ||
        n.message?.toLowerCase().includes(query) ||
        n.type?.toLowerCase().includes(query)
      );
    }
    
    return filtered;
  }, [notifications, selectedCategory, searchQuery]);

  const groupedNotifications = groupNotificationsByDate(filteredNotifications);

  if (loading) {
    return <div className="loading">Loading notifications...</div>;
  }

  return (
    <div className="notifications-container-outlook">
      <ErrorAlert error={alertError} onClose={() => setAlertError(null)} />
      <SuccessAlert message={alertSuccess} onClose={() => setAlertSuccess(null)} />
      <InfoAlert message={alertInfo} onClose={() => setAlertInfo(null)} />
      <ConfirmDialog dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />

      {/* Header Toolbar */}
      <div className="notifications-toolbar">
        <div className="toolbar-left">
          <h1 className="notifications-title">Notifications</h1>
          {unreadCount > 0 && (
            <span className="unread-badge">{unreadCount} unread</span>
          )}
        </div>
        <div className="toolbar-right">
          <div className="search-box">
            <FaSearch className="search-icon" />
            <input
              type="text"
              placeholder="Search notifications..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>
          {unreadCount > 0 && (
            <button 
              className="btn-toolbar"
              onClick={handleMarkAllAsRead}
              title="Mark all as read"
            >
              <FaCheck style={{ marginRight: '6px' }} />
              Mark All Read
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="notifications-filters-outlook">
        <div className="filter-tabs">
          <button
            className={`filter-tab ${selectedCategory === 'all' ? 'active' : ''}`}
            onClick={() => setSelectedCategory('all')}
          >
            All
          </button>
          <button
            className={`filter-tab ${selectedCategory === 'tasks' ? 'active' : ''}`}
            onClick={() => setSelectedCategory('tasks')}
          >
            Tasks
          </button>
          <button
            className={`filter-tab ${selectedCategory === 'tracker' ? 'active' : ''}`}
            onClick={() => setSelectedCategory('tracker')}
          >
            Tracker
          </button>
          <button
            className={`filter-tab ${selectedCategory === 'completion' ? 'active' : ''}`}
            onClick={() => setSelectedCategory('completion')}
          >
            Completion
          </button>
        </div>
        <label className="filter-toggle-outlook">
          <input
            type="checkbox"
            checked={showUnreadOnly}
            onChange={(e) => setShowUnreadOnly(e.target.checked)}
          />
          <span>Unread only</span>
        </label>
      </div>

      {/* Main Content Area */}
      <div className="notifications-content-outlook">
        {/* Notifications List */}
        <div className="notifications-list-outlook">
          {filteredNotifications.length === 0 ? (
            <div className="no-notifications-outlook">
              <FaBell size={48} style={{ color: '#ccc', marginBottom: '16px' }} />
              <p>No notifications {showUnreadOnly ? 'unread' : selectedCategory !== 'all' ? `in ${selectedCategory}` : searchQuery ? 'found' : ''}</p>
            </div>
          ) : (
            Object.entries(groupedNotifications).map(([dateKey, dateNotifications]) => (
              <div key={dateKey} className="notification-date-group-outlook">
                <div className="notification-date-header-outlook">
                  <span className="date-label-outlook">{dateKey}</span>
                  <span className="date-count-outlook">({dateNotifications.length})</span>
                </div>
                {dateNotifications.map((notification) => (
                  <div
                    key={notification.id}
                    className={`notification-item-outlook ${!notification.is_read ? 'unread' : ''} ${selectedNotification?.id === notification.id ? 'selected' : ''}`}
                    onClick={(e) => handleNotificationClick(notification, e)}
                    onMouseEnter={() => setHoveredNotification(notification.id)}
                    onMouseLeave={() => setHoveredNotification(null)}
                  >
                    <div className="notification-checkbox-wrapper">
                      <input
                        type="checkbox"
                        className="notification-checkbox"
                        checked={false}
                        onChange={() => {}}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                    <div className="notification-icon-wrapper-outlook">
                      {getNotificationIcon(notification.type)}
                    </div>
                    <div className="notification-content-outlook">
                      <div className="notification-header-outlook">
                        <div className="notification-sender-outlook">
                          <span className="notification-title-outlook">{notification.title}</span>
                          {!notification.is_read && <span className="unread-indicator"></span>}
                        </div>
                        <div className="notification-meta-outlook">
                          <span className="notification-time-outlook">{formatTime(notification.created_at)}</span>
                          {hoveredNotification === notification.id && (
                            <div className="notification-actions-outlook" onClick={(e) => e.stopPropagation()}>
                              {!notification.is_read && (
                                <button
                                  className="action-btn"
                                  onClick={() => handleMarkAsRead(notification.id)}
                                  title="Mark as read"
                                >
                                  <FaEye />
                                </button>
                              )}
                              <button
                                className="action-btn delete"
                                onClick={(e) => handleDelete(notification.id, e)}
                                title="Delete"
                              >
                                <FaTrash />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                      <p className="notification-preview-outlook">{notification.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        {/* Preview Pane */}
        {selectedNotification && (
          <div className="notification-preview-pane">
            <div className="preview-header">
              <button 
                className="close-preview"
                onClick={() => setSelectedNotification(null)}
                title="Close preview"
              >
                <FaTimes />
              </button>
            </div>
            <div className="preview-content">
              <div className="preview-title-section">
                <div className="preview-icon-large">
                  {getNotificationIcon(selectedNotification.type)}
                </div>
                <div>
                  <h2 className="preview-title">{selectedNotification.title}</h2>
                  <div className="preview-meta">
                    <span className="preview-time">{new Date(selectedNotification.created_at).toLocaleString('en-US', {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}</span>
                  </div>
                </div>
              </div>
              
              <div className="preview-body">
                <p className="preview-message">{selectedNotification.message}</p>
                
                {/* Tracker Status Request Details */}
                {selectedNotification.type === 'tracker_status_request' && 
                 (isAdmin() || isSuperAdmin()) && 
                 selectedNotification.metadata?.request_id && (
                  <div className="tracker-request-details-outlook">
                    <div className="details-grid">
                      <div className="detail-row">
                        <strong>Trackers:</strong>
                        <span>{selectedNotification.metadata.tracker_ids?.join(', ') || 'N/A'}</span>
                      </div>
                      <div className="detail-row">
                        <strong>Task Type:</strong>
                        <span className="task-type-badge-outlook">
                          {selectedNotification.metadata.task_type === 'grass_cutting' ? (
                            <>
                              <FaLeaf style={{ marginRight: '4px' }} />
                              Grass Cutting
                            </>
                          ) : (
                            <>
                              <FaTint style={{ marginRight: '4px' }} />
                              Panel Wash
                            </>
                          )}
                        </span>
                      </div>
                      <div className="detail-row">
                        <strong>Status:</strong>
                        <span className={`status-badge-outlook ${selectedNotification.metadata.status_type === 'done' ? 'status-done' : 'status-halfway'}`}>
                          {selectedNotification.metadata.status_type === 'done' ? (
                            <>
                              <FaCheckCircle style={{ marginRight: '4px' }} />
                              Done
                            </>
                          ) : (
                            <>
                              <FaBell style={{ marginRight: '4px' }} />
                              Halfway
                            </>
                          )}
                        </span>
                      </div>
                      {selectedNotification.metadata.message && (
                        <div className="detail-row full-width">
                          <strong>Note:</strong>
                          <p className="detail-note">{selectedNotification.metadata.message}</p>
                        </div>
                      )}
                    </div>
                    {/* Only show action buttons if request is still pending */}
                    {(!selectedNotification.metadata.request_status || selectedNotification.metadata.request_status === 'pending') && (
                      <div className="tracker-action-buttons-outlook">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleReviewRequest(selectedNotification.metadata.request_id, 'approve');
                          }}
                          className="btn-approve"
                          disabled={processingRequest}
                        >
                          <FaCheck style={{ marginRight: '6px' }} />
                          Approve
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setReviewingRequest(selectedNotification.metadata.request_id);
                          }}
                          className="btn-reject"
                          disabled={processingRequest}
                        >
                          <FaTimes style={{ marginRight: '6px' }} />
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                )}
                
                {selectedNotification.task_id && (
                  <div className="preview-actions">
                    <Link 
                      to={`/tasks/${selectedNotification.task_id}`}
                      className="preview-link"
                      onClick={() => handleMarkAsRead(selectedNotification.id)}
                    >
                      <FaEye style={{ marginRight: '6px' }} />
                      View Task
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Rejection Reason Modal */}
      {reviewingRequest && (
        <div 
          className="modal-overlay"
          onClick={() => !processingRequest && setReviewingRequest(null)}
        >
          <div 
            className="modal-content rejection-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <FaTimesCircle style={{ marginRight: '10px', color: '#d13438' }} />
              <h2>Reject Tracker Status Request</h2>
            </div>
            <p className="modal-description">
              Please provide a reason for rejecting this request:
            </p>
            <textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Enter rejection reason..."
              rows="4"
              className="rejection-textarea"
              disabled={processingRequest}
            />
            <div className="modal-footer">
              <button
                onClick={() => {
                  setReviewingRequest(null);
                  setRejectionReason('');
                }}
                className="btn btn-secondary"
                disabled={processingRequest}
              >
                Cancel
              </button>
              <button
                onClick={() => handleReviewRequest(reviewingRequest, 'reject')}
                className="btn btn-danger btn-with-icon"
                disabled={processingRequest || !rejectionReason.trim()}
              >
                <FaTimes style={{ marginRight: '6px' }} />
                {processingRequest ? 'Processing...' : 'Reject Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Notifications;
