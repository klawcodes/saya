// main.js — Titik masuk Electron: single instance, jendela utama, IPC dari UI & halaman internal,
// halaman Settings/About/Credits, dan start aplikasi. Modul lain: main-*.js

const {
  app,
  BrowserWindow,
  session,
  Menu,
  dialog,
  screen,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { createStores } = require("./store");
const {
  APP_ICON,
  BG,
  CACHE_LIMITS,
  DNS_MODES,
  NEWTAB_URL,
  PAGES,
  RENDERER_DIR,
  TAB_BAR_H,
  activeWC,
  cacheLimitAtStart,
  config,
  engine,
  engines,
  handleInternal,
  handleUI,
  isDohUrl,
  onUI,
  pushTab,
  shared,
  tabs,
  toUrl,
  writeSettings,
} = require("./main-core");
const $downloads = require("./main-downloads");
const $network = require("./main-network");
const $tabs = require("./main-tabs");
const $ui = require("./main-ui");

// Hanya satu Saya yang berjalan; link/perintah dari instance kedua dibuka sebagai tab baru
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
const urlFromArgs = (argv) =>
  (argv || [])
    .slice(1)
    .find((a) => typeof a === "string" && /^https?:\/\//i.test(a));
Object.assign(module.exports, { urlFromArgs });
app.on("second-instance", (_e, argv) => {
  if (!shared.win || shared.win.isDestroyed()) return;
  if (shared.win.isMinimized()) shared.win.restore();
  shared.win.focus();
  const url = urlFromArgs(argv);
  if (url) $tabs.createTab(url);
});

// ---------------------------------------------------------------
// Window
// ---------------------------------------------------------------
// Ukuran/posisi terakhir; posisi dibuang kalau monitornya sudah tidak ada
function savedBounds() {
  const b = shared.stores.session.bounds;
  if (!b) return {};
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return cx >= a.x && cx < a.x + a.width && cy >= a.y && cy < a.y + a.height;
  });
  return visible ? b : { width: b.width, height: b.height };
}

function createWindow() {
  shared.win = new BrowserWindow({
    width: 1200,
    height: 760,
    ...savedBounds(),
    minWidth: 640,
    minHeight: 400,
    show: false,
    backgroundColor: BG,
    ...(fs.existsSync(APP_ICON) ? { icon: APP_ICON } : {}), // ikon jendela/taskbar (icon.ico di folder proyek)
    titleBarStyle: "hidden",
    titleBarOverlay: { color: BG, symbolColor: "#a8a8b3", height: TAB_BAR_H },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
    },
  });

  if (shared.stores.session.maximized) shared.win.maximize();
  shared.win.loadFile(path.join(RENDERER_DIR, "index.html"));
  shared.win.once("ready-to-show", () => shared.win.show());

  // UI browser sendiri tidak boleh berpindah halaman / membuka jendela
  shared.win.on("page-title-updated", (e) => e.preventDefault()); // judul jendela diatur syncWindowTitle(), bukan <title> index.html
  shared.win.webContents.on("will-navigate", (e) => e.preventDefault());
  shared.win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  shared.win.webContents.on("before-input-event", $ui.handleShortcut);
  shared.win.webContents.once("did-finish-load", $tabs.startTabs);

  shared.win.on("resize", $tabs.layout);
  shared.win.on("resize", $ui.sgHide);
  shared.win.on("move", $ui.sgHide);
  shared.win.on("resize", () => {
    $downloads.dlpHide();
    $ui.mpHide();
  });
  shared.win.on("move", () => {
    $downloads.dlpHide();
    $ui.mpHide();
  });
  shared.win.on("resize", $tabs.scheduleSave);
  shared.win.on("move", $tabs.scheduleSave);
  shared.win.on("close", () => {
    if (shared.saveTimer) clearTimeout(shared.saveTimer);
    shared.saveTimer = null;
    $tabs.saveSession(); // simpan tab sebelum jendela dihancurkan
    shared.sessionLocked = true;
  });
  shared.win.on("maximize", $tabs.layout);
  shared.win.on("unmaximize", $tabs.layout);
  shared.win.on("enter-full-screen", $tabs.layout);
  shared.win.on("leave-full-screen", $tabs.layout);
  shared.win.on("closed", () => {
    shared.win = null;
    $ui.sg.view = null;
    $ui.sg.open = false;
    $ui.find.view = null;
    $ui.find.open = false;
    $ui.find.ready = false;
    $downloads.dlp.view = null;
    $downloads.dlp.open = false;
    $downloads.dlp.ready = false;
    $ui.mp.view = null;
    $ui.mp.open = false;
    $ui.mp.ready = false;
    $tabs.rsp.view = null;
    tabs.clear();
  });
}

