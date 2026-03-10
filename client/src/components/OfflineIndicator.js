/**
 * Offline Status Indicator Component
 * Shows connection status and sync progress
 */

import React, { useState, useEffect } from 'react';
import syncManager from '../utils/syncManager';
import offlineStorage from '../utils/offlineStorage';
import './OfflineIndicator.css';

function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncStatus, setSyncStatus] = useState('idle');
  const [pendingCount, setPendingCount] = useState(0);
  const [syncProgress, setSyncProgress] = useState(null);

  useEffect(() => {
    const updateOnlineStatus = () => {
      setIsOnline(navigator.onLine);
    };

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    // Check pending items — only update state when count actually changes
    const checkPending = async () => {
      try {
        const pending = await offlineStorage.getSyncQueue('pending');
        setPendingCount(prev => prev !== pending.length ? pending.length : prev);
      } catch (error) {
        // Silently ignore — don't cause re-renders for check errors
      }
    };

    checkPending();
    const interval = setInterval(checkPending, 30000); // 30s instead of 5s

    // Listen to sync status
    const unsubscribe = syncManager.onSyncStatusChange((status, data) => {
      setSyncStatus(status);
      if (status === 'completed') {
        setSyncProgress(data);
        setTimeout(() => {
          setSyncProgress(null);
        }, 3000);
        checkPending();
      } else if (status === 'syncing') {
        setSyncProgress({ message: 'Syncing...' });
      }
    });

    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
      clearInterval(interval);
      unsubscribe();
    };
  }, []);

  // Don't show anything if online and no pending items
  if (isOnline && pendingCount === 0 && syncStatus === 'idle') {
    return null;
  }

  return (
    <div className={`offline-indicator ${!isOnline ? 'offline' : ''} ${syncStatus === 'syncing' ? 'syncing' : ''}`}>
      {!isOnline ? (
        <div className="offline-status">
          <span className="offline-icon">⚠</span>
          <span className="offline-text">Offline Mode</span>
          {pendingCount > 0 && (
            <span className="pending-count">{pendingCount} pending</span>
          )}
        </div>
      ) : syncStatus === 'syncing' ? (
        <div className="sync-status">
          <span className="sync-icon">🔄</span>
          <span className="sync-text">Syncing...</span>
        </div>
      ) : pendingCount > 0 ? (
        <div className="pending-status">
          <span className="pending-icon">⏳</span>
          <span className="pending-text">{pendingCount} pending sync</span>
        </div>
      ) : syncProgress ? (
        <div className="sync-complete">
          <span className="success-icon">✓</span>
          <span className="success-text">
            {syncProgress.success > 0 && `${syncProgress.success} synced`}
            {syncProgress.failed > 0 && `, ${syncProgress.failed} failed`}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export default OfflineIndicator;
