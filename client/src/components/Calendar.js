import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  getCalendarEvents,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  uploadYearCalendar,
  getCalendarLegend,
  putCalendarLegend
} from '../api/api';
import { useAuth } from '../context/AuthContext';
import { hasOrganizationContext, isSystemOwnerWithoutCompany } from '../utils/organizationContext';
import { ErrorAlert } from './ErrorAlert';
import { ConfirmDialog } from './ConfirmDialog';
import './Calendar.css';

const CANONICAL_KEYS = [
  'weekly', 'monthly', 'quarterly', 'bi-monthly', 'bi-annually', 'annually', 'public holiday'
];

const DEFAULT_LEGEND_CONFIG = {
  'weekly':         { color: '#ffff00', label: 'Weekly' },
  'monthly':        { color: '#92d050', label: 'Monthly' },
  'quarterly':      { color: '#00b0f0', label: 'Quarterly' },
  'bi-monthly':     { color: '#F9B380', label: 'Bi-Monthly' },
  'bi-annually':    { color: '#BFBFBF', label: 'Bi-Annual' },
  'annually':       { color: '#CC5C0B', label: 'Annual' },
  'public holiday': { color: '#808080', label: 'Holiday' }
};

const FREQUENCY_ALIAS_MAP = {
  'weekly': 'weekly',
  'monthly': 'monthly',
  'quarterly': 'quarterly',
  'quaterly': 'quarterly',
  'bi-monthly': 'bi-monthly',
  'bimonthly': 'bi-monthly',
  'bi-annually': 'bi-annually',
  'biannually': 'bi-annually',
  'bi-annual': 'bi-annually',
  'annually': 'annually',
  'annual': 'annually',
  'public holiday': 'public holiday',
  'holiday': 'public holiday',
  'public': 'public holiday'
};

function buildColorMap(legendConfig) {
  const map = {};
  for (const [alias, canonical] of Object.entries(FREQUENCY_ALIAS_MAP)) {
    if (legendConfig[canonical]) {
      map[alias] = legendConfig[canonical].color;
    }
  }
  return map;
}

function getEventColor(event, colorMap) {
  if (event.task_title) {
    const title = typeof event.task_title === 'string'
      ? event.task_title
      : (event.task_title.text || event.task_title.richText?.map(r => r.text).join('') || '');
    if (title.toLowerCase().includes("complete outstanding")) {
      return 'OUTSTANDING_TASK';
    }
  }

  if (event.frequency) {
    const freq = event.frequency.toLowerCase();
    if (colorMap[freq]) {
      return colorMap[freq];
    }
  }

  if (event.task_title) {
    const title = typeof event.task_title === 'string'
      ? event.task_title.toLowerCase()
      : (event.task_title.text || event.task_title.richText?.map(r => r.text).join('') || '').toLowerCase();

    if (title.includes('public holiday') || title.includes('holiday')) {
      return colorMap['public holiday'] || colorMap['holiday'] || '#808080';
    }
    if (title.includes('bi-monthly') || title.includes('bimonthly')) {
      return colorMap['bi-monthly'] || colorMap['bimonthly'] || '#F9B380';
    }
    if (title.includes('bi-annually') || title.includes('biannually') || title.includes('bi-annual')) {
      return colorMap['bi-annually'] || colorMap['biannually'] || '#BFBFBF';
    }
    if (title.includes('annually') || title.includes('annual')) {
      return colorMap['annually'] || colorMap['annual'] || '#CC5C0B';
    }
    if (title.includes('quarterly') || title.includes('quaterly')) {
      return colorMap['quarterly'] || colorMap['quaterly'] || '#00b0f0';
    }
    if (title.includes('monthly')) {
      return colorMap['monthly'] || '#92d050';
    }
    if (title.includes('weekly')) {
      return colorMap['weekly'] || '#ffff00';
    }
  }

  return '#3498db';
}

