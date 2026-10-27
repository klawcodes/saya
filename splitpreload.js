// Preload untuk pegangan split view. Hanya mengirim aksi seret ke proses utama (rasio dihitung dari posisi kursor).
const { ipcRenderer } = require("electron");

const send = (act) => ipcRenderer.send("splitui", act);

window.addEventListener("DOMContentLoaded", () => {
  const el = document.querySelector("[data-drag]");
  if (!el) return;
  el.addEventListener("pointerdown", (e) => {
    try {
      el.setPointerCapture(e.pointerId);
    } catch {}
    send("drag-start");
  });
  el.addEventListener("pointermove", (e) => {
    if (el.hasPointerCapture(e.pointerId)) send("drag-move");
  });
  el.addEventListener("pointerup", () => send("drag-end"));
  el.addEventListener("pointercancel", () => send("drag-end"));
  el.addEventListener("dblclick", () => send("reset"));
});
