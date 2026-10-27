// Preload untuk command palette. API-nya sempit: terima data, kirim ketikan & pilihan.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('suggestAPI', {
  onRender: (cb) => ipcRenderer.on('suggest:render', (_e, p) => cb(p)),
  onShow: (cb) => ipcRenderer.on('suggest:show', (_e, p) => cb(p)),
  query: (text) => ipcRenderer.send('suggest:query', String(text ?? '')),
  pick: (index) => ipcRenderer.send('suggest:pick', Number(index)),
  go: (text) => ipcRenderer.send('suggest:go', String(text ?? '')),
  engine: (id) => ipcRenderer.send('suggest:engine', String(id)),
  size: (h) => ipcRenderer.send('suggest:size', Number(h) || 0),
  close: () => ipcRenderer.send('suggest:close'),
});
