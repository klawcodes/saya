// main-tabmenu.js — Menu klik kanan pada tab (sidebar, sidebar hover, dan top bar).
// Panel HTML (renderer/tabmenu.html) di atas halaman, polanya sama dengan menu titik tiga (main-ui.js).
// Isi menu mengikuti letak tab: sidebar = tab di atas / di bawah; top bar = tab di kiri / di kanan.

const { WebContentsView, ipcMain, screen } = require("electron");
const path = require("path");
const {
  NEWTAB_URL,
  RENDERER_DIR,
  activeWC,
  onUI,
  shared,
  tabLayout,
  tabs,
} = require("./main-core");

// Modul lain diambil lambat (hindari require melingkar)
const $tabs = () => require("./main-tabs");
const $ui = () => require("./main-ui");
const $downloads = () => require("./main-downloads");

const MENU_W = 244;
const tm = {
  view: null,
  ready: false,
  open: false,
  shown: false,
  tabId: 0,
  items: [],
  anchor: { x: 0, y: 0 },
  height: 0,
  hiddenAt: 0,
  destroyTimer: null,
  revealTimer: null,
  resizeHooked: false,
};

// Urutan Map `tabs` = urutan tab yang terlihat (moveTab mengubahnya), jadi tetangga ditentukan dari sini
const order = () => [...tabs.keys()];

function buildItems(id) {
  const ids = order();
  const i = ids.indexOf(id);
  if (i < 0) return [];
  const top = tabLayout() === "top";
  const prev = ids[i - 1];
  const next = ids[i + 1];
  const partner = $tabs().splitPartner(id); // tab yang sudah berpasangan dengan tab ini (atau null)
  const items = [];
  if (prev != null && prev !== partner)
    items.push({
      id: "split-prev",
      icon: top ? "splitl" : "splitu",
      label: top ? "Split with tab on the left" : "Split with tab above",
    });
  if (next != null && next !== partner)
    items.push({
      id: "split-next",
      icon: top ? "splitr" : "splitd",
      label: top ? "Split with tab on the right" : "Split with tab below",
    });
  if (partner != null)
    items.push({ id: "split-close", icon: "unsplit", label: "Close split view" });
  if (items.length) items.push({ sep: true });
  items.push({ id: "close", icon: "close", label: "Close tab" });
  if (next != null)
    items.push(
      top
        ? { id: "close-after", icon: "after", label: "Close tabs to the right" }
        : { id: "close-after", icon: "below", label: "Close tabs below" },
    );
  if (ids.length > 1)
    items.push({ sep: true }, { id: "close-all", icon: "all", label: "Close all tabs", danger: true });
  return items;
}

// Tutup banyak tab sekaligus tanpa mengganggu tab lain. `keep` = tab yang jadi aktif kalau tab aktif ikut tertutup.
function closeMany(victims, keep) {
  const T = $tabs();
  if (keep != null && victims.includes(shared.activeId) && tabs.has(keep)) T.activateTab(keep);
  for (const v of victims) if (tabs.has(v)) T.closeTab(v);
}

function run(act, id) {
  const T = $tabs();
  const ids = order();
  const i = ids.indexOf(id);
  if (i < 0) return; // tabnya sudah hilang
  if (act === "split-prev") {
    const n = ids[i - 1];
    if (n != null) T.makeSplit(n, id); // tetangga di panel kiri, tab ini di kanan (aktif)
  } else if (act === "split-next") {
    const n = ids[i + 1];
    if (n != null) {
      T.makeSplit(id, n); // tab ini di panel kiri, tetangga di kanan
      T.activateTab(id); // yang aktif tetap tab yang diklik
    }
  } else if (act === "split-close") {
    if (T.inSplit(id)) T.closeSplit();
  } else if (act === "close") {
    T.closeTab(id);
  } else if (act === "close-after") {
    closeMany(ids.slice(i + 1), id);
  } else if (act === "close-all") {
    // Jendela tidak ikut tertutup: satu Tab Baru dibuat lebih dulu, lalu semua tab lama ditutup
    T.createTab(NEWTAB_URL);
    closeMany(ids, null);
  }
}

