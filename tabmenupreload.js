// Preload untuk menu klik kanan tab. API-nya sempit: terima isi menu, kirim pilihan.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tabMenuAPI", {
  onRender: (cb) => ipcRenderer.on("tabmenu:render", (_e, p) => cb(p)),
  act: (id) => ipcRenderer.send("tabmenu:act", String(id)),
  size: (h) => ipcRenderer.send("tabmenu:size", Number(h) || 0),
  close: () => ipcRenderer.send("tabmenu:close"),
});
