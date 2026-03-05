import axios from 'axios';
import offlineApi from '../utils/offlineApi';
import offlineStorage from '../utils/offlineStorage';

// Determine API URL dynamically
// If REACT_APP_API_URL is set, use it
// Otherwise, detect if we're on mobile and use the current hostname
export function getApiBaseUrl() {
  const hostname = window.location.hostname;
  const protocol = window.location.protocol;
  
  // Priority 1: Check for explicit API URL in query parameter (for port forwarding)
  const urlParams = new URLSearchParams(window.location.search);
  const apiUrlParam = urlParams.get('apiUrl');
  if (apiUrlParam) {
    try {
      const parsed = new URL(apiUrlParam);
      console.log('Using API URL from query parameter:', parsed.origin + '/api');
      return parsed.origin + '/api';
    } catch (e) {
      console.warn('Invalid apiUrl parameter, ignoring:', apiUrlParam);
    }
  }

  // Priority 2: Auto-detect port forwarding URLs (before checking env/localStorage)
  // These services create different URLs for each port, so we need manual configuration
  // But we can detect the service and provide helpful guidance
  
  // Dev Tunnels: https://xxxx-3000.region.devtunnels.ms/ -> https://xxxx-3001.region.devtunnels.ms/
  if (hostname.includes('devtunnels.ms')) {
    const backendHostname = hostname.replace(/-3000\./, '-3001.');
    const detectedUrl = `${protocol}//${backendHostname}/api`;
    console.log('Dev Tunnels URL detected. Auto-detected backend API URL:', detectedUrl);
    return detectedUrl;
  }
  
  // ngrok: Different subdomains for each port, need manual config
  // But we can detect it and show a helpful message
  if (hostname.includes('ngrok') || hostname.includes('ngrok-free.app') || hostname.includes('ngrok.io')) {
    console.log('ngrok URL detected. Backend URL must be configured manually via setup page or URL parameter.');
    // Fall through to check localStorage/query params
  }
  
  // Cloudflare Tunnel: Different subdomains for each port
  if (hostname.includes('trycloudflare.com') || hostname.includes('cfargotunnel.com')) {
    console.log('Cloudflare Tunnel URL detected. Backend URL must be configured manually via setup page or URL parameter.');
    // Fall through to check localStorage/query params
  }
  
  // localhost.run: Different subdomains for each port
  if (hostname.includes('localhost.run')) {
    console.log('localhost.run URL detected. Backend URL must be configured manually via setup page or URL parameter.');
    // Fall through to check localStorage/query params
  }
  
  // localtunnel: Different subdomains for each port
  if (hostname.includes('loca.lt')) {
    console.log('localtunnel URL detected. Backend URL must be configured manually via setup page or URL parameter.');
    // Fall through to check localStorage/query params
  }

  // Priority 3: Check localStorage for stored backend URL (for port forwarding)
  const storedApiUrl = localStorage.getItem('backendApiUrl');
  if (storedApiUrl) {
    try {
      const parsed = new URL(storedApiUrl);
      console.log('Using stored backend API URL:', parsed.origin + '/api');
      return parsed.origin + '/api';
    } catch (e) {
      console.warn('Invalid stored API URL, clearing:', storedApiUrl);
      localStorage.removeItem('backendApiUrl');
    }
  }

  // Priority 4: Check environment variable (only if hostname matches or not on port forwarding)
  const envUrl = process.env.REACT_APP_API_URL;
  if (envUrl) {
    try {
      const parsed = new URL(envUrl);
      if (parsed.hostname === hostname) {
        console.log('Using REACT_APP_API_URL (host matches page):', envUrl);
        return envUrl;
      }

      // If hostname doesn't match, it's likely a port forwarding scenario
      // Don't use the env URL to avoid cookie issues
      console.log(
        'REACT_APP_API_URL hostname does not match current page hostname; using auto-detected API URL for session cookies.',
        { envUrl, pageHost: hostname }
      );
    } catch (e) {
      console.warn('Invalid REACT_APP_API_URL; using it as-is:', envUrl, e);
      return envUrl;
    }
  }
  
  // Priority 5: Auto-detect based on current location
  // Check if we're on a VS Code forwarded URL (vscode.dev, codespaces, etc.)
  const isVSCodeForwarded = hostname.includes('vscode.dev') || 
                            hostname.includes('github.dev') ||
                            hostname.includes('codespaces');
  
  if (isVSCodeForwarded) {
    // For VS Code port forwarding, we need the backend forwarded URL
    // This should be provided via query parameter or localStorage
    // Fallback: try to use the same hostname with port 3001 (may not work)
    const detectedUrl = `${protocol}//${hostname}:3001/api`;
    console.warn('VS Code forwarded URL detected. Backend URL should be provided via ?apiUrl= parameter or localStorage.');
    console.log('Attempting auto-detected API URL (may not work):', detectedUrl);
    return detectedUrl;
  }

  // Priority 6: Same origin (production) or localhost:3001 (dev)
  const port = window.location.port;
  const isDefaultPort = !port || port === '80' || port === '443';
  const detectedUrl = isDefaultPort
    ? `${protocol}//${hostname}/api`
    : `${protocol}//${hostname}:3001/api`;
  console.log('Auto-detected API URL:', detectedUrl);
  return detectedUrl;
}

