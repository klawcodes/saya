// main-ui.js — Panel menu titik tiga, menu situs, menu klik kanan, shortcut keyboard,
// dropdown saran address bar, dan Cari di halaman (Ctrl+F).

const { app, WebContentsView, ipcMain, Menu, screen, shell, clipboard, net } = require("electron");
const path = require("path");
const { isWeb } = require("./store");
const {
  BG,
  CHROME_H,
  FRAME_PAD,
  NEWTAB_URL,
  SIDEBAR_COL,
  SIDEBAR_LABEL_MIN,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  SIDEBAR_W,
  TABBAR_H,
  TOOLBAR_H,
  topH,
  handleInternal,
  clampSbW,
  sidebarCol,
  sidebarOpen,
  sidebarW,
  tabLayout,
  tabState,
  writeSettings,
  RENDERER_DIR,
  activeTab,
  activeWC,
  closedTabs,
  config,
  engine,
  engines,
  onUI,
  searchUrl,
  sendUI,
  shared,
  tabs,
  toUrl,
} = require("./main-core");
const $dialog = require("./main-dialog");
const $downloads = require("./main-downloads");
const $network = require("./main-network");
const $tabmenu = require("./main-tabmenu");
const $tabs = require("./main-tabs");

// ---------------------------------------------------------------
// Menu titik tiga: panel HTML (bukan menu native) supaya bisa memuat baris Zoom dengan tombol - / +
// yang tidak menutup menu, seperti Chrome. Polanya sama dengan panel unduhan.
// ---------------------------------------------------------------
const MENU_W = 300;
const mp = {
  view: null,
  ready: false, // menu.html sudah selesai dimuat
  open: false,
  shown: false, // view sudah ditampilkan (setelah tinggi isi diketahui)
  rect: null, // posisi tombol menu {right, bottom}
  height: 0, // tinggi isi yang dilaporkan menu.js (0 = belum diketahui)
  hiddenAt: 0,
  destroyTimer: null,
};

function mpModel() {
  const sleeping = [...tabs.values()].filter((t) => t.suspended).length;
  return {
    zoom: $tabs.zoomPercent(activeWC()),
    items: [
      { id: "newtab", icon: "newtab", label: "New tab", accel: "Ctrl+T" },
      { sep: true },
      { id: "history", icon: "history", label: "History", accel: "Ctrl+H" },
      {
        id: "bookmarks",
        icon: "star",
        label: "Bookmarks",
        accel: "Ctrl+Shift+O",
      },
      {
        id: "downloads",
        icon: "download",
        label: "Downloads",
        accel: "Ctrl+J",
      },
      { id: "dlfolder", icon: "folder", label: "Downloads folder" },
      {
        id: "reopen",
        icon: "reopen",
        label: "Reopen closed tab",
        accel: "Ctrl+Shift+T",
        disabled: closedTabs.length === 0,
      },
      { sep: true },
      { theme: true, on: config.darkWeb !== false },
      { zoom: true },
      { sep: true },
      {
        id: "split",
        icon: "sliders",
        label: $tabs.inSplit(shared.activeId) ? "Close split view" : "Split view",
        accel: "Ctrl+\\",
      },
      { id: "sleep", icon: "moon", label: "Sleep background tabs" },
      { info: true, label: `${sleeping} tab(s) sleeping` },
      { sep: true },
      { id: "perms", icon: "shield", label: "Reset site permissions" },
      { sep: true },
      {
        id: "layout",
        icon: "sliders",
        label: tabLayout() === "top" ? "Move tabs to sidebar" : "Move tabs to top bar",
      },
      { id: "settings", icon: "sliders", label: "Settings" },
      { id: "about", icon: "info", label: "About Saya" },
      { id: "credits", icon: "heart", label: "Credits" },
    ],
  };
}

const MENU_ACTIONS = {
  newtab: () => $tabs.createTab(NEWTAB_URL),
  history: () => $tabs.openInternal("history"),
  bookmarks: () => $tabs.openInternal("bookmarks"),
  downloads: () => $tabs.openInternal("downloads"),
  dlfolder: () => shell.openPath(app.getPath("downloads")),
  reopen: () => $tabs.reopenClosed(),
  split: () => $tabs.toggleSplit(),
  sleep: () => $tabs.suspendIdle(true),
  perms: () => shared.stores.permissions.clear(),
  settings: () => $tabs.openInternal("settings"),
  layout: () => setTabLayout(tabLayout() === "top" ? "sidebar" : "top"),
  about: () => $tabs.openInternal("about"),
  credits: () => $tabs.openInternal("credits"),
};

