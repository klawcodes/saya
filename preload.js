const { contextBridge, ipcRenderer, webUtils } = require("electron");

const EVENTS = new Set([
  "tab:created",
  "tab:update",
  "tab:active",
  "tab:closed",
  "adblock:state",
  "adblock:count",
  "engine:changed",
  "downloads:badge",
  "sidebar:state",
  "layout:state",
]);

const send = (channel, ...args) => ipcRenderer.send(channel, ...args);

contextBridge.exposeInMainWorld("browserAPI", {
  init: () => ipcRenderer.invoke("ui:init"),
  newTab: () => send("tab:new"),
  muteTab: (id) => send("tab:mute", id),
  closeTab: (id) => send("tab:close", id),
  moveTab: (id, index) => send("tab:move", id, index),
  activateTab: (id) => send("tab:activate", id),
  go: (input) => send("nav:go", input),
  back: () => send("nav:back"),
  forward: () => send("nav:forward"),
  reload: () => send("nav:reload"),
  toggleBookmark: () => send("bookmark:toggle"),
  menu: (rect) => send("menu:open", rect),
  toggleAdblock: () => ipcRenderer.invoke("adblock:toggle"),
  site: () => send("site:open"),
  downloadsToggle: (rect) => send("downloads:toggle", rect),
  downloadsAnchor: (rect) => send("downloads:anchor", rect),
  // Command palette (menggantikan mengetik di address bar) & sidebar auto-hide
  openPalette: (text) => send("palette:open", String(text ?? "")),
  sidebarToggle: () => send("sidebar:toggle"),
  splitTab: (id) => send("split:tab", id),
  tabMenu: (id) => send("tabmenu:open", Number(id) || 0),
  sidebarHover: (on) => send("sidebar:hover", !!on),
  // Resize sidebar: final=false saat drag berjalan, true saat dilepas (disimpan & snap ke mode icon-only)
  sidebarResize: (w, final) => send("sidebar:resize", Number(w) || 0, !!final),
  sidebarResizeToggle: () => send("sidebar:resize-toggle"),
  // File yang dijatuhkan di sidebar / toolbar: path asli hanya bisa dibaca di preload (webUtils)
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },
  openFiles: (paths) => {
    const list = (Array.isArray(paths) ? paths : []).filter((p) => typeof p === "string" && p);
    if (list.length) send("tab:openfiles", list);
  },
  on: (channel, callback) => {
    if (!EVENTS.has(channel)) return;
    ipcRenderer.on(channel, (_event, payload) => callback(payload));
  },
});
