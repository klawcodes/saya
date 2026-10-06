// Preload untuk dropdown saran address bar. API-nya sempit: terima data, kirim pilihan.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('suggestAPI', {
  onRender: (callback) => ipcRenderer.on('suggest:render', (_event, payload) => callback(payload)),
  pick: (index) => ipcRenderer.send('suggest:pick', index),
  engine: (id) => ipcRenderer.send('suggest:engine', id),
});