// ---------------------------------------------------------------
// IPC dari UI browser
// ---------------------------------------------------------------
onUI("tab:new", () => $tabs.createTab(NEWTAB_URL));
onUI("tab:close", (id) => $tabs.closeTab(id));
onUI("tab:move", (id, index) => $tabs.moveTab(id, index));
onUI("tab:activate", (id) => $tabs.activateTab(id));
onUI("tab:mute", (id) => {
  const tab = tabs.get(id);
  if (!tab) return;
  tab.muted = !tab.muted;
  if (tab.view && !tab.view.webContents.isDestroyed())
    tab.view.webContents.setAudioMuted(tab.muted);
  pushTab(tab);
});
onUI("nav:go", (input) => {
  $ui.sgHide();
  $ui.navigateActive(toUrl(input));
});
onUI("nav:back", () => {
  const wc = activeWC();
  if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
});
onUI("nav:forward", () => {
  const wc = activeWC();
  if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
});
onUI("nav:reload", () => $tabs.reload(shared.activeId));
onUI("bookmark:toggle", $tabs.toggleBookmark);
onUI("menu:open", $ui.mpToggle);
onUI("site:open", $ui.showSiteMenu);

handleUI("ui:init", () => ({
  ...$network.adblockState(),
  engine: engine().name,
  logo: $tabs.appLogo(),
}));
handleUI("adblock:toggle", () => {
  if (!shared.blocker) return $network.adblockState();
  shared.adblockOn = !shared.adblockOn;
  if (shared.adblockOn) $network.enableBlocking();
  else {
    try {
      shared.blocker.disableBlockingInSession(session.defaultSession);
    } catch {}
    $network.installClientHints(session.defaultSession); // disable bisa ikut melepas listener header
  }
  return $network.adblockState();
});

// ---------------------------------------------------------------
// IPC dari halaman internal (riwayat & bookmark)
// ---------------------------------------------------------------
handleInternal("saya:history:list", (opts) =>
  shared.stores.history.list({
    q: typeof opts?.q === "string" ? opts.q : "",
    limit: Number(opts?.limit),
    offset: Number(opts?.offset),
  }),
);
handleInternal("saya:history:remove", (url) => {
  if (typeof url === "string") shared.stores.history.remove(url);
  return true;
});
handleInternal("saya:history:clear", (since) => {
  shared.stores.history.clear(Number(since) || 0);
  return true;
});
handleInternal("saya:bookmarks:list", () => shared.stores.bookmarks.list());
handleInternal("saya:bookmarks:remove", (url) => {
  if (typeof url === "string") shared.stores.bookmarks.remove(url);
  $tabs.refreshActive();
  return true;
});

// ---------------------------------------------------------------
// ---------------------------------------------------------------
// Halaman Settings (saya://settings): bersihkan cache, batas cache web, dan DNS.
// Pilihan disimpan di userData/settings.json dan menimpa config.json (yang ada di folder
// aplikasi dan bisa read-only setelah dipasang). Semua handler hanya melayani halaman internal.
// ---------------------------------------------------------------
const CLEAR = {
  http: {
    dirs: ["Cache"],
    run: (ses) => ses.clearCache(),
  },
  code: {
    dirs: [
      "Code Cache",
      "GPUCache",
      "DawnGraphiteCache",
      "DawnWebGPUCache",
      "DawnCache",
      "GrShaderCache",
      "ShaderCache",
    ],
    run: async (ses) => {
      await ses.clearCodeCaches({ urls: [] });
      await ses.clearStorageData({ storages: ["shadercache"] });
    },
  },
  offline: {
    dirs: ["Service Worker/CacheStorage"],
    run: (ses) => ses.clearStorageData({ storages: ["cachestorage"] }),
  },
  adblock: {
    files: /^adblock-.*\.bin$/,
    // Cache engine ad blocker dibuat ulang saat Saya dibuka lagi
    run: async () => {
      const dir = app.getPath("userData");
      for (const f of await fs.promises.readdir(dir).catch(() => []))
        if (CLEAR.adblock.files.test(f))
          await fs.promises.unlink(path.join(dir, f)).catch(() => {});
    },
  },
  // Di bawah ini menyentuh akun: selalu minta konfirmasi dari proses utama
  cookies: {
    danger: true,
    button: "Clear cookies",
    message: "Clear all cookies and logins?",
    detail:
      "You will be signed out of every website (Instagram, X, Google, and so on). " +
      "Saya does not store passwords itself, so you will need to sign in again.",
    run: (ses) => ses.clearStorageData({ storages: ["cookies"] }),
  },
  sitedata: {
    danger: true,
    dirs: ["Local Storage", "IndexedDB", "Session Storage", "File System"],
    button: "Clear site data",
    message: "Clear all site data?",
    detail:
      "This removes local storage, IndexedDB and registered service workers. You may be signed out, " +
      "and web apps can lose offline data, unsent drafts and their saved settings.",
    run: (ses) =>
      ses.clearStorageData({
        storages: [
          "localstorage",
          "indexdb",
          "websql",
          "filesystem",
          "serviceworkers",
        ],
      }),
  },
};

