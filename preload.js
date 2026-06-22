const { contextBridge, ipcRenderer } = require('electron');

// Expose a minimal, explicit API surface to the renderer.
contextBridge.exposeInMainWorld('app', {
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  // Show a native "Save As" dialog and write the given bytes to the chosen path.
  // Returns { canceled } or { canceled: false, filePath }.
  exportXlsx: (bytes, defaultName) =>
    ipcRenderer.invoke('export-xlsx', { bytes, defaultName }),
  updates: {
    check: () => ipcRenderer.invoke('updates:check'),
    install: () => ipcRenderer.invoke('updates:install'),
    onDownloadProgress: (callback) => {
      const listener = (event, progress) => callback(progress);
      ipcRenderer.on('updates:download-progress', listener);
      return () => ipcRenderer.removeListener('updates:download-progress', listener);
    },
  },
});
