// Preload untuk sidebar hover (overlay). API sempit: terima daftar tab, kirim aksi (buka / tutup / tab baru).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sboAPI", {
  onRender: (cb) => ipcRenderer.on("sbo:render", (_e, p) => cb(p)),
  act: (type, id) => ipcRenderer.send("sbo:act", String(type), Number(id) || 0),
});