// ---------------------------------------------------------------
// View
// ---------------------------------------------------------------
function ensureView() {
  clearTimeout(tm.destroyTimer);
  if (tm.view && !tm.view.webContents.isDestroyed()) return tm.view;
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "tabmenupreload.js"),
    },
  });
  view.setBackgroundColor("#1c1c22");
  try {
    view.setBorderRadius(13);
  } catch {}
  view.setVisible(false);
  const wc = view.webContents;
  wc.on("will-navigate", (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  // Klik di luar menu = menu kehilangan fokus = tutup
  wc.on("blur", () => {
    if (tm.view === view && tm.open) hide();
  });
  wc.once("did-finish-load", () => {
    if (tm.view !== view) return;
    tm.ready = true;
    if (tm.open) paint();
  });
  wc.on("did-fail-load", (_e, code, desc) => {
    console.warn("[tabmenu] gagal memuat tabmenu.html:", code, desc);
  });
  wc.on("preload-error", (_e, p, err) => {
    console.warn("[tabmenu] preload error:", p, err?.message || err);
  });
  wc.loadFile(path.join(RENDERER_DIR, "tabmenu.html")).catch((err) => {
    console.warn("[tabmenu] loadFile gagal:", err.message);
  });
  shared.win.contentView.addChildView(view);
  tm.view = view;
  tm.ready = false;
  return view;
}

function paint() {
  const wc = tm.view?.webContents;
  if (!tm.ready || !wc || wc.isDestroyed()) return;
  wc.send("tabmenu:render", { items: tm.items });
}

function layout() {
  if (!tm.view || !tm.open || !shared.win || shared.win.isDestroyed()) return;
  const [w, h] = shared.win.getContentSize();
  const width = Math.min(MENU_W, w - 16);
  const height = Math.max(40, Math.min(tm.height || 200, h - 16));
  const x = Math.max(8, Math.min(Math.round(tm.anchor.x), w - width - 8));
  // Tidak muat di bawah kursor: buka ke atas
  let y = Math.round(tm.anchor.y);
  if (y + height > h - 8) y = Math.max(8, y - height);
  tm.view.setBounds({ x, y, width, height });
}

// Tampilkan panel. Dipanggil saat tabmenu.js melaporkan tinggi isi, atau oleh timer cadangan di bawah.
function reveal() {
  if (!tm.open || tm.shown || !tm.view || tm.view.webContents.isDestroyed()) return;
  tm.shown = true;
  layout();
  tm.view.setVisible(true);
  tm.view.webContents.focus();
}

// Perkiraan tinggi kalau laporan ukuran dari tabmenu.js tidak pernah datang
const estimateHeight = (items) =>
  14 + items.reduce((n, it) => n + (it.sep ? 11 : 36), 0);

function open(tabId) {
  if (!shared.win || shared.win.isDestroyed()) return;
  const id = Number(tabId);
  if (!tabs.has(id)) return;
  const items = buildItems(id);
  if (!items.length) return;
  try {
    $ui().sgHide();
    $ui().mpHide();
    $downloads().dlpHide();
  } catch {}
  // Posisi = tempat kursor berada saat klik kanan (sama untuk sidebar, overlay hover, dan top bar)
  const p = screen.getCursorScreenPoint();
  const b = shared.win.getContentBounds();
  tm.anchor = { x: p.x - b.x, y: p.y - b.y };
  tm.tabId = id;
  tm.items = items;
  tm.open = true;
  tm.shown = false;
  tm.height = 0; // tinggi tergantung isi; menunggu laporan tabmenu.js supaya tidak berkedip
  const view = ensureView();
  view.setVisible(false);
  shared.win.contentView.addChildView(view); // naik ke lapisan paling atas
  if (!tm.resizeHooked) {
    tm.resizeHooked = true;
    shared.win.on("resize", () => hide());
  }
  paint();
  // Cadangan: view yang tersembunyi bisa menunda laporan ukuran, jadi tampilkan sendiri kalau terlalu lama
  clearTimeout(tm.revealTimer);
  tm.revealTimer = setTimeout(() => {
    if (!tm.open || tm.shown) return;
    if (!tm.height) tm.height = estimateHeight(tm.items);
    reveal();
  }, 350);
}

function hide(refocusPage = false) {
  if (!tm.open) return;
  tm.open = false;
  tm.shown = false;
  tm.hiddenAt = Date.now();
  clearTimeout(tm.revealTimer);
  tm.view?.setVisible(false);
  clearTimeout(tm.destroyTimer);
  tm.destroyTimer = setTimeout(destroy, 30_000);
  if (refocusPage) {
    const wc = activeWC();
    if (wc && !wc.isDestroyed()) wc.focus();
  }
}

function destroy() {
  const view = tm.view;
  if (!view || tm.open) return;
  tm.view = null;
  tm.ready = false;
  try {
    shared.win?.contentView.removeChildView(view);
  } catch {}
  if (!view.webContents.isDestroyed()) view.webContents.close();
}

const fromView = (e) =>
  !!tm.view && !tm.view.webContents.isDestroyed() && e.sender === tm.view.webContents;

ipcMain.on("tabmenu:size", (e, h) => {
  if (!fromView(e) || !tm.open || !(h > 0)) return;
  tm.height = Math.ceil(h);
  if (tm.shown) layout();
  else reveal();
});
ipcMain.on("tabmenu:act", (e, act) => {
  if (!fromView(e) || !tm.open) return;
  const id = tm.tabId;
  const allowed = tm.items.some((it) => it.id && it.id === act);
  hide(true);
  if (allowed) run(String(act), id);
});
ipcMain.on("tabmenu:close", (e) => {
  if (fromView(e)) hide(true);
});

// Klik kanan di tab pada index.html (sidebar yang di-pin / top bar)
onUI("tabmenu:open", (id) => {
  // Klik kanan saat menu lain masih terbuka: blur sudah menutupnya, buka yang baru
  open(id);
});

module.exports = { open, hide, isOpen: () => tm.open };