const API_BASE_URL = getApiBaseUrl();

console.log('API Base URL:', API_BASE_URL);

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // Include cookies for session management
  timeout: 30000, // 30 second timeout (increased for debugging)
});

// JWT token for API requests (server supports Bearer token or session cookie)
let authToken = null;

export function setAuthToken(token) {
  authToken = token;
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    try { sessionStorage.setItem('authToken', token); } catch (e) { /* ignore */ }
  } else {
    delete api.defaults.headers.common['Authorization'];
    try { sessionStorage.removeItem('authToken'); } catch (e) { /* ignore */ }
  }
}

// Restore token on load (so refresh keeps user logged in)
try {
  const stored = sessionStorage.getItem('authToken');
  if (stored) setAuthToken(stored);
} catch (e) { /* ignore */ }

// Add request interceptor for debugging
api.interceptors.request.use(
  (config) => {
    console.log(`API Request: ${config.method.toUpperCase()} ${config.url}`);
    return config;
  },
  (error) => {
    console.error('API Request Error:', error);
    return Promise.reject(error);
  }
);

// Add response interceptor for error handling, activity tracking, and offline caching
api.interceptors.response.use(
  (response) => {
    console.log(`API Response: ${response.config.method.toUpperCase()} ${response.config.url}`, response.status);

    // Only track successful API calls as activity (exclude auth endpoints and work context checks)
    // This prevents failed requests from resetting the inactivity timer
    if (!response.config.url.includes('/auth/me') &&
        !response.config.url.includes('/auth/login') &&
        !response.config.url.includes('/tasks?status=in_progress') && // Don't track work context checks
        window.trackApiActivity) {
      window.trackApiActivity();
    }

    // Cache GET responses to IndexedDB for offline fallback
    if (response.config.method === 'get' && response.status === 200) {
      const cacheKey = `api_${response.config.url}`;
      offlineStorage.setCache(cacheKey, {
        data: response.data,
        status: response.status,
        cachedAt: Date.now()
      }).catch(() => { /* ignore cache write errors */ });
    }

    return response;
  },
  async (error) => {
    // Don't track failed requests as activity - this prevents the feedback loop
    // Only successful requests should reset the inactivity timer

    // If it's a network error on a GET request, try to serve from IndexedDB cache
    const isNetworkError = !error.response && (
      !navigator.onLine ||
      error.message.includes('Network Error') ||
      error.code === 'ERR_NETWORK' ||
      error.code === 'ECONNABORTED'
    );

    if (isNetworkError && error.config && error.config.method === 'get') {
      try {
        const cacheKey = `api_${error.config.url}`;
        const cached = await offlineStorage.getCache(cacheKey);
        if (cached && cached.data) {
          console.log(`Serving cached response for: ${error.config.url}`);
          return {
            data: cached.data,
            status: cached.status || 200,
            statusText: 'OK (Cached)',
            headers: {},
            config: error.config,
            _fromCache: true,
            _cachedAt: cached.cachedAt
          };
        }
      } catch (cacheError) {
        // Cache read failed, fall through to normal error handling
      }
    }

    if (error.code === 'ECONNABORTED') {
      console.error('API Request Timeout:', error.config?.url);
    } else if (error.response) {
      const url = error.config?.url || '';
      const status = error.response.status;
      const isExpected401 = status === 401 && (
        url.includes('/auth/me') ||
        url.includes('/notifications/unread-count')
      );
      if (!isExpected401) {
        console.error('API Error Response:', status, error.response.data);
        console.error('Error URL:', url);
        console.error('Error Method:', error.config?.method);
      }
    } else if (error.request) {
      // Only log network errors, don't spam console
      if (!error.config?.url?.includes('/tasks?status=in_progress')) {
        // Don't log work context check failures to reduce console spam
        console.error('API Network Error - No response received:', error.config?.url);
        console.error('Check if backend is running and accessible at:', API_BASE_URL);
      }
    } else {
      console.error('API Error:', error.message);
    }
    return Promise.reject(error);
  }
);