function mpView() {
  clearTimeout(mp.destroyTimer);
  if (mp.view) return mp.view;
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "menupreload.js"),
    },
  });
  view.setBackgroundColor("#1c1c22");
  try {
    view.setBorderRadius(13);
  } catch {}
  view.setVisible(false);
  const wc = view.webContents;
  wc.on("before-input-event", handleShortcut); // Ctrl+T dst. tetap jalan saat fokus di menu
  wc.on("will-navigate", (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  // Klik di luar menu (halaman / toolbar) = menu kehilangan fokus = tutup
  wc.on("blur", () => {
    if (mp.view === view && mp.open) mpHide();
  });
  wc.once("did-finish-load", () => {
    if (mp.view !== view) return;
    mp.ready = true;
    if (mp.open) mpPaint();
  });
  wc.loadFile(path.join(RENDERER_DIR, "menu.html")).catch(() => {});
  shared.win.contentView.addChildView(view);
  mp.view = view;
  mp.ready = false;
  return view;
}

function mpPaint() {
  const wc = mp.view?.webContents;
  if (!mp.ready || !wc || wc.isDestroyed()) return;
  wc.send("menu:render", mpModel());
}

function mpLayout() {
  if (!mp.view || !mp.open || !shared.win || shared.win.isDestroyed()) return;
  const [w, h] = shared.win.getContentSize();
  const y = Math.round(mp.rect?.bottom ?? CHROME_H - 6) + 6;
  const width = Math.min(MENU_W, w - 16);
  const height = Math.max(120, Math.min(mp.height || 480, h - y - 8));
  const right = mp.rect?.right ?? w - 8;
  const x = Math.max(8, Math.min(Math.round(right - width + 6), w - width - 8));
  mp.view.setBounds({ x, y, width, height });
}

function mpShow(rect) {
  if (!shared.win || shared.win.isDestroyed()) return;
  sgHide();
  $downloads.dlpHide();
  const r = rect && typeof rect === "object" ? rect : mp.rect || {};
  mp.rect = {
    right: Number(r.right) || shared.win.getContentSize()[0] - 8,
    bottom: Number(r.bottom) || CHROME_H - 6,
  };
  mp.open = true;
  const view = mpView();
  mpLayout();
  shared.win.contentView.addChildView(view); // dipasang ulang = naik ke lapisan paling atas
  // Pertama kali: tunggu menu.js melaporkan tingginya (menu:size) supaya tidak berkedip.
  // Berikutnya (view dipakai ulang): tinggi sudah diketahui, tampilkan langsung.
  if (mp.ready && mp.height) {
    mp.shown = true;
    view.setVisible(true);
    view.webContents.focus();
  }
  mpPaint();
}

function mpHide(refocusPage = false) {
  if (!mp.open) return;
  mp.open = false;
  mp.shown = false;
  mp.hiddenAt = Date.now();
  mp.view?.setVisible(false);
  clearTimeout(mp.destroyTimer);
  mp.destroyTimer = setTimeout(mpDestroy, 30_000);
  if (refocusPage) activeWC()?.focus();
}

function mpDestroy() {
  const view = mp.view;
  if (!view || mp.open) return;
  mp.view = null;
  mp.ready = false;
  mp.height = 0;
  try {
    shared.win?.contentView.removeChildView(view);
  } catch {}
  if (!view.webContents.isDestroyed()) view.webContents.close();
}

function mpToggle(rect) {
  if (mp.open) return mpHide();
  // klik pada tombol saat menu terbuka: blur sudah menutupnya lebih dulu, jangan dibuka lagi
  if (Date.now() - mp.hiddenAt < 300) return;
  mpShow(rect);
}

function mpAct(id) {
  const wc = activeWC();
  if (id === "zoom:in" || id === "zoom:out") {
    $tabs.zoomStep(wc, id === "zoom:in" ? 1 : -1);
    return mpPaint(); // menu tetap terbuka supaya bisa ditekan berulang
  }
  if (id === "theme:toggle") {
    $tabs.setDarkWeb(config.darkWeb === false);
    return mpPaint(); // menu tetap terbuka supaya hasilnya langsung kelihatan di halaman
  }
  if (id === "zoom:reset") {
    if (wc && !wc.isDestroyed()) wc.setZoomFactor(1);
    return mpPaint();
  }
  if (id === "fullscreen") {
    mpHide();
    if (shared.win && !shared.win.isDestroyed()) shared.win.setFullScreen(!shared.win.isFullScreen());
    return;
  }
  const fn = MENU_ACTIONS[id];
  if (!fn) return;
  mpHide();
  fn();
}

const fromMp = (e) =>
  !!mp.view &&
  !mp.view.webContents.isDestroyed() &&
  e.sender === mp.view.webContents;

ipcMain.on("menu:act", (e, id) => {
  if (fromMp(e)) mpAct(String(id || ""));
});
ipcMain.on("menu:size", (e, h) => {
  if (!fromMp(e) || !(h > 0)) return;
  mp.height = Math.ceil(h);
  mpLayout();
  if (mp.open && !mp.shown) {
    mp.shown = true;
    mp.view.setVisible(true);
    mp.view.webContents.focus();
  }
});
ipcMain.on("menu:close", (e) => {
  if (fromMp(e)) mpHide(true);
});

// Info & izin situs (tombol di address bar): atur izin per situs tanpa harus mereset semuanya
const SITE_PERMS = [
  ["media:audio", "Microphone"],
  ["media:video", "Camera"],
  ["geolocation", "Location"],
  ["clipboard-read", "Clipboard contents"],
];

// Panel izin situs kustom (main-dialog.js): status Ask / Allow / Block per izin, reset, jeda ad blocker.
function showSiteMenu() {
  sgHide();
  const wc = activeWC();
  const origin = $network.originOf(wc?.getURL());
  if (!origin) return;
  $dialog.site({ origin });
}

// Klik kanan di halaman web
function showContextMenu(wc, p) {
  const groups = [];
  const sel = (p.selectionText || "").trim();

  if (p.linkURL && isWeb(p.linkURL)) {
    groups.push([
      { label: "Open link in new tab", click: () => $tabs.createTab(p.linkURL) },
      {
        label: "Open link in split view",
        click: () => $tabs.openInSplit(p.linkURL),
      },
      {
        label: "Copy link address",
        click: () => clipboard.writeText(p.linkURL),
      },
    ]);
  }
  if (p.mediaType === "image") {
    const web = isWeb(p.srcURL); // gambar blob:/data:/file: tetap bisa disalin
    const g = [];
    if (web) {
      g.push(
        { label: "Open image in new tab", click: () => $tabs.createTab(p.srcURL) },
        { label: "Save image", click: () => wc.downloadURL(p.srcURL) },
      );
    }
    g.push({ label: "Copy image", click: () => wc.copyImageAt(p.x, p.y) });
    if (web)
      g.push({
        label: "Copy image address",
        click: () => clipboard.writeText(p.srcURL),
      });
    groups.push(g);
  }
  if (p.isEditable) {
    const f = p.editFlags;
    groups.push([
      { role: "undo", label: "Undo", enabled: f.canUndo },
      { role: "redo", label: "Redo", enabled: f.canRedo },
    ]);
    groups.push([
      { role: "cut", label: "Cut", enabled: f.canCut },
      { role: "copy", label: "Copy", enabled: f.canCopy },
      { role: "paste", label: "Paste", enabled: f.canPaste },
      { role: "selectAll", label: "Select all", enabled: f.canSelectAll },
    ]);
  } else if (sel) {
    const short = sel.length > 30 ? sel.slice(0, 30) + "…" : sel;
    groups.push([
      { role: "copy", label: "Copy" },
      {
        label: `Search the web for “${short}”`,
        click: () => $tabs.createTab(searchUrl(sel)),
      },
    ]);
  }
  if (!p.isEditable && !sel && !p.linkURL) {
    groups.push([
      {
        label: "Back",
        enabled: wc.navigationHistory.canGoBack(),
        click: () => wc.navigationHistory.goBack(),
      },
      {
        label: "Forward",
        enabled: wc.navigationHistory.canGoForward(),
        click: () => wc.navigationHistory.goForward(),
      },
      { label: "Reload", click: () => $tabs.reload(shared.activeId) },
    ]);
  }
  if (shared.blocker && isWeb(wc.getURL())) {
    const site = $network.siteKey(wc.getURL());
    const group = [];
    if (shared.adblockOn && !$network.isSitePaused(wc.getURL())) {
      group.push(
        {
          label: "Block this element",
          click: () => $network.blockElement(wc, p.x, p.y, false),
        },
        {
          label: "Block similar banners",
          click: () => $network.blockElement(wc, p.x, p.y, true),
        },
      );
    }
    group.push({
      label: $network.isSitePaused(wc.getURL())
        ? `Resume ad blocker on ${site}`
        : `Pause ad blocker on ${site}`,
      click: () => {
        $network.togglePause(wc.getURL());
        wc.reload();
      },
    });
    groups.push(group);
  }
  groups.push([
    {
      label: "Inspect",
      click: () => {
        const tab = $tabs.tabOf(wc);
        if (tab && !tab.devtools) $tabs.openDevTools(tab);
        wc.inspectElement(p.x, p.y);
      },
    },
  ]);

  const template = [];
  groups.forEach((g, i) => {
    if (i) template.push({ type: "separator" });
    template.push(...g);
  });
  Menu.buildFromTemplate(template).popup({ window: shared.win });
}

function handleShortcut(event, input) {
  if (input.type !== "keyDown") return;
  const ctrl = input.control || input.meta;
  const key = input.key.toLowerCase();
  const wc = activeWC();
  let handled = true;

  if (ctrl && input.shift && key === "t") $tabs.reopenClosed();
  else if (ctrl && input.shift && key === "b") toggleSidebar();
  else if (ctrl && key === "t") $tabs.createTab(NEWTAB_URL);
  else if (ctrl && key === "w") $tabs.closeTab(shared.activeId);
  else if (ctrl && key === "l") $tabs.focusAddress();
  else if (ctrl && key === "p") wc?.print();
  else if (ctrl && key === "d") $tabs.toggleBookmark();
  else if (ctrl && key === "h") $tabs.openInternal("history");
  else if (ctrl && !input.shift && key === "j") $tabs.openInternal("downloads");
  else if (ctrl && input.shift && key === "o") $tabs.openInternal("bookmarks");
  else if (ctrl && key === "e") cycleEngine(input.shift ? -1 : 1);
  else if (
    input.alt &&
    !ctrl &&
    /^[1-9]$/.test(key) &&
    engines[Number(key) - 1]
  )
    setEngine(Number(key) - 1, { fresh: !sg.editing, refocus: sg.editing });
  else if (key === "f5" || (ctrl && key === "r")) $tabs.reload(shared.activeId);
  else if (input.alt && key === "arrowleft") {
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  } else if (input.alt && key === "arrowright") {
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  } else if (ctrl && key === "tab") $tabs.cycleTab(input.shift ? -1 : 1);
  else if (ctrl && input.shift && key === "m") $tabs.toggleResponsive();
  else if (key === "f12" || (ctrl && input.shift && key === "i"))
    $tabs.toggleDevTools();
  else if (ctrl && !input.shift && key === "f") findOpen();
  else if (find.open && key === "escape" && !sg.editing) findClose();
  else if (find.open && key === "f3") findRun(find.text, !input.shift);
  else if (ctrl && (key === "=" || key === "+")) $tabs.zoomStep(wc, 1);
  else if (ctrl && key === "-") $tabs.zoomStep(wc, -1);
  else if (ctrl && key === "0") wc?.setZoomFactor(1);
  else if (ctrl && !input.shift && key === "\\") $tabs.toggleSplit();
  else if (key === "f11") shared.win.setFullScreen(!shared.win.isFullScreen());
  else handled = false;

  if (handled) event.preventDefault();
}

// ---------------------------------------------------------------
// Command palette (pengganti dropdown saran di address bar) + mesin pencari.
// Ketikan terjadi di dalam palette sendiri (suggest.html), bukan di toolbar. Palette = WebContentsView
// di tengah jendela, karena view halaman web menutupi UI browser (HTML di index.html tidak bisa tampil
// di atasnya). View dibuat saat dipakai dan dibuang 30 detik setelah ditutup supaya tidak memakan RAM.
// ---------------------------------------------------------------
const PAL_W = 620;
const PAL_MAX_H = 460;
const SG_MAX = 12;
const sg = {
  view: null,
  ready: false, // suggest.html sudah selesai dimuat
  open: false,
  shown: false, // view sudah ditampilkan (setelah tinggi isi diketahui)
  editing: false, // sama dengan open; dipertahankan karena dipakai handleShortcut/setEngine
  base: [], // baris pertama + tab + riwayat/bookmark + aksi
  items: [], // base + saran dari mesin pencari
  typed: "",
  init: { text: "", select: false },
  height: 0,
  seq: 0,
  abort: null,
  debounce: null,
  destroyTimer: null,
  revealTimer: null,
  shownAt: 0,
  hiddenAt: 0,
};

const hostOf = (u) => {
  try {
    return new URL(u).host.replace(/^www\./, "") || u;
  } catch {
    return u;
  }
};
const safeFav = (f) =>
  typeof f === "string" && /^(https?:|data:image\/)/i.test(f) ? f : "";

function navigateActive(url) {
  const tab = activeTab();
  if (!tab?.view) return;
  tab.errorUrl = "";
  tab.view.webContents.loadURL(url).catch(() => {});
  tab.view.webContents.focus();
}

const PAL_ACTIONS = [
  { id: "newtab", title: "New Tab", sub: "Ctrl+T", icon: "plus" },
  { id: "reopen", title: "Reopen Closed Tab", sub: "Ctrl+Shift+T", icon: "reopen" },
  { id: "sidebar", title: "Toggle Sidebar", sub: "Ctrl+Shift+B", icon: "sidebar" },
  { id: "history", title: "History", sub: "Ctrl+H", icon: "clock" },
  { id: "bookmarks", title: "Bookmarks", sub: "Ctrl+Shift+O", icon: "star" },
  { id: "downloads", title: "Downloads", sub: "Ctrl+J", icon: "download" },
  { id: "split", title: "Split View", sub: "Ctrl+\\", icon: "sidebar" },
  { id: "layout", title: "Switch Tab Layout", sub: "", icon: "sidebar" },
  { id: "settings", title: "Settings", sub: "", icon: "sliders" },
];
const PAL_RUN = {
  newtab: () => $tabs.createTab(NEWTAB_URL),
  reopen: () => $tabs.reopenClosed(),
  sidebar: () => toggleSidebar(),
  history: () => $tabs.openInternal("history"),
  bookmarks: () => $tabs.openInternal("bookmarks"),
  downloads: () => $tabs.openInternal("downloads"),
  settings: () => $tabs.openInternal("settings"),
  split: () => $tabs.toggleSplit(),
  layout: () => setTabLayout(tabLayout() === "top" ? "sidebar" : "top"),
};

// Tab terbuka (selain tab aktif & Tab Baru kosong), yang terbaru dipakai di atas
function tabItems(q, limit) {
  const needle = q.toLowerCase();
  const out = [];
  const list = [...tabs.values()]
    .filter((t) => t.id !== shared.activeId)
    .sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0));
  for (const t of list) {
    let s;
    try {
      s = tabState(t);
    } catch {
      continue;
    }
    if (!s?.url) continue;
    if (
      needle &&
      !s.url.toLowerCase().includes(needle) &&
      !(s.title || "").toLowerCase().includes(needle)
    )
      continue;
    out.push({
      kind: "tab",
      icon: "tab",
      tabId: t.id,
      favicon: safeFav(s.favicon || t.favicon),
      title: s.title || s.url,
      sub: hostOf(s.url),
      sec: needle ? "Open Tabs" : "Recent Tabs",
      hint: "Switch to Tab",
    });
    if (out.length >= limit) break;
  }
  return out;
}

