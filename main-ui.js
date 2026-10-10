// main-ui.js — Panel menu titik tiga, menu situs, menu klik kanan, shortcut keyboard,
// dropdown saran address bar, dan Cari di halaman (Ctrl+F).

const { app, WebContentsView, ipcMain, Menu, shell, clipboard, net } = require("electron");
const path = require("path");
const { isWeb } = require("./store");
const {
  CHROME_H,
  NEWTAB_URL,
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
const $downloads = require("./main-downloads");
const $network = require("./main-network");
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
      { id: "sleep", icon: "moon", label: "Sleep background tabs" },
      { info: true, label: `${sleeping} tab(s) sleeping` },
      { sep: true },
      { id: "perms", icon: "shield", label: "Reset site permissions" },
      { sep: true },
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
  sleep: () => $tabs.suspendIdle(true),
  perms: () => shared.stores.permissions.clear(),
  settings: () => $tabs.openInternal("settings"),
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

function showSiteMenu() {
  sgHide();
  const wc = activeWC();
  const origin = $network.originOf(wc?.getURL());
  if (!origin) return;
  const perms = shared.stores.permissions;
  const stateText = (v) =>
    v === true ? "Allowed" : v === false ? "Blocked" : "Ask";
  const template = [
    { label: new URL(origin).host, enabled: false },
    {
      label: origin.startsWith("https:")
        ? "Secure connection (HTTPS)"
        : "Insecure connection (HTTP)",
      enabled: false,
    },
    { type: "separator" },
  ];
  for (const [key, name] of SITE_PERMS) {
    const cur = perms.get(origin, key);
    template.push({
      label: `${name}: ${stateText(cur)}`,
      submenu: [
        {
          label: "Ask every time",
          type: "radio",
          checked: cur === undefined,
          click: () => perms.forget(origin, key),
        },
        {
          label: "Allow",
          type: "radio",
          checked: cur === true,
          click: () => perms.set(origin, key, true),
        },
        {
          label: "Block",
          type: "radio",
          checked: cur === false,
          click: () => perms.set(origin, key, false),
        },
      ],
    });
  }
  template.push(
    { label: "Notifications: always blocked", enabled: false },
    { type: "separator" },
    {
      label: "Reset permissions for this site",
      click: () => perms.clearOrigin(origin),
    },
    ...(shared.blocker
      ? [
          { type: "separator" },
          {
            label: $network.isSitePaused(origin)
              ? "Ad blocker: paused on this site (click to resume)"
              : "Pause ad blocker on this site",
            click: () => {
              $network.togglePause(origin);
              $tabs.reload(shared.activeId);
            },
          },
        ]
      : []),
    {
      label: "Reload page (to apply changes)",
      click: () => $tabs.reload(shared.activeId),
    },
  );
  Menu.buildFromTemplate(template).popup({ window: shared.win });
}

// Klik kanan di halaman web
function showContextMenu(wc, p) {
  const groups = [];
  const sel = (p.selectionText || "").trim();

  if (p.linkURL && isWeb(p.linkURL)) {
    groups.push([
      { label: "Open link in new tab", click: () => $tabs.createTab(p.linkURL) },
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
  else if (key === "f11") shared.win.setFullScreen(!shared.win.isFullScreen());
  else handled = false;

  if (handled) event.preventDefault();
}

// ---------------------------------------------------------------
// Mesin pencari & dropdown saran di address bar.
// Dropdown = WebContentsView tersendiri, karena view halaman web menutupi UI browser
// (HTML di index.html tidak bisa tampil di atas halaman). View ini dibuat saat address
// bar dipakai dan dibuang 30 detik setelah ditutup supaya tidak memakan RAM.
// ---------------------------------------------------------------
const SG_ROW = 34;
const SG_LIST_PAD = 16;
const SG_FOOT = 34;
const SG_MAX = 8;
const sg = {
  view: null,
  open: false,
  editing: false, // address bar sedang fokus?
  base: [], // baris pertama + riwayat/bookmark
  items: [], // base + saran dari mesin pencari
  sel: -1,
  typed: "",
  rect: null,
  seq: 0,
  abort: null,
  debounce: null,
  hideTimer: null,
  destroyTimer: null,
  createdAt: 0, // when the dropdown view was last created (see giveFocusBack)
};

function navigateActive(url) {
  const tab = activeTab();
  if (!tab?.view) return;
  tab.errorUrl = "";
  tab.view.webContents.loadURL(url).catch(() => {});
  tab.view.webContents.focus();
}

function setEngine(i, opts = {}) {
  shared.engineIdx = ((i % engines.length) + engines.length) % engines.length;
  shared.stores?.session.setEngine(engine().id);
  if (shared.win && !shared.win.isDestroyed() && (opts.fresh || opts.refocus))
    shared.win.webContents.focus();
  sendUI("engine:changed", {
    name: engine().name,
    fresh: !!opts.fresh,
    refocus: !!opts.refocus,
  });
}
const cycleEngine = (dir) =>
  setEngine(shared.engineIdx + dir, { fresh: !sg.editing, refocus: sg.editing });

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
    view.setBorderRadius(13);
  } catch {}
  view.setVisible(false);
  // The dropdown never needs keyboard focus (all typing happens in the address bar).
  // A freshly created WebContentsView can grab focus, which blurs the address input,
  // wipes the typed text and closes the dropdown. That is why the first search only
  // worked on the second try. Hand focus straight back to the browser UI.
  sg.createdAt = Date.now();
  const giveFocusBack = () => {
    if (!shared.win || shared.win.isDestroyed() || sg.view !== view) return;
    if (sg.open || Date.now() - sg.createdAt < 1500) shared.win.webContents.focus();
  };
  view.webContents.on("focus", giveFocusBack);
  view.webContents.once("did-finish-load", () => {
    sgPaint();
    giveFocusBack();
  });
  view.webContents
    .loadFile(path.join(RENDERER_DIR, "suggest.html"))
    .catch(() => {});
  shared.win.contentView.addChildView(view);
  sg.view = view;
  return view;
}

function sgPaint() {
  const wc = sg.view?.webContents;
  if (!wc || wc.isDestroyed() || wc.isLoading()) return;
  wc.send("suggest:render", {
    items: sg.items,
    sel: sg.sel,
    typed: sg.typed.trim(),
    engines: engines.map((e) => ({ id: e.id, name: e.name })),
    current: engine().id,
  });
}

function sgLayout() {
  if (!sg.view || !sg.rect || !shared.win || shared.win.isDestroyed()) return;
  const [w] = shared.win.getContentSize();
  const width = Math.max(
    200,
    Math.min(Math.max(Math.round(sg.rect.width), 480), w - 16),
  );
  const center = sg.rect.x + sg.rect.width / 2;
  const x = Math.max(
    8,
    Math.min(Math.round(center - width / 2), w - width - 8),
  );
  const n = sg.items.length;
  const height = (n ? SG_LIST_PAD + n * SG_ROW : 0) + SG_FOOT;
  sg.view.setBounds({ x, y: Math.round(sg.rect.bottom) + 4, width, height });
}

function sgShow() {
  if (!shared.win || shared.win.isDestroyed()) return;
  clearTimeout(sg.hideTimer);
  const view = sgView();
  sgLayout();
  shared.win.contentView.addChildView(view); // dipasang ulang = naik ke lapisan paling atas
  view.setVisible(true);
  sg.open = true;
  sgPaint();
}

function sgDestroy() {
  const view = sg.view;
  if (!view || sg.open) return;
  sg.view = null;
  try {
    shared.win?.contentView.removeChildView(view);
  } catch {}
  if (!view.webContents.isDestroyed()) view.webContents.close();
}

function sgHide() {
  if (!sg.open && !sg.view) return;
  clearTimeout(sg.hideTimer);
  clearTimeout(sg.debounce);
  sg.seq++;
  sg.abort?.abort();
  if (sg.view && sg.open) sg.view.setVisible(false);
  sg.open = false;
  sg.items = [];
  sg.base = [];
  sg.sel = -1;
  clearTimeout(sg.destroyTimer);
  sg.destroyTimer = setTimeout(sgDestroy, 30_000);
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

function sgQuery(text, rect, force) {
  if (!config.suggestions.enabled || !shared.win || shared.win.isDestroyed()) return;
  const raw = String(text || "").slice(0, 300);
  const q = raw.trim();
  if (rect && [rect.x, rect.width, rect.bottom].every(Number.isFinite)) {
    sg.rect = { x: rect.x, width: rect.width, bottom: rect.bottom };
  }
  if (!sg.rect || (!q && !force)) return sgHide();

  const mine = ++sg.seq;
  sg.abort?.abort();
  sg.typed = raw;
  const isAddress = !!q && toUrl(q) !== searchUrl(q); // terlihat seperti alamat, bukan pencarian
  sg.base = q
    ? [
        isAddress
          ? {
              kind: "go",
              icon: "globe",
              text: raw,
              title: q,
              sub: "Go to address",
            }
          : {
              kind: "search",
              icon: "search",
              text: raw,
              title: q,
              sub: `Search with ${engine().name}`,
            },
        ...sgLocal(q),
      ]
    : [];
  sg.items = sg.base;
  sg.sel = sg.items.length ? 0 : -1;
  sgShow();
  if (q && !isAddress) sgRemote(q, mine); // alamat tidak pernah dikirim ke mesin pencari
}

function sgRemote(q, mine) {
  const eng = engine();
  if (!config.suggestions.remote || !eng.suggest) return;
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
        .map((s) => ({ kind: "search", icon: "search", text: s, title: s }));
      sg.items = [...sg.base, ...extra].slice(0, SG_MAX);
      sgLayout();
      sgPaint();
    } catch {
      // offline / dibatalkan: saran lokal tetap tampil
    } finally {
      clearTimeout(timeout);
    }
  }, 120);
}

