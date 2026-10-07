// Preload untuk panel unduhan (popup di bawah ikon toolbar). API-nya sempit: terima daftar, kirim aksi.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dlAPI", {
  onRender: (cb) => ipcRenderer.on("dl:render", (_e, p) => cb(p)),
  act: (id, action) => ipcRenderer.send("dl:act", String(id), String(action)),
  all: () => ipcRenderer.send("dl:all"),
  close: () => ipcRenderer.send("dl:close"),
});
