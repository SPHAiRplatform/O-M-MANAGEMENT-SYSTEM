/**
 * Offline API Wrapper
 * Intercepts API calls and queues them when offline
 */

import axios from 'axios';
import offlineStorage from './offlineStorage';
import syncManager from './syncManager';
import { getApiBaseUrl } from '../api/api';

class OfflineApi {
  constructor() {
    this.isOnline = navigator.onLine;
    this.setupOnlineListeners();
  }

  setupOnlineListeners() {
    window.addEventListener('online', () => {
      this.isOnline = true;
      syncManager.sync();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
    });
  }

  async request(config) {
    const { method, url, data, headers = {} } = config;

    // If online, try to make the request directly
    if (this.isOnline && navigator.onLine) {
      try {
        const API_BASE_URL = getApiBaseUrl();
        const response = await axios({
          ...config,
          url: `${API_BASE_URL}${url}`,
          withCredentials: true
        });
        return response;
      } catch (error) {
        // If request fails and it's a network error, queue it
        if (!error.response && error.message.includes('Network Error')) {
          return this.queueRequest(config);
        }
        throw error;
      }
    }

    // If offline, queue the request
    return this.queueRequest(config);
  }

  async queueRequest(config) {
    const { method, url, data, headers } = config;
    
    // Generate a unique ID for this request
    const requestId = `${method}_${url}_${Date.now()}_${Math.random()}`;

    // Determine the operation type from the URL
    let type = 'unknown';
    if (url.includes('/tasks/') && method === 'PATCH') {
      if (url.includes('/start')) type = 'task_start';
      else if (url.includes('/pause')) type = 'task_pause';
      else if (url.includes('/resume')) type = 'task_resume';
      else if (url.includes('/complete')) type = 'task_complete';
    } else if (url.includes('/checklist-responses') && method === 'POST') {
      type = 'checklist_submit';
    } else if (url.includes('/tasks') && method === 'POST') {
      type = 'task_create';
    } else if (url.includes('/inventory/') && method === 'POST') {
      type = 'inventory_update';
    }

    // Add to sync queue
    await offlineStorage.addToSyncQueue({
      id: requestId,
      type,
      method: method.toUpperCase(),
      url,
      data,
      headers
    });

    // Return a mock response that indicates the request is queued
    return {
      data: {
        queued: true,
        message: 'Request queued for sync when connection is restored',
        requestId
      },
      status: 202,
      statusText: 'Accepted',
      headers: {},
      config
    };
  }

  // Helper methods for common operations
  async get(url, config = {}) {
    return this.request({ ...config, method: 'GET', url });
  }

  async post(url, data, config = {}) {
    return this.request({ ...config, method: 'POST', url, data });
  }

  async put(url, data, config = {}) {
    return this.request({ ...config, method: 'PUT', url, data });
  }

  async patch(url, data, config = {}) {
    return this.request({ ...config, method: 'PATCH', url, data });
  }

  async delete(url, config = {}) {
    return this.request({ ...config, method: 'DELETE', url });
  }
}

// Export singleton instance
export default new OfflineApi();