// Authentication
export const login = (username, password, rememberMe = false) => 
  api.post('/auth/login', { username, password, remember_me: rememberMe });
export const logout = () => api.post('/auth/logout');
export const getCurrentUser = () => api.get('/auth/me');
export const changePassword = (currentPassword, newPassword) => 
  api.post('/auth/change-password', { currentPassword, newPassword });
export const forgotPassword = (email) =>
  api.post('/auth/forgot-password', { email });
export const resetPassword = (email, code, newPassword) =>
  api.post('/auth/reset-password', { email, code, newPassword });

// Users (admin only)
export const getUsers = () => api.get('/users');
export const getUser = (id) => api.get(`/users/${id}`);
export const createUser = (data) => api.post('/users', data);
export const updateUser = (id, data) => api.put(`/users/${id}`, data);
export const getRoles = () => api.get('/users/roles');
export const deactivateUser = (id) => api.patch(`/users/${id}/deactivate`);
export const deleteUser = (id) => api.delete(`/users/${id}`);

// Assets
export const getAssets = () => api.get('/assets');
export const getAsset = (id) => api.get(`/assets/${id}`);
export const getAssetsByType = (type) => api.get(`/assets/type/${type}`);

// Checklist Templates
export const getChecklistTemplates = () => api.get('/checklist-templates');
export const getChecklistTemplate = (id) => api.get(`/checklist-templates/${id}`);
export const getChecklistTemplatesByAssetType = (assetType) => 
  api.get(`/checklist-templates/asset-type/${assetType}`);
export const updateChecklistTemplateMetadata = (id, data) =>
  api.patch(`/checklist-templates/${id}/metadata`, data);
