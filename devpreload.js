// Preload untuk bar & pegangan DevTools buatan Saya. Halamannya statis (milik Saya sendiri),
// jadi cukup memasang listener dan mengirim aksi ke main process lewat IPC.
const { ipcRenderer } = require("electron");

window.addEventListener("DOMContentLoaded", () => {
  const send = (act) => ipcRenderer.send("devui", act);
  let drag = false;

  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-act]");
    if (b) send(b.dataset.act);
  });
  document.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !e.target.closest?.("[data-drag]")) return;
    drag = true;
    try {
      e.target.setPointerCapture(e.pointerId);
    } catch {}
    send("drag-start");
    e.preventDefault();
  });
  document.addEventListener("pointermove", () => drag && send("drag-move"));
  const end = () => {
    if (!drag) return;
    drag = false;
    send("drag-end");
  };
  document.addEventListener("pointerup", end);
  document.addEventListener("pointercancel", end);
  document.addEventListener("lostpointercapture", end);
  document.addEventListener("dblclick", (e) => {
    if (e.target.closest?.("[data-drag]")) send("reset");
  });
});
