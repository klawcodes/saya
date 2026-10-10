// main-linkstatus.js — Pratinjau tujuan link: kotak kecil di kiri bawah jendela yang menampilkan alamat
// link saat kursor berada di atasnya (seperti Chrome). Dipicu event "update-target-url" milik tiap tab.
//
// Kotak dibuat sebagai WebContentsView sendiri (data: URL, tanpa preload) supaya tampil di atas halaman.
// Kalau kursor sedang berada di tempat kotak akan muncul (link di pojok kiri bawah), kotak pindah ke kanan
// bawah supaya tidak menutupi link yang sedang di-hover. Modul ini hanya bergantung pada main-core.

const { WebContentsView, screen } = require("electron");
const { shared } = require("./main-core");

const H = 24; // tinggi kotak
const GAP = 10; // jarak dari tepi kiri & bawah jendela (kotak sedikit mengambang)
const MAX_CHARS = 50; // alamat yang lebih panjang dipotong lalu diberi "..."

const HTML = `<!doctype html><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden;
  font:12px/1 "Segoe UI",system-ui,sans-serif;user-select:none}
#s{position:absolute;left:0;top:0;box-sizing:border-box;height:100%;width:max-content;padding:0 10px;
  background:linear-gradient(135deg,rgba(255,255,255,.14),rgba(255,255,255,.04)),rgba(30,30,40,.55);
  color:#f0f0f6;border-radius:8px;
  backdrop-filter:blur(14px) saturate(160%);-webkit-backdrop-filter:blur(14px) saturate(160%);
  opacity:.6;white-space:nowrap;line-height:24px}
</style>
<div id="s"></div>
<script>window.setUrl=t=>{const e=document.getElementById("s");e.textContent=t;return Math.ceil(e.getBoundingClientRect().width)};</script>`;
const PAGE_URL = "data:text/html;charset=utf-8," + encodeURIComponent(HTML);

let view = null;
let ready = false;
let pending = null;
let visible = false;

const winOk = () => !!shared.win && !shared.win.isDestroyed();

function ensureView() {
  if (view) return view;
  const v = new WebContentsView({
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  v.setBackgroundColor("#00000000");
  const wc = v.webContents;
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  wc.on("will-navigate", (e) => e.preventDefault());
  wc.on("did-finish-load", () => {
    if (view !== v) return;
    ready = true;
    const t = pending;
    pending = null;
    if (t !== null) apply(t);
  });
  wc.loadURL(PAGE_URL).catch(() => {});
  v.setVisible(false);
  shared.win.contentView.addChildView(v);
  view = v;
  ready = false;
  return v;
}

let seq = 0; // penanda permintaan terbaru (mengabaikan hasil ukur yang sudah usang)

// Tulis teks ke kotak, ukur lebar aslinya, lalu pasang posisi/ukuran kotak sesuai teks itu
function apply(text) {
  const wc = view?.webContents;
  if (!wc || wc.isDestroyed()) return;
  const id = ++seq;
  wc.executeJavaScript(`window.setUrl(${JSON.stringify(text)})`)
    .then((measured) => {
      if (id === seq && winOk() && view) place(Number(measured) || 60);
    })
    .catch(() => {});
}

// URL -> teks tampilan: alamat yang mudah dibaca (%20 jadi spasi, dst.), dipotong kalau terlalu panjang
function label(url) {
  let s = String(url);
  try {
    s = decodeURI(s);
  } catch {}
  return s.length > MAX_CHARS ? s.slice(0, MAX_CHARS) + "..." : s;
}

function place(textW) {
  const b = shared.win.getContentBounds();
  const w = Math.min(Math.max(40, Math.floor(b.width * 0.5)), textW);
  const y = b.height - H - GAP;

  // Kursor di area kiri bawah? Pindah ke kanan supaya link yang di-hover tidak tertutup.
  const c = screen.getCursorScreenPoint();
  const cx = c.x - b.x;
  const cy = c.y - b.y;
  const underLeft = cx >= 0 && cx <= w + 24 && cy >= y - 24 && cy <= b.height;
  const x = underLeft ? Math.max(0, b.width - w - GAP) : GAP;

  view.setBounds({ x, y, width: w, height: H });
  view.setVisible(true);
  if (!visible) shared.win.contentView.addChildView(view); // naik ke lapisan paling atas
  visible = true;
}

function show(url) {
  if (!winOk() || shared.htmlFullscreen || !/^(https?|ftp|mailto):/i.test(String(url || ""))) {
    hide();
    return;
  }
  const text = label(url);
  ensureView();
  if (ready) apply(text);
  else pending = text;
}

function hide() {
  seq++;
  pending = null;
  if (!visible) return;
  visible = false;
  try {
    view?.setVisible(false);
  } catch {}
}

function destroy() {
  seq++;
  const v = view;
  view = null;
  ready = false;
  pending = null;
  visible = false;
  if (!v) return;
  try {
    if (winOk()) shared.win.contentView.removeChildView(v);
  } catch {}
  try {
    if (!v.webContents.isDestroyed()) v.webContents.close();
  } catch {}
}

Object.assign(module.exports, { destroy, hide, show });
