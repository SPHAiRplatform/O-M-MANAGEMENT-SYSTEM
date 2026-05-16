import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { getTasks } from '../api/api';

/**
 * Custom hook for smart inactivity timeout detection
 * Implements two-tier timeout:
 * - Work-active timeout: 2-4 hours (when user has active tasks or recent work)
 * - Idle timeout: 45 minutes (when user has no active work context)
 */
export const useInactivityTimeout = () => {
  const { user, logout, isAuthenticated } = useAuth();
  const [showWarning, setShowWarning] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(0);
  
  const timeoutRef = useRef(null);
  const warningTimeoutRef = useRef(null);
  const lastActivityRef = useRef(Date.now());
  const lastApiActivityRef = useRef(Date.now());
  const checkIntervalRef = useRef(null);
  const warningIntervalRef = useRef(null);
  const debounceTimerRef = useRef(null);
  const abortControllerRef = useRef(null);
  const workContextCacheRef = useRef({ result: null, timestamp: 0 });
  const consecutiveFailuresRef = useRef(0);
  const lastWorkContextCheckRef = useRef(0);
  
  // Timeout durations (in milliseconds)
  // Extended in development to prevent interruptions
  const isDevelopment = process.env.NODE_ENV !== 'production';
  const IDLE_TIMEOUT = isDevelopment 
    ? 24 * 60 * 60 * 1000 // 24 hours in development
    : 45 * 60 * 1000; // 45 minutes in production
  const WORK_ACTIVE_TIMEOUT = isDevelopment
    ? 24 * 60 * 60 * 1000 // 24 hours in development
    : 3 * 60 * 60 * 1000; // 3 hours in production
  const WARNING_TIME = 5 * 60 * 1000; // 5 minutes before logout
  const RECENT_API_THRESHOLD = 10 * 60 * 1000; // 10 minutes
  const RECENT_TASK_THRESHOLD = 2 * 60 * 60 * 1000; // 2 hours
  
  // Debounce and throttling constants
  const ACTIVITY_DEBOUNCE = 5 * 1000; // 5 seconds - debounce user activity
  const WORK_CONTEXT_CHECK_INTERVAL = 60 * 1000; // 60 seconds - minimum time between work context checks
  const WORK_CONTEXT_CACHE_DURATION = 30 * 1000; // 30 seconds - cache work context results
  const MAX_CONSECUTIVE_FAILURES = 3; // Max failures before exponential backoff
  const INITIAL_BACKOFF = 5 * 1000; // 5 seconds initial backoff
  const MAX_BACKOFF = 60 * 1000; // 60 seconds max backoff

  /**
   * Calculate exponential backoff delay
   */
  const getBackoffDelay = useCallback(() => {
    const failures = consecutiveFailuresRef.current;
    if (failures === 0) return 0;
    
    const delay = Math.min(INITIAL_BACKOFF * Math.pow(2, failures - 1), MAX_BACKOFF);
    return delay;
  }, []);

  /**
   * Check for other activity indicators (API activity, drafts)
   */
  const checkOtherActivity = useCallback(() => {
    // Check for recent API activity (within last 10 minutes)
    const timeSinceLastApi = Date.now() - lastApiActivityRef.current;
    if (timeSinceLastApi < RECENT_API_THRESHOLD) {
      return true;
    }

    const draftKeys = Object.keys(localStorage).filter(key =>
      key.startsWith('draft_') || key.startsWith('checklist_draft_')
    );

    if (draftKeys.length > 0) {
      return true;
    }

    return false;
  }, [RECENT_API_THRESHOLD]);

  /**
   * Check if user has active work context
   * Uses caching and request cancellation to prevent resource exhaustion
   */
  const hasActiveWorkContext = useCallback(async () => {
    if (!user || !isAuthenticated()) return false;

    // Check cache first
    const now = Date.now();
    const cacheAge = now - workContextCacheRef.current.timestamp;
    if (workContextCacheRef.current.result !== null && cacheAge < WORK_CONTEXT_CACHE_DURATION) {
      return workContextCacheRef.current.result;
    }

    const timeSinceLastCheck = now - lastWorkContextCheckRef.current;
    if (timeSinceLastCheck < WORK_CONTEXT_CHECK_INTERVAL) {
      if (workContextCacheRef.current.result !== null) {
        return workContextCacheRef.current.result;
      }
      return checkOtherActivity();
    }

    // Check if we should apply backoff
    const backoffDelay = getBackoffDelay();
    if (backoffDelay > 0) {
      const timeSinceLastFailure = now - lastWorkContextCheckRef.current;
      if (timeSinceLastFailure < backoffDelay) {
        if (workContextCacheRef.current.result !== null) {
          return workContextCacheRef.current.result;
        }
        return checkOtherActivity();
      }
    }

    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new AbortController for this request
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      lastWorkContextCheckRef.current = now;
      
      // Check for active tasks (in_progress or paused) assigned to this user
      // Pass signal for request cancellation
      const tasksResponse = await getTasks({ status: 'in_progress' }, { 
        signal,
        timeout: 10000 // 10 second timeout for work context checks (shorter than default)
      });
      
      // Reset failure count on success
      consecutiveFailuresRef.current = 0;
      
      if (!tasksResponse || !tasksResponse.data || !Array.isArray(tasksResponse.data)) {
        // No tasks or invalid response, check other conditions
        const result = checkOtherActivity();
        workContextCacheRef.current = { result, timestamp: now };
        return result;
      }
      
      // Filter tasks assigned to current user
      const userTasks = tasksResponse.data.filter(task => {
        // Check if task is assigned to user via assigned_to field
        if (task.assigned_to === user.id) return true;
        
        // Check if user is in assigned_users array
        if (task.assigned_users && Array.isArray(task.assigned_users)) {
          return task.assigned_users.some(assignedUser => assignedUser.id === user.id);
        }
        
        return false;
      }) || [];
      
      const activeTasks = userTasks.filter(task => 
        task.status === 'in_progress' || task.status === 'paused' || task.is_paused
      );

      if (activeTasks.length > 0) {
        const result = true;
        workContextCacheRef.current = { result, timestamp: now };
        return result;
      }

      // Check for tasks started within last 2 hours by this user
      const recentTasks = userTasks.filter(task => {
        if (!task.started_at) return false;
        const startedAt = new Date(task.started_at);
        const now = new Date();
        return (now - startedAt) < RECENT_TASK_THRESHOLD;
      });

      if (recentTasks.length > 0) {
        const result = true;
        workContextCacheRef.current = { result, timestamp: now };
        return result;
      }

      // Check other activity indicators
      const result = checkOtherActivity();
      workContextCacheRef.current = { result, timestamp: now };
      return result;
    } catch (error) {
      // Don't treat failed requests as activity - only successful ones
      if (error.name === 'AbortError' || error.name === 'CanceledError') {
        if (workContextCacheRef.current.result !== null) {
          return workContextCacheRef.current.result;
        }
        return checkOtherActivity();
      }
      
      consecutiveFailuresRef.current += 1;
      console.error('Error checking work context:', error);
      
      // On error, check other activity indicators (don't make API call)
      const result = checkOtherActivity();
      // Don't cache error results - only cache successful API results
      return result;
    }
  }, [user, isAuthenticated, RECENT_API_THRESHOLD, RECENT_TASK_THRESHOLD, checkOtherActivity, getBackoffDelay]);

  /**
   * Reset the inactivity timer (debounced)
   */
  const resetTimer = useCallback(async () => {
    // Clear existing debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Debounce the reset - only actually reset after user stops interacting
    debounceTimerRef.current = setTimeout(async () => {
      // Clear existing timeouts
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (warningTimeoutRef.current) {
        clearTimeout(warningTimeoutRef.current);
        warningTimeoutRef.current = null;
      }
      if (warningIntervalRef.current) {
        clearInterval(warningIntervalRef.current);
        warningIntervalRef.current = null;
      }

      setShowWarning(false);
      setTimeRemaining(0);

      if (!isAuthenticated()) return;

      // Update last activity time
      lastActivityRef.current = Date.now();

      // Check if user has active work context (this is now throttled and cached)
      const hasActiveWork = await hasActiveWorkContext();
      const timeoutDuration = hasActiveWork ? WORK_ACTIVE_TIMEOUT : IDLE_TIMEOUT;

      // Set warning timeout (5 minutes before logout)
      const warningTime = timeoutDuration - WARNING_TIME;
      warningTimeoutRef.current = setTimeout(() => {
        setShowWarning(true);
        setTimeRemaining(WARNING_TIME);
        
        // Update countdown every second
        const warningStartTime = Date.now();
        warningIntervalRef.current = setInterval(() => {
          const elapsed = Date.now() - warningStartTime;
          const remaining = Math.max(0, WARNING_TIME - elapsed);
          setTimeRemaining(remaining);
          
          if (remaining <= 0) {
            clearInterval(warningIntervalRef.current);
            warningIntervalRef.current = null;
          }
        }, 1000);
      }, warningTime);

      // Set logout timeout
      timeoutRef.current = setTimeout(async () => {
        // Double-check work context before logging out (uses cache if recent)
        const stillHasActiveWork = await hasActiveWorkContext();
        
        if (stillHasActiveWork) {
          resetTimer();
          return;
        }
        setShowWarning(false);
        await logout();
      }, timeoutDuration);
    }, ACTIVITY_DEBOUNCE);
  }, [isAuthenticated, hasActiveWorkContext, logout, IDLE_TIMEOUT, WORK_ACTIVE_TIMEOUT, WARNING_TIME, ACTIVITY_DEBOUNCE]);

  /**
   * Track API activity (only called for successful API calls)
   */
  const trackApiActivity = useCallback(() => {
    lastApiActivityRef.current = Date.now();
    // Reset failure count on successful API activity
    consecutiveFailuresRef.current = 0;
    // Invalidate cache to force fresh check
    workContextCacheRef.current = { result: null, timestamp: 0 };
    resetTimer();
  }, [resetTimer]);

  /**
   * Extend session (user clicked "Stay Logged In")
   */
  const extendSession = useCallback(() => {
    setShowWarning(false);
    setTimeRemaining(0);
    resetTimer();
  }, [resetTimer]);

  // Set up activity listeners
  useEffect(() => {
    if (!isAuthenticated()) {
      // Clear all timeouts if not authenticated
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);
      if (warningIntervalRef.current) clearInterval(warningIntervalRef.current);
      if (checkIntervalRef.current) clearInterval(checkIntervalRef.current);
      return;
    }

    // Activity events
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    
    const handleActivity = () => {
      lastActivityRef.current = Date.now();
      resetTimer();
    };

    // Add event listeners
    events.forEach(event => {
      document.addEventListener(event, handleActivity, { passive: true });
    });

    // Track page visibility
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        resetTimer();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Periodic check for work context (every 5 minutes)
    // This will use cached results if available, reducing API calls
    checkIntervalRef.current = setInterval(() => {
      resetTimer();
    }, 5 * 60 * 1000);

    // Initial timer setup
    resetTimer();

    // Cleanup
    return () => {
      events.forEach(event => {
        document.removeEventListener(event, handleActivity);
      });
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);
      if (warningIntervalRef.current) clearInterval(warningIntervalRef.current);
      if (checkIntervalRef.current) clearInterval(checkIntervalRef.current);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      
      // Cancel any pending API requests
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [isAuthenticated, resetTimer]);

  return {
    showWarning,
    timeRemaining,
    extendSession,
    trackApiActivity
  };
};
