// Preload untuk menu titik tiga (panel di bawah tombol menu). API-nya sempit: terima isi menu, kirim pilihan.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("menuAPI", {
  onRender: (cb) => ipcRenderer.on("menu:render", (_e, p) => cb(p)),
  act: (id) => ipcRenderer.send("menu:act", String(id)),
  size: (h) => ipcRenderer.send("menu:size", Number(h) || 0),
  close: () => ipcRenderer.send("menu:close"),
});
