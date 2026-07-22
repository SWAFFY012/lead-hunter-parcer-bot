const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  startApp: () => ipcRenderer.invoke('start-app'),
  restartApp: () => ipcRenderer.invoke('restart-app'),
  openApp: () => ipcRenderer.invoke('open-app'),
  safeStop: () => ipcRenderer.invoke('safe-stop'),
  forceStop: () => ipcRenderer.invoke('force-stop'),
  closeLauncher: () => ipcRenderer.send('close-launcher'),
  startLogs: () => ipcRenderer.send('start-logs'),
  stopLogs: () => ipcRenderer.send('stop-logs'),
  onLogData: (callback) => {
    // Remove all previous listeners to avoid memory leaks
    ipcRenderer.removeAllListeners('log-data');
    ipcRenderer.on('log-data', (event, data) => callback(data));
  }
});
