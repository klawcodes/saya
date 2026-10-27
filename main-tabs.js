// main-tabs.js — Layout view, DevTools menempel, responsive view, tab (buat/aktif/tutup/pindah),
// penyimpanan sesi, tab suspend (hemat RAM), bookmark, zoom.

const {
  WebContentsView,
  ipcMain,
  clipboard,
  nativeImage,
  screen,
} = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { pathToFileURL, fileURLToPath } = require("url");
const { isWeb } = require("./store");
const {
  APP_ICON,
  BG,
  CHROME_H,
  PAGE_RADIUS,
  pageArea,
  ERROR_URL,
  INTERNAL_BASE,
  NEWTAB_URL,
  PAGES,
  PAGE_PRELOAD,
  activeTab,
  activeWC,
  closedTabs,
  config,
  onUI,
  pushTab,
  sendUI,
  shared,
  tabState,
  tabs,
  toUrl,
  writeSettings,
  SYSTEM_DARK,
} = require("./main-core");
const $dialog = require("./main-dialog");
const $downloads = require("./main-downloads");
const $main = require("./main");
const $network = require("./main-network");
const $shortcuts = require("./main-shortcuts");
const $toast = require("./main-toast");
const $linkstatus = require("./main-linkstatus");
const $ui = require("./main-ui");

const originOf = (u) => {
  try {
    return new URL(u).origin;
  } catch {
    return "";
  }
};
// Hanya http(s) / data:image yang boleh dipakai UI; data URI raksasa dibuang
const validFav = (f) =>
  typeof f === "string" && f.length <= 65536 && /^(https?:\/\/|data:image\/)/i.test(f);

const refreshActive = () => activeTab() && pushTab(activeTab());

function layout() {
  layoutViews();
  $ui.findLayout();
  $ui.sboLayout(); // sidebar hover (overlay) selalu di atas view halaman
  $dialog.layout(); // dialog modal menutupi seluruh jendela, di atas semuanya
}

function layoutViews() {
  if (!shared.win || shared.win.isDestroyed()) return;
  const [cw, ch] = shared.win.getContentSize();
  const tab = activeTab();
  const view = tab?.view;
  if (!view) return;
  // Kartu halaman: dikurangi toolbar atas, bingkai, dan sidebar (kalau terbuka); lihat pageArea di main-core.js
  const { x: ox, y: top, width: w, height: H } = pageArea(cw, ch);
  try {
    view.setBorderRadius(shared.htmlFullscreen ? 0 : PAGE_RADIUS);
  } catch {}
  try {
    view.setVisible(true);
  } catch {}
  // Split view: dua tab berdampingan (lihat blok "Split view" di bawah)
  const mate = splitPair(tab);
  if (mate) {
    layoutSplit(tab, mate, { ox, top, w, H });
    return;
  }
  splitUiHide();
  const hidden = tabs.get(splitPartner(tab.id));
  try {
    if (hidden?.view && !hidden.view.webContents.isDestroyed())
      hidden.view.setVisible(false); // pasangan split tidak boleh menimpa tab aktif (mis. saat DevTools terbuka)
  } catch {}
  const dt = tab.devtools;
  if (dt) dt.setVisible(!shared.htmlFullscreen);
  if (!dt || shared.htmlFullscreen) {
    placePage(tab, { x: ox, y: top, width: w, height: H });
    devUiHide();
    return;
  }
  // DevTools terbelah (awal 61,8% : 38,2%, bisa digeser lewat pegangan). Posisi: otomatis (lebar -> kanan,
  // sempit -> bawah) atau dipilih lewat tombol di bar DevTools.
  const right = dev.dock === "auto" ? w >= 900 : dev.dock === "right";
  dev.right = right;
  const bar = DEV_BAR_H;
  const hh = DEV_HANDLE / 2;
  if (right) {
    const dw = Math.round(w * dev.ratio);
    placePage(tab, { x: ox, y: top, width: w - dw, height: H });
    dt.setBounds({
      x: ox + w - dw,
      y: top + bar,
      width: dw,
      height: Math.max(0, H - bar),
    });
    devUiPlace(
      dt,
      { x: ox + w - dw, y: top, width: dw, height: bar },
      { x: ox + w - dw - hh, y: top, width: DEV_HANDLE, height: H },
    );
  } else {
    const dh = Math.round(H * dev.ratio);
    const y = top + H - dh;
    placePage(tab, { x: ox, y: top, width: w, height: H - dh });
    dt.setBounds({ x: ox, y: y + bar, width: w, height: Math.max(0, dh - bar) });
    devUiPlace(
      dt,
      { x: ox, y, width: w, height: bar },
      { x: ox, y: y - hh, width: w, height: DEV_HANDLE },
    );
  }
}

// ---------------------------------------------------------------
// DevTools menempel di jendela (split), bukan jendela baru.
// Electron tidak mendukung docked DevTools untuk WebContentsView, jadi DevTools
// dirender ke WebContentsView tersendiri lewat setDevToolsWebContents.
// ---------------------------------------------------------------
const tabOf = (wc) =>
  [...tabs.values()].find((t) => t.view && t.view.webContents === wc);

function openDevTools(tab) {
  if (!tab?.view || tab.devtools) return;
  const dt = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  dt.setBackgroundColor(BG);
  dt.webContents.on("before-input-event", $ui.handleShortcut); // F12 juga menutup dari dalam DevTools
  tab.devtools = dt;
  tab.view.webContents.setDevToolsWebContents(dt.webContents);
  // "undocked" (bukan "detach"): DevTools tetap memenuhi view-nya sendiri, tapi dianggap bisa di-dock, jadi
  // tombol "Toggle device toolbar" (mobile view, Ctrl+Shift+M) tersedia. Tombol tutup & posisi: bar Saya.
  tab.view.webContents.openDevTools({ mode: "detach" });
  shared.win.contentView.addChildView(dt);
  layout();
}

function dropDevtoolsView(tab) {
  const dt = tab.devtools;
  if (!dt) return;
  tab.devtools = null;
  try {
    shared.win.contentView.removeChildView(dt);
  } catch {}
  const dwc = dt.webContents; // bisa sudah undefined kalau DevTools ditutup lebih dulu
  if (dwc && !dwc.isDestroyed()) {
    try {
      dwc.close();
    } catch {}
  }
  layout();
}

function toggleDevTools() {
  const tab = activeTab();
  if (!tab?.view) return;
  if (tab.devtools) {
    tab.view.webContents.closeDevTools();
    dropDevtoolsView(tab);
  } else {
    openDevTools(tab);
  }
}

// ---------------------------------------------------------------
// Kontrol DevTools buatan Saya: bar (mobile view, posisi kanan/bawah, tutup) dan pegangan untuk
// menggeser ukuran. Frontend DevTools di view terpisah tidak punya tombol tutup sendiri.
// ---------------------------------------------------------------
const DEV_BAR_H = 28;
const DEV_HANDLE = 6;
const DEV_RATIO = 0.382;
const DEV_MIN = 0.2;
const DEV_MAX = 0.8;
const dev = {
  bar: null,
  split: null,
  ratio: DEV_RATIO,
  dock: "auto",
  right: true,
  dragging: false,
  applied: "",
};

