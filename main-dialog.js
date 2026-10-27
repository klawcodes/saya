// main-dialog.js — Dialog & prompt izin buatan sendiri (menggantikan kotak pesan native Windows).
// Satu view overlay penuh-jendela (renderer/dialog.html) dengan antrean: alert/confirm/prompt dari halaman web,
// permintaan izin situs (lokasi, kamera, mikrofon, clipboard), dan panel izin situs (tombol di address bar).
// Polanya sama dengan menu titik tiga (main-ui.js): WebContentsView + preload sempit + IPC.

const { WebContentsView, ipcMain } = require("electron");
const path = require("path");
const { isWeb } = require("./store");
const { RENDERER_DIR, activeWC, shared } = require("./main-core");

// Modul ini dimuat oleh main-network.js, jadi modul lain diambil lambat (hindari require melingkar)
const $tabs = () => require("./main-tabs");
const $network = () => require("./main-network");

const SITE_PERMS = [
  ["geolocation", "Location"],
  ["media:video", "Camera"],
  ["media:audio", "Microphone"],
  ["clipboard-read", "Clipboard contents"],
];

const dlg = {
  view: null,
  ready: false,
  cur: null, // item yang sedang tampil
  queue: [],
  destroyTimer: null,
};
let seq = 0;

const hostOf = (u) => {
  try {
    return new URL(u).host;
  } catch {
    return "";
  }
};