function Calendar() {
  const { isAdmin, user, loading: authLoading } = useAuth();
  // Initialize to current month of current year only (calendar is locked to current year)
  const getInitialDate = () => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1); // First day of current month, current year
  };

  const [currentDate, setCurrentDate] = useState(getInitialDate());

  // Keep calendar year in sync with actual current year (e.g. when year rolls over or user returns to tab)
  const actualYear = new Date().getFullYear();
  useEffect(() => {
    if (currentDate.getFullYear() !== actualYear) {
      const today = new Date();
      setCurrentDate(new Date(today.getFullYear(), today.getMonth(), 1));
    }
  }, [actualYear]);

  // Re-sync to current year when user returns to tab (handles year change at midnight)
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setCurrentDate(prev => {
          const today = new Date();
          if (prev.getFullYear() !== today.getFullYear()) {
            return new Date(today.getFullYear(), today.getMonth(), 1);
          }
          return prev;
        });
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);
  const [events, setEvents] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(null);
  const [showEventModal, setShowEventModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [legendExpanded, setLegendExpanded] = useState(false);
  const [eventForm, setEventForm] = useState({
    event_date: '',
    task_title: '',
    procedure_code: '',
    description: '',
    frequency: ''
  });
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [legendConfig, setLegendConfig] = useState(DEFAULT_LEGEND_CONFIG);
  const [showLegendModal, setShowLegendModal] = useState(false);
  const [legendForm, setLegendForm] = useState({});
  const [legendSaving, setLegendSaving] = useState(false);
  const fileInputRef = useRef(null);

  const roles = user?.roles || (user?.role ? [user.role] : []);
  const isSystemOwner = roles.includes('system_owner') || roles.includes('super_admin') ||
    user?.role === 'system_owner' || user?.role === 'super_admin';
  const showUploadButton = isSystemOwner && hasOrganizationContext(user);

  const colorMap = useMemo(() => buildColorMap(legendConfig), [legendConfig]);

  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();
  
  // Get today's date in real-time (using local time, not UTC)
  const getTodayDate = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  useEffect(() => {
    // Wait for AuthContext to finish loading before checking organization context
    if (authLoading) {
      return; // Don't check until auth is loaded
    }
    
    // Only load events if user has organization context
    if (hasOrganizationContext(user)) {
      loadEvents();
    } else {
      // System owner without company: show empty calendar
      setEvents({});
      setLoading(false);
    }
  }, [currentYear, currentMonth, user, authLoading]);

  useEffect(() => {
    if (authLoading) return;
    if (hasOrganizationContext(user)) {
      getCalendarLegend()
        .then(res => {
          if (res.data?.legend) setLegendConfig(res.data.legend);
        })
        .catch(() => {});
    }
  }, [user, authLoading]);

  // Helper to format date without UTC conversion
  const formatLocalDate = (date) => {
    const d = date instanceof Date ? date : new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const loadEvents = async () => {
    try {
      setLoading(true);
      // Load events for the current month - use local date formatting
      const startDate = formatLocalDate(new Date(currentYear, currentMonth, 1));
      const endDate = formatLocalDate(new Date(currentYear, currentMonth + 1, 0));
      const response = await getCalendarEvents({ start_date: startDate, end_date: endDate });
      const eventsByDate = {};
      
      response.data.forEach(event => {
        // Use event_date as-is if it's already a YYYY-MM-DD string from the server
        let date = event.event_date;
        
        // If it's somehow still a Date object or needs conversion
        if (date instanceof Date) {
          date = formatLocalDate(date);
        } else if (typeof date === 'object' && date !== null) {
          // Handle serialized date objects
          date = formatLocalDate(new Date(date));
        } else if (typeof date === 'string' && date.includes('T')) {
          // ISO string like "2026-01-04T00:00:00.000Z" - extract just the date part
          date = date.split('T')[0];
        } else if (typeof date !== 'string') {
          date = String(date);
        }
        
        // Ensure frequency is properly set from task_title if missing
        if (!event.frequency && event.task_title) {
          const title = String(event.task_title).toLowerCase();
          if (title.includes('weekly')) event.frequency = 'weekly';
          else if (title.includes('monthly')) event.frequency = 'monthly';
          else if (title.includes('quarterly') || title.includes('quaterly')) event.frequency = 'quarterly';
          else if (title.includes('bi-monthly') || title.includes('bimonthly')) event.frequency = 'bi-monthly';
          else if (title.includes('bi-annually') || title.includes('biannually') || title.includes('bi-annual')) event.frequency = 'bi-annually';
          else if (title.includes('annually') || (title.includes('annual') && !title.includes('bi-annual'))) event.frequency = 'annually';
          else if (title.includes('public holiday') || title.includes('holiday')) event.frequency = 'public holiday';
        }
        
        if (!eventsByDate[date]) {
          eventsByDate[date] = [];
        }
        eventsByDate[date].push(event);
      });
      
      setEvents(eventsByDate);
      setLoading(false);
    } catch (error) {
      console.error('Error loading calendar events:', error);
      setLoading(false);
    }
  };

  const handleDateClick = (date) => {
    setSelectedDate(date);
    setEditingEvent(null);
    setEventForm({
      event_date: date,
      task_title: '',
      procedure_code: '',
      description: '',
      frequency: ''
    });
    setShowEventModal(true);
  };

  const handleEventClick = (event, e) => {
    e.stopPropagation();
    setEditingEvent(event);
    setEventForm({
      event_date: event.event_date,
      task_title: event.task_title,
      procedure_code: event.procedure_code || '',
      description: event.description || '',
      frequency: event.frequency || ''
    });
    setShowEventModal(true);
  };

  const handleSaveEvent = async () => {
    try {
      if (editingEvent) {
        await updateCalendarEvent(editingEvent.id, eventForm);
      } else {
        await createCalendarEvent(eventForm);
      }
      await loadEvents();
      setShowEventModal(false);
      setEditingEvent(null);
      setSelectedDate(null);
    } catch (err) {
      console.error('Error saving event:', err);
      setError({
        message: 'Failed to save event. Please try again.',
        details: err.response?.data?.error || err.message
      });
    }
  };

  const handleDeleteEvent = () => {
    if (!editingEvent) return;
    const eventToDelete = editingEvent;

    // Close the edit modal first so the confirm dialog is visible
    setShowEventModal(false);

    setConfirmDialog({
      title: 'Delete Event',
      message: 'Are you sure you want to delete this event?',
      confirmLabel: 'Delete',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await deleteCalendarEvent(eventToDelete.id);
          await loadEvents();
          setEditingEvent(null);
          setSelectedDate(null);
        } catch (err) {
          console.error('Error deleting event:', err);
          setError({
            message: 'Failed to delete event. Please try again.',
            details: err.response?.data?.error || err.message
          });
        }
      }
    });
  };
  
  const handleCloseModal = () => {
    setShowEventModal(false);
    setEditingEvent(null);
    setSelectedDate(null);
  };

  const generateCalendar = () => {
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    
    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();
    
    const days = [];
    
    // Add empty cells for days before the first day of the month
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }
    
    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(currentYear, currentMonth, day);
      // Use local date formatting instead of UTC to avoid timezone issues
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const dayStr = String(date.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${dayStr}`;
      days.push({
        day,
        date: dateStr,
        events: events[dateStr] || []
      });
    }
    
    return {
      name: monthNames[currentMonth],
      year: currentYear,
      days
    };
  };

  const calendar = generateCalendar();
  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  
  // Navigation locked to current year only: cannot go to previous or next year
  const actualCurrentYear = new Date().getFullYear();
  const canGoPrevious = currentMonth > 0 && currentYear === actualCurrentYear;
  const canGoNext = currentMonth < 11 && currentYear === actualCurrentYear;

  const handlePreviousMonth = () => {
    if (!canGoPrevious) return;
    setCurrentDate(new Date(currentYear, currentMonth - 1, 1));
  };

  const handleNextMonth = () => {
    if (!canGoNext) return;
    setCurrentDate(new Date(currentYear, currentMonth + 1, 1));
  };

  const handleToday = () => {
    const today = new Date();
    setCurrentDate(new Date(today.getFullYear(), today.getMonth(), 1));
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setError('Please select an Excel (.xlsx) file.');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const result = await uploadYearCalendar(file);
      await loadEvents();
      setError(null);
      alert(`Year calendar uploaded. ${result.imported} events imported. Template saved for download.`);
    } catch (err) {
      setError(err.message || 'Failed to upload year calendar.');
    } finally {
      setUploading(false);
    }
  };

  // Helper to determine text color based on background
  function getContrastColor(hexColor) {
    if (!hexColor) return '#000000';
    // Remove # if present
    const hex = hexColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    // Calculate luminance
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? '#000000' : '#ffffff';
  }

  if (loading) {
    return <div className="loading">Loading calendar...</div>;
  }

  return (
    <div className="calendar-container">
      <ErrorAlert
        error={error}
        onClose={() => setError(null)}
        title="Calendar Error"
      />
      <ConfirmDialog
        dialog={confirmDialog}
        onClose={() => setConfirmDialog(null)}
      />
      <div className="calendar-header">
        <h1>Year Calendar</h1>
        <div className="calendar-controls">
          <button 
            className="btn btn-secondary calendar-nav-btn calendar-icon-btn" 
            onClick={handlePreviousMonth}
            disabled={!canGoPrevious}
            title={canGoPrevious ? "Previous Month" : "Only months in the current year are shown"}
          >
            ◀
          </button>
          <button 
            className="btn btn-secondary calendar-nav-btn calendar-icon-btn" 
            onClick={handleToday}
            title="Go to current month"
          >
            ●
          </button>
          <button 
            className="btn btn-secondary calendar-nav-btn calendar-icon-btn" 
            onClick={handleNextMonth}
            disabled={!canGoNext}
            title={canGoNext ? "Next Month" : "Only months in the current year are shown"}
          >
            ▶
          </button>
          {showUploadButton && (
            <>
              <input
                type="file"
                ref={fileInputRef}
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
              <button
                type="button"
                className="btn btn-secondary calendar-download-btn"
                onClick={handleUploadClick}
                disabled={uploading}
                title="Upload Year Calendar Excel to import events and save as template"
              >
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="calendar-content-wrapper">
        {/* Calendar - Left Side */}
        <div className="calendar-month-view" style={{ position: 'relative' }}>
        <div className="calendar-month">
          <h2 className="month-name">{calendar.name} {calendar.year}</h2>
          <div className="calendar-weekdays">
            {weekDays.map(day => (
              <div key={day} className="weekday-header">{day}</div>
            ))}
          </div>
          <div className="calendar-days">
            {calendar.days.map((dayData, dayIndex) => {
              if (dayData === null) {
                return <div key={dayIndex} className="calendar-day empty"></div>;
              }
              
              const { day, date, events: dayEvents } = dayData;
              const isToday = date === getTodayDate();
              const isSelected = selectedDate === date || (showEventModal && eventForm.event_date === date);
              
              return (
                <div
                  key={dayIndex}
                  className={`calendar-day ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}`}
                  onClick={() => handleDateClick(date)}
                >
                  <div className="day-number">{day}</div>
                    <div className="day-events">
                      {dayEvents.slice(0, 3).map((event, eventIndex) => {
                        const eventColor = getEventColor(event, colorMap);
                        // Extract task title safely (handle object formats)
                        let taskTitle = event.task_title;
                        if (taskTitle && typeof taskTitle === 'object') {
                          taskTitle = taskTitle.text || taskTitle.richText?.map(r => r.text).join('') || 'Task';
                        }
                        taskTitle = taskTitle && typeof taskTitle === 'string' ? taskTitle : 'Task';
                        
                        // Check if this is an outstanding task (no color, black border)
                        const isOutstandingTask = eventColor === 'OUTSTANDING_TASK';
                        
                        return (
                          <div
                            key={eventIndex}
                            className="calendar-event"
                            style={{ 
                              backgroundColor: isOutstandingTask ? 'transparent' : eventColor, 
                              color: isOutstandingTask ? '#000' : getContrastColor(eventColor),
                              border: isOutstandingTask ? '0.2px solid #000' : 'none',
                              fontWeight: isOutstandingTask ? '600' : 'normal'
                            }}
                            onClick={(e) => handleEventClick(event, e)}
                            title={taskTitle}
                          >
                            {taskTitle.length > 25 ? taskTitle.substring(0, 25) + '...' : taskTitle}
                          </div>
                        );
                      })}
                      {dayEvents.length > 3 && (
                        <div className="calendar-event-more">
                          +{dayEvents.length - 3} more
                        </div>
                      )}
                    </div>
                </div>
              );
            })}
          </div>
        </div>
        
        {/* Legend - Compact Horizontal (driven by legendConfig) */}
        <div className="calendar-legend-compact">
          <div className="legend-trigger" onClick={() => setLegendExpanded(!legendExpanded)} title="Show/Hide Legend">
            <span className="legend-icon">Legend</span>
          </div>
          {legendExpanded && (
            <div className="legend-items-horizontal">
              {CANONICAL_KEYS.map(key => (
                <div key={key} className="legend-item-compact">
                  <span className="legend-color-compact" style={{ backgroundColor: legendConfig[key]?.color }}></span>
                  <span className="legend-label-compact">{legendConfig[key]?.label}</span>
                </div>
              ))}
              {isSystemOwner && hasOrganizationContext(user) && (
                <div
                  className="legend-item-compact legend-customize-btn"
                  onClick={() => {
                    const form = {};
                    CANONICAL_KEYS.forEach(k => {
                      form[k] = { color: legendConfig[k]?.color || '#000000', label: legendConfig[k]?.label || '' };
                    });
                    setLegendForm(form);
                    setShowLegendModal(true);
                  }}
                  title="Customize legend colors and labels"
                  style={{ cursor: 'pointer', marginTop: 4, borderTop: '1px solid #e0e0e0', paddingTop: 4 }}
                >
                  <span style={{ fontSize: 10, color: '#3498db', fontWeight: 600 }}>Customize</span>
                </div>
              )}
            </div>
          )}
        </div>
        </div>
      </div>

      {showEventModal && (
        <div className="modal-overlay" onClick={handleCloseModal}>
          <div className="modal-content calendar-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingEvent ? 'Edit Event' : 'Add Event'}</h2>
              <button className="modal-close" onClick={handleCloseModal}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Date *</label>
                <input
                  type="date"
                  value={eventForm.event_date}
                  onChange={(e) => setEventForm({ ...eventForm, event_date: e.target.value })}
                  className="form-control"
                  required
                />
              </div>
              <div className="form-group">
                <label>Task Title *</label>
                <input
                  type="text"
                  value={eventForm.task_title}
                  onChange={(e) => setEventForm({ ...eventForm, task_title: e.target.value })}
                  className="form-control"
                  placeholder="e.g., PM-009 Weekly Artificial Ventilation"
                  required
                />
              </div>
              <div className="form-group">
                <label>Procedure Code</label>
                <input
                  type="text"
                  value={eventForm.procedure_code}
                  onChange={(e) => setEventForm({ ...eventForm, procedure_code: e.target.value })}
                  className="form-control"
                  placeholder="e.g., PM-009"
                />
              </div>
              <div className="form-group">
                <label>Frequency</label>
                <select
                  value={eventForm.frequency}
                  onChange={(e) => setEventForm({ ...eventForm, frequency: e.target.value })}
                  className="form-control"
                >
                  <option value="">Select frequency</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="bi-monthly">Bi-Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="biannually">Bi-Annually</option>
                  <option value="annually">Annually</option>
                </select>
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={eventForm.description}
                  onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })}
                  className="form-control"
                  rows="3"
                  placeholder="Additional details about this task..."
                />
              </div>
            </div>
            <div className="modal-footer">
              {editingEvent && (
                <button
                  className="btn btn-danger"
                  onClick={handleDeleteEvent}
                >
                  Delete
                </button>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px' }}>
                <button
                  className="btn btn-secondary"
                  onClick={handleCloseModal}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleSaveEvent}
                  disabled={!eventForm.event_date || !eventForm.task_title}
                >
                  {editingEvent ? 'Update' : 'Add'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showLegendModal && (
        <div className="modal-overlay" onClick={() => setShowLegendModal(false)}>
          <div className="modal-content calendar-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h2>Customize Legend</h2>
              <button className="modal-close" onClick={() => setShowLegendModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, color: '#7f8c8d', margin: '0 0 16px' }}>
                Set a color and display label for each task frequency. Changes apply to this organization only.
              </p>
              {CANONICAL_KEYS.map(key => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <input
                    type="color"
                    value={legendForm[key]?.color || '#000000'}
                    onChange={(e) => setLegendForm(prev => ({
                      ...prev,
                      [key]: { ...prev[key], color: e.target.value }
                    }))}
                    style={{ width: 36, height: 32, padding: 0, border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer' }}
                    title={`Color for ${key}`}
                  />
                  <input
                    type="text"
                    value={legendForm[key]?.label || ''}
                    onChange={(e) => setLegendForm(prev => ({
                      ...prev,
                      [key]: { ...prev[key], label: e.target.value }
                    }))}
                    className="form-control"
                    style={{ flex: 1 }}
                    placeholder={`Label for ${key}`}
                    maxLength={30}
                  />
                  <span style={{ fontSize: 10, color: '#95a5a6', minWidth: 80, textAlign: 'right' }}>{key}</span>
                </div>
              ))}
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  const form = {};
                  CANONICAL_KEYS.forEach(k => {
                    form[k] = { color: DEFAULT_LEGEND_CONFIG[k].color, label: DEFAULT_LEGEND_CONFIG[k].label };
                  });
                  setLegendForm(form);
                }}
                title="Reset all to default colors and labels"
              >
                Reset
              </button>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px' }}>
                <button className="btn btn-secondary" onClick={() => setShowLegendModal(false)}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  disabled={legendSaving || CANONICAL_KEYS.some(k => !legendForm[k]?.color || !legendForm[k]?.label?.trim())}
                  onClick={async () => {
                    setLegendSaving(true);
                    try {
                      const res = await putCalendarLegend(legendForm);
                      if (res.data?.legend) {
                        setLegendConfig(res.data.legend);
                      } else {
                        setLegendConfig(legendForm);
                      }
                      setShowLegendModal(false);
                    } catch (err) {
                      setError({
                        message: 'Failed to save legend customization.',
                        details: err.response?.data?.error || err.message
                      });
                    } finally {
                      setLegendSaving(false);
                    }
                  }}
                >
                  {legendSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Calendar;
