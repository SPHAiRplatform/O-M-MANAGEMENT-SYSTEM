import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { getPlantMapStructure, savePlantMapStructure, submitTrackerStatusRequest, getCycleInfo, resetCycle, clearCycleToZero, uploadPlantMap } from '../api/api';
import { useAuth } from '../context/AuthContext';
import { hasOrganizationContext, isSystemOwnerWithoutCompany } from '../utils/organizationContext';
import { generatePlantMapReport } from '../utils/plantMapReport';
import { ErrorAlert, SuccessAlert, InfoAlert } from './ErrorAlert';
import { ConfirmDialog } from './ConfirmDialog';
import SitemapBuilder from './SitemapBuilder';
import './Plant.css';

// Correct cabinet mapping: 24 cabinets total
const getCorrectCabinet = (trackerId) => {
  if (!trackerId.startsWith('M')) return '';
  const num = parseInt(trackerId.substring(1), 10);
  if (isNaN(num) || num < 1 || num > 99) return '';
  if (num >= 93) return 'CT24'; // M93-M99 all belong to CT24
  return `CT${Math.ceil(num / 4).toString().padStart(2, '0')}`;
};

// Memoized tracker component for performance
const TrackerBlock = React.memo(({ tracker, bounds, viewMode, isSelected, onSelect, selectionMode }) => {
  const x = (tracker.col - bounds.minCol) * 28;
  const y = (tracker.row - bounds.minRow) * 28;
  const isSiteOffice = tracker.id.startsWith('SITE_OFFICE');
  const bgColor = isSiteOffice 
    ? '#4169E1' 
    : (viewMode === 'grass_cutting' 
        ? (tracker.grassCuttingColor || '#ffffff')
        : (tracker.panelWashColor || '#ffffff'));
  
  // Use brighter colors for better visibility
  // Map old colors to new brighter colors, or use existing if already bright
  const displayColor = (bgColor === '#90EE90' || bgColor === '#4CAF50') ? '#4CAF50' : // Brighter green for done
                      (bgColor === '#FFD700' || bgColor === '#FF9800') ? '#FF9800' : // Brighter orange for halfway
                      bgColor;
  
  // Check if tracker is already done (green) - should not be selectable
  const isDone = !isSiteOffice && (bgColor === '#90EE90' || bgColor === '#4CAF50');
  const isSelectable = !isSiteOffice && !isDone && selectionMode;

  const handleClick = (e) => {
    if (isSiteOffice || !selectionMode || isDone) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(tracker);
  };

  const handleTouch = (e) => {
    if (isSiteOffice || !selectionMode || isDone) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(tracker);
  };
  
  return (
    <div
      onClick={handleClick}
      onTouchStart={handleTouch}
      style={{
        position: 'absolute',
        left: `${x}px`,
        top: `${y}px`,
        width: '28px',
        height: '28px',
        backgroundColor: displayColor,
        border: isSelected ? '3px solid #007bff' : '1px solid #333',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: isSiteOffice ? 'default' : (isSelectable ? 'pointer' : (isDone ? 'not-allowed' : 'default')),
        opacity: isDone && selectionMode ? 0.6 : 1,
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        borderRadius: '2px',
        transition: 'transform 0.1s, box-shadow 0.1s, border 0.1s',
        boxShadow: isSelected ? '0 0 8px rgba(0, 123, 255, 0.6)' : 'none',
        transform: isSelected ? 'scale(1.1)' : 'scale(1)',
        zIndex: isSelected ? 10 : 1,
        touchAction: selectionMode ? 'manipulation' : 'auto',
        WebkitTapHighlightColor: 'transparent',
        msTouchAction: selectionMode ? 'manipulation' : 'auto'
      }}
      className={!isSiteOffice ? 'tracker-block' : ''}
      title={isSiteOffice ? 'Site Office' : `${tracker.label} - ${tracker.cabinet}${isDone && selectionMode ? '\nAlready completed - cannot select' : selectionMode ? '\nTap to select' : ''}`}
    >
      {isSelected && (
        <div style={{
          position: 'absolute',
          top: '-2px',
          right: '-2px',
          width: '12px',
          height: '12px',
          backgroundColor: '#007bff',
          borderRadius: '50%',
          border: '2px solid white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '8px',
          color: 'white',
          fontWeight: 'bold'
        }}>
          ✓
        </div>
      )}
      <div style={{ fontWeight: 'bold', fontSize: '7px', lineHeight: '1.1' }}>
        {tracker.label}
      </div>
      {tracker.sublabel && (
        <div style={{ fontSize: '5px', lineHeight: '1' }}>{tracker.sublabel}</div>
      )}
      {tracker.cabinet && (
        <div style={{ fontSize: '5px', color: '#555', lineHeight: '1' }}>{tracker.cabinet}</div>
      )}
    </div>
  );
});

TrackerBlock.displayName = 'TrackerBlock';