// ---------------------------------------------------------------
// View
// ---------------------------------------------------------------
function ensureView() {
  clearTimeout(dlg.destroyTimer);
  if (dlg.view && !dlg.view.webContents.isDestroyed()) return dlg.view;
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "dialogpreload.js"),
    },
  });
  view.setBackgroundColor("#00000000"); // transparan: latar redup digambar dialog.css
  view.setVisible(false);
  const wc = view.webContents;
  wc.on("will-navigate", (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  wc.once("did-finish-load", () => {
    if (dlg.view !== view) return;
    dlg.ready = true;
    if (dlg.cur) paint(true);
  });
  wc.loadFile(path.join(RENDERER_DIR, "dialog.html")).catch(() => {});
  shared.win.contentView.addChildView(view);
  dlg.view = view;
  dlg.ready = false;
  return view;
}

function destroyView() {
  const view = dlg.view;
  if (!view || dlg.cur) return;
  dlg.view = null;
  dlg.ready = false;
  try {
    shared.win?.contentView.removeChildView(view);
  } catch {}
  if (!view.webContents.isDestroyed()) view.webContents.close();
}

// Menutupi seluruh isi jendela (modal)
function layout() {
  const v = dlg.view;
  if (!v || !dlg.cur || !shared.win || shared.win.isDestroyed()) return;
  const [w, h] = shared.win.getContentSize();
  v.setBounds({ x: 0, y: 0, width: w, height: h });
  raise();
}

// Selalu di lapisan paling atas (view tab yang baru diaktifkan tidak boleh menutupinya)
function raise() {
  const v = dlg.view;
  if (!v || !dlg.cur || !shared.win || shared.win.isDestroyed()) return;
  try {
    const kids = shared.win.contentView.children;
    if (kids[kids.length - 1] !== v) shared.win.contentView.addChildView(v);
  } catch {}
}

// ---------------------------------------------------------------
// Antrean
// ---------------------------------------------------------------
function payloadOf(item) {
  const s = item.spec;
  const p = { ...s, id: item.id };
  delete p.wc;
  if (s.kind === "site") Object.assign(p, siteState(item));
  return p;
}

function paint(focus) {
  const wc = dlg.view?.webContents;
  if (!dlg.ready || !wc || wc.isDestroyed() || !dlg.cur) return;
  wc.send("dialog:render", payloadOf(dlg.cur));
  if (focus) wc.focus();
}

const cancelResult = (item) => ({
  button: item.spec.cancelId || "",
  value: null,
  checked: false,
});

function pump() {
  if (dlg.cur || !dlg.queue.length) return;
  if (!shared.win || shared.win.isDestroyed()) {
    for (const it of dlg.queue.splice(0)) it.resolve(cancelResult(it));
    return;
  }
  dlg.cur = dlg.queue.shift();
  const view = ensureView();
  layout();
  view.setVisible(true);
  paint(true);
}

function finish(item, result) {
  if (item.done) return;
  item.done = true;
  if (dlg.cur === item) dlg.cur = null;
  else dlg.queue = dlg.queue.filter((x) => x !== item);
  item.resolve(result);
  if (dlg.queue.length) return pump();
  if (dlg.view && !dlg.view.webContents.isDestroyed()) {
    dlg.view.setVisible(false);
    clearTimeout(dlg.destroyTimer);
    dlg.destroyTimer = setTimeout(destroyView, 30_000);
  }
  const wc = activeWC();
  if (wc && !wc.isDestroyed()) wc.focus();
}

// spec: { kind, title, message, buttons:[{id,label,variant}], cancelId, defaultId, wc?, ... }
function ask(spec) {
  return new Promise((resolve) => {
    const item = { id: ++seq, spec, resolve, done: false, changed: false };
    const wc = spec.wc;
    if (wc && !wc.isDestroyed()) {
      // Tab/halaman yang meminta sudah hilang: dialognya ikut dibatalkan
      wc.once("destroyed", () => finish(item, cancelResult(item)));
    }
    dlg.queue.push(item);
    pump();
  });
}

const fromView = (e) =>
  !!dlg.view && !dlg.view.webContents.isDestroyed() && e.sender === dlg.view.webContents;

ipcMain.on("dialog:result", (e, r) => {
  const item = dlg.cur;
  if (!fromView(e) || !item || !r || r.id !== item.id) return;
  const ids = (item.spec.buttons || []).map((b) => b.id);
  const button = ids.includes(r.button) ? r.button : item.spec.cancelId || "";
  finish(item, {
    button,
    value: typeof r.value === "string" ? r.value.slice(0, 20000) : null,
    checked: r.checked === true,
  });
});

// ---------------------------------------------------------------
// Panel izin situs (tombol di address bar)
// ---------------------------------------------------------------
function siteState(item) {
  const origin = item.spec.origin;
  const perms = shared.stores.permissions;
  const out = {
    changed: item.changed,
    secure: origin.startsWith("https:"),
    rows: SITE_PERMS.map(([key, label]) => {
      const v = perms.get(origin, key);
      return { key, label, state: v === true ? "allow" : v === false ? "block" : "ask" };
    }),
    adblock: null,
  };
  if (shared.blocker)
    out.adblock = { paused: !!$network().isSitePaused(origin) };
  return out;
}

ipcMain.on("dialog:site", (e, r) => {
  const item = dlg.cur;
  if (!fromView(e) || !item || item.spec.kind !== "site" || !r || r.id !== item.id)
    return;
  const origin = item.spec.origin;
  const perms = shared.stores.permissions;
  if (r.op === "set") {
    if (!SITE_PERMS.some(([k]) => k === r.key)) return;
    if (r.value === "allow") perms.set(origin, r.key, true);
    else if (r.value === "block") perms.set(origin, r.key, false);
    else if (r.value === "ask") perms.forget(origin, r.key);
    else return;
    item.changed = true;
  } else if (r.op === "reset") {
    perms.clearOrigin(origin);
    item.changed = true;
  } else if (r.op === "adblock") {
    if (!shared.blocker) return;
    $network().togglePause(origin);
    item.changed = true;
  } else return;
  paint(false);
});

// Dipakai tombol info situs. Setelah ditutup, "Reload page" memuat ulang tab aktif supaya perubahan berlaku.
async function site({ origin }) {
  if (!origin) return;
  const res = await ask({
    kind: "site",
    origin,
    host: hostOf(origin),
    buttons: [
      { id: "close", label: "Done" },
      { id: "reload", label: "Reload page", variant: "primary" },
    ],
    cancelId: "close",
  });
  if (res.button === "reload") $tabs().reload(shared.activeId);
}

// ---------------------------------------------------------------
// Izin situs (dipanggil main-network.js). Hasil: { button: "allow" | "block" | "dismiss" }
// ---------------------------------------------------------------
function permission({ origin, keys, wc }) {
  return ask({
    kind: "permission",
    host: hostOf(origin),
    keys,
    buttons: [
      { id: "block", label: "Block" },
      { id: "allow", label: "Allow", variant: "primary" },
    ],
    cancelId: "dismiss",
    defaultId: "block", // Enter tanpa memilih = tidak memberi akses
    wc,
  });
}

// ---------------------------------------------------------------
// alert() / confirm() / prompt() dari halaman web. pagepreload.js menggantikan ketiganya dan memanggil
// ipcRenderer.sendSync: halaman memang harus berhenti sampai dialog ditutup, sama seperti dialog bawaan.
// ---------------------------------------------------------------
const flood = new Map(); // wc.id -> { url, times: [], muted }
const MAX_MSG = 5000;

ipcMain.on("saya:dialog", (e, req) => {
  let replied = false;
  const reply = (v) => {
    if (replied) return;
    replied = true;
    try {
      e.returnValue = v;
    } catch {}
  };
  const type = ["alert", "confirm", "prompt"].includes(req?.type) ? req.type : "alert";
  const fallback = type === "alert" ? true : type === "confirm" ? false : null;
  try {
    const url = e.senderFrame?.url || "";
    if (!isWeb(url) || e.sender.isDestroyed()) return reply(fallback);

    // Pembatas spam: halaman yang memunculkan dialog beruntun boleh dibungkam oleh pengguna
    const now = Date.now();
    let f = flood.get(e.sender.id);
    if (!f || f.url !== url) {
      f = { url, times: [], muted: false };
      flood.set(e.sender.id, f);
    }
    if (f.muted) return reply(fallback);
    f.times = f.times.filter((t) => now - t < 10_000);
    const crowded = f.times.length >= 2;
    f.times.push(now);

    // Dialog dari tab latar belakang: tampilkan tabnya dulu supaya jelas asalnya
    const tab = $tabs().tabByWcId(e.sender.id);
    if (tab && shared.activeId !== tab.id) $tabs().activateTab(tab.id);

    const message = String(req?.message ?? "").slice(0, MAX_MSG);
    ask({
      kind: type,
      title: `${hostOf(url)} says`,
      message,
      value: type === "prompt" ? String(req?.def ?? "").slice(0, MAX_MSG) : "",
      buttons:
        type === "alert"
          ? [{ id: "ok", label: "OK", variant: "primary" }]
          : [
              { id: "cancel", label: "Cancel" },
              { id: "ok", label: "OK", variant: "primary" },
            ],
      cancelId: type === "alert" ? "ok" : "cancel",
      checkbox: crowded
        ? { label: "Prevent this page from showing more dialogs" }
        : null,
      wc: e.sender,
    }).then((res) => {
      if (res.checked) f.muted = true;
      const ok = res.button === "ok";
      if (type === "alert") return reply(true);
      if (type === "confirm") return reply(ok);
      reply(ok ? (res.value ?? "") : null);
    });
  } catch {
    reply(fallback);
  }
});

module.exports = { ask, layout, permission, raise, site };
