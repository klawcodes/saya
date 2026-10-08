// Preload untuk bar responsive view buatan Saya. Halamannya statis (data: URL milik Saya sendiri):
// kirim aksi/ukuran ke main process lewat IPC "respui", dan terima state dari "resp:state".
const { ipcRenderer } = require("electron");

window.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const send = (act, val) => ipcRenderer.send("respui", act, val);
  const size = () => send("size", { w: Number($("w").value), h: Number($("h").value) });

  $("dev").addEventListener("change", () => send("device", Number($("dev").value)));
  for (const id of ["w", "h"]) {
    $(id).addEventListener("change", size);
    $(id).addEventListener("keydown", (e) => {
      if (e.key === "Enter") e.target.blur();
    });
  }
  $("rot").addEventListener("click", () => send("rotate"));
  $("close").addEventListener("click", () => send("close"));

  ipcRenderer.on("resp:state", (_e, s) => {
    $("dev").value = String(s.dev);
    if (document.activeElement !== $("w")) $("w").value = s.w;
    if (document.activeElement !== $("h")) $("h").value = s.h;
    $("scale").textContent = Math.round((s.scale || 1) * 100) + "%";
  });
  send("ready");
});