const DEV_BAR_HTML = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#141418;color:#a8a8b3;font:12px "Segoe UI",system-ui,sans-serif;user-select:none;overflow:hidden}
body{box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;padding:0 6px 0 12px;border-bottom:1px solid #26262e}
.g{display:flex;gap:2px}
button{width:26px;height:22px;display:grid;place-items:center;border:0;border-radius:5px;background:none;color:inherit;cursor:default}
button:hover{background:#26262e;color:#e4e4ea}
button:focus-visible{outline:2px solid #7c8cff;outline-offset:-2px}
html[data-dock=right] [data-act=dock-right],html[data-dock=bottom] [data-act=dock-bottom]{background:#26262e;color:#e4e4ea}
svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
</style><span>DevTools</span><div class="g">
<button data-act="mobile" title="Mobile view (Ctrl+Shift+M)"><svg viewBox="0 0 16 16"><rect x="4.5" y="1.5" width="7" height="13" rx="1.5"/><path d="M7 12.5h2"/></svg></button>
<button data-act="dock-right" title="Dock to right"><svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M9.5 3v10"/></svg></button>
<button data-act="dock-bottom" title="Dock to bottom"><svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 9h12"/></svg></button>
<button data-act="close" title="Close DevTools (F12)"><svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>
</div>`;
const DEV_SPLIT_HTML = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden}
[data-drag]{position:fixed;inset:0}
html[data-o=h] [data-drag]{cursor:col-resize}
html[data-o=v] [data-drag]{cursor:row-resize}
</style><div data-drag></div>`;

function ensureDevView(kind) {
  const cur = dev[kind];
  if (cur && !cur.webContents.isDestroyed()) return cur;
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "devpreload.js"),
    },
  });
  view.setBackgroundColor(kind === "bar" ? BG : "#00000000");
  const wc = view.webContents;
  wc.on("before-input-event", $ui.handleShortcut); // F12 tetap menutup saat fokus di bar
  wc.on("will-navigate", (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  wc.once("did-finish-load", () => devApply(true));
  wc.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(kind === "bar" ? DEV_BAR_HTML : DEV_SPLIT_HTML),
  ).catch(() => {});
  shared.win.contentView.addChildView(view);
  dev[kind] = view;
  return view;
}

// Beri tahu halaman bar/pegangan posisi saat ini (untuk kursor resize dan tombol posisi yang aktif)
function devApply(force) {
  const key = dev.right ? "h" : "v";
  if (!force && dev.applied === key) return;
  dev.applied = key;
  const set = (v, attr, val) => {
    const wc = v?.webContents;
    if (!wc || wc.isDestroyed() || wc.isLoading()) return;
    wc.executeJavaScript(
      `document.documentElement.dataset.${attr}=${JSON.stringify(val)}`,
    ).catch(() => {});
  };
  set(dev.split, "o", key);
  set(dev.bar, "dock", dev.right ? "right" : "bottom");
}

function devUiPlace(dt, barRect, handleRect) {
  const bar = ensureDevView("bar");
  const split = ensureDevView("split");
  bar.setBounds(barRect);
  split.setBounds(handleRect);
  for (const v of [bar, split]) {
    v.setVisible(true);
    // Naikkan di atas DevTools (kalau urutannya di bawah); jangan mengacak lapisan lain tanpa perlu
    const kids = shared.win.contentView.children;
    if (kids.indexOf(v) < kids.indexOf(dt))
      shared.win.contentView.addChildView(v);
  }
  devApply(false);
}

function devUiHide() {
  for (const v of [dev.bar, dev.split]) {
    if (v && !v.webContents.isDestroyed()) v.setVisible(false);
  }
}

// Geser pegangan: hitung rasio dari posisi kursor terhadap jendela
function devDrag() {
  if (!shared.win || shared.win.isDestroyed()) return;
  const pt = screen.getCursorScreenPoint();
  const cb = shared.win.getContentBounds();
  const A = pageArea(cb.width, cb.height);
  const frac = dev.right
    ? (cb.x + A.x + A.width - pt.x) / Math.max(1, A.width)
    : (cb.y + A.y + A.height - pt.y) / Math.max(1, A.height);
  dev.ratio = Math.min(DEV_MAX, Math.max(DEV_MIN, frac));
  layout();
}

ipcMain.on("devui", (e, act) => {
  const from = e.sender;
  if (from !== dev.bar?.webContents && from !== dev.split?.webContents) return;
  const tab = activeTab();
  if (!tab?.devtools) return;
  switch (act) {
    case "close":
      toggleDevTools();
      break;
    case "dock-right":
    case "dock-bottom":
      dev.dock = act === "dock-right" ? "right" : "bottom";
      layout();
      break;
    case "mobile":
      toggleResponsive(); // responsive view buatan Saya (lihat blok "Responsive view" di bawah)
      break;
    case "drag-start":
      dev.dragging = true;
      break;
    case "drag-move":
      if (dev.dragging) devDrag();
      break;
    case "drag-end":
      dev.dragging = false;
      break;
    case "reset":
      dev.ratio = DEV_RATIO;
      layout();
      break;
  }
});

// ---------------------------------------------------------------
// Responsive view (mobile/tablet) buatan Saya.
// Kenapa tidak memakai tombol "Toggle device toolbar" bawaan DevTools: frontend-nya meminta browser
// memindahkan halaman asli ke kotak yang ia gambar (InspectorFrontendHost.setInspectedPageBounds), dan
// Electron hanya melayani itu untuk DevTools bawaannya sendiri, bukan untuk setDevToolsWebContents.
// Hasilnya area kosong. Di sini emulasinya lewat CDP (Emulation.*), dan view halaman langsung
// diperkecil + ditaruh di tengah area halaman, dengan bar kontrol di atasnya.
// State per tab: tab.resp = { on, dev, w, h, dpr, tablet, scale, applied }
// ---------------------------------------------------------------
const RESP_BAR_H = 36;
const RESP_PAD = 14;
const DEVICES = [
  { name: "iPhone SE", w: 375, h: 667, dpr: 2 },
  { name: "iPhone 12 Pro", w: 390, h: 844, dpr: 3 },
  { name: "iPhone 14 Pro Max", w: 430, h: 932, dpr: 3 },
  { name: "Pixel 7", w: 412, h: 915, dpr: 2.625 },
  { name: "Samsung Galaxy S20 Ultra", w: 412, h: 915, dpr: 3.5 },
  { name: "iPad Mini", w: 768, h: 1024, dpr: 2, tablet: true },
  { name: "iPad Air", w: 820, h: 1180, dpr: 2, tablet: true },
  { name: "iPad Pro 12.9", w: 1024, h: 1366, dpr: 2, tablet: true },
];
const rsp = { view: null };

const RESP_BAR_HTML = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#141418;color:#a8a8b3;font:12px "Segoe UI",system-ui,sans-serif;user-select:none;overflow:hidden}
body{box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:8px;padding:0 8px;border-bottom:1px solid #26262e}
select,input{height:24px;box-sizing:border-box;background:#1c1c22;color:#e4e4ea;border:1px solid #26262e;border-radius:5px;font:inherit;padding:0 6px;outline:none}
select:focus,input:focus{border-color:#7c8cff}
option{background:#1c1c22;color:#e4e4ea}
input{width:56px;text-align:center}
button{width:26px;height:24px;display:grid;place-items:center;border:0;border-radius:5px;background:none;color:inherit;cursor:default}
button:hover{background:#26262e;color:#e4e4ea}
button:focus-visible{outline:2px solid #7c8cff;outline-offset:-2px}
#scale{min-width:34px;text-align:left}
svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
</style>
<select id="dev"><option value="-1">Responsive</option>${DEVICES.map((d, i) => `<option value="${i}">${d.name}</option>`).join("")}</select>
<input id="w" inputmode="numeric" maxlength="4" title="Width"><span>×</span><input id="h" inputmode="numeric" maxlength="4" title="Height">
<span id="scale"></span>
<button id="rot" title="Rotate"><svg viewBox="0 0 16 16"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3"/></svg></button>
<button id="close" title="Close responsive view (Ctrl+Shift+M)"><svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>`;

function tabByWcId(id) {
  if (id == null) return null;
  for (const t of tabs.values()) {
    const v = t.view;
    if (v && !v.webContents.isDestroyed() && v.webContents.id === id) return t;
  }
  return null;
}

// Identitas browser: desktop biasa, atau Chrome Android kalau tab sedang dalam mode responsive
function identityFor(wc) {
  const r = tabOf(wc)?.resp;
  if (!r?.on)
    return { userAgent: $network.UA, userAgentMetadata: $network.UA_META };
  const phone = !r.tablet;
  return {
    userAgent: `Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${$network.CHROME_MAJOR}.0.0.0 ${phone ? "Mobile " : ""}Safari/537.36`,
    userAgentMetadata: {
      ...$network.UA_META,
      platform: "Android",
      platformVersion: "13.0.0",
      architecture: "",
      bitness: "",
      model: "Pixel 7",
      mobile: phone,
    },
  };
}

async function respApply(tab) {
  const wc = tab.view?.webContents;
  const r = tab.resp;
  if (!wc || wc.isDestroyed() || !r) return;
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
    const send = (m, p) => wc.debugger.sendCommand(m, p);
    if (r.on) {
      const land = r.w > r.h;
      await send("Emulation.setDeviceMetricsOverride", {
        width: r.w,
        height: r.h,
        deviceScaleFactor: r.dpr || 0,
        mobile: true,
        scale: r.scale || 1, // dikecilkan supaya muat di jendela; ukuran view native = ukuran x scale
        screenWidth: r.w,
        screenHeight: r.h,
        dontSetVisibleSize: true, // ukuran view diatur placePage(), bukan Blink
        screenOrientation: land
          ? { type: "landscapePrimary", angle: 90 }
          : { type: "portraitPrimary", angle: 0 },
      });
      await send("Emulation.setTouchEmulationEnabled", {
        enabled: true,
        maxTouchPoints: 5,
      });
      await send("Emulation.setEmitTouchEventsForMouse", {
        enabled: true,
        configuration: "mobile",
      });
    } else {
      await send("Emulation.clearDeviceMetricsOverride");
      await send("Emulation.setTouchEmulationEnabled", { enabled: false });
      await send("Emulation.setEmitTouchEventsForMouse", { enabled: false });
    }
    await send("Emulation.setUserAgentOverride", identityFor(wc));
  } catch (err) {
    console.warn("[responsive] gagal mengatur emulasi:", err.message);
  }
}

// Pasang ulang emulasi hanya kalau ukuran/skala/jenis perangkat berubah
function respSync(tab) {
  const r = tab.resp;
  const key = [r.w, r.h, r.dpr, r.scale, r.tablet].join(",");
  if (r.applied === key) return;
  r.applied = key;
  respApply(tab);
}

function respView() {
  if (rsp.view && !rsp.view.webContents.isDestroyed()) return rsp.view;
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "resppreload.js"),
    },
  });
  view.setBackgroundColor(BG);
  const wc = view.webContents;
  wc.on("before-input-event", $ui.handleShortcut); // Ctrl+Shift+M tetap menutup saat fokus di bar
  wc.on("will-navigate", (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  wc.loadURL(
    "data:text/html;charset=utf-8," + encodeURIComponent(RESP_BAR_HTML),
  ).catch(() => {});
  shared.win.contentView.addChildView(view);
  rsp.view = view;
  return view;
}

function respPush(tab) {
  const r = tab?.resp;
  const wc = rsp.view?.webContents;
  if (!r?.on || !wc || wc.isDestroyed()) return;
  wc.send("resp:state", { dev: r.dev, w: r.w, h: r.h, scale: r.scale || 1 });
}

function respUiHide() {
  const v = rsp.view;
  if (v && !v.webContents.isDestroyed()) v.setVisible(false);
}

// Menaruh view halaman di dalam `area`. Mode normal: penuh. Mode responsive: seukuran perangkat
// (diperkecil kalau tidak muat), rata tengah horizontal, di bawah bar kontrol.
function placePage(tab, area) {
  const view = tab.view;
  const r = tab.resp;
  if (!r?.on || shared.htmlFullscreen) {
    view.setBounds(area);
    respUiHide();
    return;
  }
  const availW = Math.max(50, area.width - RESP_PAD * 2);
  const availH = Math.max(50, area.height - RESP_BAR_H - RESP_PAD * 2);
  const s = Math.min(1, availW / r.w, availH / r.h);
  r.scale = Math.round(s * 1000) / 1000;
  const vw = Math.max(1, Math.round(r.w * s));
  const vh = Math.max(1, Math.round(r.h * s));
  view.setBounds({
    x: area.x + Math.round((area.width - vw) / 2),
    y: area.y + RESP_BAR_H + RESP_PAD,
    width: vw,
    height: vh,
  });
  const bar = respView();
  bar.setBounds({
    x: area.x,
    y: area.y,
    width: area.width,
    height: RESP_BAR_H,
  });
  bar.setVisible(true);
  respPush(tab);
  respSync(tab);
}

async function toggleResponsive(force) {
  const tab = activeTab();
  if (!tab?.view || !shared.win || shared.win.isDestroyed()) return;
  const r = (tab.resp ||= {
    on: false,
    dev: -1,
    w: 390,
    h: 844,
    dpr: 0,
    tablet: false,
    scale: 1,
    applied: "",
  });
  const on = typeof force === "boolean" ? force : !r.on;
  if (on === r.on) return;
  r.on = on;
  r.applied = "";
  layout();
  await respApply(tab);
  reload(tab.id); // UA baru hanya berlaku untuk permintaan berikutnya
}

const clampDim = (v, fallback) => {
  const n = Math.round(Number(v));
  return n >= 50 && n <= 4000 ? n : fallback;
};

ipcMain.on("respui", (e, act, val) => {
  if (!rsp.view || e.sender !== rsp.view.webContents) return;
  const tab = activeTab();
  if (act === "ready") return respPush(tab);
  const r = tab?.resp;
  if (!r?.on) return;
  switch (act) {
    case "device": {
      const i = Number(val);
      const d = DEVICES[i];
      if (d) {
        Object.assign(r, {
          dev: i,
          w: d.w,
          h: d.h,
          dpr: d.dpr,
          tablet: !!d.tablet,
        });
      } else {
        Object.assign(r, { dev: -1, dpr: 0, tablet: false });
      }
      break;
    }
    case "size":
      r.w = clampDim(val?.w, r.w);
      r.h = clampDim(val?.h, r.h);
      Object.assign(r, { dev: -1, dpr: 0, tablet: false });
      break;
    case "rotate":
      [r.w, r.h] = [r.h, r.w];
      break;
    case "close":
      toggleResponsive(false);
      return;
    default:
      return;
  }
  layout();
});

// ---------------------------------------------------------------
// Split view (ala Arc): dua tab berdampingan di area halaman, dipisah pegangan yang bisa digeser.
// State: shared.split = { ids: [kiri, kanan], ratio } (satu grup; null = tidak ada). Tab aktif = panel yang
// terakhir diklik (toolbar, Ctrl+L dsb. mengikuti panel itu). Bar tipis di bawah halaman menandai panel aktif.
// Cara pakai: Ctrl+\ (toggle), Ctrl+klik tab di sidebar, klik kanan link > "Open link in split view",
// atau menu titik tiga / command palette. Klik dua kali pegangan = kembali 50:50.
// ---------------------------------------------------------------
const SPLIT_GAP = 8;
const SPLIT_HANDLE = 12;
const SPLIT_MIN = 0.15;
const spl = { handle: null, bar: null, dragging: false, applied: "" };

const SPLIT_HANDLE_HTML = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden}
[data-drag]{position:fixed;inset:0;cursor:col-resize;display:grid;place-items:center}
i{width:4px;height:40px;border-radius:2px;background:#34343f;transition:background 120ms,height 120ms}
[data-drag]:hover i{background:#7c8cff;height:64px}
</style><div data-drag><i></i></div>`;
const SPLIT_BAR_HTML = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden}
.b{position:absolute;top:0;height:100%;border-radius:2px;background:#2a2a33;transition:background 140ms}
#l{left:0;width:var(--l,50%)}
#r{left:calc(var(--l,50%) + var(--g,8px));right:0}
html[data-a="0"] #l,html[data-a="1"] #r{background:#7c8cff}
</style><div class="b" id="l"></div><div class="b" id="r"></div>`;

function splitPartner(id) {
  const s = shared.split;
  return s && s.ids.includes(id) ? s.ids.find((x) => x !== id) : null;
}
const inSplit = (id) => splitPartner(id) != null;

function detach(t) {
  if (!t || !shared.win || shared.win.isDestroyed()) return;
  try {
    if (t.view) shared.win.contentView.removeChildView(t.view);
    if (t.devtools) shared.win.contentView.removeChildView(t.devtools);
  } catch {}
}

// Pasangan split dari tab aktif, kalau split bisa digambar (DevTools / responsive view / layar penuh = tidak)
function splitPair(tab) {
  const s = shared.split;
  if (!s || shared.htmlFullscreen || !s.ids.includes(tab.id)) return null;
  const o = tabs.get(s.ids.find((x) => x !== tab.id));
  if (!o || !o.view || o.view.webContents.isDestroyed()) return null;
  if (tab.devtools || o.devtools || tab.resp?.on || o.resp?.on) return null;
  return o;
}

function ensureSplitView(kind) {
  const cur = spl[kind];
  if (cur && !cur.webContents.isDestroyed()) return cur;
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      ...(kind === "handle"
        ? { preload: path.join(__dirname, "splitpreload.js") }
        : {}),
    },
  });
  view.setBackgroundColor("#00000000");
  const wc = view.webContents;
  wc.on("before-input-event", $ui.handleShortcut);
  wc.on("will-navigate", (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  if (kind === "bar")
    wc.once("did-finish-load", () => {
      spl.applied = "";
      layout();
    });
  wc.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(kind === "bar" ? SPLIT_BAR_HTML : SPLIT_HANDLE_HTML),
  ).catch(() => {});
  shared.win.contentView.addChildView(view);
  spl[kind] = view;
  return view;
}

function splitUiHide() {
  for (const v of [spl.handle, spl.bar]) {
    if (v && !v.webContents.isDestroyed()) v.setVisible(false);
  }
}

function splitBarSync(lw, activeIdx) {
  const key = `${lw},${activeIdx}`;
  if (spl.applied === key) return;
  const wc = spl.bar?.webContents;
  if (!wc || wc.isDestroyed() || wc.isLoading()) return;
  spl.applied = key;
  wc.executeJavaScript(
    `(()=>{const d=document.documentElement;d.style.setProperty('--l','${lw}px');d.style.setProperty('--g','${SPLIT_GAP}px');d.dataset.a='${activeIdx}'})()`,
  ).catch(() => {});
}

function layoutSplit(tab, mate, A) {
  const s = shared.split;
  const left = tabs.get(s.ids[0]);
  const right = tabs.get(s.ids[1]);
  const lw = Math.round((A.w - SPLIT_GAP) * s.ratio);
  const rw = Math.max(0, A.w - SPLIT_GAP - lw);
  left.view.setBounds({ x: A.ox, y: A.top, width: lw, height: A.H });
  right.view.setBounds({
    x: A.ox + lw + SPLIT_GAP,
    y: A.top,
    width: rw,
    height: A.H,
  });
  for (const t of [left, right]) {
    try {
      t.view.setBorderRadius(PAGE_RADIUS);
      t.view.setVisible(true);
    } catch {}
  }
  devUiHide();
  respUiHide();
  const handle = ensureSplitView("handle");
  const bar = ensureSplitView("bar");
  handle.setBounds({
    x: A.ox + lw + SPLIT_GAP / 2 - SPLIT_HANDLE / 2,
    y: A.top,
    width: SPLIT_HANDLE,
    height: A.H,
  });
  bar.setBounds({ x: A.ox, y: A.top + A.H + 2, width: A.w, height: 4 });
  for (const v of [handle, bar]) {
    v.setVisible(true);
    // Naikkan di atas kedua panel (kalau urutannya di bawah); jangan mengacak overlay lain
    const kids = shared.win.contentView.children;
    const topIdx = Math.max(kids.indexOf(left.view), kids.indexOf(right.view));
    if (kids.indexOf(v) < topIdx) shared.win.contentView.addChildView(v);
  }
  splitBarSync(lw, s.ids.indexOf(shared.activeId));
}

function makeSplit(aId, bId) {
  if (!tabs.has(aId) || !tabs.has(bId) || aId === bId) return;
  const old = shared.split;
  shared.split = { ids: [aId, bId], ratio: 0.5 };
  spl.applied = "";
  if (old) {
    for (const id of old.ids) {
      if (id !== aId && id !== bId) detach(tabs.get(id));
    }
  }
  activateTab(bId); // panel baru langsung aktif; activateTab memasang kedua view
  for (const id of new Set([...(old ? old.ids : []), aId, bId])) {
    const t = tabs.get(id);
    if (t) pushTab(t);
  }
}

// Ctrl+klik tab: split tab aktif dengan tab itu
function splitWith(otherId) {
  const cur = activeTab();
  if (cur && cur.id !== otherId) makeSplit(cur.id, otherId);
}

// Link / URL dibuka di panel baru di sebelah tab aktif
function openInSplit(input) {
  const cur = activeTab();
  if (!cur) return;
  const newId = shared.nextId;
  createTab(input);
  makeSplit(cur.id, newId);
}

function closeSplit() {
  const sp = shared.split;
  if (!sp) return;
  shared.split = null;
  const act = activeTab();
  for (const id of sp.ids) {
    const t = tabs.get(id);
    if (!t) continue;
    if (!act || t.id !== act.id) detach(t);
    pushTab(t);
  }
  splitUiHide();
  layout();
}

// Ctrl+\ : tutup split kalau sedang split; kalau tidak, split dengan tab yang terakhir dipakai (atau tab baru)
function toggleSplit() {
  const cur = activeTab();
  if (!cur) return;
  if (inSplit(cur.id)) return closeSplit();
  const others = [...tabs.values()]
    .filter((t) => t.id !== cur.id)
    .sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0));
  if (others.length) makeSplit(cur.id, others[0].id);
  else openInSplit(NEWTAB_URL);
}

// Geser pegangan: rasio dari posisi kursor terhadap area halaman
function splitDrag() {
  const s = shared.split;
  if (!s || !shared.win || shared.win.isDestroyed()) return;
  const pt = screen.getCursorScreenPoint();
  const cb = shared.win.getContentBounds();
  const A = pageArea(cb.width, cb.height);
  const frac =
    (pt.x - cb.x - A.x - SPLIT_GAP / 2) / Math.max(1, A.width - SPLIT_GAP);
  s.ratio = Math.min(1 - SPLIT_MIN, Math.max(SPLIT_MIN, frac));
  layout();
}

ipcMain.on("splitui", (e, act) => {
  if (!spl.handle || e.sender !== spl.handle.webContents || !shared.split) return;
  switch (act) {
    case "drag-start":
      spl.dragging = true;
      break;
    case "drag-move":
      if (spl.dragging) splitDrag();
      break;
    case "drag-end":
      spl.dragging = false;
      break;
    case "reset":
      shared.split.ratio = 0.5;
      layout();
      break;
  }
});

function focusAddress() {
  if (!shared.win || shared.win.isDestroyed()) return;
  // Ctrl+L / Tab Baru: buka command palette, berisi alamat halaman ini (terpilih semua)
  const s = tabState(activeTab());
  $ui.paletteOpen(s?.url || "", true);
}

// Tab Baru: ketikan langsung masuk ke address bar, tanpa perlu klik. Dipasang di before-input-event tiap tab.
// Karakter pertama diteruskan ke UI (yang lalu mengambil fokus); ketikan berikutnya ikut diteruskan
// berurutan sampai fokus benar-benar pindah, jadi tidak ada huruf yang hilang saat mengetik cepat.
function newTabTyping(wc, event, input) {
  if (input.type !== "keyDown" || !shared.win || shared.win.isDestroyed())
    return false;
  if (wc !== activeWC() || wc.getURL() !== NEWTAB_URL) return false;
  if ($shortcuts.typingBlocked(wc)) return false; // dialog shortcut terbuka: ketikan untuk kolom di dialog
  const mod = input.control || input.meta;
  const toAddress = (text) => {
    if (!text || !shared.win || shared.win.isDestroyed()) return;
    $ui.paletteType(text);
  };
  if (!mod && !input.alt && input.key.length === 1) {
    // huruf, angka, simbol, spasi
    event.preventDefault();
    toAddress(input.key);
    return true;
  }
  if (mod && !input.alt && !input.shift && input.key.toLowerCase() === "v") {
    // Ctrl+V = tempel ke address bar. Hasil readText() tidak diasumsikan string (bisa Promise / kosong
    // di beberapa versi Electron atau saat clipboard dikunci aplikasi lain), dan kegagalan tidak boleh jadi error.
    const clean = (t) =>
      typeof t === "string" ? t.replace(/[\r\n]+/g, " ").slice(0, 2000) : "";
    let raw;
    try {
      raw = clipboard.readText();
    } catch {
      return false;
    }
    if (raw && typeof raw.then === "function") {
      event.preventDefault();
      raw.then((t) => toAddress(clean(t))).catch(() => {});
      return true;
    }
    const text = clean(raw);
    if (!text) return false;
    event.preventDefault();
    toAddress(text);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------
// Tab
// ---------------------------------------------------------------
// ---------------------------------------------------------------
// Tema situs (dark/light), hanya untuk halaman web; halaman internal (file://) selalu gelap.
// Dark : situs melihat prefers-color-scheme: dark (bawaan) DAN Chromium "auto dark mode" menyala. Situs yang
//        dark mode-nya setengah jadi (latar gelap tapi panel putih / teks gelap) dibereskan: warna terang
//        dibalik jadi gelap, teks gelap jadi terang, gambar/video tidak disentuh. Bagian yang sudah gelap
//        dan berwarna (header merah dsb.) dibiarkan.
// Off  : browser tidak memaksa apa pun. Tanpa auto dark mode; prefers-color-scheme mengikuti skema OS yang asli
//        (bukan paksaan terang/gelap), jadi tiap situs memakai tema pilihannya sendiri (toggle di situs, dsb.).
// Dipasang lewat CDP (sama seperti emulasi DevTools), jadi berlaku langsung tanpa memuat ulang halaman.
// ---------------------------------------------------------------
// Dokumen PDF web: viewer PDF bawaan Chromium melukis sendiri; auto dark mode membuatnya layar hitam.
// (PDF lokal file:// tidak terkena karena `web` = false di applyTheme.) Dikenali dari ekstensi .pdf, dari
// Content-Type respons (main-network.js), atau dari document.contentType setelah navigasi (sniffPdf).
function isPdfDoc(tab, u) {
  if (tab.pdf && tab.pdf === u) return true;
  if (shared.pdfDocs.has(u)) return true;
  try {
    return /\.pdf$/i.test(new URL(u).pathname);
  } catch {
    return false;
  }
}

function sniffPdf(tab, url) {
  const wc = tab?.view?.webContents;
  if (!wc || wc.isDestroyed() || !isWeb(url) || tab.pdf === url) return;
  wc.executeJavaScript("document.contentType")
    .then((type) => {
      if (wc.isDestroyed() || tab.view?.webContents !== wc) return;
      if (!/^application\/pdf/i.test(String(type))) return;
      tab.pdf = url;
      applyTheme(tab, url);
    })
    .catch(() => {});
}

async function applyTheme(tab, url) {
  const wc = tab?.view?.webContents;
  if (!wc || wc.isDestroyed()) return;
  const u = url || wc.getURL();
  const web = isWeb(u);
  const dark = config.darkWeb !== false;
  const pdf = web && isPdfDoc(tab, u);
  // Situs yang dipaksa terang saat Dark web mati (tidak mengikuti tema OS), mis. Pinterest
  let host = "";
  try {
    host = new URL(url || wc.getURL()).hostname;
  } catch {}
  const forceLight = web && !dark && /(^|\.)pinterest\.[a-z.]+$/i.test(host);
  // Warna dasar halaman: situs yang tidak melukis latarnya sendiri menampilkan warna ini.
  // Dark web mati dan (OS terang atau situs paksa-terang) = putih; selain itu = BG.
  try {
    tab.view.setBackgroundColor(
      web && !dark && (forceLight || !SYSTEM_DARK) ? "#ffffff" : BG,
    );
  } catch {}
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
    const send = (m, p) => wc.debugger.sendCommand(m, p);
    // Tanpa parameter "enabled" = override dihapus
    await send(
      "Emulation.setAutoDarkModeOverride",
      web && dark && !pdf ? { enabled: true } : {},
    );
    // Dark web mati: ikuti skema OS asli, tidak dipaksa terang. Dark web nyala / halaman internal: bawaan (gelap).
    await send("Emulation.setEmulatedMedia", {
      features: [
        {
          name: "prefers-color-scheme",
          // Dark web mati = ikuti skema OS asli (default sistem); khusus Pinterest dipaksa terang
          value:
            web && !dark
              ? forceLight
                ? "light"
                : SYSTEM_DARK
                  ? "dark"
                  : "light"
              : "",
        },
      ],
    });
  } catch (err) {
    console.warn("[tema] gagal mengatur tema situs:", err.message);
  }
}

function setDarkWeb(on) {
  config.darkWeb = !!on;
  try {
    writeSettings({ darkWeb: config.darkWeb });
  } catch (err) {
    console.warn("[tema] gagal menyimpan pilihan:", err.message);
  }
  for (const tab of tabs.values()) if (tab.view) applyTheme(tab);
}

// Argumen untuk preload halaman: beri tahu apakah shim Chrome berlaku di semua situs (juga di iframe)
function shimPrefs() {
  return config.identity.chromeShim === "all"
    ? {
        additionalArguments: ["--saya-shim=all"],
        nodeIntegrationInSubFrames: true,
      }
    : {};
}

function buildView(tab) {
  const id = tab.id;
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: PAGE_PRELOAD, // hanya mengekspos API kalau halamannya internal
      ...shimPrefs(),
    },
  });
  view.setBackgroundColor(BG);
  tab.view = view;

  const wc = view.webContents;
  wc.setWebRTCIPHandlingPolicy("default_public_interface_only"); // cegah kebocoran IP lokal lewat WebRTC
  wc.setMaxListeners(50); // situs besar memasang banyak listener saat loading; ini hanya peringatan
  $network.spoofUA(wc); // UA + Client Hints konsisten (lihat spoofUA)
  wc.setAudioMuted(!!tab.muted);
  const live = () => !wc.isDestroyed() && tab.view === view;
  // Halaman menutup dirinya sendiri (window.close() setelah login OAuth, dsb.): webContents hancur tanpa
  // lewat closeTab, sehingga tab hantu tertinggal di daftar. suspend() dan closeTab() sudah mengosongkan
  // tab.view / menghapus tab-nya lebih dulu, jadi keduanya tidak memicu blok ini.
  wc.once("destroyed", () => {
    if (tab.view !== view || !tabs.has(id)) return;
    closeTab(id);
  });
  const push = () => {
    if (!live()) return;
    pushTab(tab);
    scheduleSave();
  };
  const record = (url) => {
    if (config.history.enabled && !tab.restoring)
      shared.stores.history.add(url, wc.getTitle());
  };

  wc.on("did-start-navigation", (e) => {
    if (e.isMainFrame && live() && !wc.debugger.isAttached())
      $network.spoofUA(wc); // debugger bisa terlepas (DevTools, crash)
  });
  // Tema situs dipasang sedini mungkin (awal navigasi) dan dipastikan lagi saat navigasi selesai di-commit
  wc.on("did-start-navigation", (e) => {
    if (e.isMainFrame && live()) applyTheme(tab, e.url);
  });
  wc.on("did-navigate", (_e, url) => {
    if (!live()) return;
    applyTheme(tab, url);
    sniffPdf(tab, url); // PDF tanpa ekstensi .pdf / tanpa ad blocker: dikenali dari contentType
  });
  // Tujuan link yang sedang di-hover (kosong = kursor pergi) -> kotak kecil di kiri bawah
  wc.on("update-target-url", (_e, url) => {
    if (!live() || tab.id !== shared.activeId) return;
    if (url) $linkstatus.show(url);
    else $linkstatus.hide();
  });
  wc.on("page-title-updated", (_e, title) => {
    if (!live()) return;
    if (!tab.restoring) {
      shared.stores.history.setTitle(wc.getURL(), title);
      $shortcuts.setTitle(wc.getURL(), title);
    }
    push();
  });
  wc.on("did-start-loading", push);
  wc.on("did-stop-loading", () => {
    // Situs tanpa <link rel="icon"> tidak memicu page-favicon-updated: pakai /favicon.ico (gagal muat = placeholder bawaan)
    if (live() && !tab.favicon) {
      const url = wc.getURL();
      const o = isWeb(url) ? originOf(url) : "";
      if (o && o !== "null") {
        tab.favicon = o + "/favicon.ico";
        tab.favOrigin = o;
      }
    }
    push();
  });
  wc.on("audio-state-changed", push);
  wc.on("media-started-playing", push); // cadangan untuk versi Electron lama
  // Redirect / navigasi baru / gagal muat: segarkan status supaya spinner tidak tertinggal "berhenti"
  wc.on("did-start-navigation", (e) => e.isMainFrame && push());
  wc.on("did-redirect-navigation", (e) => e.isMainFrame && push());
  wc.on("did-fail-load", push);
  wc.on("did-navigate-in-page", (_e, url, isMainFrame) => {
    if (!live()) return;
    if (isMainFrame) record(url);
    push();
  });
  wc.on("did-navigate", (_e, url) => {
    if (!live()) return;
    // Ikon dipertahankan selama masih satu situs (back/forward, reload, bfcache tidak memicu event favicon lagi)
    const o = originOf(url);
    if (!o || o === "null" || o !== tab.favOrigin) {
      tab.favicon = "";
      tab.favOrigin = "";
    }
    tab.keepAlive = false; // izin media berlaku untuk halaman ini saja
    $ui.findReset(tab);
    $shortcuts.resetDialog(wc); // dialog shortcut di Tab Baru ikut hilang saat halaman berganti
    if (!url.startsWith(ERROR_URL)) {
      tab.errorUrl = "";
      record(url);
      if (config.history.enabled && !tab.restoring) $shortcuts.visit(url);
    }
    push();
  });
  wc.on("page-favicon-updated", (_e, list) => {
    if (!live() || !Array.isArray(list)) return;
    const f = list.find(validFav);
    if (!f) return; // kosong / tidak valid: pertahankan ikon yang sudah ada
    tab.favicon = f;
    tab.favOrigin = originOf(wc.getURL());
    $shortcuts.setFavicon(wc.getURL(), f);
    push();
  });
  wc.on("did-fail-load", (_e, code, desc, failedUrl, isMainFrame) => {
    if (!live() || !isMainFrame || code === -3) return; // -3 = dibatalkan (navigasi baru)
    if (failedUrl.startsWith(ERROR_URL)) return;
    tab.errorUrl = failedUrl;
    wc.loadURL(
      `${ERROR_URL}?u=${encodeURIComponent(failedUrl)}&e=${encodeURIComponent(desc)}`,
    ).catch(() => {});
  });
  // Tab crash: muat ulang otomatis (maks 3x berturut-turut), lalu tampilkan halaman error
  let crashes = 0;
  wc.on("did-finish-load", () => {
    crashes = 0;
  });
  wc.on("render-process-gone", (_e, details) => {
    if (!live() || details.reason === "clean-exit") return;
    if (++crashes <= 3) {
      setTimeout(() => live() && wc.reload(), 500);
      return;
    }
    tab.errorUrl = wc.getURL();
    wc.loadURL(
      `${ERROR_URL}?u=${encodeURIComponent(tab.errorUrl)}&e=${encodeURIComponent("the page stopped responding (crash)")}`,
    ).catch(() => {});
  });
  wc.on("devtools-closed", () => live() && dropDevtoolsView(tab));
  wc.on("context-menu", (_e, params) => $ui.showContextMenu(wc, params));
  // File lokal dijatuhkan di halaman (mis. diseret dari panel unduhan / Explorer) membuat Chromium
  // menavigasi tab ini ke file://. Gantinya: gambar/txt/pdf dibuka di tab baru, jenis lain diabaikan.
  // (Situs dengan area upload sendiri menangani drop-nya duluan, jadi upload lewat drag tetap jalan.)
  wc.on("will-navigate", (e, url) => {
    if (!/^file:/i.test(url) || url.startsWith(INTERNAL_BASE)) return;
    e.preventDefault();
    try {
      openLocalFile(fileURLToPath(url));
    } catch {}
  });
  // Ctrl + roda mouse: Electron hanya mengirim eventnya, penerapannya urusan kita. Diberi jeda singkat
  // supaya roda yang mulus (touchpad) tidak melompati beberapa langkah sekaligus.
  let lastZoom = 0;
  wc.on("zoom-changed", (_e, direction) => {
    const now = Date.now();
    if (now - lastZoom < 70) return;
    lastZoom = now;
    zoomStep(wc, direction === "in" ? 1 : -1);
  });
  wc.on("before-input-event", (e, input) => {
    if (!newTabTyping(wc, e, input)) $ui.handleShortcut(e, input);
  });
  // Split view: mengklik panel lain menjadikannya tab aktif
  wc.on("focus", () => {
    if (live() && shared.split?.ids.includes(id) && shared.activeId !== id)
      activateTab(id);
  });
  wc.on("enter-html-full-screen", () => {
    shared.htmlFullscreen = true;
    shared.win.setFullScreen(true);
    layout();
  });
  wc.on("leave-html-full-screen", () => {
    shared.htmlFullscreen = false;
    shared.win.setFullScreen(false);
    layout();
  });
  wc.setWindowOpenHandler(
    ({ url: target, disposition, features, frameName }) => {
      if (config.adblock.debug)
        console.log("[popup]", { target, disposition, features, frameName });
      if ($network.popupBlocked(wc, target)) return { action: "deny" };
      // Popup sungguhan (window.open dengan ukuran, window.open bernama, about:blank yang nanti diisi
      // halaman asal, atau alur login OAuth lintas situs), mis. login Google/Facebook/Apple. Harus jendela
      // asli supaya window.opener & postMessage jalan; kalau dijadikan tab biasa, hasil login tidak kembali
      // ke halaman asal. Link biasa (<a target="_blank">, noopener/noreferrer saja) dibuka sebagai tab.
      if (
        target === "about:blank" ||
        disposition === "new-window" ||
        $network.wantsPopupWindow(features) ||
        $network.isNamedWindow(frameName) ||
        $network.isAuthTarget(target, wc.getURL())
      ) {
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            parent: shared.win,
            autoHideMenuBar: true,
            backgroundColor: BG,
            webPreferences: {
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
              preload: PAGE_PRELOAD,
              ...shimPrefs(),
            },
          },
        };
      }
      createTab(target);
      return { action: "deny" };
    },
  );
  wc.on("did-create-window", (child) => setupPopupWindow(child, wc));
  return view;
}

// Jendela popup (login, dsb.): identitas browser sama dengan tab; link baru di dalamnya dibuka sebagai tab
//
// Alur login (mis. "Add account" di Google Drive): setelah login selesai, Google mengarahkan popup ke halaman
// situs asal. Kalau halaman itu tidak menutup dirinya sendiri, popup tertinggal menampilkan situsnya. Di sini
// popup yang sudah pernah melewati halaman login lalu mendarat di halaman biasa ditutup (setelah jeda singkat,
// supaya callback OAuth sempat memanggil postMessage / window.close), dan tab asal dimuat ulang agar memakai akun baru.
function setupPopupWindow(child, opener) {
  const cwc = child.webContents;
  child.setMenuBarVisibility(false);
  $network.spoofUA(cwc);

  let sawAuth = false;
  let doneTimer = null;
  const alive = () => !child.isDestroyed() && !cwc.isDestroyed();
  const onNav = (url) => {
    if (!alive() || !isWeb(url)) return;
    clearTimeout(doneTimer);
    if ($network.isAuthHost(url)) {
      sawAuth = true;
      return;
    }
    if (!sawAuth) return; // popup biasa (bukan alur login): biarkan
    doneTimer = setTimeout(() => {
      if (!alive()) return; // sudah menutup dirinya sendiri
      if (opener && !opener.isDestroyed()) opener.reload();
      child.close();
    }, 2000);
  };
  cwc.on("did-navigate", (_e, url) => onNav(url));
  cwc.on("did-redirect-navigation", (e) => {
    if (e.isMainFrame) onNav(e.url);
  });
  child.on("closed", () => clearTimeout(doneTimer));
  cwc.on("did-start-navigation", (e) => {
    if (e.isMainFrame && !cwc.isDestroyed() && !cwc.debugger.isAttached())
      $network.spoofUA(cwc);
  });
  cwc.setWindowOpenHandler(({ url: target }) => {
    if (isWeb(target)) createTab(target);
    return { action: "deny" };
  });
}

function createTab(input) {
  if (!shared.win || shared.win.isDestroyed()) return;
  const url = toUrl(input);
  const id = shared.nextId++;
  const tab = {
    id,
    view: null,
    devtools: null,
    suspended: false,
    saved: null,
    lastActive: Date.now(),
    favicon: "",
    errorUrl: "",
    restoring: false,
  };
  tabs.set(id, tab);
  buildView(tab);

  sendUI("tab:created", tabState(tab));
  activateTab(id);
  tab.view.webContents.loadURL(url).catch(() => {});
  if (url === NEWTAB_URL) focusAddress();
}

// Jenis file lokal yang dibuka langsung di tab (penampil bawaan Chromium). SVG/HTML sengaja tidak
// termasuk: keduanya bisa menjalankan skrip dengan asal file://.
const VIEWABLE = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "avif",
  "ico",
  "txt",
  "pdf",
]);
const isViewable = (p) =>
  VIEWABLE.has(path.extname(String(p)).slice(1).toLowerCase());

function openLocalFile(p) {
  if (typeof p !== "string" || !path.isAbsolute(p) || !isViewable(p))
    return false;
  if (!fs.existsSync(p)) return false;
  createTab(pathToFileURL(p).href);
  return true;
}

// File yang dijatuhkan di tab bar / toolbar (dikirim renderer UI sebagai daftar path)
onUI("tab:openfiles", (paths) => {
  if (!Array.isArray(paths)) return;
  for (const p of paths.slice(0, 10)) openLocalFile(p);
});

function activateTab(id) {
  const next = tabs.get(id);
  if (!next) return;
  // Tab hantu (webContents sudah hancur): buang, lalu pindah ke tab lain
  if (next.view && next.view.webContents.isDestroyed()) {
    next.view = null; // supaya listener "destroyed" tidak ikut memproses
    return closeTab(id);
  }
  $ui.sgHide(); // dropdown saran akan tertutup view halaman
  $downloads.dlpHide();
  $ui.mpHide();
  if ($ui.find.open && $ui.find.tabId !== id) $ui.findClose(false); // bar cari milik tab sebelumnya
  const prev = activeTab();
  const sameGroup = !!prev && splitPartner(prev.id) === id; // pindah antar panel split: keduanya tetap tampil
  if (prev && prev !== next) {
    prev.lastActive = Date.now(); // hitung "menganggur" sejak ditinggalkan
    if (!sameGroup) {
      detach(prev);
      const pp = tabs.get(splitPartner(prev.id));
      if (pp && pp.id !== id) detach(pp);
    }
  }
  shared.activeId = id;
  next.lastActive = Date.now();
  if (next.suspended) resume(next);
  shared.win.contentView.addChildView(next.view);
  try {
    next.view.setVisible(true);
  } catch {}
  if (next.devtools) shared.win.contentView.addChildView(next.devtools);
  // Pasangan split ikut dipasang (dibangunkan kalau sedang tidur)
  const mate = tabs.get(splitPartner(id));
  if (mate) {
    if (mate.suspended) resume(mate);
    if (mate.view) {
      shared.win.contentView.addChildView(mate.view);
      if (mate.devtools) shared.win.contentView.addChildView(mate.devtools);
    }
  }
  layout();
  // Tab Baru yang sudah terbuka: fokus ke address bar, bukan ke halamannya (yang tidak punya input)
  if (next.view.webContents.getURL() === NEWTAB_URL) focusAddress();
  else next.view.webContents.focus();
  pushTab(next);
  sendUI("tab:active", id);
  $linkstatus.hide();
  $toast.raise(); // view tab baru tidak boleh menutupi notifikasi
  $dialog.raise(); // ...maupun dialog yang sedang terbuka
  scheduleSave();
}

// Geser tab (drag di tab bar): urutan Map = urutan tab, dipakai Ctrl+Tab, tab tetangga saat menutup, dan sesi tersimpan
function moveTab(id, index) {
  if (!tabs.has(id) || !Number.isInteger(index)) return;
  const ids = [...tabs.keys()];
  const from = ids.indexOf(id);
  const to = Math.max(0, Math.min(index, ids.length - 1));
  if (from === to) return;
  ids.splice(to, 0, ids.splice(from, 1)[0]);
  const entries = ids.map((k) => [k, tabs.get(k)]);
  tabs.clear();
  for (const [k, v] of entries) tabs.set(k, v);
  scheduleSave();
}

function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  const ids = [...tabs.keys()];
  const idx = ids.indexOf(id);
  const wasActive = id === shared.activeId;
  // Menutup salah satu panel split membubarkan split; pasangannya jadi tab biasa
  const mateId = splitPartner(id);
  if (mateId != null) {
    shared.split = null;
    splitUiHide();
    const m = tabs.get(mateId);
    if (m) pushTab(m);
  }
  const dead = !tab.view || tab.view.webContents.isDestroyed();
  let closing = null;
  try {
    closing = dead ? null : tabState(tab);
  } catch {}
  if (closing && isWeb(closing.url)) {
    closedTabs.push(closing.url);
    if (closedTabs.length > 10) closedTabs.shift();
  }

  if ($ui.find.open && $ui.find.tabId === id) $ui.findClose(false);
  if (wasActive && tab.view) {
    try {
      shared.win.contentView.removeChildView(tab.view);
    } catch {}
  }
  dropDevtoolsView(tab);
  tabs.delete(id);
  sendUI("tab:closed", id);
  scheduleSave();
  if (tab.view && !tab.view.webContents.isDestroyed()) {
    try {
      tab.view.webContents.close();
    } catch {}
  }

  if (tabs.size === 0) {
    shared.win.close();
    return;
  }
  if (wasActive) {
    shared.activeId = null;
    activateTab(
      mateId != null && tabs.has(mateId)
        ? mateId
        : (ids[idx + 1] ?? ids[idx - 1]),
    );
  } else if (mateId != null) {
    layout(); // panel yang tersisa kembali memenuhi area halaman
  }
}

function cycleTab(dir) {
  const ids = [...tabs.keys()];
  if (ids.length < 2) return;
  const i = ids.indexOf(shared.activeId);
  activateTab(ids[(i + dir + ids.length) % ids.length]);
}

function reopenClosed() {
  const url = closedTabs.pop();
  if (url) createTab(url);
}

// Tab hasil pemulihan dibuat dalam keadaan tidur: baru dimuat saat dibuka (RAM hemat saat startup)
function createSuspendedTab({ u, t, f }) {
  const id = shared.nextId++;
  const snap = {
    id,
    url: u,
    title: t || u,
    loading: false,
    canGoBack: false,
    canGoForward: false,
  };
  const tab = {
    id,
    view: null,
    devtools: null,
    suspended: true,
    saved: { entries: [], index: 0, snap },
    lastActive: Date.now(),
    favicon: validFav(f) ? f : "",
    favOrigin: validFav(f) ? originOf(u) : "",
    errorUrl: "",
    restoring: false,
  };
  tabs.set(id, tab);
  sendUI("tab:created", tabState(tab));
  return id;
}

function startTabs() {
  const saved = config.restoreTabs ? shared.stores.session.tabs : [];
  if (saved.length) {
    const ids = saved.map(createSuspendedTab);
    activateTab(ids[Math.min(shared.stores.session.active, ids.length - 1)]);
  }
  const url = $main.urlFromArgs(process.argv);
  if (url) createTab(url);
  else if (!saved.length) createTab(NEWTAB_URL);
}

function saveSession() {
  if (
    shared.sessionLocked ||
    !shared.stores ||
    !shared.win ||
    shared.win.isDestroyed()
  )
    return;
  try {
    const list = [];
    let active = 0;
    for (const tab of tabs.values()) {
      const s = tabState(tab);
      if (!s || !isWeb(s.url)) continue;
      if (tab.id === shared.activeId) active = list.length;
      list.push({
        u: s.url,
        t: s.title,
        f: isWeb(tab.favicon) && tab.favicon.length <= 2048 ? tab.favicon : "",
      });
    }
    shared.stores.session.set(
      list,
      active,
      shared.win.isFullScreen() ? null : shared.win.getNormalBounds(),
      shared.win.isMaximized(),
    );
  } catch {}
}

function scheduleSave() {
  if (shared.saveTimer || shared.sessionLocked) return;
  shared.saveTimer = setTimeout(() => {
    shared.saveTimer = null;
    saveSession();
  }, 1000);
}

function reload(id) {
  const tab = tabs.get(id);
  const wc = tab?.view?.webContents;
  if (!wc) return;
  if (tab.errorUrl && wc.getURL().startsWith(ERROR_URL))
    wc.loadURL(tab.errorUrl).catch(() => {});
  else wc.reload();
}

// ---------------------------------------------------------------
// Hemat memori: tab latar belakang yang menganggur ditidurkan.
// WebContents-nya dihancurkan (RAM kembali), tapi judul, ikon, riwayat
// back/forward dan posisi scroll disimpan dan dipulihkan saat tab dibuka.
// ---------------------------------------------------------------
// Host yang tidak boleh ditidurkan (WhatsApp Web, Meet, dsb.): cocok dengan host itu sendiri dan subdomainnya
let neverSuspendSet = null;
function neverSuspendHost(url) {
  if (!neverSuspendSet) {
    const list = Array.isArray(config.tabSuspend.neverSuspend)
      ? config.tabSuspend.neverSuspend
      : [];
    neverSuspendSet = new Set(
      list.map((d) => String(d).trim().toLowerCase()).filter(Boolean),
    );
  }
  const host = $network.hostOf(url);
  return !!host && $network.inSet(neverSuspendSet, host);
}

function canSuspend(tab) {
  if (tab.id === shared.activeId || tab.suspended || !tab.view || tab.keepAlive)
    return false;
  // Panel split yang sedang tampil tidak boleh ditidurkan
  if (shared.split?.ids.includes(tab.id) && shared.split.ids.includes(shared.activeId))
    return false;
  const wc = tab.view.webContents;
  if (
    wc.isDestroyed() ||
    wc.isLoading() ||
    wc.isCurrentlyAudible() ||
    wc.isDevToolsOpened()
  )
    return false;
  const url = wc.getURL();
  return !url.startsWith(ERROR_URL) && !neverSuspendHost(url);
}

function suspend(tab) {
  const view = tab.view;
  const nav = view.webContents.navigationHistory;
  const snap = tabState(tab);
  tab.saved = {
    entries: nav.getAllEntries(),
    index: nav.getActiveIndex(),
    snap,
  };
  tab.suspended = true;
  tab.view = null;
  view.webContents.close();
  pushTab(tab);
}

function resume(tab) {
  const { entries, index, snap } = tab.saved;
  tab.saved = null;
  if (tab.resp) tab.resp.applied = ""; // WebContents baru: emulasi responsive dipasang ulang saat layout
  tab.suspended = false;
  tab.restoring = true; // jangan hitung pemulihan sebagai kunjungan baru
  buildView(tab);
  const wc = tab.view.webContents;
  wc.once("did-stop-loading", () => {
    tab.restoring = false;
  });
  const fallback = () => {
    tab.restoring = false;
    const url = snap.url ? toUrl(snap.url) : NEWTAB_URL;
    wc.loadURL(url).catch(() => {});
  };
  try {
    if (!entries.length) fallback();
    else wc.navigationHistory.restore({ index, entries }).catch(() => {});
  } catch {
    fallback();
  }
}

// RAM kosong di bawah ambang? (macOS dilewati: os.freemem() di sana tidak menghitung cache, jadi selalu tampak "rendah")
function memoryPressure() {
  const pct = Number(config.tabSuspend.lowMemory?.freePercent);
  if (!(pct > 0) || process.platform === "darwin") return false;
  return os.freemem() / os.totalmem() < pct / 100;
}

function suspendIdle(force) {
  if (force) {
    for (const tab of tabs.values()) if (canSuspend(tab)) suspend(tab);
    return;
  }
  const minutes = (n, fallback) => Math.max(1, Number(n) || fallback) * 60_000;
  const normal = minutes(config.tabSuspend.afterMinutes, 5);
  const pressure = memoryPressure();
  const limit = pressure
    ? Math.min(normal, minutes(config.tabSuspend.lowMemory?.afterMinutes, 1))
    : normal;
  const now = Date.now();
  const idle = [...tabs.values()].filter(
    (tab) => canSuspend(tab) && now - tab.lastActive >= limit,
  );
  if (pressure) {
    idle.sort((a, b) => a.lastActive - b.lastActive); // terlama dipakai lebih dulu
    idle.splice(2); // maks 2 tab per siklus
  }
  for (const tab of idle) suspend(tab);
}

// ---------------------------------------------------------------
// Bookmark, riwayat, menu
// ---------------------------------------------------------------
function toggleBookmark() {
  const tab = activeTab();
  const s = tab && tabState(tab);
  if (!s?.bookmarkable) return;
  shared.stores.bookmarks.toggle(s.url, s.title);
  pushTab(tab);
}

function openInternal(name) {
  $downloads.dlpHide();
  $ui.mpHide();
  const url = PAGES[name];
  for (const t of tabs.values()) {
    if (!t.suspended && t.view.webContents.getURL() === url)
      return activateTab(t.id);
  }
  const wc = activeWC();
  if (wc && wc.getURL() === NEWTAB_URL) wc.loadURL(url).catch(() => {});
  else createTab(url);
}

// Logo kecil di ujung kiri tab bar (branding): icon.ico di folder proyek, diperkecil jadi PNG
let logoCache;
function appLogo() {
  if (logoCache !== undefined) return logoCache;
  logoCache = "";
  try {
    const img = nativeImage.createFromPath(APP_ICON);
    if (!img.isEmpty())
      logoCache = img
        .resize({ width: 48, height: 48, quality: "best" })
        .toDataURL();
  } catch {}
  return logoCache;
}

// ---------------------------------------------------------------
// Zoom halaman: langkah preset seperti Chrome (25% ... 500%), Ctrl + roda mouse, Ctrl +/-/0, dan baris
// Zoom di menu titik tiga. Tingkat zoom diingat Chromium per situs selama Saya terbuka.
// ---------------------------------------------------------------
const ZOOMS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4,
  5,
];

function zoomStep(wc, dir) {
  if (!wc || wc.isDestroyed()) return;
  const cur = wc.getZoomFactor();
  const next =
    dir > 0
      ? ZOOMS.find((z) => z > cur + 0.001)
      : [...ZOOMS].reverse().find((z) => z < cur - 0.001);
  if (next) wc.setZoomFactor(next);
}

const zoomPercent = (wc) =>
  wc && !wc.isDestroyed() ? Math.round(wc.getZoomFactor() * 100) : 100;

Object.assign(module.exports, {
  activateTab,
  appLogo,
  closeTab,
  createTab,
  cycleTab,
  closeSplit,
  inSplit,
  makeSplit,
  splitPartner,
  openInSplit,
  splitWith,
  toggleSplit,
  focusAddress,
  identityFor,
  isViewable,
  layout,
  moveTab,
  openDevTools,
  openInternal,
  openLocalFile,
  refreshActive,
  reload,
  reopenClosed,
  respApply,
  rsp,
  saveSession,
  scheduleSave,
  setDarkWeb,
  startTabs,
  suspendIdle,
  tabByWcId,
  tabOf,
  toggleBookmark,
  toggleDevTools,
  toggleResponsive,
  zoomPercent,
  zoomStep,
});