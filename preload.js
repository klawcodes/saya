const { contextBridge, ipcRenderer } = require("electron");

const EVENTS = new Set([
  "tab:created",
  "tab:update",
  "tab:active",
  "tab:closed",
  "focus-address",
  "adblock:state",
  "adblock:count",
  "engine:changed",
  "suggest:fill",
  "downloads:badge",
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
  menu: () => send("menu:open"),
  toggleAdblock: () => ipcRenderer.invoke("adblock:toggle"),
  site: () => send("site:open"),
  downloadsToggle: (rect) => send("downloads:toggle", rect),
  suggestQuery: (text, rect, force) => send("suggest:query", text, rect, force),
  suggestMove: (dir) => send("suggest:move", dir),
  suggestFocus: () => send("suggest:focus"),
  suggestBlur: () => send("suggest:blur"),
  on: (channel, callback) => {
    if (!EVENTS.has(channel)) return;
    ipcRenderer.on(channel, (_event, payload) => callback(payload));
  },
});
