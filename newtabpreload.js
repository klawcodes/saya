// newtabpreload.js — Dipasang lewat session.registerPreloadScript (lihat init() di main-shortcuts.js).
// Mengekspos window.newtabAPI HANYA di renderer/newtab.html; main-shortcuts.js memeriksa lagi pengirimnya.

const { contextBridge, ipcRenderer } = require("electron");

if (
  location.protocol === "file:" &&
  /\/renderer\/newtab\.html$/i.test(location.pathname)
) {
  const plain = (item) => ({
    t: String(item?.t ?? ""),
    u: String(item?.u ?? ""),
  });
  contextBridge.exposeInMainWorld("newtabAPI", {
    list: () => ipcRenderer.invoke("newtab:sc:list"),
    add: (item) => ipcRenderer.invoke("newtab:sc:add", plain(item)),
    edit: (id, item) => ipcRenderer.invoke("newtab:sc:edit", String(id), plain(item)),
    remove: (id) => ipcRenderer.invoke("newtab:sc:remove", String(id)),
    dialog: (open) => ipcRenderer.send("newtab:sc:dialog", !!open),
  });
}