function sgMove(dir) {
  const n = sg.items.length;
  if (!sg.open || !n) return;
  sg.sel = (Math.max(sg.sel, 0) + dir + n) % n;
  sendUI("suggest:fill", sg.items[sg.sel].text);
  sgPaint();
}

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

onUI("suggest:query", (text, rect, force) => sgQuery(text, rect, force));
onUI("suggest:move", (dir) => sgMove(Number(dir) > 0 ? 1 : -1));
onUI("suggest:focus", () => {
  sg.editing = true;
  clearTimeout(sg.hideTimer);
});
onUI("suggest:blur", () => {
  sg.editing = false;
  clearTimeout(sg.hideTimer);
  sg.hideTimer = setTimeout(sgHide, 150); // tunda: klik di dropdown membuat input kehilangan fokus lebih dulu
});
ipcMain.on("suggest:pick", (event, i) => {
  if (!sg.view || event.sender !== sg.view.webContents) return;
  const it = sg.items[Number(i)];
  if (!it) return;
  const url =
    it.kind === "search"
      ? searchUrl(it.text)
      : it.kind === "url"
        ? it.url
        : toUrl(it.text);
  sgHide();
  navigateActive(url);
});
ipcMain.on("suggest:engine", (event, id) => {
  if (!sg.view || event.sender !== sg.view.webContents) return;
  const i = engines.findIndex((e) => e.id === id);
  if (i >= 0) setEngine(i, { refocus: true });
});

Object.assign(module.exports, {
  find,
  findClose,
  findLayout,
  findReset,
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