function Plant() {
  const { isAdmin, isSuperAdmin, user, loading: authLoading, hasAnyRole } = useAuth();
  const [trackers, setTrackers] = useState([]);
  const [selectedTrackers, setSelectedTrackers] = useState(new Set()); // Multi-select
  const [selectionMode, setSelectionMode] = useState(false); // Toggle for selection mode
  const [showStatusRequestModal, setShowStatusRequestModal] = useState(false);
  const [viewMode, setViewMode] = useState('grass_cutting');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const [statusRequestForm, setStatusRequestForm] = useState({
    status_type: 'done', // 'done' or 'halfway'
    message: ''
  });
  const saveTimeoutRef = useRef(null);
  const hasLoadedRef = useRef(false);
  const mapContainerRef = useRef(null);
  const mapScrollRef = useRef(null);
  const [mapScale, setMapScale] = useState(1);
  const [downloading, setDownloading] = useState(false);
  const [currentCycle, setCurrentCycle] = useState(null);
  const [cycleLoading, setCycleLoading] = useState(false);
  const [resettingCycle, setResettingCycle] = useState(false);
  const [alertError, setAlertError] = useState(null);
  const [alertSuccess, setAlertSuccess] = useState(null);
  const [alertInfo, setAlertInfo] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [builderMode, setBuilderMode] = useState(false);
  const [uploadingMap, setUploadingMap] = useState(false);
  const plantFileInputRef = useRef(null);
  // Custom labels per organization (stored in map-structure.json)
  const [plantLabels, setPlantLabels] = useState({
    trackerName: 'Trackers',
    cycleName: 'Cycle'
  });
  const siteMapName = 'Site Map'; // Always "Site Map" for all organizations
  const location = useLocation();
  const lastLocationRef = useRef(null);

  /**
   * Load map structure from company folder ONLY
   * PERMANENT SOLUTION: No localStorage fallback to prevent cross-company data leakage
   * Each company's map is stored in: uploads/companies/{slug}/plant/map-structure.json
   * 
   * This function is extracted so it can be called:
   * - On initial mount
   * - When page becomes visible again (after approval)
   * - When viewMode changes
   */
  const loadMapStructure = useCallback(async (forceReload = false) => {
    // Wait for AuthContext to finish loading before checking organization context
    if (authLoading) {
      return; // Don't check until auth is loaded
    }
    
    // If not forcing reload, check if already loaded
    if (!forceReload && hasLoadedRef.current) {
      return;
    }
    
    // Mark as loaded (unless forcing reload)
    if (!forceReload) {
      hasLoadedRef.current = true;
    }
    
    setLoading(true);
    setError(null);
    
      // Check if user has organization context
      if (isSystemOwnerWithoutCompany(user)) {
        // System owner without company: show empty map
        console.log('[PLANT] System owner without company selected - showing empty map');
        setTrackers([]);
        setLoading(false);
        return;
      }
    
    try {
      // Load from server (company-scoped folder)
      const serverPromise = getPlantMapStructure();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Server timeout')), 5000)
      );
      
      let structure = null;
      let serverHasData = false;
      
      // Try to load from server (company folder)
      try {
        const result = await Promise.race([serverPromise, timeoutPromise]);
        if (result && result.structure && Array.isArray(result.structure)) {
          if (result.structure.length > 0) {
            structure = result.structure;
            serverHasData = true;
            console.log('[PLANT] Loaded structure from company folder:', structure.length, 'trackers');
            // Load custom labels if present
            if (result.labels) {
              setPlantLabels(prev => ({ ...prev, ...result.labels }));
            }
          } else {
            // Server returned empty array - company has no map data
            serverHasData = false;
            console.log('[PLANT] Company folder has no map structure - showing blank map');
          }
        }
      } catch (serverError) {
        console.warn('[PLANT] Server load failed or timeout:', serverError.message);
        serverHasData = false;
      }
      
      // NO localStorage fallback - ensures data isolation
      // Each company must have its own map in company folder
      if (!structure || structure.length === 0) {
        console.log('[PLANT] No map structure found in company folder - showing blank map');
        structure = [];
      }
      
      // Process structure
      if (structure && structure.length > 0) {
        // Filter: keep only M## trackers and SITE_OFFICE, remove roads
        const filtered = structure.filter(t => 
          (t.id && t.id.startsWith('M') && /^M\d{2}$/.test(t.id)) || t.id.startsWith('SITE_OFFICE')
        );
        
        // Fix CT numbers
        const fixed = filtered.map(t => {
          if (t.id.startsWith('SITE_OFFICE')) return t;
          const correctCT = getCorrectCabinet(t.id);
          return correctCT ? { ...t, cabinet: correctCT } : t;
        });
        
        setTrackers(fixed);
        
        // If we have data but server doesn't, save to server immediately
        // This ensures other devices can access it
        if (!serverHasData && fixed.length > 0) {
          console.log('[PLANT] Server has no data, auto-syncing to server...');
          setSaving(true);
          try {
            await savePlantMapStructure(fixed);
            console.log('[PLANT] ✓ Successfully auto-saved to company folder');
          } catch (err) {
            console.error('[PLANT] ✗ Failed to auto-save to server:', err);
            // Don't show error to user, just log it
          } finally {
            setSaving(false);
          }
        }
      } else {
        // No map data - show blank map (company has no plant map)
        console.log('[PLANT] No map structure found - showing blank map');
        setTrackers([]);
      }
    } catch (err) {
      console.error('[PLANT] Error loading map structure:', err);
      setError('Failed to load map structure. Please refresh the page.');
      // Show blank map on error (no localStorage fallback to prevent data leakage)
      setTrackers([]);
    } finally {
      setLoading(false);
    }
  }, [user, authLoading]);

  /**
   * Initial load on mount
   */
  useEffect(() => {
    loadMapStructure(false);
  }, [loadMapStructure]);

  /**
   * Reload map structure when navigating back to Plant page
   * This ensures the map updates after admin approval in notifications
   */
  useEffect(() => {
    // Check if we're on the Plant page
    const isOnPlantPage = location.pathname === '/tenant/plant' || location.pathname === '/plant';
    
    if (isOnPlantPage) {
      // Check if we just navigated to the Plant page (from another page)
      if (lastLocationRef.current !== null && lastLocationRef.current !== location.pathname && hasLoadedRef.current) {
        console.log('[PLANT] Navigated back to Plant page - reloading map structure to check for updates');
        // Reset flag to allow reload
        hasLoadedRef.current = false;
        loadMapStructure(true);
      }
    }
    
    lastLocationRef.current = location.pathname;
  }, [location.pathname, loadMapStructure]);

  /**
   * Listen for custom event when tracker status is approved
   * This allows Notifications page to trigger a reload
   */
  useEffect(() => {
    const handleTrackerApproved = (event) => {
      console.log('[PLANT] Tracker approval event received - reloading map structure', event.detail);
      // Force reload immediately
      hasLoadedRef.current = false; // Reset flag to allow reload
      loadMapStructure(true);
    };

    // Listen for custom event
    window.addEventListener('trackerStatusApproved', handleTrackerApproved);
    
    // Also listen for window focus (user switches back to tab)
    const handleFocus = () => {
      // Only reload if we're on Plant page and map has been loaded before
      const isOnPlantPage = location.pathname === '/tenant/plant' || location.pathname === '/plant';
      if (isOnPlantPage && hasLoadedRef.current) {
        console.log('[PLANT] Window regained focus on Plant page - reloading map structure');
        loadMapStructure(true);
      }
    };
    
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('trackerStatusApproved', handleTrackerApproved);
      window.removeEventListener('focus', handleFocus);
    };
  }, [loadMapStructure, location.pathname]);

  /**
   * Reload map structure when viewMode changes
   * This ensures tracker colors are updated for the current view mode
   */
  useEffect(() => {
    if (hasLoadedRef.current) {
      console.log('[PLANT] View mode changed - reloading map structure');
      loadMapStructure(true);
    }
  }, [viewMode, loadMapStructure]);
  /**
   * Save map structure to company folder
   * PERMANENT SOLUTION: Saves to company-scoped file only (no localStorage)
   * Prevents cross-company data leakage
   */
  const saveToServer = useCallback(async (structureToSave, showSaving = true) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        if (showSaving) setSaving(true);
        await savePlantMapStructure(structureToSave);
        console.log('[PLANT] Structure saved to company folder successfully');
        // NO localStorage - data must come from company folder only
      } catch (err) {
        console.error('[PLANT] Error saving to company folder:', err);
        // Don't save to localStorage - ensures data isolation
      } finally {
        if (showSaving) setSaving(false);
      }
    }, 1000); // Debounce 1 second
  }, []);

  // Handle multi-select (works for both desktop and mobile)
  const handleTrackerSelect = useCallback((tracker) => {
    if (tracker.id.startsWith('SITE_OFFICE')) return;
    if (!selectionMode) return; // Only allow selection when in selection mode
    
    // Check if tracker is already done (green) - should not be selectable
    const color = viewMode === 'grass_cutting' ? tracker.grassCuttingColor : tracker.panelWashColor;
    const isDone = color === '#90EE90' || color === '#4CAF50';
    
    if (isDone) {
      // Don't allow selection of already completed trackers
      return;
    }
    
    setSelectedTrackers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(tracker.id)) {
        newSet.delete(tracker.id);
      } else {
        newSet.add(tracker.id);
      }
      return newSet;
    });
  }, [selectionMode, viewMode]);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedTrackers(new Set());
  }, []);

  // Toggle selection mode
  const toggleSelectionMode = useCallback(() => {
    setSelectionMode(prev => {
      if (prev) {
        // Exiting selection mode - clear selection
        setSelectedTrackers(new Set());
      }
      return !prev;
    });
  }, []);

  // Handle status request submission
  const handleSubmitStatusRequest = useCallback(async () => {
    if (selectedTrackers.size === 0) {
      setAlertError('Please select at least one tracker');
      return;
    }

    // Prevent duplicate submissions
    if (submittingRequest) {
      console.log('[PLANT] Submission already in progress, ignoring duplicate request');
      return;
    }

    setSubmittingRequest(true);
    try {
      const response = await submitTrackerStatusRequest({
        tracker_ids: Array.from(selectedTrackers),
        task_type: viewMode,
        status_type: statusRequestForm.status_type,
        message: statusRequestForm.message || null
      });
      
      console.log('[PLANT] Status request submitted successfully:', response.data);
      setAlertSuccess(`Status request submitted successfully! ${selectedTrackers.size} tracker(s) marked as ${statusRequestForm.status_type === 'done' ? 'done' : 'halfway'}. Waiting for admin approval.`);
      setShowStatusRequestModal(false);
      setSelectedTrackers(new Set());
      setStatusRequestForm({ status_type: 'done', message: '' });
    } catch (error) {
      console.error('[PLANT] Error submitting status request:', error);
      const errorMessage = error.response?.data?.error || error.response?.data?.message || 'Failed to submit status request';
      
      // Handle duplicate request error gracefully
      if (error.response?.status === 409) {
        setAlertInfo(`Request already submitted. ${error.response?.data?.message || 'Please wait a moment before submitting again.'}`);
      } else {
        setAlertError(errorMessage);
      }
    } finally {
      setSubmittingRequest(false);
    }
  }, [selectedTrackers, viewMode, statusRequestForm, submittingRequest]);


  // Calculate bounding box (memoized)
  const bounds = useMemo(() => {
    if (trackers.length === 0) return { minCol: 0, maxCol: 20, minRow: 0, maxRow: 15 };
    const cols = trackers.map(t => t.col);
    const rows = trackers.map(t => t.row);
    return {
      minCol: Math.floor(Math.min(...cols)) - 1,
      maxCol: Math.ceil(Math.max(...cols)) + 2,
      minRow: Math.floor(Math.min(...rows)) - 1,
      maxRow: Math.ceil(Math.max(...rows)) + 2
    };
  }, [trackers]);

  const mapWidth = useMemo(() => (bounds.maxCol - bounds.minCol) * 28 + 10, [bounds]);
  const mapHeight = useMemo(() => (bounds.maxRow - bounds.minRow) * 28 + 10, [bounds]);

  // Auto-scale map to fit container on mobile
  useEffect(() => {
    const calcScale = () => {
      if (!mapScrollRef.current || mapWidth <= 0) return;
      const containerWidth = mapScrollRef.current.clientWidth - 16; // padding
      if (containerWidth < mapWidth) {
        setMapScale(Math.max(0.3, containerWidth / mapWidth));
      } else {
        setMapScale(1);
      }
    };
    calcScale();
    window.addEventListener('resize', calcScale);
    return () => window.removeEventListener('resize', calcScale);
  }, [mapWidth]);

  // Calculate progress and statistics for current view mode
  const progress = useMemo(() => {
    const allTrackers = trackers.filter(t => !t.id.startsWith('SITE_OFFICE'));
    if (allTrackers.length === 0) return 0;
    
    const doneCount = allTrackers.filter(t => {
      const color = viewMode === 'grass_cutting' ? t.grassCuttingColor : t.panelWashColor;
      // Check for both old and new green colors
      return color === '#90EE90' || color === '#4CAF50';
    }).length;
    
    const halfwayCount = allTrackers.filter(t => {
      const color = viewMode === 'grass_cutting' ? t.grassCuttingColor : t.panelWashColor;
      // Check for both old and new orange colors
      return color === '#FFD700' || color === '#FF9800';
    }).length;
    
    // Progress = (done + halfway * 0.5) / total * 100
    const progressValue = ((doneCount + halfwayCount * 0.5) / allTrackers.length) * 100;
    return Math.min(100, Math.max(0, progressValue));
  }, [trackers, viewMode]);

  // Load cycle information (skip if system owner without company)
  useEffect(() => {
    const loadCycleInfo = async () => {
      if (!viewMode) return;
      if (isSystemOwnerWithoutCompany(user)) return;
      if (trackers.length === 0) return;
      setCycleLoading(true);
      try {
        const cycleData = await getCycleInfo(viewMode);
        setCurrentCycle(cycleData);
      } catch (error) {
        console.error('[PLANT] Error loading cycle info:', error);
      } finally {
        setCycleLoading(false);
      }
    };

    loadCycleInfo();
  }, [viewMode, trackers, user]); // Reload when viewMode, trackers, or user change

  // Handle cycle reset
  const handleResetCycle = useCallback(async () => {
    if (!isAdmin()) {
      setAlertError('Only administrators can reset cycles');
      return;
    }

    setConfirmDialog({
      title: `Reset ${plantLabels.cycleName}`,
      message: `Are you sure you want to reset the ${viewMode === 'grass_cutting' ? 'Grass Cutting' : 'Panel Wash'} ${plantLabels.cycleName.toLowerCase()}?\n\nThis will:\n- Complete the current ${plantLabels.cycleName.toLowerCase()}\n- Start a new ${plantLabels.cycleName.toLowerCase()}\n- Reset all ${plantLabels.trackerName.toLowerCase()} colors to white\n\nThis action cannot be undone.`,
      confirmLabel: 'Reset',
      variant: 'danger',
      onConfirm: async () => {
        setResettingCycle(true);
        try {
          const result = await resetCycle(viewMode);
          console.log('[PLANT] Cycle reset result:', result);

          // Reset the loaded flag to force a fresh reload
          hasLoadedRef.current = false;

          // Reload cycle info
          const cycleData = await getCycleInfo(viewMode);
          setCurrentCycle(cycleData);

          // Force reload map structure with delay to ensure backend has saved
          // Use longer delay and add cache-busting to ensure fresh data
          setTimeout(async () => {
            try {
              console.log('[PLANT] Reloading map structure after cycle reset...');
              // Force reload by resetting flag and calling loadMapStructure
              hasLoadedRef.current = false;

              // Add a small cache-busting delay and reload
              await new Promise(resolve => setTimeout(resolve, 300));
              await loadMapStructure(true);

              // Verify the reload worked by checking tracker colors
              console.log('[PLANT] Map structure reloaded after cycle reset');

              // Double-check: reload again after another short delay to ensure consistency
              setTimeout(async () => {
                hasLoadedRef.current = false;
                await loadMapStructure(true);
                console.log('[PLANT] Second reload completed for verification');
              }, 500);
            } catch (reloadError) {
              console.error('[PLANT] Error reloading map after cycle reset:', reloadError);
            }
          }, 800);

          setAlertSuccess(`${plantLabels.cycleName} reset successfully! New ${plantLabels.cycleName.toLowerCase()}: ${result.new_cycle_number}`);
        } catch (error) {
          console.error('[PLANT] Error resetting cycle:', error);
          setAlertError('Failed to reset cycle: ' + (error.response?.data?.error || error.message));
        } finally {
          setResettingCycle(false);
        }
      }
    });
  }, [viewMode, isAdmin, loadMapStructure, plantLabels]);

  // Handle clear cycle to zero (system_owner only)
  const handleClearCycleToZero = useCallback(async () => {
    setConfirmDialog({
      title: `Clear ${plantLabels.cycleName} to Zero`,
      message: `This will permanently delete ALL ${plantLabels.cycleName.toLowerCase()} history for ${viewMode === 'grass_cutting' ? 'Grass Cutting' : 'Panel Wash'} and reset the count to 0.\n\nAll ${plantLabels.trackerName.toLowerCase()} colors will be reset to white.\n\nThis action cannot be undone.`,
      confirmLabel: 'Clear to Zero',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await clearCycleToZero(viewMode);
          setCurrentCycle(null);
          hasLoadedRef.current = false;
          await loadMapStructure(true);
          setAlertSuccess(`${plantLabels.cycleName} cleared to zero successfully`);
        } catch (error) {
          const errMsg = error.response?.data?.error || error.message || 'Unknown error';
          setAlertError('Failed to clear cycles: ' + (typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg)));
        }
      }
    });
  }, [viewMode, loadMapStructure, plantLabels]);

  // Calculate detailed statistics for report
  const statistics = useMemo(() => {
    const allTrackers = trackers.filter(t => !t.id.startsWith('SITE_OFFICE'));
    if (allTrackers.length === 0) {
      return {
        progress: 0,
        doneCount: 0,
        halfwayCount: 0,
        notDoneCount: 0,
        totalTrackers: 0
      };
    }
    
    const doneCount = allTrackers.filter(t => {
      const color = viewMode === 'grass_cutting' ? t.grassCuttingColor : t.panelWashColor;
      return color === '#90EE90' || color === '#4CAF50';
    }).length;
    
    const halfwayCount = allTrackers.filter(t => {
      const color = viewMode === 'grass_cutting' ? t.grassCuttingColor : t.panelWashColor;
      return color === '#FFD700' || color === '#FF9800';
    }).length;
    
    const notDoneCount = allTrackers.length - doneCount - halfwayCount;
    const progressValue = ((doneCount + halfwayCount * 0.5) / allTrackers.length) * 100;
    
    return {
      progress: Math.min(100, Math.max(0, progressValue)),
      doneCount,
      halfwayCount,
      notDoneCount,
      totalTrackers: allTrackers.length
    };
  }, [trackers, viewMode]);

  // Handle download report
  const handleDownloadReport = useCallback(async () => {
    if (!mapContainerRef.current) {
      setAlertError('Map container not found. Please refresh the page and try again.');
      return;
    }

    if (downloading) {
      return; // Prevent multiple simultaneous downloads
    }

    // Ensure cycle info is loaded before generating PDF
    if (cycleLoading) {
      setAlertInfo('Please wait for cycle information to load before generating the report.');
      return;
    }

    setDownloading(true);
    try {
      // If cycle info hasn't loaded yet, fetch it now
      let cycleData = currentCycle;
      if (!cycleData) {
        try {
          cycleData = await getCycleInfo(viewMode);
          setCurrentCycle(cycleData);
        } catch (error) {
          console.warn('[PLANT] Could not load cycle info for PDF, continuing without it:', error);
          // Continue without cycle info rather than failing the entire PDF generation
        }
      }

      // Include cycle number in statistics for PDF
      const statsWithCycle = {
        ...statistics,
        cycleNumber: cycleData?.cycle_number || null
      };
      
      await generatePlantMapReport(
        mapContainerRef.current,
        statsWithCycle,
        viewMode
      );
    } catch (error) {
      console.error('Error generating report:', error);
      setAlertError('Failed to generate report. Please try again.');
    } finally {
      setDownloading(false);
    }
  }, [mapContainerRef, statistics, viewMode, downloading, currentCycle, cycleLoading]);

  const handlePlantMapUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';

    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls', 'csv', 'json'].includes(ext)) {
      setAlertError({ message: 'Invalid file type. Please upload an Excel (.xlsx, .xls), CSV, or JSON file.' });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setAlertError({ message: 'File too large. Maximum size is 10MB.' });
      return;
    }

    try {
      setUploadingMap(true);
      setAlertError(null);
      const result = await uploadPlantMap(file);
      setAlertSuccess({ message: `Plant map uploaded successfully. ${result.trackersFound || 0} trackers found.` });
      // Reload map data
      hasLoadedRef.current = false;
      loadMapStructure(true);
    } catch (err) {
      setAlertError({ message: 'Upload failed: ' + (err.message || 'Unknown error') });
    } finally {
      setUploadingMap(false);
    }
  };

  if (loading) {
    return (
      <div className="plant-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}>
        <div style={{ fontSize: '18px', color: '#666' }}>Loading plant map...</div>
      </div>
    );
  }

  if (error && trackers.length === 0) {
    return (
      <div className="plant-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}>
        <div style={{ fontSize: '18px', color: '#d32f2f', marginBottom: '10px' }}>{error}</div>
        <button 
          onClick={() => { hasLoadedRef.current = false; window.location.reload(); }}
          className="btn btn-primary"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="plant-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <ErrorAlert error={alertError} onClose={() => setAlertError(null)} />
      <SuccessAlert message={alertSuccess} onClose={() => setAlertSuccess(null)} />
      <InfoAlert message={alertInfo} onClose={() => setAlertInfo(null)} />
      <ConfirmDialog dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />

      {/* Header */}
      <div style={{ width: '100%', maxWidth: '1200px', marginBottom: '10px' }}>
        <h2 className="page-title" style={{ margin: '0 0 10px 0', textAlign: 'center' }}>{siteMapName}</h2>
        
        {/* Controls */}
        <div className="plant-controls-wrapper" style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          padding: '15px',
          background: '#f5f5f5',
          borderRadius: '8px'
        }}>
          {/* First Row: View, Progress Bar, and Selection Controls */}
          <div className="plant-controls-row" style={{ 
            display: 'flex', 
            justifyContent: 'center',
            alignItems: 'center', 
            gap: '20px', 
            flexWrap: 'wrap'
          }}>
            {/* View and Progress Bar */}
            <div className="plant-view-progress" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'nowrap' }}>
              <div className="plant-view-select" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <label style={{ fontWeight: 'bold', fontSize: '12px' }}>View:</label>
                <select 
                  value={viewMode} 
                  onChange={(e) => setViewMode(e.target.value)}
                  style={{ 
                    padding: '4px 6px', 
                    fontSize: '12px', 
                    borderRadius: '4px',
                    border: '1px solid #ccc',
                    cursor: 'pointer'
                  }}
                >
                  <option value="grass_cutting">🌿 Grass Cutting</option>
                  <option value="panel_wash">💧 Panel Wash</option>
                </select>
              </div>
              {/* Progress Bar */}
              <div className="plant-progress-group" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div className="plant-progress-bar" style={{ width: '250px' }}>
                  <div style={{
                    width: '100%',
                    height: '28px',
                    backgroundColor: '#e0e0e0',
                    borderRadius: '14px',
                    overflow: 'hidden',
                    border: '1px solid #ccc',
                    position: 'relative'
                  }}>
                    <div style={{
                      width: `${progress}%`,
                      height: '100%',
                      backgroundColor: progress >= 100 ? '#4CAF50' : progress >= 50 ? '#FF9800' : '#f44336',
                      transition: 'width 0.3s ease',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'white',
                      fontSize: '13px',
                      fontWeight: 'bold',
                      minWidth: progress > 0 ? '50px' : '0'
                    }}>
                      {progress > 0 && `${progress.toFixed(1)}%`}
                    </div>
                    {progress < 15 && (
                      <div style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        color: '#666',
                        fontSize: '13px',
                        fontWeight: 'bold',
                        pointerEvents: 'none'
                      }}>
                        {progress.toFixed(1)}%
                      </div>
                    )}
                  </div>
                </div>
                {/* Clean Button - Show always during development for testing (normally only shows at 100%) */}
                {hasAnyRole('system_owner', 'operations_admin') && (
                  <button
                    className="plant-clean-btn"
                    onClick={handleResetCycle}
                    disabled={resettingCycle}
                    title={`Reset ${viewMode === 'grass_cutting' ? 'Grass Cutting' : 'Panel Wash'} ${plantLabels.cycleName.toLowerCase()} and clear all ${plantLabels.trackerName.toLowerCase()}`}
                    style={{
                      padding: '4px 8px',
                      fontSize: '11px',
                      fontWeight: 'bold',
                      backgroundColor: '#4CAF50',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: resettingCycle ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px',
                      opacity: resettingCycle ? 0.6 : 1,
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <span style={{ fontSize: '12px' }}>🧹</span>
                    <span>{resettingCycle ? '...' : 'Clean'}</span>
                  </button>
                )}
                {hasAnyRole('system_owner') && (
                  <button
                    className="plant-reset-btn"
                    onClick={handleClearCycleToZero}
                    title={`Clear ${plantLabels.cycleName} count to zero and delete all history`}
                    style={{
                      padding: '4px 8px',
                      fontSize: '11px',
                      fontWeight: 'bold',
                      backgroundColor: '#dc3545',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <span>Reset 0</span>
                  </button>
                )}
              </div>
            </div>

            {/* Action Buttons - compact horizontal group */}
            <div className="plant-action-buttons" style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'nowrap' }}>
              <button
                onClick={toggleSelectionMode}
                className={selectionMode ? "btn btn-primary" : "btn btn-secondary"}
                style={{ 
                  padding: '6px 10px', 
                  fontSize: '12px',
                  fontWeight: 'bold'
                }}
              >
                {selectionMode ? '✓ Select' : 'Select'}
              </button>

              <button
                onClick={handleDownloadReport}
                className="btn btn-primary"
                disabled={downloading || trackers.length === 0}
                style={{ 
                  padding: '6px 10px', 
                  fontSize: '12px',
                  fontWeight: 'bold'
                }}
                title="Download plant map report with image and statistics"
              >
                {downloading ? '...' : '↓ PDF'}
              </button>

              {hasAnyRole('system_owner') && (
                <>
                  <input
                    ref={plantFileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv,.json"
                    style={{ display: 'none' }}
                    onChange={handlePlantMapUpload}
                  />
                  <button
                    onClick={() => plantFileInputRef.current?.click()}
                    className="btn btn-secondary"
                    disabled={uploadingMap}
                    style={{ padding: '6px 10px', fontSize: '12px', fontWeight: 'bold' }}
                    title="Upload plant map Excel file"
                  >
                    <i className="bi bi-upload"></i>{' '}
                    {uploadingMap ? 'Uploading...' : 'Upload'}
                  </button>
                  <button
                    onClick={() => setBuilderMode(!builderMode)}
                    className={builderMode ? 'btn btn-danger' : 'btn btn-secondary'}
                    style={{ padding: '6px 10px', fontSize: '12px', fontWeight: 'bold' }}
                    title="Visual map builder to create and edit sitemap layouts"
                  >
                    <i className={`bi ${builderMode ? 'bi-x-lg' : 'bi-grid-3x3-gap'}`}></i>{' '}
                    {builderMode ? 'Exit' : 'Builder'}
                  </button>
                </>
              )}
            </div>

            {/* Multi-Select Controls */}
            {selectionMode && (
              <div style={{ 
                display: 'flex', 
                gap: '4px', 
                alignItems: 'center',
                padding: '3px 6px',
                background: '#e3f2fd',
                borderRadius: '4px',
                border: '1px solid #2196f3'
              }}>
                {selectedTrackers.size > 0 ? (
                  <>
                    <span style={{ fontWeight: 'bold', color: '#1976d2', fontSize: '11px' }}>
                      {selectedTrackers.size} sel
                    </span>
                    <button
                      onClick={() => setShowStatusRequestModal(true)}
                      className="btn btn-primary"
                      style={{ 
                        padding: '3px 8px', 
                        fontSize: '11px',
                        fontWeight: 'bold'
                      }}
                    >
                      Status
                    </button>
                    <button
                      onClick={clearSelection}
                      className="btn btn-secondary"
                      style={{ 
                        padding: '3px 8px', 
                        fontSize: '11px'
                      }}
                    >
                      Clear
                    </button>
                  </>
                ) : (
                  <span style={{ color: '#666', fontSize: '11px' }}>
                    Tap to select
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Second Row: Legend */}
          <div className="plant-legend-row">
            <span className="plant-legend-item">
              <span className="plant-legend-swatch" style={{ background: '#fff' }}></span>
              Not Done
            </span>
            <span className="plant-legend-item">
              <span className="plant-legend-swatch" style={{ background: '#4CAF50' }}></span>
              Done
            </span>
            <span className="plant-legend-item">
              <span className="plant-legend-swatch" style={{ background: '#FF9800' }}></span>
              Halfway
            </span>
            <span className="plant-legend-item">
              <span className="plant-legend-swatch" style={{ background: '#4169E1' }}></span>
              Site Office
            </span>
          </div>
        </div>
      </div>

      {/* Builder Mode or Normal Map View */}
      {builderMode ? (
        <SitemapBuilder
          initialTrackers={trackers}
          initialLabels={plantLabels}
          onSave={async (newTrackers, newLabels) => {
            await savePlantMapStructure(newTrackers, newLabels);
            setTrackers(newTrackers);
            if (newLabels) setPlantLabels(prev => ({ ...prev, ...newLabels }));
          }}
          onExit={() => {
            setBuilderMode(false);
            hasLoadedRef.current = false;
            loadMapStructure(true);
          }}
        />
      ) : (
        <>
          {/* Map Container - Centered & Scaled to fit */}
          <div
            ref={mapScrollRef}
            className="plant-map-scroll"
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'flex-start',
              width: '100%',
              padding: '8px',
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                width: `${mapWidth}px`,
                height: `${mapHeight * mapScale}px`,
                position: 'relative',
                flexShrink: 0
              }}
            >
              <div
                ref={mapContainerRef}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: `${mapWidth}px`,
                  height: `${mapHeight}px`,
                  background: '#fafafa',
                  border: '2px solid #333',
                  borderRadius: '4px',
                  transform: `scale(${mapScale})`,
                  transformOrigin: 'top left'
                }}
              >
                {trackers.map((tracker) => (
                  <TrackerBlock
                    key={tracker.id}
                    tracker={tracker}
                    bounds={bounds}
                    viewMode={viewMode}
                    isSelected={selectedTrackers.has(tracker.id)}
                    onSelect={handleTrackerSelect}
                    selectionMode={selectionMode}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{ marginTop: '10px', fontSize: '12px', color: '#666', textAlign: 'center' }}>
            <div style={{ marginBottom: '8px' }}>
              {plantLabels.trackerName}: {trackers.filter(t => !t.id.startsWith('SITE_OFFICE')).length}
              {selectionMode && ` | ${selectedTrackers.size} selected`}
              {currentCycle && currentCycle.cycle_number && (
                <span style={{ color: '#4CAF50', fontWeight: 'bold', marginLeft: '8px' }}>
                  | {plantLabels.cycleName}: {currentCycle.cycle_number}
                </span>
              )}
              {currentCycle && (!currentCycle.cycle_number || currentCycle.cycle_number === null) && (
                <span style={{ color: '#999', fontWeight: 'normal', marginLeft: '8px' }}>
                  | {plantLabels.cycleName}: Not Started
                </span>
              )}
            </div>

            {/* Cycle completion indicator */}
            {currentCycle && currentCycle.is_complete && (
              <div style={{
                marginTop: '8px',
                padding: '8px 12px',
                backgroundColor: '#4CAF50',
                color: 'white',
                borderRadius: '4px',
                display: 'inline-block',
                fontSize: '13px',
                fontWeight: '500'
              }}>
                ✓ {plantLabels.cycleName} {currentCycle.cycle_number} Completed!
              </div>
            )}
          </div>
        </>
      )}

      {/* Status Request Modal */}
      {showStatusRequestModal && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
          onClick={() => !submittingRequest && setShowStatusRequestModal(false)}
        >
          <div 
            style={{
              background: 'white',
              borderRadius: '12px',
              padding: '30px',
              maxWidth: '500px',
              width: '90%',
              maxHeight: '90vh',
              overflow: 'auto',
              boxShadow: '0 10px 40px rgba(0,0,0,0.3)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ marginBottom: '20px' }}>
              <h2 style={{ margin: '0 0 10px 0', color: '#1976d2' }}>
                Update Status
              </h2>
              <p style={{ margin: '0', color: '#666', fontSize: '14px' }}>
                You've selected <strong>{selectedTrackers.size}</strong> tracker(s) for <strong>{viewMode === 'grass_cutting' ? 'Grass Cutting' : 'Panel Wash'}</strong>
              </p>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', fontSize: '14px' }}>
                Status Type *
              </label>
              <select
                value={statusRequestForm.status_type}
                onChange={(e) => setStatusRequestForm({ ...statusRequestForm, status_type: e.target.value })}
                style={{
                  width: '100%',
                  padding: '10px',
                  fontSize: '14px',
                  border: '2px solid #ddd',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
                disabled={submittingRequest}
              >
                <option value="done">Done (Completed)</option>
                <option value="halfway">Halfway (In Progress)</option>
              </select>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', fontSize: '14px' }}>
                Message (Optional)
              </label>
              <textarea
                value={statusRequestForm.message}
                onChange={(e) => setStatusRequestForm({ ...statusRequestForm, message: e.target.value })}
                placeholder="Add any notes or comments about this status update..."
                rows="4"
                style={{
                  width: '100%',
                  padding: '10px',
                  fontSize: '14px',
                  border: '2px solid #ddd',
                  borderRadius: '6px',
                  resize: 'vertical',
                  fontFamily: 'inherit'
                }}
                disabled={submittingRequest}
              />
            </div>

            <div style={{ 
              padding: '12px', 
              background: '#fff3cd', 
              borderRadius: '6px', 
              marginBottom: '20px',
              border: '1px solid #ffc107'
            }}>
              <p style={{ margin: 0, fontSize: '13px', color: '#856404' }}>
                <i className="bi bi-exclamation-triangle-fill"></i> <strong>Note:</strong> Your request will be sent to admin/superadmin for approval.
                The tracker colors will only change after approval.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  setShowStatusRequestModal(false);
                  setStatusRequestForm({ status_type: 'done', message: '' });
                }}
                className="btn btn-secondary"
                disabled={submittingRequest}
                style={{ padding: '10px 20px', fontSize: '14px' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitStatusRequest}
                className="btn btn-primary"
                disabled={submittingRequest}
                style={{ padding: '10px 20px', fontSize: '14px', fontWeight: 'bold' }}
              >
                {submittingRequest ? 'Submitting...' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default Plant;