function actionItems(q) {
  const n = q.toLowerCase();
  let list = PAL_ACTIONS.filter(
    (a) =>
      (a.id !== "reopen" || closedTabs.length) &&
      (a.id !== "sidebar" || tabLayout() === "sidebar"),
  ).map((a) =>
    a.id === "layout"
      ? { ...a, title: tabLayout() === "top" ? "Move Tabs to Sidebar" : "Move Tabs to Top Bar" }
      : a.id === "split"
        ? { ...a, title: $tabs.inSplit(shared.activeId) ? "Close Split View" : "Split View" }
        : a,
  );
  if (n) list = list.filter((a) => a.title.toLowerCase().includes(n)).slice(0, 3);
  return list.map((a) => ({
    kind: "action",
    id: a.id,
    icon: a.icon,
    title: a.title,
    sub: a.sub,
    sec: n ? "Actions" : "Quick Actions",
    hint: "Run",
  }));
}

function setEngine(i, opts = {}) {
  shared.engineIdx = ((i % engines.length) + engines.length) % engines.length;
  shared.stores?.session.setEngine(engine().id);
  sendUI("engine:changed", { name: engine().name });
  if (sg.open) {
    sgQuery(sg.typed, false); // "Search with ..." ikut berubah
    sg.view?.webContents.focus();
  } else if (opts.fresh) {
    paletteOpen("", false);
  }
}
const cycleEngine = (dir) =>
  setEngine(shared.engineIdx + dir, { fresh: !sg.editing });

