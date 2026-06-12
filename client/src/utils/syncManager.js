/**
 * Sync Manager
 * Handles synchronization of offline operations when connection is restored
 */

import offlineStorage from './offlineStorage';
import axios from 'axios';
import { getApiBaseUrl, getAuthToken } from '../api/api';

class SyncManager {
  constructor() {
    this.isSyncing = false;
    this.syncListeners = [];
    this.maxRetries = 3;
    this.retryDelay = 5000; // 5 seconds
    this.syncInterval = null;
    this._onlineHandler = null; // stored so we can remove it on stopAutoSync
  }

  onSyncStatusChange(callback) {
    this.syncListeners.push(callback);
    return () => {
      this.syncListeners = this.syncListeners.filter(cb => cb !== callback);
    };
  }

  notifySyncStatus(status, data = null) {
    this.syncListeners.forEach(callback => {
      try {
        callback(status, data);
      } catch (error) {
        console.error('Error in sync listener:', error);
      }
    });
  }

  async sync() {
    if (this.isSyncing) return;
    if (!navigator.onLine) return;

    this.isSyncing = true;
    this.notifySyncStatus('syncing');

    try {
      const pendingItems = await offlineStorage.getSyncQueue('pending');

      if (pendingItems.length === 0) {
        this.isSyncing = false;
        this.notifySyncStatus('idle');
        return;
      }

      let successCount = 0;
      let failureCount = 0;

      for (const item of pendingItems) {
        // Skip items that are scheduled for a future retry
        if (item.nextRetry && item.nextRetry > Date.now()) {
          continue;
        }

        try {
          await this.processSyncItem(item);
          await offlineStorage.removeFromSyncQueue(item.id);
          successCount++;
        } catch (error) {
          console.error('Error processing sync item:', error);

          const retryCount = (item.retryCount || 0) + 1;

          if (retryCount >= this.maxRetries) {
            await offlineStorage.updateSyncQueueItem(item.id, {
              status: 'failed',
              retryCount,
              lastError: error.message
            });
            failureCount++;
          } else {
            await offlineStorage.updateSyncQueueItem(item.id, {
              retryCount,
              lastError: error.message,
              nextRetry: Date.now() + this.retryDelay
            });
          }
        }
      }

      this.notifySyncStatus('completed', {
        success: successCount,
        failed: failureCount,
        total: pendingItems.length
      });

    } catch (error) {
      console.error('Sync error:', error);
      this.notifySyncStatus('error', { error: error.message });
    } finally {
      this.isSyncing = false;
    }
  }

  async processSyncItem(item) {
    const API_BASE_URL = getApiBaseUrl();
    const { method, url, data, headers } = item;

    // Attach the current JWT so replayed writes are authenticated even when the
    // session cookie isn't sent (cross-origin port-forwarding, expiry, SameSite).
    const token = getAuthToken();

    // Drop any Authorization captured at queue time — it may be stale. The fresh
    // token below is authoritative.
    const { Authorization, authorization, ...safeHeaders } = headers || {};

    const config = {
      method: method.toLowerCase(),
      url: `${API_BASE_URL}${url}`,
      headers: {
        'Content-Type': 'application/json',
        ...safeHeaders,
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      withCredentials: true,
      // Don't let axios throw only on 2xx — we validate manually below
      validateStatus: () => true
    };

    if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      config.data = data;
    }

    const response = await axios(config);

    // Treat 4xx/5xx as errors so the item is retried or marked failed
    if (response.status >= 400) {
      const message = response.data?.error || response.data?.message || `HTTP ${response.status}`;
      throw new Error(message);
    }

    return response.data;
  }

  async startAutoSync(interval = 30000) {
    // Remove any previously registered online handler to prevent accumulation
    if (this._onlineHandler) {
      window.removeEventListener('online', this._onlineHandler);
    }

    this._onlineHandler = async () => {
      await this.sync();
    };

    // Sync when connection is restored
    window.addEventListener('online', this._onlineHandler);

    // Sync immediately if online
    if (navigator.onLine) {
      await this.sync();
    }

    // Clear any existing interval before setting a new one
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    this.syncInterval = setInterval(async () => {
      if (navigator.onLine && !this.isSyncing) {
        await this.sync();
      }
    }, interval);
  }

  stopAutoSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    if (this._onlineHandler) {
      window.removeEventListener('online', this._onlineHandler);
      this._onlineHandler = null;
    }
  }
}

// Export singleton instance
export default new SyncManager();
