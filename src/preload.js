const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('murphAPI', {
  // Key
  validateKey: (key) => ipcRenderer.invoke('validate-key', key),
  checkKey: () => ipcRenderer.invoke('check-key'),
  deactivateKey: () => ipcRenderer.invoke('deactivate-key'),
  goApp: () => ipcRenderer.invoke('go-app'),

  // Profiles
  getProfiles: () => ipcRenderer.invoke('get-profiles'),
  saveProfile: (p) => ipcRenderer.invoke('save-profile', p),
  deleteProfile: (id) => ipcRenderer.invoke('delete-profile', id),

  // Tasks
  getTasks: () => ipcRenderer.invoke('get-tasks'),
  saveTask: (t) => ipcRenderer.invoke('save-task', t),
  deleteTask: (id) => ipcRenderer.invoke('delete-task', id),
  clearTasks: () => ipcRenderer.invoke('clear-tasks'),

  // Freemans
  freemansRun: (data) => ipcRenderer.invoke('freemans-run', data),
  openCheckout: () => ipcRenderer.invoke('open-checkout'),

  // Very
  veryRun: (data) => ipcRenderer.invoke('very-run', data),
  veryStop: (data) => ipcRenderer.invoke('very-stop', data),
  getExtensionStatus: () => ipcRenderer.invoke('get-extension-status'),

  // Extension management
  getExtensionPath: () => ipcRenderer.invoke('get-extension-path'),
  openChromeWithExtension: () => ipcRenderer.invoke('open-chrome-with-extension'),
  openExtensionFolder: () => ipcRenderer.invoke('open-extension-folder'),
  getVeryLinks: () => ipcRenderer.invoke('get-very-links'),
  saveVeryLink: (link) => ipcRenderer.invoke('save-very-link', link),
  deleteVeryLink: (id) => ipcRenderer.invoke('delete-very-link', id),
  getVeryLinkGroups: () => ipcRenderer.invoke('get-very-link-groups'),
  saveVeryLinkGroup: (g) => ipcRenderer.invoke('save-very-link-group', g),
  deleteVeryLinkGroup: (id) => ipcRenderer.invoke('delete-very-link-group', id),
  getSoundFiles: () => ipcRenderer.invoke('get-sound-files'),
  getSoundsFolder: () => ipcRenderer.invoke('get-sounds-folder'),
  openSoundsFolder: () => ipcRenderer.invoke('open-sounds-folder'),
  onExtensionStatus: (callback) => {
    ipcRenderer.on('extension-status', (event, data) => callback(data));
  },

  // Stats
  getStats: () => ipcRenderer.invoke('get-stats'),
  updateStats: (u) => ipcRenderer.invoke('update-stats', u),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),

  // Webhook
  sendWebhook: (url, payload) => ipcRenderer.invoke('send-webhook', { url, payload }),
  testWebhook: (url) => ipcRenderer.invoke('test-webhook', url),

  // Checkout tracking (Supabase + local)
  logCheckout: (data) => ipcRenderer.invoke('log-checkout', data),
  getCheckoutLog: () => ipcRenderer.invoke('get-checkout-log'),
  clearCheckoutLog: () => ipcRenderer.invoke('clear-checkout-log'),

  // Desktop notifications
  showNotification: (opts) => ipcRenderer.invoke('show-notification', opts),

  // Session management
  clearCookies: (partition) => ipcRenderer.invoke('clear-cookies', partition),

  // Stock monitors
  getStockMonitors: () => ipcRenderer.invoke('get-stock-monitors'),
  saveStockMonitor: (m) => ipcRenderer.invoke('save-stock-monitor', m),
  deleteStockMonitor: (id) => ipcRenderer.invoke('delete-stock-monitor', id),
  checkStock: (data) => ipcRenderer.invoke('check-stock', data),

  // Task groups
  getTaskGroups: () => ipcRenderer.invoke('get-task-groups'),
  saveTaskGroup: (g) => ipcRenderer.invoke('save-task-group', g),
  deleteTaskGroup: (id) => ipcRenderer.invoke('delete-task-group', id),

  // Proxy
  testProxy: (proxy) => ipcRenderer.invoke('test-proxy', proxy),
  getProxyGroups: () => ipcRenderer.invoke('get-proxy-groups'),
  saveProxyGroup: (g) => ipcRenderer.invoke('save-proxy-group', g),
  deleteProxyGroup: (id) => ipcRenderer.invoke('delete-proxy-group', id),

  // Error log
  getErrorLog: () => ipcRenderer.invoke('get-error-log'),
  logError: (entry) => ipcRenderer.invoke('log-error', entry),
  clearErrorLog: () => ipcRenderer.invoke('clear-error-log'),

  // Data export/import
  exportAllData: () => ipcRenderer.invoke('export-all-data'),
  importAllData: (data) => ipcRenderer.invoke('import-all-data', data),

  // Checkout progress (main → renderer event channel)
  onCheckoutProgress: (callback) => {
    ipcRenderer.on('checkout-progress', (event, data) => callback(data));
  },
  removeCheckoutProgress: () => {
    ipcRenderer.removeAllListeners('checkout-progress');
  },

  // Auto-updater
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  updaterCheck: () => ipcRenderer.invoke('updater-check'),
  updaterDownload: () => ipcRenderer.invoke('updater-download'),
  updaterInstall: () => ipcRenderer.invoke('updater-install'),
  onUpdateAvailable: (callback) => {
    ipcRenderer.on('update-available', (event, data) => callback(data));
  },
  onUpdateProgress: (callback) => {
    ipcRenderer.on('update-progress', (event, data) => callback(data));
  },
  onUpdateDownloaded: (callback) => {
    ipcRenderer.on('update-downloaded', () => callback());
  },
  onUpdateChecking: (callback) => {
    ipcRenderer.on('update-checking', () => callback());
  },
  onUpdateCheckResult: (callback) => {
    ipcRenderer.on('update-check-result', (event, data) => callback(data));
  }
});