async function dirSize(p) {
  let entries;
  try {
    entries = await fs.promises.readdir(p, { withFileTypes: true });
  } catch {
    return 0;
  }
  const sizes = await Promise.all(
    entries.map(async (e) => {
      const f = path.join(p, e.name);
      if (e.isDirectory()) return dirSize(f);
      if (!e.isFile()) return 0;
      try {
        return (await fs.promises.stat(f)).size;
      } catch {
        return 0;
      }
    }),
  );
  return sizes.reduce((a, b) => a + b, 0);
}

// Ukuran satu kategori (null = tidak ada ukuran yang bisa dihitung, mis. cookie)
async function clearSize(c) {
  const base = app.getPath("userData");
  if (!c.dirs && !c.files) return null;
  let n = 0;
  for (const d of c.dirs || []) n += await dirSize(path.join(base, d));
  if (c.files) {
    for (const f of await fs.promises.readdir(base).catch(() => [])) {
      if (!c.files.test(f)) continue;
      try {
        n += (await fs.promises.stat(path.join(base, f))).size;
      } catch {}
    }
  }
  return n;
}

handleInternal("saya:settings:get", () => ({
  dns: { mode: config.dns.mode, servers: config.dns.servers },
  cacheLimitMB: config.cacheLimitMB | 0,
  dataDir: app.getPath("userData"),
}));

handleInternal("saya:settings:dns", (mode, servers) => {
  if (!DNS_MODES.includes(mode))
    return { ok: false, error: "Invalid DNS mode." };
  if (
    !Array.isArray(servers) ||
    servers.length < 1 ||
    servers.length > 5 ||
    !servers.every(isDohUrl)
  )
    return { ok: false, error: "A DNS server must be an https:// address." };
  try {
    writeSettings({ dnsMode: mode, dnsServers: servers });
  } catch (err) {
    return { ok: false, error: "Could not save: " + err.message };
  }
  config.dns.mode = mode;
  config.dns.servers = servers;
  $network.setupDns();
  session.defaultSession.clearHostResolverCache().catch(() => {}); // lookup berikutnya memakai pengaturan baru
  return { ok: true };
});

handleInternal("saya:settings:cacheLimit", (mb) => {
  if (!CACHE_LIMITS.includes(mb)) return { ok: false, error: "Invalid value." };
  try {
    writeSettings({ cacheLimitMB: mb });
  } catch (err) {
    return { ok: false, error: "Could not save: " + err.message };
  }
  return { ok: true, restart: mb !== (cacheLimitAtStart | 0) };
});

handleInternal("saya:cache:sizes", async () => {
  const out = {};
  for (const [id, c] of Object.entries(CLEAR)) out[id] = await clearSize(c);
  out.total = await dirSize(app.getPath("userData"));
  return out;
});

handleInternal("saya:cache:clear", async (id) => {
  const c =
    typeof id === "string" && Object.hasOwn(CLEAR, id) ? CLEAR[id] : null;
  if (!c) return { ok: false, error: "Unknown item." };
  if (c.danger) {
    const opts = {
      type: "warning",
      title: "Saya",
      message: c.message,
      detail: c.detail,
      buttons: ["Cancel", c.button],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
    const { response } =
      shared.win && !shared.win.isDestroyed()
        ? await dialog.showMessageBox(shared.win, opts)
        : await dialog.showMessageBox(opts);
    if (response !== 1) return { ok: false, cancelled: true };
  }
  const before = await clearSize(c);
  try {
    await c.run(session.defaultSession);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  const after = await clearSize(c);
  return {
    ok: true,
    freed: before != null && after != null ? Math.max(0, before - after) : null,
  };
});

// Halaman Tentang (saya://about) & Kredit (saya://credits)
// Daftar kredit dibaca dari package.json + node_modules saat halamannya dibuka
// (tidak ada daftar yang ditulis tangan, jadi selalu ikut dependensi yang dipakai).
// ---------------------------------------------------------------
// --- kredit:mulai ---
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

function findPackageDir(name, from) {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const cand = path.join(dir, "node_modules", name);
    if (fs.existsSync(path.join(cand, "package.json"))) return cand;
    if (path.dirname(dir) === dir) return "";
  }
}

function licenseOf(pkg) {
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license && pkg.license.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses))
    return pkg.licenses.map((l) => l.type || l).join(" OR ");
  return "";
}

