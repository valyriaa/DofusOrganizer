const { ipcRenderer } = require('electron');

window.appContext = {
  setClickableArea: (isClickable) => ipcRenderer.send('clickable-area', isClickable),
  moveWindow: (dx, dy) => ipcRenderer.invoke('move-window', dx, dy),
  showSettings: () => ipcRenderer.invoke('show-settings'),
  hideSettings: () => ipcRenderer.invoke('hide-settings'),
  getLocal: () => ipcRenderer.invoke('get-local'),
  getSettings: () => ipcRenderer.invoke('get-settings').then(result => !result ? result : JSON.parse(result)),
  updateSettings: (key, val) => ipcRenderer.invoke('update-settings', key, val),
  syncPlay: (sync = true) => ipcRenderer.invoke('sync-play', sync),
  tabProcessor: (tabId) => (type, ...args) => ipcRenderer.invoke('process-execute', tabId, type, ...args),
  processImage: (id) => ipcRenderer.invoke('process-frame', id),
  hideImageCropper: () => ipcRenderer.invoke('hide-cropper'),
  notify: (type, message) => ipcRenderer.invoke('notify', type, message),
  onImageContent: (cb) => ipcRenderer.on("image-content", (_, payload) => cb(payload)),
  versionData: () => ipcRenderer.invoke('version-data'),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
  closeApp: () => ipcRenderer.invoke('close-app'),
  ipcRenderer
};