function sgView() {
  clearTimeout(sg.destroyTimer);
  if (sg.view) return sg.view;
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "suggestpreload.js"),
    },
  });
  view.setBackgroundColor("#1c1c22");
  try {
    view.setBorderRadius(16);
  } catch {}
  view.setVisible(false);
  const wc = view.webContents;
  wc.on("before-input-event", handleShortcut); // Ctrl+E, Alt+1..9, dst. tetap jalan saat fokus di palette
  wc.on("will-navigate", (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  // Klik di luar palette (halaman / toolbar / sidebar) = palette kehilangan fokus = tutup
  wc.on("blur", () => {
    if (sg.view === view && sg.open && Date.now() - sg.shownAt > 250) sgHide();
  });
  wc.once("did-finish-load", () => {
    if (sg.view !== view) return;
    sg.ready = true;
    if (sg.open) {
      sgSendShow();
      sgPaint(true);
    }
  });
  wc.loadFile(path.join(RENDERER_DIR, "suggest.html")).catch(() => {});
  shared.win.contentView.addChildView(view);
  sg.view = view;
  sg.ready = false;
  sg.height = 0;
  return view;
}

function sgSendShow() {
  const wc = sg.view?.webContents;
  if (!sg.ready || !wc || wc.isDestroyed()) return;
  wc.send("suggest:show", sg.init);
}

function sgPaint(reset = true) {
  const wc = sg.view?.webContents;
  if (!sg.ready || !wc || wc.isDestroyed()) return;
  wc.send("suggest:render", {
    items: sg.items,
    typed: sg.typed.trim(),
    reset,
    engines: engines.map((e) => ({ id: e.id, name: e.name })),
    current: engine().id,
    placeholder: `Search with ${engine().name} or enter address`,
  });
}

function sgLayout() {
  if (!sg.view || !shared.win || shared.win.isDestroyed()) return;
  const [w, h] = shared.win.getContentSize();
  const width = Math.max(240, Math.min(PAL_W, w - 32));
  const y = Math.round(Math.max(40, h * 0.12));
  const height = Math.max(
    100,
    Math.min(sg.height || 300, PAL_MAX_H, h - y - 16),
  );
  sg.view.setBounds({ x: Math.round((w - width) / 2), y, width, height });
}

function sgReveal() {
  if (!sg.open || !sg.view || sg.shown) return;
  sg.shown = true;
  sg.shownAt = Date.now();
  sgLayout();
  sg.view.setVisible(true);
  sg.view.webContents.focus();
}

// text = isi awal kotak ketik; select = pilih semua teks (Ctrl+L / klik URL di toolbar)
function paletteOpen(text = "", select = false) {
  if (!shared.win || shared.win.isDestroyed()) return;
  mpHide();
  $downloads.dlpHide();
  clearTimeout(sg.destroyTimer);
  clearTimeout(sg.revealTimer);
  const view = sgView();
  sg.init = { text: String(text ?? "").slice(0, 2000), select: !!select };
  sg.open = true;
  sg.editing = true;
  shared.win.contentView.addChildView(view); // dipasang ulang = naik ke lapisan paling atas
  sgQuery(sg.init.text, true);
  sgSendShow();
  // Tampilkan setelah isi dirender dan tingginya diketahui (suggest:size); cadangan kalau tidak datang
  sg.revealTimer = setTimeout(() => {
    if (sg.open && !sg.shown) sgReveal();
  }, 450);
}

// Ketikan dari halaman Tab Baru (sebelum fokus pindah ke palette): ditambahkan berurutan, tidak ada huruf yang hilang
function paletteType(text) {
  const t = String(text ?? "");
  if (!t) return;
  if (!sg.open) return paletteOpen(t, false);
  sg.init = { text: (sg.init.text + t).slice(0, 2000), select: false };
  sgQuery(sg.init.text, true);
  sgSendShow();
}

function sgDestroy() {
  const view = sg.view;
  if (!view || sg.open) return;
  sg.view = null;
  sg.ready = false;
  sg.height = 0;
  try {
    shared.win?.contentView.removeChildView(view);
  } catch {}
  if (!view.webContents.isDestroyed()) view.webContents.close();
}

// Catatan: dipasang juga sebagai listener resize/move (argumen pertama = event), jadi refocus harus persis true
function sgHide(refocusPage = false) {
  if (!sg.open && !sg.view) return;
  clearTimeout(sg.debounce);
  clearTimeout(sg.revealTimer);
  sg.seq++;
  sg.abort?.abort();
  if (sg.open) sg.hiddenAt = Date.now();
  sg.open = false;
  sg.editing = false;
  sg.shown = false;
  if (sg.view) sg.view.setVisible(false);
  sg.items = [];
  sg.base = [];
  clearTimeout(sg.destroyTimer);
  sg.destroyTimer = setTimeout(sgDestroy, 30_000);
  if (refocusPage === true) activeWC()?.focus();
}

// Bookmark dulu (maks 2), lalu riwayat; total maks 4 baris
function sgLocal(q) {
  const needle = q.toLowerCase();
  const out = [];
  const seen = new Set();
  const add = (u, t, icon) => {
    if (seen.has(u) || out.length >= 4) return;
    seen.add(u);
    out.push({
      kind: "url",
      icon,
      text: u,
      url: u,
      title: t || u,
      sub: u.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, ""),
      sec: "History & Bookmarks",
      hint: "Open",
    });
  };
  for (const b of shared.stores.bookmarks.items) {
    if (out.length >= 2) break;
    if (
      b.u.toLowerCase().includes(needle) ||
      (b.t || "").toLowerCase().includes(needle)
    )
      add(b.u, b.t, "star");
  }
  for (const h of shared.stores.history.suggest(q, 4)) add(h.u, h.t, "clock");
  return out;
}