export const uploadTemplateFile = (formData) => 
  api.post('/checklist-templates/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
export const createChecklistTemplate = (data) => api.post('/checklist-templates', data);
export const updateChecklistTemplate = (id, data) => api.put(`/checklist-templates/${id}`, data);
export const deleteChecklistTemplate = (id) => api.delete(`/checklist-templates/${id}`);

// Helper function to make API calls offline-aware
// method: HTTP method string (GET, POST, PUT, PATCH, DELETE)
// urlBuilder: function that takes args and returns the URL path
// dataExtractor: optional function that takes args and returns the request body
const makeOfflineAware = (apiCall, method = 'POST', urlBuilder = null, dataExtractor = null) => {
  return async (...args) => {
    try {
      // Try normal API first
      return await apiCall(...args);
    } catch (error) {
      // If it's a network error and we're offline, queue it
      if (!navigator.onLine || (!error.response && (error.message.includes('Network Error') || error.code === 'ERR_NETWORK'))) {
        console.log(`Offline: queueing ${method} request for sync`);

        const url = urlBuilder ? urlBuilder(...args) : '';
        const data = dataExtractor ? dataExtractor(...args) : (typeof args[0] === 'object' ? args[0] : {});

        // Use offline API to queue the request
        const offlineResponse = await offlineApi.request({ method, url, data });

        // Return a response-like object
        return {
          data: offlineResponse.data,
          status: offlineResponse.status || 202,
          statusText: offlineResponse.statusText || 'Accepted',
          headers: offlineResponse.headers || {},
          config: { url, method, data }
        };
      }
      throw error;
    }
  };
};

// Tasks
export const getTasks = (params, config = {}) => api.get('/tasks', { params, ...config });
export const getTask = (id) => api.get(`/tasks/${id}`);
export const deleteTask = (id) => api.delete(`/tasks/${id}`);
export const bulkDeleteTasks = (ids) => api.post('/tasks/bulk-delete', { ids });
export const createTask = makeOfflineAware(
  (data) => api.post('/tasks', data),
  'POST', () => '/tasks', (data) => data
);
export const startTask = makeOfflineAware(
  (id) => api.patch(`/tasks/${id}/start`),
  'PATCH', (id) => `/tasks/${id}/start`
);
export const getOvertimeRequests = (params) => api.get('/overtime-requests', { params });
export const getOvertimeRequest = (id) => api.get(`/overtime-requests/${id}`);
export const approveOvertimeRequest = makeOfflineAware(
  (id) => api.patch(`/overtime-requests/${id}/approve`),
  'PATCH', (id) => `/overtime-requests/${id}/approve`
);
export const rejectOvertimeRequest = makeOfflineAware(
  (id, rejectionReason) => api.patch(`/overtime-requests/${id}/reject`, { rejection_reason: rejectionReason }),
  'PATCH', (id) => `/overtime-requests/${id}/reject`, (id, rejectionReason) => ({ rejection_reason: rejectionReason })
);
export const pauseTask = makeOfflineAware(
  (id, pauseReason) => api.patch(`/tasks/${id}/pause`, { pause_reason: pauseReason }),
  'PATCH', (id) => `/tasks/${id}/pause`, (id, pauseReason) => ({ pause_reason: pauseReason })
);
export const resumeTask = makeOfflineAware(
  (id) => api.patch(`/tasks/${id}/resume`),
  'PATCH', (id) => `/tasks/${id}/resume`
);
export const completeTask = makeOfflineAware(
  (id, data) => api.patch(`/tasks/${id}/complete`, data),
  'PATCH', (id) => `/tasks/${id}/complete`, (id, data) => data
);
// NOTE: Do NOT default to "word" here. If format is omitted, the server will
// auto-select Word if available, otherwise Excel (based on template files).
export const downloadTaskReport = (id, format = null) => {
  if (!id) {
    console.error('downloadTaskReport called without task ID');
    return '#';
  }
  // Always use getApiBaseUrl() so the API hostname matches the page hostname,
  // ensuring session cookies are sent (prevents "Authentication required").
  const baseUrl = getApiBaseUrl();
  const formatParam = format ? `?format=${encodeURIComponent(format)}` : '';
  const url = `${baseUrl}/tasks/${id}/report${formatParam}`;
  console.log(`${(format || 'auto').toUpperCase()} Report Download URL:`, url);
  console.log('Task ID:', id);
  return url;
};

// Checklist Responses
export const getChecklistResponses = (params) => api.get('/checklist-responses', { params });
export const getChecklistResponse = (id) => api.get(`/checklist-responses/${id}`);
export const submitChecklistResponse = makeOfflineAware(
  (data) => api.post('/checklist-responses', data),
  'POST', () => '/checklist-responses', (data) => data
);

// Draft Checklist Responses (Auto-save)
export const saveDraftResponse = makeOfflineAware(
  (data) => api.post('/checklist-responses/draft', data),
  'POST', () => '/checklist-responses/draft', (data) => data
);
export const getDraftResponse = (taskId) => api.get(`/checklist-responses/draft/${taskId}`);
export const deleteDraftResponse = makeOfflineAware(
  (taskId) => api.delete(`/checklist-responses/draft/${taskId}`),
  'DELETE', (taskId) => `/checklist-responses/draft/${taskId}`
);

// CM Letters
export const getCMLetters = (params) => api.get('/cm-letters', { params });
export const getCMLetter = (id) => api.get(`/cm-letters/${id}`);
export const updateCMLetterStatus = makeOfflineAware(
  (id, data) => api.patch(`/cm-letters/${id}/status`, data),
  'PATCH', (id) => `/cm-letters/${id}/status`, (id, data) => data
);
export const updateCMLetterFaultLog = makeOfflineAware(
  (id, data) => api.patch(`/cm-letters/${id}/fault-log`, data),
  'PATCH', (id) => `/cm-letters/${id}/fault-log`, (id, data) => data
);
export const getPlantMapData = async () => {
  try {
    const response = await axios.get(`${getApiBaseUrl()}/plant/map-data`, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching plant map data:', error);
    throw error;
  }
};

// Get plant map structure from server
export const getPlantMapStructure = async () => {
  try {
    const response = await axios.get(`${getApiBaseUrl()}/plant/structure`, {
      withCredentials: true,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching plant map structure:', error);
    throw error;
  }
};

// Save plant map structure to server
export const savePlantMapStructure = async (structure, labels = null) => {
  try {
    const body = { structure };
    if (labels) body.labels = labels;
    const response = await axios.post(`${getApiBaseUrl()}/plant/structure`,
      body,
      {
        withCredentials: true,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error('Error saving plant map structure:', error);
    throw error;
  }
};

// Tracker Status Request API functions
export const submitTrackerStatusRequest = async (requestData) => {
  try {
    const response = await axios.post(
      `${getApiBaseUrl()}/plant/tracker-status-request`,
      requestData,
      { withCredentials: true }
    );
    return response.data;
  } catch (error) {
    console.error('Error submitting tracker status request:', error);
    throw error;
  }
};

export const getTrackerStatusRequests = async (status = 'pending') => {
  try {
    const response = await axios.get(
      `${getApiBaseUrl()}/plant/tracker-status-requests?status=${status}`,
      { withCredentials: true }
    );
    return response.data;
  } catch (error) {
    console.error('Error fetching tracker status requests:', error);
    throw error;
  }
};

export const reviewTrackerStatusRequest = async (requestId, action, rejectionReason = null) => {
  try {
    const response = await axios.patch(
      `${getApiBaseUrl()}/plant/tracker-status-request/${requestId}`,
      { action, rejection_reason: rejectionReason },
      { withCredentials: true }
    );
    return response.data;
  } catch (error) {
    console.error('Error reviewing tracker status request:', error);
    throw error;
  }
};

// Cycle Tracking API functions
export const getCycleInfo = async (taskType) => {
  try {
    const response = await axios.get(
      `${getApiBaseUrl()}/plant/cycles/${taskType}`,
      { withCredentials: true }
    );
    return response.data;
  } catch (error) {
    console.error('Error fetching cycle info:', error);
    throw error;
  }
};

export const resetCycle = async (taskType) => {
  try {
    const response = await axios.post(
      `${getApiBaseUrl()}/plant/cycles/${taskType}/reset`,
      {},
      { withCredentials: true }
    );
    return response.data;
  } catch (error) {
    console.error('Error resetting cycle:', error);
    throw error;
  }
};

export const clearCycleToZero = async (taskType) => {
  try {
    const response = await axios.post(
      `${getApiBaseUrl()}/plant/cycles/${taskType}/clear`,
      {},
      { withCredentials: true }
    );
    return response.data;
  } catch (error) {
    console.error('Error clearing cycle to zero:', error);
    throw error;
  }
};

export const getCycleHistory = async (taskType, year = null, month = null) => {
  try {
    let url = `${getApiBaseUrl()}/plant/cycles/${taskType}/history`;
    const params = [];
    if (year) params.push(`year=${year}`);
    if (month) params.push(`month=${month}`);
    if (params.length > 0) url += `?${params.join('&')}`;
    
    const response = await axios.get(url, { withCredentials: true });
    return response.data;
  } catch (error) {
    console.error('Error fetching cycle history:', error);
    throw error;
  }
};

export const getCycleStats = async (taskType, year = null) => {
  try {
    let url = `${getApiBaseUrl()}/plant/cycles/${taskType}/stats`;
    if (year) url += `?year=${year}`;
    
    const response = await axios.get(url, { withCredentials: true });
    return response.data;
  } catch (error) {
    console.error('Error fetching cycle stats:', error);
    throw error;
  }
};

export const downloadFaultLog = async (period = 'all', params = {}) => {
  const baseUrl = getApiBaseUrl();
  let url = `${baseUrl}/cm-letters/fault-log/download?period=${period}`;
  
  // Add date filters if provided
  if (params.startDate) {
    url += `&startDate=${params.startDate}`;
  }
  if (params.endDate) {
    url += `&endDate=${params.endDate}`;
  }
  
  console.log('[DOWNLOAD] Starting fault log download from:', url);
  
  try {
    // Use fetch with credentials to ensure cookies are sent
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include', // Important: include cookies for authentication
      headers: {
        'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    // Get filename from Content-Disposition header or use default
    const contentDisposition = response.headers.get('Content-Disposition');
    let filename = `Fault_Log_${period}_${new Date().toISOString().split('T')[0]}.xlsx`;
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename="?(.+)"?/i);
      if (filenameMatch) {
        filename = filenameMatch[1];
      }
    }

    // Get blob and create download link
    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);

    console.log('[DOWNLOAD] Fault log downloaded successfully:', filename);
    return { success: true, filename };
  } catch (error) {
    console.error('[DOWNLOAD] Error downloading fault log:', error);
    throw error;
  }
};

// Inventory
export const getInventoryItems = (params) => api.get('/inventory/items', { params });
export const importInventoryFromExcel = makeOfflineAware(
  () => api.post('/inventory/import'),
  'POST', () => '/inventory/import'
);
export const downloadInventoryExcel = async () => {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/inventory/download`;
  
  console.log('[DOWNLOAD] Starting inventory download from:', url);
  
  try {
    // Use fetch with credentials to ensure cookies are sent
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include', // Include cookies for authentication
      headers: {
        'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }
    });

    console.log('[DOWNLOAD] Response status:', response.status, response.statusText);
    console.log('[DOWNLOAD] Response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      let errorData;
      try {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          errorData = await response.json();
        } else {
          const text = await response.text();
          console.error('[DOWNLOAD] Error response text:', text);
          errorData = { error: text || 'Failed to download inventory' };
        }
      } catch (parseError) {
        console.error('[DOWNLOAD] Error parsing error response:', parseError);
        errorData = { error: `HTTP ${response.status}: ${response.statusText}` };
      }
      console.error('[DOWNLOAD] Error data:', errorData);
      throw new Error(errorData.error || errorData.details || 'Failed to download inventory');
    }

    // Get the blob from response
    console.log('[DOWNLOAD] Reading response as blob...');
    const blob = await response.blob();
    console.log('[DOWNLOAD] Blob created, size:', blob.size, 'bytes, type:', blob.type);
    
    if (blob.size === 0) {
      throw new Error('Downloaded file is empty');
    }
    
    // Create a temporary link and trigger download
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `Inventory_Count_${new Date().toISOString().split('T')[0]}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Clean up the object URL
    window.URL.revokeObjectURL(downloadUrl);
    
    console.log('[DOWNLOAD] Download triggered successfully');
    return Promise.resolve();
  } catch (error) {
    console.error('[DOWNLOAD] Error downloading inventory Excel:', error);
    console.error('[DOWNLOAD] Error message:', error.message);
    console.error('[DOWNLOAD] Error stack:', error.stack);
    throw error;
  }
};
export const adjustInventory = makeOfflineAware(
  (data) => api.post('/inventory/adjust', data),
  'POST', () => '/inventory/adjust', (data) => data
);
export const consumeInventory = makeOfflineAware(
  (data) => api.post('/inventory/consume', data),
  'POST', () => '/inventory/consume', (data) => data
);
export const getInventorySlips = () => api.get('/inventory/slips');
export const getInventorySlip = (id) => api.get(`/inventory/slips/${id}`);
export const getSparesUsage = (params) => api.get('/inventory/usage', { params });
export const createInventoryItem = makeOfflineAware(
  (data) => api.post('/inventory/items', data),
  'POST', () => '/inventory/items', (data) => data
);
export const updateInventoryItem = makeOfflineAware(
  (itemCode, data) => api.put(`/inventory/items/${itemCode}`, data),
  'PUT', (itemCode) => `/inventory/items/${itemCode}`, (itemCode, data) => data
);


// Task Locking API
export const lockTask = makeOfflineAware(
  (id, data) => api.patch(`/tasks/${id}/lock`, data),
  'PATCH', (id) => `/tasks/${id}/lock`, (id, data) => data
);
export const unlockTask = makeOfflineAware(
  (id) => api.patch(`/tasks/${id}/unlock`),
  'PATCH', (id) => `/tasks/${id}/unlock`
);
export const updateTask = makeOfflineAware(
  (id, data) => api.put(`/tasks/${id}`, data),
  'PUT', (id) => `/tasks/${id}`, (id, data) => data
);

// Profile API
export const getProfile = () => api.get('/users/profile/me');
export const updateProfile = (data) => api.put('/users/profile/me', data);
export const uploadProfileImage = async (file) => {
  const formData = new FormData();
  formData.append('image', file);
  
  // Use fetch API for file uploads (like ChecklistForm) to avoid axios Content-Type header issues
  // fetch automatically sets Content-Type with boundary for FormData
  const API_BASE_URL = getApiBaseUrl();
  
  try {
    const response = await fetch(`${API_BASE_URL}/users/profile/me/avatar`, {
      method: 'POST',
      body: formData,
      credentials: 'include', // Include cookies for session management
    });
    
    if (!response.ok) {
      // Parse error response to match axios error format for compatibility
      let errorData;
      try {
        errorData = await response.json();
      } catch (e) {
        errorData = { error: 'Failed to upload image' };
      }
      
      // Create error object with axios-like structure for compatibility
      const error = new Error(errorData.error || 'Failed to upload image');
      error.response = {
        status: response.status,
        data: errorData,
      };
      throw error;
    }
    
    const data = await response.json();
    return { data };
  } catch (error) {
    // If it's already our custom error, re-throw it
    if (error.response) {
      throw error;
    }
    // For network errors or other fetch errors, wrap them
    const wrappedError = new Error(error.message || 'Failed to upload image');
    wrappedError.response = {
      status: 0,
      data: { error: error.message || 'Network error. Please check your connection.' },
    };
    throw wrappedError;
  }
};

export const removeProfileImage = async () => {
  const API_BASE_URL = getApiBaseUrl();
  
  try {
    const response = await fetch(`${API_BASE_URL}/users/profile/me/avatar`, {
      method: 'DELETE',
      credentials: 'include', // Include cookies for session management
    });
    
    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch (e) {
        errorData = { error: 'Failed to remove image' };
      }
      
      const error = new Error(errorData.error || 'Failed to remove image');
      error.response = {
        status: response.status,
        data: errorData,
      };
      throw error;
    }
    
    const data = await response.json();
    return { data };
  } catch (error) {
    if (error.response) {
      throw error;
    }
    const wrappedError = new Error(error.message || 'Failed to remove image');
    wrappedError.response = {
      status: 0,
      data: { error: error.message || 'Network error. Please check your connection.' },
    };
    throw wrappedError;
  }
};

// Early Completion Requests API
export const getEarlyCompletionRequests = (taskId) => api.get(`/early-completion-requests/task/${taskId}`);
export const getPendingEarlyCompletionRequests = () => api.get('/early-completion-requests/pending');
export const createEarlyCompletionRequest = makeOfflineAware(
  (data) => api.post('/early-completion-requests', data),
  'POST', () => '/early-completion-requests', (data) => data
);
export const approveEarlyCompletionRequest = makeOfflineAware(
  (id) => api.post(`/early-completion-requests/${id}/approve`),
  'POST', (id) => `/early-completion-requests/${id}/approve`
);
export const rejectEarlyCompletionRequest = makeOfflineAware(
  (id, data) => api.post(`/early-completion-requests/${id}/reject`, data),
  'POST', (id) => `/early-completion-requests/${id}/reject`, (id, data) => data
);

// Notifications API
export const getNotifications = (params) => api.get('/notifications', { params });
export const getUnreadNotificationCount = () => api.get('/notifications/unread-count');
export const markNotificationAsRead = makeOfflineAware(
  (id) => api.patch(`/notifications/${id}/read`),
  'PATCH', (id) => `/notifications/${id}/read`
);
export const markAllNotificationsAsRead = makeOfflineAware(
  () => api.patch('/notifications/read-all'),
  'PATCH', () => '/notifications/read-all'
);
export const deleteNotification = makeOfflineAware(
  (id) => api.delete(`/notifications/${id}`),
  'DELETE', (id) => `/notifications/${id}`
);

// Calendar API
export const getCalendarEvents = (params) => api.get('/calendar', { params });
export const getCalendarEvent = (id) => api.get(`/calendar/${id}`);
export const getCalendarEventsByDate = (date) => api.get(`/calendar/date/${date}`);
export const createCalendarEvent = makeOfflineAware(
  (data) => api.post('/calendar', data),
  'POST', () => '/calendar', (data) => data
);
export const updateCalendarEvent = makeOfflineAware(
  (id, data) => api.put(`/calendar/${id}`, data),
  'PUT', (id) => `/calendar/${id}`, (id, data) => data
);
export const deleteCalendarEvent = makeOfflineAware(
  (id) => api.delete(`/calendar/${id}`),
  'DELETE', (id) => `/calendar/${id}`
);

export const getCalendarLegend = () => api.get('/calendar/legend');
export const putCalendarLegend = (legend) => api.put('/calendar/legend', { legend });

/** Upload year calendar Excel (system owner only). Imports events and saves template for download. */
export const uploadYearCalendar = async (file) => {
  const API_BASE_URL = getApiBaseUrl();
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(`${API_BASE_URL}/calendar/upload`, {
    method: 'POST',
    body: formData,
    credentials: 'include'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.message || data.error || 'Upload failed');
    err.details = data.details;
    throw err;
  }
  return data;
};

/** Download saved year calendar template (Excel) for current company, if one was uploaded. */
export const downloadYearCalendarTemplate = async () => {
  const API_BASE_URL = getApiBaseUrl();
  const response = await fetch(`${API_BASE_URL}/calendar/year-template`, {
    credentials: 'include'
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || data.message || 'Template not available');
  }
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', 'year-calendar-template.xlsx');
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

// Organization API functions
export const getCurrentOrganizationBranding = () => api.get('/organizations/current/branding');
export const getCurrentOrganizationFeatures = () => api.get('/organizations/current/features');
export const getOrganizationBranding = (id) => api.get(`/organizations/${id}/branding`);
export const updateOrganizationBranding = (id, data) => api.put(`/organizations/${id}/branding`, data);
export const uploadOrganizationLogo = async (id, file) => {
  const formData = new FormData();
  formData.append('logo', file);
  const API_BASE_URL = getApiBaseUrl();
  const response = await fetch(`${API_BASE_URL}/organizations/${id}/logo`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to upload logo');
  }
  return response.json();
};

// License API functions removed - no longer needed
// export const getLicenseStatus = async () => { ... }
// export const getLicenseInfo = async () => { ... }
// export const activateLicense = async (licenseData) => { ... }
// export const renewLicense = async (licenseKey) => { ... }
// export const generateLicenseKey = async (companyName) => { ... }

export const submitFeedback = async (data) => {
  const API_BASE_URL = getApiBaseUrl();
  try {
    const response = await axios.post(`${API_BASE_URL}/feedback`, data, {
      withCredentials: true,
    });
    return response.data;
  } catch (error) {
    console.error('Error submitting feedback:', error);
    throw error;
  }
};

export const getContactEmail = async () => {
  const base = getApiBaseUrl();
  const response = await axios.get(`${base}/feedback/contact-email`, { withCredentials: true });
  return response.data;
};

/** Platform settings (system owner only). */
export const getPlatformSettings = async () => {
  const base = getApiBaseUrl();
  const response = await axios.get(`${base}/platform/settings`, { withCredentials: true });
  return response.data;
};

export const updatePlatformSettings = async (settings) => {
  const base = getApiBaseUrl();
  const response = await axios.put(`${base}/platform/settings`, settings, { withCredentials: true });
  return response.data;
};

export default api;

