// main-toast.js — Notifikasi kecil di kanan atas jendela (pengganti dialog error bawaan Electron).
//
// Kartu muncul 5 detik (jeda saat kursor di atasnya), ada tombol OK dan "Copy details" (isi teknis error
// untuk dilaporkan). Dibuat sebagai WebContentsView sendiri (data: URL, tanpa preload) supaya tampil di atas
// halaman web; pola sama dengan panel unduhan. Modul ini hanya bergantung pada main-core.
//
// Pakai: report(err) untuk error tak terduga; notify(judul, pesan) untuk pesan biasa.

const { app, WebContentsView, clipboard } = require("electron");
const fs = require("fs");
const path = require("path");
const { shared, CHROME_H } = require("./main-core");

const SHOW_MS = 5000;
const CARD_W = 360;
const CARD_H = 118;
const PAD = 8; // ruang bayangan di sekeliling kartu
const DEDUPE_MS = 15_000; // error yang sama tidak ditampilkan berulang

const HTML = `<!doctype html><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden;
  font:13px/1.4 "Segoe UI",system-ui,sans-serif;color:#e4e4ea;user-select:none}
#card{position:absolute;inset:${PAD}px;border-radius:10px;background:#24242c;border:1px solid #3a3a48;
  box-shadow:0 6px 20px rgb(0 0 0/.5);padding:12px 14px;overflow:hidden;display:flex;flex-direction:column;
  animation:in 160ms ease-out}
@keyframes in{from{opacity:0;transform:translateX(24px)}}
.row{display:flex;gap:10px;align-items:flex-start;flex:1;min-width:0}
.ico{flex:none;width:20px;height:20px;border-radius:50%;background:#e5534b;color:#fff;font-weight:700;
  font-size:13px;display:grid;place-items:center;margin-top:1px}
.txt{min-width:0}
#t{font-weight:600;font-size:13px}
#m{color:#a8a8b3;font-size:12px;margin-top:2px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.btns{display:flex;justify-content:flex-end;gap:6px;margin-top:6px}
button{font:inherit;font-size:12px;border:0;border-radius:6px;padding:4px 12px;cursor:pointer;
  background:#30303c;color:#e4e4ea}
button:hover{background:#3d3d4d}
#ok{background:#7c8cff;color:#10101a;font-weight:600}
#ok:hover{background:#95a1ff}
#bar{position:absolute;left:0;bottom:0;height:3px;width:100%;background:#7c8cff;transform-origin:left;opacity:.8}
#bar.run{animation:bar var(--ms) linear forwards}
#card:hover #bar{animation-play-state:paused}
@keyframes bar{to{transform:scaleX(0)}}
</style>
<div id="card">
  <div class="row"><div class="ico">!</div><div class="txt"><div id="t"></div><div id="m"></div></div></div>
  <div class="btns"><button id="copy">Copy details</button><button id="ok">OK</button></div>
  <div id="bar"></div>
</div>
<script>
const $=id=>document.getElementById(id);
const cmd=c=>console.log("__saya_toast:"+c);
$("ok").onclick=()=>cmd("close");
$("copy").onclick=()=>{cmd("copy");$("copy").textContent="Copied";};
$("bar").addEventListener("animationend",()=>cmd("close"));
window.showToast=(t,m,ms,canCopy)=>{
  $("t").textContent=t;$("m").textContent=m;
  $("copy").style.display=canCopy?"":"none";$("copy").textContent="Copy details";
  const b=$("bar");b.classList.remove("run");void b.offsetWidth;
  b.style.setProperty("--ms",ms+"ms");b.classList.add("run");
};
</script>`;
const URL_ = "data:text/html;charset=utf-8," + encodeURIComponent(HTML);

let view = null;
let ready = false;
let pending = null; // pesan yang menunggu halaman toast selesai dimuat
let failsafe = null;
let details = ""; // isi teknis untuk "Copy details"
const recent = new Map();

const winOk = () => !!shared.win && !shared.win.isDestroyed();

function layout() {
  if (!view || !winOk()) return;
  const { width } = shared.win.getContentBounds();
  const w = CARD_W + PAD * 2;
  const top = shared.htmlFullscreen ? 0 : CHROME_H;
  view.setBounds({
    x: Math.max(0, width - w - 4),
    y: top + 4,
    width: w,
    height: CARD_H + PAD * 2,
  });
}

// Pasang ulang = naik ke lapisan paling atas (dipanggil saat tab berpindah)
function raise() {
  if (!view || !winOk()) return;
  try {
    shared.win.contentView.addChildView(view);
  } catch {}
}

function destroy() {
  clearTimeout(failsafe);
  failsafe = null;
  const v = view;
  view = null;
  ready = false;
  pending = null;
  if (!v) return;
  try {
    if (winOk()) shared.win.contentView.removeChildView(v);
  } catch {}
  try {
    if (!v.webContents.isDestroyed()) v.webContents.close();
  } catch {}
}

function paint(msg) {
  const wc = view?.webContents;
  if (!wc || wc.isDestroyed()) return;
  wc.executeJavaScript(
    `window.showToast(${JSON.stringify(msg.title)},${JSON.stringify(msg.text)},${SHOW_MS},${!!msg.canCopy})`,
  ).catch(() => {});
}

function show(msg) {
  if (!winOk()) return;
  if (!view) {
    const v = new WebContentsView({
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    v.setBackgroundColor("#00000000");
    const wc = v.webContents;
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    wc.on("will-navigate", (e) => e.preventDefault());
    // Tombol di kartu mengirim perintah lewat console.log (tanpa preload / IPC)
    wc.on("console-message", (...a) => {
      const text = typeof a[0]?.message === "string" ? a[0].message : a[2];
      if (typeof text !== "string" || !text.startsWith("__saya_toast:") || view !== v) return;
      const cmd = text.slice(13);
      if (cmd === "copy") clipboard.writeText(details);
      else if (cmd === "close") destroy();
    });
    wc.on("did-finish-load", () => {
      if (view !== v) return;
      ready = true;
      if (pending) paint(pending);
      pending = null;
    });
    wc.loadURL(URL_).catch(() => {});
    view = v;
    ready = false;
    shared.win.contentView.addChildView(v);
  }
  layout();
  raise();
  if (ready) paint(msg);
  else pending = msg;
  clearTimeout(failsafe);
  failsafe = setTimeout(destroy, SHOW_MS + 30_000); // jaga-jaga kalau animasi tidak pernah selesai
}

function logToFile(source, stack) {
  try {
    fs.appendFileSync(
      path.join(app.getPath("userData"), "error.log"),
      `[${new Date().toISOString()}] [${source}] ${stack}\n\n`,
    );
  } catch {}
}

// Error tak terduga: dicatat (terminal + userData/error.log), pengguna hanya melihat kartu ramah ini
function report(err, source = "app") {
  const message = String(err?.message ?? err ?? "Unknown error");
  const stack = String(err?.stack || message);
  console.error(`[${source}]`, stack);
  logToFile(source, stack);
  const now = Date.now();
  if (now - (recent.get(message) || 0) < DEDUPE_MS) return;
  recent.set(message, now);
  if (recent.size > 50) recent.delete(recent.keys().next().value);
  details = `Saya ${app.getVersion()} (${process.platform})\n${stack}`;
  show({
    title: "Something went wrong",
    text: "Saya hit a problem but is still running. If it keeps happening, please restart the browser.",
    canCopy: true,
  });
}

// Pesan biasa (bukan error)
function notify(title, text) {
  show({ title: String(title || "Saya"), text: String(text || ""), canCopy: false });
}

Object.assign(module.exports, { destroy, layout, notify, raise, report });