function sgQuery(text, reset = true) {
  if (!shared.win || shared.win.isDestroyed()) return;
  const raw = String(text ?? "").slice(0, 300);
  const q = raw.trim();
  const mine = ++sg.seq;
  sg.abort?.abort();
  clearTimeout(sg.debounce);
  sg.typed = raw;
  const isAddress = !!q && toUrl(q) !== searchUrl(q); // terlihat seperti alamat, bukan pencarian
  const items = [];
  if (q) {
    items.push(
      isAddress
        ? { kind: "go", icon: "globe", text: raw, title: q, sub: "Go to address", hint: "Go" }
        : {
            kind: "search",
            icon: "search",
            text: raw,
            title: q,
            sub: `Search with ${engine().name}`,
            hint: "Search",
          },
      ...tabItems(q, 3),
      ...(config.suggestions.enabled ? sgLocal(q) : []),
      ...actionItems(q),
    );
  } else {
    items.push(...tabItems("", 5), ...actionItems(""));
  }
  sg.base = items.slice(0, SG_MAX);
  sg.items = sg.base;
  sgPaint(reset);
  if (q && !isAddress) sgRemote(q, mine); // alamat tidak pernah dikirim ke mesin pencari
}

function sgRemote(q, mine) {
  const eng = engine();
  if (!config.suggestions.enabled || !config.suggestions.remote || !eng.suggest) return;
  clearTimeout(sg.debounce);
  sg.debounce = setTimeout(async () => {
    if (mine !== sg.seq) return;
    const ctrl = (sg.abort = new AbortController());
    const timeout = setTimeout(() => ctrl.abort(), 2500);
    try {
      const res = await net.fetch(
        eng.suggest.replace("%s", encodeURIComponent(q)),
        { signal: ctrl.signal },
      );
      if (!res.ok) return;
      const data = await res.json();
      if (mine !== sg.seq || !sg.open) return;
      const low = q.toLowerCase();
      const list = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
      const extra = list
        .filter(
          (s) => typeof s === "string" && s.trim() && s.toLowerCase() !== low,
        )
        .map((s) => ({
          kind: "search",
          icon: "search",
          text: s,
          title: s,
          sec: "Suggestions",
          hint: "Search",
        }));
      sg.items = [...sg.base, ...extra].slice(0, SG_MAX);
      sgPaint(false);
    } catch {
      // offline / dibatalkan: saran lokal tetap tampil
    } finally {
      clearTimeout(timeout);
    }
  }, 120);
}

const fromSg = (e) =>
  !!sg.view && !sg.view.webContents.isDestroyed() && e.sender === sg.view.webContents;

ipcMain.on("suggest:query", (e, text) => {
  if (fromSg(e) && sg.open) sgQuery(String(text ?? ""), true);
});
ipcMain.on("suggest:size", (e, h) => {
  if (!fromSg(e) || !(h > 0)) return;
  sg.height = Math.ceil(h);
  if (sg.open && sg.shown) sgLayout();
  else sgReveal();
});
ipcMain.on("suggest:close", (e) => {
  if (fromSg(e)) sgHide(true);
});
ipcMain.on("suggest:go", (e, text) => {
  if (!fromSg(e)) return;
  const t = String(text ?? "").trim();
  sgHide();
  if (t) navigateActive(toUrl(t));
});
ipcMain.on("suggest:pick", (e, i) => {
  if (!fromSg(e)) return;
  const it = sg.items[Number(i)];
  if (!it) return;
  sgHide();
  if (it.kind === "tab") return $tabs.activateTab(it.tabId);
  if (it.kind === "action") return PAL_RUN[it.id]?.();
  navigateActive(
    it.kind === "search"
      ? searchUrl(it.text)
      : it.kind === "url"
        ? it.url
        : toUrl(it.text),
  );
});
ipcMain.on("suggest:engine", (e, id) => {
  if (!fromSg(e)) return;
  const i = engines.findIndex((x) => x.id === id);
  if (i >= 0) setEngine(i);
});
// Klik URL di toolbar -> palette berisi alamat halaman ini (terpilih semua)
onUI("palette:open", (text) => {
  if (Date.now() - sg.hiddenAt < 250) return; // klik yang sama yang baru saja menutup palette (blur)
  paletteOpen(String(text ?? ""), true);
});

// ---------------------------------------------------------------
// Sidebar auto-hide. Tiga keadaan: tersembunyi (area halaman hampir penuh, hanya bingkai 8px),
// terbuka karena kursor di tepi kiri (hover), atau disematkan (pin). Sidebar digambar di index.html;
// main hanya menyimpan statusnya dan menggeser area halaman (lihat pageArea di main-core.js).
// Hover ditutup lewat polling posisi kursor (hanya jalan saat sidebar terbuka karena hover), karena
// view halaman menutupi UI sehingga event mouseleave di UI tidak bisa diandalkan.
// ---------------------------------------------------------------
const sb = { timer: null, leaveAt: 0, anim: null };
const sidebarTarget = () => (sidebarOpen() ? sidebarCol() : FRAME_PAD);

function sidebarSend() {
  const w = sidebarW();
  sendUI("sidebar:state", {
    open: sidebarOpen(),
    pinned: shared.sidebar.pinned,
    width: w,
    min: SIDEBAR_MIN,
    max: SIDEBAR_MAX,
    labelMin: SIDEBAR_LABEL_MIN,
  });
}

function sendLayoutState() {
  sendUI("layout:state", { mode: tabLayout() });
  sidebarSend();
}

// Tombol jendela Windows mengikuti tinggi baris paling atas (toolbar di mode sidebar, baris tab di mode top)
function applyOverlay() {
  if (!shared.win || shared.win.isDestroyed()) return;
  try {
    shared.win.setTitleBarOverlay({
      color: BG,
      symbolColor: "#a8a8b3",
      height: tabLayout() === "top" ? TABBAR_H : TOOLBAR_H,
    });
  } catch {}
}

// Area halaman digeser halus (ease-out cubic, 170 ms), serasi dengan transisi CSS sidebar & bingkai di style.css
const SB_ANIM_MS = 170;
function sidebarAnimate() {
  clearInterval(sb.anim);
  sb.anim = null;
  const from = shared.sbX;
  const to = sidebarTarget();
  if (from === to || !shared.win || shared.win.isDestroyed()) {
    shared.sbX = to;
    $tabs.layout();
    return;
  }
  const t0 = Date.now();
  sb.anim = setInterval(() => {
    if (!shared.win || shared.win.isDestroyed()) {
      clearInterval(sb.anim);
      sb.anim = null;
      return;
    }
    const p = Math.min(1, (Date.now() - t0) / SB_ANIM_MS);
    shared.sbX = p >= 1 ? to : from + (to - from) * (1 - Math.pow(1 - p, 3));
    $tabs.layout();
    if (p >= 1) {
      clearInterval(sb.anim);
      sb.anim = null;
    }
  }, 16);
}

