// Preload untuk dialog kustom (alert, konfirmasi, izin situs, panel izin). API-nya sempit: terima isi, kirim pilihan.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dialogAPI", {
  onRender: (cb) => ipcRenderer.on("dialog:render", (_e, p) => cb(p)),
  result: (r) => ipcRenderer.send("dialog:result", r),
  site: (r) => ipcRenderer.send("dialog:site", r),
});