function homepageOf(pkg) {
  const repo =
    typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  const raw = pkg.homepage || repo || "";
  const url = String(raw)
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/\.git$/, "");
  return /^https?:\/\//i.test(url) ? url : "";
}

function licenseTextOf(dir, license) {
  try {
    const file = fs
      .readdirSync(dir)
      .find(
        (n) =>
          /^(licen[cs]e|copying)/i.test(n) &&
          fs.statSync(path.join(dir, n)).isFile(),
      );
    if (file)
      return fs.readFileSync(path.join(dir, file), "utf8").slice(0, 200_000);
  } catch {}
  return `No license file found in this package.${license ? ` Recorded license: ${license}.` : ""}`;
}

// Hanya dependensi produksi (beserta turunannya) yang ikut dikemas, bukan devDependencies
function collectCredits(root) {
  const pkg = readJson(path.join(root, "package.json")) || {};
  const found = new Map(); // "nama@versi" -> entri
  const visited = new Set();
  const walk = (name, from) => {
    const dir = findPackageDir(name, from);
    if (!dir || visited.has(dir)) return;
    visited.add(dir);
    const p = readJson(path.join(dir, "package.json"));
    if (!p) return;
    const key = `${p.name || name}@${p.version || ""}`;
    if (!found.has(key)) {
      const license = licenseOf(p);
      found.set(key, {
        name: p.name || name,
        version: p.version || "",
        license,
        homepage: homepageOf(p),
        text: () => licenseTextOf(dir, license),
      });
    }
    for (const dep of Object.keys({
      ...p.dependencies,
      ...p.optionalDependencies,
    }))
      walk(dep, dir);
  };
  for (const dep of Object.keys(pkg.dependencies || {})) walk(dep, root);
  return [...found.values()].sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );
}
// --- kredit:selesai ---

function staticCredits() {
  const exeDir = path.dirname(process.execPath);
  const read = (file, fallback) => {
    try {
      return fs.readFileSync(path.join(exeDir, file), "utf8").slice(0, 200_000);
    } catch {
      return fallback;
    }
  };
  return [
    {
      name: "Electron",
      version: process.versions.electron,
      license: "MIT",
      homepage: "https://www.electronjs.org",
      text: () =>
        read(
          "LICENSE",
          "MIT License. https://github.com/electron/electron/blob/main/LICENSE",
        ),
    },
    {
      name: "Chromium",
      version: process.versions.chrome,
      license: "BSD-3-Clause and other component licenses",
      homepage: "https://www.chromium.org",
      text: () =>
        `Chromium includes many components, each with its own license. The full list is in LICENSES.chromium.html in the app folder:\n${path.join(exeDir, "LICENSES.chromium.html")}`,
    },
    {
      name: "Node.js",
      version: process.versions.node,
      license: "MIT",
      homepage: "https://nodejs.org",
      text: () =>
        "MIT License. https://github.com/nodejs/node/blob/main/LICENSE",
    },
  ];
}

let creditsCache = null;
const credits = () =>
  (creditsCache ||= [...staticCredits(), ...collectCredits(__dirname)]);

handleInternal("saya:about:info", () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  chromium: process.versions.chrome,
  bits: process.arch === "ia32" || process.arch === "arm" ? "32-bit" : "64-bit",
}));
handleInternal("saya:credits:list", () =>
  credits().map((c, id) => ({
    id,
    name: c.name,
    version: c.version,
    license: c.license,
    homepage: c.homepage,
  })),
);
handleInternal(
  "saya:credits:license",
  (id) => credits()[Number(id)]?.text() ?? "",
);
handleInternal("saya:open", (name) => {
  if (typeof name === "string" && Object.hasOwn(PAGES, name))
    $tabs.openInternal(name);
  return true;
});

// Kalau scriptlet (cosmetic: true) gagal di sebuah situs, cukup catat satu baris
process.on("unhandledRejection", (reason) => {
  console.warn("[warn]", String(reason?.message || reason).split("\n")[0]);
});

// ---------------------------------------------------------------
// Start
// ---------------------------------------------------------------
app.whenReady().then(() => {
  if (!gotLock) return;
  Menu.setApplicationMenu(null);
  shared.stores = createStores(app.getPath("userData"), config);
  const savedEngine = engines.findIndex(
    (e) => e.id === shared.stores.session.engine,
  );
  if (savedEngine >= 0) shared.engineIdx = savedEngine;
  $network.setupSession();
  $network.setupDns();
  createWindow();
  $network.setupAdblock();
  if (config.tabSuspend.enabled)
    setInterval(() => $tabs.suspendIdle(false), 30_000);
});

app.on("before-quit", () => shared.stores?.flush());
app.on("window-all-closed", () => app.quit());