function sidebarApply() {
  sidebarSend();
  sidebarAnimate();
  sidebarWatch();
  sboUpdate();
}

// ---------------------------------------------------------------
// Sidebar hover = overlay: WebContentsView di atas halaman, jadi halaman TIDAK mengecil. Hanya sidebar yang
// di-pin (index.html) yang menggeser area halaman. Isinya daftar tab sederhana (buka, tutup, tab baru).
// ---------------------------------------------------------------
const SBO_HTML = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#141418;color:#a8a8b3;font:12px/1 "Segoe UI",system-ui,sans-serif;user-select:none;overflow:hidden}
body{box-sizing:border-box;display:flex;flex-direction:column;gap:5px;padding:8px;border:1px solid #34343f;border-radius:13px}
button{font:inherit}
#new{flex:none;margin-top:-2px;height:34px;display:flex;align-items:center;gap:8px;padding:0 8px 0 9px;border:0;border-radius:9px;background:none;color:inherit;text-align:left;cursor:default}
#new:hover{background:#26262e;color:#e4e4ea}
#new svg{width:14px;height:14px}
#list{flex:0 1 auto;min-height:0;display:flex;flex-direction:column;gap:3px;overflow-y:auto;overflow-x:hidden}
#list::-webkit-scrollbar{width:6px}
#list::-webkit-scrollbar-thumb{background:#30303c;border-radius:3px}
.t{flex:none;height:34px;display:flex;align-items:center;gap:8px;padding:0 3px 0 8px;border-radius:9px;cursor:default}
.t:hover{background:#26262e}
.t.a{background:#2e2e38;color:#e4e4ea}
.t.p{box-shadow:inset 2px 0 0 #7c8cff}
.f{width:16px;height:16px;flex:none;border-radius:3px;background:#26262e center/cover no-repeat}
.t.s .f{filter:grayscale(1);opacity:.7}
.t.s .n{opacity:.55}
.t.l .f{background:none;border:2px solid #a8a8b3;border-top-color:transparent;border-radius:50%;animation:r .7s linear infinite}
@keyframes r{to{transform:rotate(360deg)}}
.n{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.4}
.x{flex:none;width:20px;height:20px;display:grid;place-items:center;border:0;border-radius:6px;background:none;color:inherit;opacity:0}
.t:hover .x,.t.a .x{opacity:.8}
.x:hover{background:#3a3a45;opacity:1}
.x svg{width:8px;height:8px}
</style>
<div id="list"></div>
<button id="new"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M7 2v10M2 7h10"/></svg><span>New Tab</span></button>
<script>
const L = document.getElementById("list");
document.getElementById("new").onclick = () => sboAPI.act("new", 0);
sboAPI.onRender((p) => {
  const list = p.list;
  const st = L.scrollTop;
  L.textContent = "";
  for (const t of list) {
    const d = document.createElement("div");
    d.className = "t" + (t.active ? " a" : "") + (t.suspended ? " s" : "") + (t.loading ? " l" : "") + (t.split ? " p" : "");
    d.title = t.title;
    const f = document.createElement("span");
    f.className = "f";
    if (t.favicon && !t.loading) f.style.backgroundImage = "url(" + JSON.stringify(t.favicon) + ")";
    const n = document.createElement("span");
    n.className = "n";
    n.textContent = t.title;
    const x = document.createElement("button");
    x.className = "x";
    x.innerHTML = '<svg viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M1 1l6 6M7 1L1 7"/></svg>';
    x.onclick = (e) => { e.stopPropagation(); sboAPI.act("close", t.id); };
    d.onmousedown = (e) => {
      if (e.button === 1) { e.preventDefault(); sboAPI.act("close", t.id); }
      else if (e.button === 0 && !e.target.closest(".x")) sboAPI.act(e.ctrlKey || e.metaKey ? "split" : "activate", t.id);
    };
    d.oncontextmenu = (e) => { e.preventDefault(); sboAPI.act("menu", t.id); };
    d.append(f, n, x);
    L.appendChild(d);
  }
  L.scrollTop = st;
});
</script>`;

// dx = pergeseran horizontal overlay (0 = terbuka penuh, SBO_OFF = tersembunyi di kiri). Dianimasikan ala GSAP:
// masuk expo.out (cepat lalu melambat halus), keluar power2.in.
const sboW = () => SIDEBAR_W; // overlay auto-hide selalu selebar default, tidak mengikuti lebar sidebar yang di-pin
const sboOff = () => -(sboW() + FRAME_PAD * 2);
const sbo = {
  view: null,
  ready: false,
  open: false,
  closing: false,
  dx: sboOff(),
  anim: null,
  destroyTimer: null,
  pushTimer: null,
};
const easeExpoOut = (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p));
const easePowerIn = (p) => p * p;

function sboAnimate(to, ms, ease, done) {
  clearInterval(sbo.anim);
  sbo.anim = null;
  const from = sbo.dx;
  if (from === to) {
    done?.();
    return;
  }
  const t0 = Date.now();
  sbo.anim = setInterval(() => {
    if (!shared.win || shared.win.isDestroyed()) {
      clearInterval(sbo.anim);
      sbo.anim = null;
      return;
    }
    const p = Math.min(1, (Date.now() - t0) / ms);
    sbo.dx = p >= 1 ? to : from + (to - from) * ease(p);
    sboLayout();
    if (p >= 1) {
      clearInterval(sbo.anim);
      sbo.anim = null;
      done?.();
    }
  }, 16);
}

const sboWant = () =>
  tabLayout() === "sidebar" && shared.sidebar.hover && !shared.sidebar.pinned;

function sboView() {
  clearTimeout(sbo.destroyTimer);
  if (sbo.view && !sbo.view.webContents.isDestroyed()) return sbo.view;
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "sbpreload.js"),
    },
  });
  view.setBackgroundColor("#141418");
  try {
    view.setBorderRadius(13);
  } catch {}
  view.setVisible(false);
  const wc = view.webContents;
  wc.on("before-input-event", handleShortcut);
  wc.on("will-navigate", (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  wc.once("did-finish-load", () => {
    if (sbo.view !== view) return;
    sbo.ready = true;
    if (sbo.open) sboPush();
  });
  wc.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(SBO_HTML)).catch(() => {});
  shared.win.contentView.addChildView(view);
  sbo.view = view;
  sbo.ready = false;
  return view;
}

function sboPush() {
  clearTimeout(sbo.pushTimer);
  sbo.pushTimer = setTimeout(() => {
    const wc = sbo.view?.webContents;
    if (!sbo.open || !sbo.ready || !wc || wc.isDestroyed()) return;
    const list = [];
    for (const t of tabs.values()) {
      let s;
      try {
        s = tabState(t);
      } catch {
        continue;
      }
      if (!s) continue;
      list.push({
        id: t.id,
        title: s.title || s.url || "New Tab",
        favicon: safeFav(s.favicon || t.favicon),
        active: t.id === shared.activeId,
        suspended: !!t.suspended,
        loading: !!s.loading,
        split: !!s.split,
      });
    }
    wc.send("sbo:render", { list });
  }, 30);
}
shared.onTabsChanged = sboPush;

// Posisi + naikkan ke lapisan atas (kecuali palette / menu / panel unduhan sedang terbuka)
function sboLayout() {
  if (!sbo.open || !sbo.view || sbo.view.webContents.isDestroyed()) return;
  if (!shared.win || shared.win.isDestroyed()) return;
  const [, h] = shared.win.getContentSize();
  const y = topH();
  sbo.view.setBounds({
    x: FRAME_PAD + Math.round(sbo.dx),
    y,
    width: sboW(),
    height: Math.max(100, h - y - FRAME_PAD),
  });
  const kids = shared.win.contentView.children;
  if (!sg.open && !$downloads.dlp.open && !mp.open && !$tabmenu.isOpen() && kids[kids.length - 1] !== sbo.view)
    shared.win.contentView.addChildView(sbo.view);
}

function sboUpdate() {
  if (!shared.win || shared.win.isDestroyed()) return;
  if (sboWant()) {
    if (!sbo.open) sbo.dx = sboOff(); // lebar bisa berubah sejak terakhir ditutup
    const view = sboView();
    sbo.open = true;
    sbo.closing = false;
    sboLayout();
    shared.win.contentView.addChildView(view);
    view.setVisible(true);
    sboPush();
    sboAnimate(0, 320, easeExpoOut);
  } else if (sbo.open && !sbo.closing) {
    sbo.closing = true;
    sboAnimate(sboOff(), 180, easePowerIn, () => {
      sbo.open = false;
      sbo.closing = false;
      sbo.view?.setVisible(false);
      clearTimeout(sbo.destroyTimer);
      sbo.destroyTimer = setTimeout(() => {
        const view = sbo.view;
        if (!view || sbo.open) return;
        sbo.view = null;
        sbo.ready = false;
        try {
          shared.win?.contentView.removeChildView(view);
        } catch {}
        if (!view.webContents.isDestroyed()) view.webContents.close();
      }, 30_000);
    });
  }
}

ipcMain.on("sbo:act", (e, type, id) => {
  if (!sbo.view || sbo.view.webContents.isDestroyed() || e.sender !== sbo.view.webContents) return;
  if (type === "new") $tabs.createTab(NEWTAB_URL);
  else if (type === "activate") $tabs.activateTab(Number(id));
  else if (type === "split") $tabs.splitWith(Number(id));
  else if (type === "close") $tabs.closeTab(Number(id));
  else if (type === "menu") $tabmenu.open(Number(id)); // klik kanan tab di sidebar hover
});
// Ctrl+klik tab di sidebar (index.html): split dengan tab itu
onUI("split:tab", (id) => $tabs.splitWith(Number(id)));

// Hover ditutup lewat polling posisi kursor (hanya jalan saat sidebar terbuka karena hover), karena
// view halaman menutupi UI sehingga event mouseleave di UI tidak bisa diandalkan.
function sidebarWatch() {
  clearInterval(sb.timer);
  sb.timer = null;
  if (!shared.sidebar.hover || shared.sidebar.pinned) return;
  sb.leaveAt = 0;
  sb.timer = setInterval(() => {
    if (
      !shared.win ||
      shared.win.isDestroyed() ||
      !shared.sidebar.hover ||
      shared.sidebar.pinned
    ) {
      clearInterval(sb.timer);
      sb.timer = null;
      return;
    }
    const p = screen.getCursorScreenPoint();
    const b = shared.win.getContentBounds();
    const x = p.x - b.x;
    const y = p.y - b.y;
    // Menu klik kanan tab terbuka: sidebar hover jangan menutup di bawahnya
    const inside = $tabmenu.isOpen() || (x >= 0 && x <= SIDEBAR_COL + 12 && y >= 0 && y <= b.height);
    if (inside) {
      sb.leaveAt = 0;
    } else if (!sb.leaveAt) {
      sb.leaveAt = Date.now();
    } else if (Date.now() - sb.leaveAt > 250) {
      shared.sidebar.hover = false;
      sidebarApply();
    }
  }, 120);
}

function setSidebarHover(on) {
  if (tabLayout() !== "sidebar") return;
  if (shared.sidebar.hover === on || shared.sidebar.pinned) return;
  shared.sidebar.hover = on;
  sidebarApply();
}

function toggleSidebar() {
  if (tabLayout() !== "sidebar") return;
  shared.sidebar.pinned = !shared.sidebar.pinned;
  shared.sidebar.hover = false;
  sidebarApply();
}

// Ganti letak tab: "sidebar" | "top". Disimpan di settings.json (userData).
function setTabLayout(mode) {
  if (mode !== "top" && mode !== "sidebar") return;
  if (tabLayout() === mode) return;
  config.tabLayout = mode;
  try {
    writeSettings({ tabLayout: mode });
  } catch {}
  clearInterval(sb.anim);
  sb.anim = null;
  shared.sidebar.hover = false;
  shared.sbX = sidebarTarget();
  sidebarWatch();
  sboUpdate();
  sgHide();
  mpHide();
  applyOverlay();
  sendLayoutState();
  $tabs.layout();
}

onUI("sidebar:toggle", () => toggleSidebar());
onUI("sidebar:hover", (on) => setSidebarHover(!!on));

// Resize sidebar (hanya saat di-pin). Saat drag: halaman mengikuti langsung tanpa animasi.
// Saat dilepas: lebar < SIDEBAR_LABEL_MIN di-snap ke SIDEBAR_MIN (icon-only), disimpan, lalu digeser halus.
function setSidebarWidth(w, final) {
  if (!sidebarOpen()) return;
  let next = clampSbW(w);
  if (final && next < SIDEBAR_LABEL_MIN) next = SIDEBAR_MIN;
  if (!final && shared.sbW === next) return;
  shared.sbW = next;
  if (final) {
    shared.stores?.session.setSbw(next);
    sidebarSend();
    sidebarAnimate();
  } else {
    clearInterval(sb.anim);
    sb.anim = null;
    shared.sbX = sidebarTarget();
    $tabs.layout();
  }
}
onUI("sidebar:resize", (w, final) => setSidebarWidth(Number(w), !!final));
// Klik dua kali pada handle: icon-only <-> lebar default
onUI("sidebar:resize-toggle", () =>
  setSidebarWidth(sidebarW() > SIDEBAR_MIN ? SIDEBAR_MIN : SIDEBAR_W, true),
);
// Dipakai halaman Settings (lewat sayaAPI.settingsTabLayout): tanpa argumen = baca saja
handleInternal("saya:settings:tabLayout", (mode) => {
  if (mode === "top" || mode === "sidebar") setTabLayout(mode);
  return tabLayout();
});

// ---------------------------------------------------------------
// Cari di halaman (Ctrl+F). Pola sama dengan dropdown saran: WebContentsView kecil
// yang dibuat saat dipakai dan dibuang 30 detik setelah ditutup. Bar hanya hidup
// untuk satu tab; pindah tab menutupnya.
// ---------------------------------------------------------------
const FIND_W = 340;
const FIND_H = 44;
const find = {
  view: null,
  ready: false, // find.html sudah selesai dimuat
  open: false,
  tabId: 0,
  text: "", // teks terakhir di kotak cari
  last: "", // teks yang sedang dicari di halaman ("" = belum ada sesi)
  queriedAt: 0,
  off: null, // lepas listener found-in-page
  destroyTimer: null,
};

function findWC() {
  const wc = tabs.get(find.tabId)?.view?.webContents;
  return wc && !wc.isDestroyed() ? wc : null;
}

function findSend(channel, payload) {
  const wc = find.view?.webContents;
  if (find.ready && wc && !wc.isDestroyed()) wc.send(channel, payload);
}

function findView() {
  clearTimeout(find.destroyTimer);
  if (find.view) return find.view;
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "findpreload.js"),
    },
  });
  view.setBackgroundColor("#1c1c22");
  try {
    view.setBorderRadius(10);
  } catch {}
  view.setVisible(false);
  const wc = view.webContents;
  wc.on("before-input-event", handleShortcut); // Ctrl+F/Esc/F3 tetap jalan saat fokus di bar
  wc.on("will-navigate", (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  wc.once("did-finish-load", () => {
    if (find.view !== view) return;
    find.ready = true;
    if (find.open) findInit();
  });
  wc.loadFile(path.join(RENDERER_DIR, "find.html")).catch(() => {});
  shared.win.contentView.addChildView(view);
  find.view = view;
  find.ready = false;
  return view;
}

// Isi kotak cari dengan teks terakhir, fokus ke sana, dan cari ulang kalau ada teks
function findInit() {
  findSend("find:show", { text: find.text });
  find.view?.webContents.focus();
  if (find.text) findRun(find.text, true);
}

function findLayout() {
  if (!find.view || !find.open || !shared.win || shared.win.isDestroyed()) return;
  const b = activeTab()?.view?.getBounds();
  if (!b) return;
  const width = Math.min(FIND_W, Math.max(200, b.width - 24));
  // 20px dari tepi kanan = di kiri scrollbar halaman
  find.view.setBounds({
    x: b.x + b.width - width - 20,
    y: b.y + 6,
    width,
    height: FIND_H,
  });
  // DevTools yang baru dibuka bisa menutupi bar; angkat lagi (kecuali dropdown saran sedang terbuka)
  const kids = shared.win.contentView.children;
  if (!sg.open && !$downloads.dlp.open && !mp.open && kids[kids.length - 1] !== find.view)
    shared.win.contentView.addChildView(find.view);
}

function findOpen() {
  const tab = activeTab();
  const wc = tab?.view?.webContents;
  if (!shared.win || shared.win.isDestroyed() || !wc || wc.isDestroyed()) return;
  if (find.open) {
    find.view?.webContents.focus();
    findSend("find:show", { text: find.text }); // fokus + pilih semua teks
    return;
  }
  sgHide();
  find.open = true;
  find.tabId = tab.id;
  find.last = "";
  const onFound = (_e, r) => {
    if (!r.finalUpdate && !(r.matches > 0)) return; // abaikan update sementara yang kosong
    findSend("find:result", { ord: r.activeMatchOrdinal, total: r.matches });
    // findInPage bisa memindahkan fokus ke halaman: kembalikan ke kotak cari
    if (r.finalUpdate && Date.now() - find.queriedAt < 500)
      find.view?.webContents.focus();
  };
  wc.on("found-in-page", onFound);
  find.off = () => wc.removeListener("found-in-page", onFound);
  const view = findView();
  findLayout();
  shared.win.contentView.addChildView(view); // naik ke lapisan paling atas
  view.setVisible(true);
  if (find.ready) findInit();
}

function findClose(refocusPage = true) {
  if (!find.open) return;
  find.open = false;
  find.off?.();
  find.off = null;
  find.last = "";
  const wc = findWC();
  if (wc) {
    try {
      wc.stopFindInPage("clearSelection");
    } catch {}
  }
  find.view?.setVisible(false);
  clearTimeout(find.destroyTimer);
  find.destroyTimer = setTimeout(findDestroy, 30_000);
  if (refocusPage && wc) wc.focus();
}

function findDestroy() {
  const view = find.view;
  if (!view || find.open) return;
  find.view = null;
  find.ready = false;
  try {
    shared.win?.contentView.removeChildView(view);
  } catch {}
  if (!view.webContents.isDestroyed()) view.webContents.close();
}

// Navigasi penuh: sorotan lama tidak berlaku lagi. Bar tetap terbuka; Enter memulai pencarian baru.
function findReset(tab) {
  if (!find.open || find.tabId !== tab.id) return;
  find.last = "";
  findSend("find:result", { ord: 0, total: 0 });
}

// findNext di Electron berarti "mulai sesi baru" (true = pencarian baru, false = lanjut ke hasil berikutnya)
function findRun(text, forward) {
  const wc = findWC();
  if (!find.open || !wc) return;
  find.text = text;
  if (!text) {
    find.last = "";
    wc.stopFindInPage("clearSelection"); // jangan pernah kirim teks kosong ke findInPage
    findSend("find:result", { ord: 0, total: 0 });
    return;
  }
  const fresh = text !== find.last;
  find.last = text;
  find.queriedAt = Date.now();
  wc.findInPage(text, { forward: !!forward, findNext: fresh });
  find.view?.webContents.focus();
}

const fromFind = (e) =>
  !!find.view &&
  !find.view.webContents.isDestroyed() &&
  e.sender === find.view.webContents;
ipcMain.on("find:query", (e, text) => {
  if (fromFind(e)) findRun(String(text ?? "").slice(0, 200), true);
});
ipcMain.on("find:step", (e, forward) => {
  if (fromFind(e)) findRun(find.text, !!forward);
});
ipcMain.on("find:close", (e) => {
  if (fromFind(e)) findClose();
});

Object.assign(module.exports, {
  find,
  paletteOpen,
  paletteType,
  sendLayoutState,
  setTabLayout,
  toggleSidebar,
  findClose,
  findLayout,
  findReset,
  sboLayout,
  handleShortcut,
  mp,
  mpHide,
  mpToggle,
  navigateActive,
  sg,
  sgHide,
  showContextMenu,
  showSiteMenu,
});
