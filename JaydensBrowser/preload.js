const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  sendNavigate: (url) => ipcRenderer.send('navigate', url),
  onNavigate: (cb) => ipcRenderer.on('navigate', (e, url) => cb(url))
});
