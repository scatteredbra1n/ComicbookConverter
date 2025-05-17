const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  validateCBRs: (filePaths) => ipcRenderer.invoke('validate-cbrs', filePaths),
  selectOutputFolder: () => ipcRenderer.invoke('select-output-folder'),
  convertFiles: (payload) => ipcRenderer.send('convert-files', payload),
  onProgress: (callback) => ipcRenderer.on('conversion-progress', (e, progress) => callback(progress)),
  onComplete: (callback) => ipcRenderer.on('conversion-complete', callback),
  onFileStatus: (callback) => ipcRenderer.on('file-status', (e, data) => callback(data)),
});
