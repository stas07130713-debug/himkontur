import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('himkonturUpdates', {
  platform: 'windows',
  getVersion: () => ipcRenderer.invoke('himkontur:update-version'),
  check: () => ipcRenderer.invoke('himkontur:update-check'),
  install: () => ipcRenderer.invoke('himkontur:update-install'),
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('himkontur:update-status', listener);
    return () => ipcRenderer.removeListener('himkontur:update-status', listener);
  }
});
