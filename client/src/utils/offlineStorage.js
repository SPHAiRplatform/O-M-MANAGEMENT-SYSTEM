/**
 * Offline Storage Manager
 * Handles IndexedDB operations for offline data storage
 */

const DB_NAME = 'SPHAiRDigital_OfflineDB';
const DB_VERSION = 1;
const STORES = {
  SYNC_QUEUE: 'syncQueue',
  TASKS: 'tasks',
  CHECKLIST_RESPONSES: 'checklistResponses',
  CACHE: 'cache'
};

class OfflineStorage {
  constructor() {
    this.db = null;
    this.initPromise = null;
  }

  async init() {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('Failed to open IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('IndexedDB opened successfully');
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Create object stores if they don't exist
        if (!db.objectStoreNames.contains(STORES.SYNC_QUEUE)) {
          const syncQueueStore = db.createObjectStore(STORES.SYNC_QUEUE, { keyPath: 'id', autoIncrement: true });
          syncQueueStore.createIndex('timestamp', 'timestamp', { unique: false });
          syncQueueStore.createIndex('type', 'type', { unique: false });
          syncQueueStore.createIndex('status', 'status', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.TASKS)) {
          db.createObjectStore(STORES.TASKS, { keyPath: 'id' });
        }

        if (!db.objectStoreNames.contains(STORES.CHECKLIST_RESPONSES)) {
          db.createObjectStore(STORES.CHECKLIST_RESPONSES, { keyPath: 'id' });
        }

        if (!db.objectStoreNames.contains(STORES.CACHE)) {
          db.createObjectStore(STORES.CACHE, { keyPath: 'key' });
        }
      };
    });

    return this.initPromise;
  }

  // Sync Queue Operations
  async addToSyncQueue(operation) {
    await this.init();
    const transaction = this.db.transaction([STORES.SYNC_QUEUE], 'readwrite');
    const store = transaction.objectStore(STORES.SYNC_QUEUE);
    
    const queueItem = {
      ...operation,
      timestamp: Date.now(),
      status: 'pending',
      retryCount: 0
    };

    return new Promise((resolve, reject) => {
      const request = store.add(queueItem);
      request.onsuccess = () => {
        console.log('Added to sync queue:', queueItem);
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getSyncQueue(status = null) {
    await this.init();
    const transaction = this.db.transaction([STORES.SYNC_QUEUE], 'readonly');
    const store = transaction.objectStore(STORES.SYNC_QUEUE);
    const index = store.index('timestamp');

    return new Promise((resolve, reject) => {
      const request = index.getAll();
      request.onsuccess = () => {
        let items = request.result;
        if (status) {
          items = items.filter(item => item.status === status);
        }
        resolve(items);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async updateSyncQueueItem(id, updates) {
    await this.init();
    const transaction = this.db.transaction([STORES.SYNC_QUEUE], 'readwrite');
    const store = transaction.objectStore(STORES.SYNC_QUEUE);

    return new Promise((resolve, reject) => {
      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        const item = getRequest.result;
        if (!item) {
          reject(new Error('Queue item not found'));
          return;
        }

        const updatedItem = { ...item, ...updates };
        const putRequest = store.put(updatedItem);
        putRequest.onsuccess = () => resolve(updatedItem);
        putRequest.onerror = () => reject(putRequest.error);
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  async removeFromSyncQueue(id) {
    await this.init();
    const transaction = this.db.transaction([STORES.SYNC_QUEUE], 'readwrite');
    const store = transaction.objectStore(STORES.SYNC_QUEUE);

    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Task Operations
  async saveTask(task) {
    await this.init();
    const transaction = this.db.transaction([STORES.TASKS], 'readwrite');
    const store = transaction.objectStore(STORES.TASKS);

    return new Promise((resolve, reject) => {
      const request = store.put(task);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getTask(id) {
    await this.init();
    const transaction = this.db.transaction([STORES.TASKS], 'readonly');
    const store = transaction.objectStore(STORES.TASKS);

    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllTasks() {
    await this.init();
    const transaction = this.db.transaction([STORES.TASKS], 'readonly');
    const store = transaction.objectStore(STORES.TASKS);

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Checklist Response Operations
  async saveChecklistResponse(response) {
    await this.init();
    const transaction = this.db.transaction([STORES.CHECKLIST_RESPONSES], 'readwrite');
    const store = transaction.objectStore(STORES.CHECKLIST_RESPONSES);

    return new Promise((resolve, reject) => {
      const request = store.put(response);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getChecklistResponse(id) {
    await this.init();
    const transaction = this.db.transaction([STORES.CHECKLIST_RESPONSES], 'readonly');
    const store = transaction.objectStore(STORES.CHECKLIST_RESPONSES);

    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Cache Operations
  async setCache(key, value) {
    await this.init();
    const transaction = this.db.transaction([STORES.CACHE], 'readwrite');
    const store = transaction.objectStore(STORES.CACHE);

    return new Promise((resolve, reject) => {
      const request = store.put({ key, value, timestamp: Date.now() });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getCache(key) {
    await this.init();
    const transaction = this.db.transaction([STORES.CACHE], 'readonly');
    const store = transaction.objectStore(STORES.CACHE);

    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.value : null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async clearCache() {
    await this.init();
    const transaction = this.db.transaction([STORES.CACHE], 'readwrite');
    const store = transaction.objectStore(STORES.CACHE);

    return new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

// Export singleton instance
export default new OfflineStorage();
