// Preload untuk bar "cari di halaman". API-nya sempit: kirim teks/arah, terima hasil.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("findAPI", {
  query: (text) => ipcRenderer.send("find:query", String(text)),
  step: (forward) => ipcRenderer.send("find:step", !!forward),
  close: () => ipcRenderer.send("find:close"),
  onShow: (cb) => ipcRenderer.on("find:show", (_e, p) => cb(p)),
  onResult: (cb) => ipcRenderer.on("find:result", (_e, p) => cb(p)),
});
