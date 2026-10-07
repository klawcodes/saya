const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  session,
  nativeTheme,
  Menu,
  Notification,
  dialog,
  shell,
  clipboard,
  nativeImage,
  screen,
  net,
} = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { pathToFileURL } = require("url");
const { createStores, isWeb } = require("./store");

// ---------------------------------------------------------------
// Layout (piksel) — skema golden ratio: 26 : 42 = 1 : 1.615.
// Samakan dengan --tab-h dan --bar-h di renderer/style.css.
// ---------------------------------------------------------------
const TAB_BAR_H = 34;
const TOOLBAR_H = 42;
const CHROME_H = TAB_BAR_H + TOOLBAR_H;
const BG = "#141418";

const RENDERER_DIR = path.join(__dirname, "renderer");
const INTERNAL_BASE = pathToFileURL(RENDERER_DIR).href + "/";
const fileUrl = (name) => pathToFileURL(path.join(RENDERER_DIR, name)).href;
const NEWTAB_URL = fileUrl("newtab.html");
const ERROR_URL = fileUrl("error.html");
const PAGES = {
  downloads: fileUrl("downloads.html"),
  history: fileUrl("history.html"),
  bookmarks: fileUrl("bookmarks.html"),
  about: fileUrl("about.html"),
  credits: fileUrl("credits.html"),
  settings: fileUrl("settings.html"),
};
const PAGE_NAMES = new Map(
  Object.entries(PAGES).map(([name, url]) => [url, name]),
);
const PAGE_PRELOAD = path.join(__dirname, "pagepreload.js");
const APP_ICON = path.join(__dirname, "icon.ico"); // taruh logo (format .ico) di sini; dipakai jendela & build

// ---------------------------------------------------------------
// Config (config.json di folder proyek)
// ---------------------------------------------------------------
const DEFAULT_ENGINES = [
  {
    id: "google",
    name: "Google",
    url: "https://www.google.com/search?q=%s",
    suggest:
      "https://suggestqueries.google.com/complete/search?client=firefox&q=%s",
  },
  {
    id: "duckduckgo",
    name: "DuckDuckGo",
    url: "https://duckduckgo.com/?q=%s",
    suggest: "https://duckduckgo.com/ac/?type=list&q=%s",
  },
  {
    id: "brave",
    name: "Brave Search",
    url: "https://search.brave.com/search?q=%s",
    suggest: "https://search.brave.com/api/suggest?q=%s",
  },
];

// Daftar filter setara uBlock Origin: filter uBO sendiri + EasyList + ABPindo (iklan judi/streaming Indonesia)
const DEFAULT_ADBLOCK_LISTS = [
  "https://ublockorigin.github.io/uAssets/filters/filters.min.txt",
  "https://ublockorigin.github.io/uAssets/filters/badware.min.txt",
  "https://ublockorigin.github.io/uAssets/filters/unbreak.min.txt",
  "https://ublockorigin.github.io/uAssets/filters/quick-fixes.min.txt",
  "https://easylist.to/easylist/easylist.txt",
  "https://raw.githubusercontent.com/ABPindo/indonesianadblockrules/master/subscriptions/abpindo.txt",
];

const DEFAULT_CONFIG = {
  searchEngine: "duckduckgo", // id dari searchEngines (URL lama berformat https://...%s juga masih diterima)
  searchEngines: DEFAULT_ENGINES, // ganti/tambah sesuka hati; %s = kata kunci, "suggest" boleh dihapus
  suggestions: {
    enabled: true, // dropdown saran di address bar
    remote: true, // false = hanya riwayat & bookmark, tidak ada ketikan yang dikirim ke mesin pencari
  },
  identity: {
    chromeShim: "all", // 'all' = lengkapi window.chrome dll. di semua situs (mengurangi salah deteksi bot); 'google' = hanya Google/YouTube
    clientHints: true, // UA + Client Hints ala Chrome lewat CDP (false = pakai bawaan Electron; untuk uji coba login Google)
  },
  hardwareAcceleration: true,
  restoreTabs: true, // buka kembali tab terakhir saat Saya dijalankan
  adblock: {
    enabled: true,
    level: "ublock", // 'ublock' (daftar di "lists", setara uBlock Origin) | 'ads' | 'adsAndTracking' (daftar bawaan Ghostery)
    lists: DEFAULT_ADBLOCK_LISTS, // dipakai kalau level = 'ublock'; boleh tambah/kurangi URL
    cosmetic: true, // sembunyikan kotak iklan yang tersisa + scriptlet (inilah yang menghilangkan banner persegi)
    csp: false, // true = terapkan filter $csp (mematikan skrip inline iklan, tapi bisa merusak situs Next.js seperti IDLIX)
    html: false, // true = terapkan filter HTML (##^); sangat agresif, bisa merusak halaman
    popups: true, // blokir popup / tab iklan (window.open) yang cocok dengan daftar filter, plus pembatas spam popup
    allowlist: [], // situs yang dikecualikan dari ad blocker, mis. ["x.com", "youtube.com"]
    neverBlock: [], // host tambahan yang TIDAK PERNAH disentuh (login, pembayaran, dsb.); digabung dengan daftar bawaan
    scriptlets: true, // false = matikan injeksi scriptlet uBO (YouTube, IDLIX, dsb.); sembunyikan elemen & blokir jaringan tetap jalan
    debug: false, // true = cetak URL yang diblokir ke terminal
  },
  dns: {
    mode: "automatic", // 'automatic' (fallback ke DNS sistem) | 'secure' (wajib DoH) | 'off'
    servers: [
      "https://cloudflare-dns.com/dns-query",
      "https://dns.google/dns-query",
      "https://dns.quad9.net/dns-query",
    ],
  },
  history: {
    enabled: true,
    maxEntries: 5000, // yang terlama dibuang otomatis
  },
  tabSuspend: {
    enabled: true, // tab latar belakang yang menganggur dibebaskan dari RAM
    afterMinutes: 5,
    neverSuspend: ["web.whatsapp.com", "meet.google.com"], // host yang tidak pernah ditidurkan (cocok dengan subdomain juga)
    lowMemory: { freePercent: 15, afterMinutes: 1 }, // RAM kosong < freePercent% -> batas idle jadi afterMinutes (0 = nonaktif)
  },
};

function loadConfig() {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(__dirname, "config.json"), "utf8"),
    );
    return {
      ...DEFAULT_CONFIG,
      ...raw,
      adblock: { ...DEFAULT_CONFIG.adblock, ...raw.adblock },
      dns: { ...DEFAULT_CONFIG.dns, ...raw.dns },
      history: { ...DEFAULT_CONFIG.history, ...raw.history },
      tabSuspend: {
        ...DEFAULT_CONFIG.tabSuspend,
        ...raw.tabSuspend,
        lowMemory: {
          ...DEFAULT_CONFIG.tabSuspend.lowMemory,
          ...raw.tabSuspend?.lowMemory,
        },
      },
      suggestions: { ...DEFAULT_CONFIG.suggestions, ...raw.suggestions },
      identity: { ...DEFAULT_CONFIG.identity, ...raw.identity },
    };
  } catch (err) {
    console.error(
      "[config] gagal membaca config.json, pakai default:",
      err.message,
    );
    return DEFAULT_CONFIG;
  }
}

const config = loadConfig();

// Pilihan dari halaman Settings (userData/settings.json) menimpa config.json
const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");
const DNS_MODES = ["secure", "automatic", "off"];
const CACHE_LIMITS = [0, 50, 100, 250, 500]; // MB; 0 = otomatis (bawaan Chromium)

function isDohUrl(u) {
  if (typeof u !== "string" || u.length > 300) return false;
  try {
    const x = new URL(u);
    return (
      x.protocol === "https:" && !!x.hostname && !x.username && !x.password
    );
  } catch {
    return false;
  }
}

function readSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    return s && typeof s === "object" && !Array.isArray(s) ? s : {};
  } catch {
    return {};
  }
}

function writeSettings(patch) {
  const tmp = SETTINGS_FILE + ".tmp";
  fs.writeFileSync(
    tmp,
    JSON.stringify({ ...readSettings(), ...patch }, null, 2),
  );
  fs.renameSync(tmp, SETTINGS_FILE);
}

{
  const s = readSettings();
  if (DNS_MODES.includes(s.dnsMode)) config.dns.mode = s.dnsMode;
  if (
    Array.isArray(s.dnsServers) &&
    s.dnsServers.length >= 1 &&
    s.dnsServers.length <= 5 &&
    s.dnsServers.every(isDohUrl)
  )
    config.dns.servers = s.dnsServers;
  if (CACHE_LIMITS.includes(s.cacheLimitMB))
    config.cacheLimitMB = s.cacheLimitMB;
}
const cacheLimitAtStart = config.cacheLimitMB | 0; // perubahan batas baru berlaku setelah Saya dibuka ulang
if (cacheLimitAtStart > 0)
  app.commandLine.appendSwitch(
    "disk-cache-size",
    String(cacheLimitAtStart * 1024 * 1024),
  );

// Mesin pencari aktif (bisa diganti lewat Ctrl+E / Alt+1..9, pilihan terakhir disimpan di session.json)
const isEngine = (e) =>
  e &&
  typeof e.id === "string" &&
  typeof e.name === "string" &&
  typeof e.url === "string" &&
  e.url.includes("%s");
const engines = Array.isArray(config.searchEngines)
  ? config.searchEngines.filter(isEngine)
  : [];
if (!engines.length) engines.push(...DEFAULT_ENGINES);
let engineIdx = Math.max(
  0,
  engines.findIndex(
    (e) => e.id === config.searchEngine || e.url === config.searchEngine,
  ),
);
const engine = () => engines[engineIdx] || engines[0];
const searchUrl = (q) => engine().url.replace("%s", encodeURIComponent(q));

// Matikan fitur Chromium yang tidak dipakai browser ini (hemat RAM & proses latar belakang)
app.commandLine.appendSwitch(
  "disable-features",
  "Translate,MediaRouter,OptimizationHints",
);
app.commandLine.appendSwitch("disable-blink-features", "AutomationControlled"); // navigator.webdriver tetap false

// Pindahkan data lama (riwayat, bookmark, sesi, izin, login) dari folder "Sift" ke "Saya", sekali saja
try {
  const oldDir = path.join(app.getPath("appData"), "Sift");
  const newDir = app.getPath("userData");
  if (oldDir.toLowerCase() !== newDir.toLowerCase() && fs.existsSync(oldDir)) {
    const skip =
      /^(Cache|Code Cache|GPUCache|DawnCache|GrShaderCache|ShaderCache|Crashpad|blob_storage)$/i;
    fs.cpSync(oldDir, newDir, {
      recursive: true,
      force: false, // file yang sudah ada di folder baru tidak ditimpa
      errorOnExist: false,
      filter: (src) =>
        !skip.test(path.basename(src)) &&
        !/\.(bin|tmp|lock)$/i.test(src) &&
        path.basename(src) !== "lockfile",
    });
  }
} catch (e) {
  console.warn("[saya] migrasi data lama dilewati:", e.message);
}
if (process.platform === "win32") app.setAppUserModelId("Saya"); // ikon & pengelompokan taskbar

// Hanya satu Saya yang berjalan; link/perintah dari instance kedua dibuka sebagai tab baru
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
const urlFromArgs = (argv) =>
  (argv || [])
    .slice(1)
    .find((a) => typeof a === "string" && /^https?:\/\//i.test(a));
app.on("second-instance", (_e, argv) => {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  const url = urlFromArgs(argv);
  if (url) createTab(url);
});

nativeTheme.themeSource = "dark"; // hanya dark mode (UI + prefers-color-scheme untuk situs)
if (!config.hardwareAcceleration) app.disableHardwareAcceleration();

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------
// Tab: { id, view, suspended, saved, lastActive, favicon, errorUrl, restoring, keepAlive }
//  - view      : WebContentsView (null kalau tab sedang tidur)
//  - saved     : { entries, index, snap } milik tab yang tidur
//  - errorUrl  : url asli yang gagal dimuat (ditampilkan di address bar)
//  - keepAlive : true setelah izin mikrofon/kamera diberikan; tab tidak ditidurkan sampai navigasi berikutnya
const tabs = new Map();
let activeId = null;
let nextId = 1;
let win = null;
let htmlFullscreen = false;
let stores = null;
const closedTabs = []; // URL tab yang baru ditutup (maks 10), untuk Ctrl+Shift+T
let sessionLocked = false;
let saveTimer = null;

let blocker = null;
let adblockOn = false;
let blockedCount = 0;
let countTimer = null;

// ---------------------------------------------------------------
// Util
// ---------------------------------------------------------------
function toUrl(input) {
  const text = String(input || "").trim();
  if (!text) return NEWTAB_URL;
  const internal =
    /^(?:saya|sift):\/\/(history|bookmarks|downloads|about|credits|settings)\/?$/i.exec(
      text,
    );
  if (internal) return PAGES[internal[1].toLowerCase()];
  if (
    /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ||
    /^(about|data|file|view-source):/i.test(text)
  ) {
    return text;
  }
  if (/^(localhost|(\d{1,3}\.){3}\d{1,3})(:\d+)?([/?#].*)?$/i.test(text)) {
    return "http://" + text;
  }
  if (!/\s/.test(text) && /^[^\s/]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(text)) {
    return "https://" + text;
  }
  return searchUrl(text);
}

function sendUI(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function onUI(channel, handler) {
  ipcMain.on(channel, (event, ...args) => {
    if (win && event.sender === win.webContents) handler(...args);
  });
}

function handleUI(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!win || event.sender !== win.webContents) return null;
    return handler(...args);
  });
}

// Hanya halaman internal (renderer/*.html) yang boleh memanggil API riwayat/bookmark
function handleInternal(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    const from = event.senderFrame?.url || "";
    if (!from.startsWith(INTERNAL_BASE)) return null;
    return handler(...args);
  });
}

const activeTab = () => tabs.get(activeId);
const activeWC = () => activeTab()?.view?.webContents;

function tabState(tab) {
  if (!tab) return null;
  let s;
  if (tab.suspended) {
    s = { ...tab.saved.snap, loading: false };
  } else {
    const wc = tab.view.webContents;
    let url = wc.getURL();
    if (url === NEWTAB_URL) url = "";
    else if (PAGE_NAMES.has(url)) url = "saya://" + PAGE_NAMES.get(url);
    else if (url.startsWith(ERROR_URL) || url.startsWith("chrome-error://"))
      url = tab.errorUrl || "";
    s = {
      id: tab.id,
      url,
      title: wc.getTitle() || url || "New Tab",
      loading: wc.isLoading() || wc.isWaitingForResponse(), // tetap "loading" selama menunggu respons pertama
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
    };
  }
  return {
    ...s,
    favicon: tab.favicon,
    suspended: tab.suspended,
    audible: !tab.suspended && tab.view.webContents.isCurrentlyAudible(),
    muted: !!tab.muted,
    bookmarkable: isWeb(s.url),
    bookmarked: stores.bookmarks.has(s.url),
  };
}

// Judul jendela = judul tab aktif ("(96) WhatsApp - Saya"). Windows memakainya untuk preview taskbar dan Alt+Tab.
let winTitle = "";
function syncWindowTitle(s) {
  if (!win || win.isDestroyed()) return;
  const t = s?.title ? `${String(s.title).slice(0, 200)} - Saya` : "Saya";
  if (t === winTitle) return;
  winTitle = t;
  win.setTitle(t);
}

const pushTab = (tab) => {
  if (!tabs.has(tab.id)) return;
  const s = tabState(tab);
  sendUI("tab:update", s);
  if (tab.id === activeId) syncWindowTitle(s);
};
const refreshActive = () => activeTab() && pushTab(activeTab());

function layout() {
  layoutViews();
  findLayout();
}

function layoutViews() {
  if (!win || win.isDestroyed()) return;
  const [w, h] = win.getContentSize();
  const tab = activeTab();
  const view = tab?.view;
  if (!view) return;
  const top = htmlFullscreen ? 0 : CHROME_H;
  const H = Math.max(0, h - top);
  const dt = tab.devtools;
  if (dt) dt.setVisible(!htmlFullscreen);
  if (!dt || htmlFullscreen) {
    view.setBounds({ x: 0, y: top, width: w, height: H });
    return;
  }
  // DevTools terbelah: halaman 61,8% : DevTools 38,2%. Jendela lebar -> di kanan, sempit -> di bawah.
  if (w >= 900) {
    const dw = Math.round(w * 0.382);
    view.setBounds({ x: 0, y: top, width: w - dw, height: H });
    dt.setBounds({ x: w - dw, y: top, width: dw, height: H });
  } else {
    const dh = Math.round(H * 0.382);
    view.setBounds({ x: 0, y: top, width: w, height: H - dh });
    dt.setBounds({ x: 0, y: top + H - dh, width: w, height: dh });
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
  dt.webContents.on("before-input-event", handleShortcut); // F12 juga menutup dari dalam DevTools
  tab.devtools = dt;
  tab.view.webContents.setDevToolsWebContents(dt.webContents);
  tab.view.webContents.openDevTools({ mode: "detach" });
  win.contentView.addChildView(dt);
  layout();
}

function dropDevtoolsView(tab) {
  const dt = tab.devtools;
  if (!dt) return;
  tab.devtools = null;
  try {
    win.contentView.removeChildView(dt);
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

function focusAddress() {
  if (!win || win.isDestroyed()) return;
  win.webContents.focus();
  sendUI("focus-address");
}

// ---------------------------------------------------------------
// Tab
// ---------------------------------------------------------------
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
  spoofUA(wc); // UA + Client Hints konsisten (lihat spoofUA)
  wc.setAudioMuted(!!tab.muted);
  const live = () => !wc.isDestroyed() && tab.view === view;
  const push = () => {
    if (!live()) return;
    pushTab(tab);
    scheduleSave();
  };
  const record = (url) => {
    if (config.history.enabled && !tab.restoring)
      stores.history.add(url, wc.getTitle());
  };

  wc.on("did-start-navigation", (e) => {
    if (e.isMainFrame && live() && !wc.debugger.isAttached()) spoofUA(wc); // debugger bisa terlepas (DevTools, crash)
  });
  wc.on("page-title-updated", (_e, title) => {
    if (!live()) return;
    if (!tab.restoring) stores.history.setTitle(wc.getURL(), title);
    push();
  });
  wc.on("did-start-loading", push);
  wc.on("did-stop-loading", push);
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
    tab.favicon = "";
    tab.keepAlive = false; // izin media berlaku untuk halaman ini saja
    findReset(tab);
    if (!url.startsWith(ERROR_URL)) {
      tab.errorUrl = "";
      record(url);
    }
    push();
  });
  wc.on("page-favicon-updated", (_e, list) => {
    if (live() && list && list[0]) {
      tab.favicon = list[0];
      push();
    }
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
  wc.on("context-menu", (_e, params) => showContextMenu(wc, params));
  wc.on("before-input-event", handleShortcut);
  wc.on("enter-html-full-screen", () => {
    htmlFullscreen = true;
    win.setFullScreen(true);
    layout();
  });
  wc.on("leave-html-full-screen", () => {
    htmlFullscreen = false;
    win.setFullScreen(false);
    layout();
  });
  wc.setWindowOpenHandler(
    ({ url: target, disposition, features, frameName }) => {
      if (config.adblock.debug)
        console.log("[popup]", { target, disposition, features, frameName });
      if (popupBlocked(wc, target)) return { action: "deny" };
      // Popup sungguhan (window.open dengan ukuran, window.open bernama, about:blank yang nanti diisi
      // halaman asal, atau tujuan login), mis. login Google/Facebook/Apple. Harus jendela asli supaya
      // window.opener & postMessage jalan; kalau dijadikan tab biasa, hasil login tidak kembali ke halaman asal.
      if (
        target === "about:blank" ||
        disposition === "new-window" ||
        features ||
        frameName ||
        isAuthTarget(target)
      ) {
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            parent: win,
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
  wc.on("did-create-window", (child) => setupPopupWindow(child));
  return view;
}

// Jendela popup (login, dsb.): identitas browser sama dengan tab; link baru di dalamnya dibuka sebagai tab
function setupPopupWindow(child) {
  const cwc = child.webContents;
  child.setMenuBarVisibility(false);
  spoofUA(cwc);
  cwc.on("did-start-navigation", (e) => {
    if (e.isMainFrame && !cwc.isDestroyed() && !cwc.debugger.isAttached())
      spoofUA(cwc);
  });
  cwc.setWindowOpenHandler(({ url: target }) => {
    if (isWeb(target)) createTab(target);
    return { action: "deny" };
  });
}

function createTab(input) {
  if (!win || win.isDestroyed()) return;
  const url = toUrl(input);
  const id = nextId++;
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

function activateTab(id) {
  const next = tabs.get(id);
  if (!next) return;
  sgHide(); // dropdown saran akan tertutup view halaman
  dlpHide();
  if (find.open && find.tabId !== id) findClose(false); // bar cari milik tab sebelumnya
  const prev = activeTab();
  if (prev && prev !== next) {
    prev.lastActive = Date.now(); // hitung "menganggur" sejak ditinggalkan
    if (prev.view) {
      try {
        win.contentView.removeChildView(prev.view);
        if (prev.devtools) win.contentView.removeChildView(prev.devtools);
      } catch {}
    }
  }
  activeId = id;
  next.lastActive = Date.now();
  if (next.suspended) resume(next);
  win.contentView.addChildView(next.view);
  if (next.devtools) win.contentView.addChildView(next.devtools);
  layout();
  next.view.webContents.focus();
  pushTab(next);
  sendUI("tab:active", id);
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
  const wasActive = id === activeId;
  const closing = tabState(tab);
  if (closing && isWeb(closing.url)) {
    closedTabs.push(closing.url);
    if (closedTabs.length > 10) closedTabs.shift();
  }

  if (find.open && find.tabId === id) findClose(false);
  if (wasActive && tab.view) {
    try {
      win.contentView.removeChildView(tab.view);
    } catch {}
  }
  dropDevtoolsView(tab);
  tabs.delete(id);
  sendUI("tab:closed", id);
  scheduleSave();
  if (tab.view) tab.view.webContents.close();

  if (tabs.size === 0) {
    win.close();
    return;
  }
  if (wasActive) {
    activeId = null;
    activateTab(ids[idx + 1] ?? ids[idx - 1]);
  }
}

function cycleTab(dir) {
  const ids = [...tabs.keys()];
  if (ids.length < 2) return;
  const i = ids.indexOf(activeId);
  activateTab(ids[(i + dir + ids.length) % ids.length]);
}

function reopenClosed() {
  const url = closedTabs.pop();
  if (url) createTab(url);
}

// Tab hasil pemulihan dibuat dalam keadaan tidur: baru dimuat saat dibuka (RAM hemat saat startup)
function createSuspendedTab({ u, t }) {
  const id = nextId++;
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
    favicon: "",
    errorUrl: "",
    restoring: false,
  };
  tabs.set(id, tab);
  sendUI("tab:created", tabState(tab));
  return id;
}

function startTabs() {
  const saved = config.restoreTabs ? stores.session.tabs : [];
  if (saved.length) {
    const ids = saved.map(createSuspendedTab);
    activateTab(ids[Math.min(stores.session.active, ids.length - 1)]);
  }
  const url = urlFromArgs(process.argv);
  if (url) createTab(url);
  else if (!saved.length) createTab(NEWTAB_URL);
}

function saveSession() {
  if (sessionLocked || !stores || !win || win.isDestroyed()) return;
  try {
    const list = [];
    let active = 0;
    for (const tab of tabs.values()) {
      const s = tabState(tab);
      if (!s || !isWeb(s.url)) continue;
      if (tab.id === activeId) active = list.length;
      list.push({ u: s.url, t: s.title });
    }
    stores.session.set(
      list,
      active,
      win.isFullScreen() ? null : win.getNormalBounds(),
      win.isMaximized(),
    );
  } catch {}
}

function scheduleSave() {
  if (saveTimer || sessionLocked) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
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
  const host = hostOf(url);
  return !!host && inSet(neverSuspendSet, host);
}

function canSuspend(tab) {
  if (tab.id === activeId || tab.suspended || !tab.view || tab.keepAlive)
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
  stores.bookmarks.toggle(s.url, s.title);
  pushTab(tab);
}

function openInternal(name) {
  dlpHide();
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

function showMenu() {
  const sleeping = [...tabs.values()].filter((t) => t.suspended).length;
  Menu.buildFromTemplate([
    {
      label: "New tab",
      accelerator: "Ctrl+T",
      click: () => createTab(NEWTAB_URL),
    },
    { type: "separator" },
    {
      label: "History",
      accelerator: "Ctrl+H",
      click: () => openInternal("history"),
    },
    {
      label: "Bookmarks",
      accelerator: "Ctrl+Shift+O",
      click: () => openInternal("bookmarks"),
    },
    {
      label: "Downloads",
      accelerator: "Ctrl+J",
      click: () => openInternal("downloads"),
    },
    {
      label: "Downloads folder",
      click: () => shell.openPath(app.getPath("downloads")),
    },
    {
      label: "Reopen closed tab",
      accelerator: "Ctrl+Shift+T",
      enabled: closedTabs.length > 0,
      click: reopenClosed,
    },
    { type: "separator" },
    { label: "Sleep background tabs", click: () => suspendIdle(true) },
    { label: `${sleeping} tab(s) sleeping`, enabled: false },
    { type: "separator" },
    {
      label: "Reset site permissions",
      click: () => stores.permissions.clear(),
    },
    { type: "separator" },
    { label: "Settings", click: () => openInternal("settings") },
    { label: "About Saya", click: () => openInternal("about") },
    { label: "Credits", click: () => openInternal("credits") },
  ]).popup({ window: win });
}

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
  const origin = originOf(wc?.getURL());
  if (!origin) return;
  const perms = stores.permissions;
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
    ...(blocker
      ? [
          { type: "separator" },
          {
            label: isSitePaused(origin)
              ? "Ad blocker: paused on this site (click to resume)"
              : "Pause ad blocker on this site",
            click: () => {
              togglePause(origin);
              reload(activeId);
            },
          },
        ]
      : []),
    {
      label: "Reload page (to apply changes)",
      click: () => reload(activeId),
    },
  );
  Menu.buildFromTemplate(template).popup({ window: win });
}

// Klik kanan di halaman web
function showContextMenu(wc, p) {
  const groups = [];
  const sel = (p.selectionText || "").trim();

  if (p.linkURL && isWeb(p.linkURL)) {
    groups.push([
      { label: "Open link in new tab", click: () => createTab(p.linkURL) },
      {
        label: "Copy link address",
        click: () => clipboard.writeText(p.linkURL),
      },
    ]);
  }
  if (p.mediaType === "image" && isWeb(p.srcURL)) {
    groups.push([
      { label: "Open image in new tab", click: () => createTab(p.srcURL) },
      { label: "Save image", click: () => wc.downloadURL(p.srcURL) },
      {
        label: "Copy image address",
        click: () => clipboard.writeText(p.srcURL),
      },
    ]);
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
        click: () => createTab(searchUrl(sel)),
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
      { label: "Reload", click: () => reload(activeId) },
    ]);
  }
  if (blocker && isWeb(wc.getURL())) {
    const site = siteKey(wc.getURL());
    const group = [];
    if (adblockOn && !isSitePaused(wc.getURL())) {
      group.push(
        {
          label: "Block this element",
          click: () => blockElement(wc, p.x, p.y, false),
        },
        {
          label: "Block similar banners",
          click: () => blockElement(wc, p.x, p.y, true),
        },
      );
    }
    group.push({
      label: isSitePaused(wc.getURL())
        ? `Resume ad blocker on ${site}`
        : `Pause ad blocker on ${site}`,
      click: () => {
        togglePause(wc.getURL());
        wc.reload();
      },
    });
    groups.push(group);
  }
  groups.push([
    {
      label: "Inspect",
      click: () => {
        const tab = tabOf(wc);
        if (tab && !tab.devtools) openDevTools(tab);
        wc.inspectElement(p.x, p.y);
      },
    },
  ]);

  const template = [];
  groups.forEach((g, i) => {
    if (i) template.push({ type: "separator" });
    template.push(...g);
  });
  Menu.buildFromTemplate(template).popup({ window: win });
}

function handleShortcut(event, input) {
  if (input.type !== "keyDown") return;
  const ctrl = input.control || input.meta;
  const key = input.key.toLowerCase();
  const wc = activeWC();
  let handled = true;

  if (ctrl && input.shift && key === "t") reopenClosed();
  else if (ctrl && key === "t") createTab(NEWTAB_URL);
  else if (ctrl && key === "w") closeTab(activeId);
  else if (ctrl && key === "l") focusAddress();
  else if (ctrl && key === "p") wc?.print();
  else if (ctrl && key === "d") toggleBookmark();
  else if (ctrl && key === "h") openInternal("history");
  else if (ctrl && !input.shift && key === "j") openInternal("downloads");
  else if (ctrl && input.shift && key === "o") openInternal("bookmarks");
  else if (ctrl && key === "e") cycleEngine(input.shift ? -1 : 1);
  else if (
    input.alt &&
    !ctrl &&
    /^[1-9]$/.test(key) &&
    engines[Number(key) - 1]
  )
    setEngine(Number(key) - 1, { fresh: !sg.editing, refocus: sg.editing });
  else if (key === "f5" || (ctrl && key === "r")) reload(activeId);
  else if (input.alt && key === "arrowleft") {
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  } else if (input.alt && key === "arrowright") {
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  } else if (ctrl && key === "tab") cycleTab(input.shift ? -1 : 1);
  else if (key === "f12" || (ctrl && input.shift && key === "i"))
    toggleDevTools();
  else if (ctrl && !input.shift && key === "f") findOpen();
  else if (find.open && key === "escape" && !sg.editing) findClose();
  else if (find.open && key === "f3") findRun(find.text, !input.shift);
  else if (ctrl && (key === "=" || key === "+"))
    wc?.setZoomLevel(wc.getZoomLevel() + 0.5);
  else if (ctrl && key === "-") wc?.setZoomLevel(wc.getZoomLevel() - 0.5);
  else if (ctrl && key === "0") wc?.setZoomLevel(0);
  else handled = false;

  if (handled) event.preventDefault();
}

// ---------------------------------------------------------------
// Session, DNS, ad blocker
// ---------------------------------------------------------------
// ---------------------------------------------------------------
// Identitas browser. Header Sec-CH-UA dan navigator.userAgentData (JavaScript) harus
// SAMA. Kalau berbeda (header bilang "Google Chrome", JS tidak), Google menolak login
// dengan "This browser or app may not be secure". Karena itu keduanya diatur sekaligus
// lewat CDP per tab (Emulation.setUserAgentOverride), bukan hanya menimpa header.
// ---------------------------------------------------------------
const CHROME_FULL = process.versions.chrome;
const CHROME_MAJOR = CHROME_FULL.split(".")[0];
const UA_OS =
  process.platform === "win32"
    ? { ua: "Windows NT 10.0; Win64; x64", name: "Windows", ver: "10.0.0" }
    : process.platform === "darwin"
      ? {
          ua: "Macintosh; Intel Mac OS X 10_15_7",
          name: "macOS",
          ver: "10.15.7",
        }
      : { ua: "X11; Linux x86_64", name: "Linux", ver: "6.5.0" };
const UA = `Mozilla/5.0 (${UA_OS.ua}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`;
const UA_META = {
  brands: [
    { brand: "Chromium", version: CHROME_MAJOR },
    { brand: "Google Chrome", version: CHROME_MAJOR },
    { brand: "Not_A Brand", version: "24" },
  ],
  fullVersionList: [
    { brand: "Chromium", version: CHROME_FULL },
    { brand: "Google Chrome", version: CHROME_FULL },
    { brand: "Not_A Brand", version: "24.0.0.0" },
  ],
  fullVersion: CHROME_FULL,
  platform: UA_OS.name,
  platformVersion: UA_OS.ver,
  architecture: "x86",
  model: "",
  mobile: false,
  bitness: "64",
  wow64: false,
};

// Override CDP pada halaman utama TIDAK menjalar ke iframe lintas situs (proses terpisah, mis. captcha
// anti-bot, tombol login) maupun worker: di sana navigator.userAgentData tetap bawaan Electron (tanpa
// "Google Chrome"), padahal header HTTP sudah mengaku Chrome. Ketidakcocokan itu dibaca sistem anti-bot.
// Karena itu setiap target anak (iframe, worker, service worker) dipasangi override yang sama lewat
// Target.setAutoAttach. waitForDebuggerOnStart = override terpasang SEBELUM skrip pertama target jalan.
const uaHooked = new WeakSet();

async function applyUA(wc, sessionId) {
  const params = { userAgent: UA, userAgentMetadata: UA_META };
  const send = (method) => wc.debugger.sendCommand(method, params, sessionId);
  try {
    await send("Emulation.setUserAgentOverride");
  } catch {
    try {
      await send("Network.setUserAgentOverride"); // target worker tidak punya domain Emulation
    } catch {}
  }
}

function hookTargets(wc) {
  if (uaHooked.has(wc)) return;
  uaHooked.add(wc);
  wc.debugger.on("message", async (_e, method, params) => {
    if (method !== "Target.attachedToTarget") return;
    const { sessionId, targetInfo, waitingForDebugger } = params || {};
    if (!sessionId) return;
    try {
      if (wc.isDestroyed()) return;
      if (config.adblock.debug)
        console.log("[ua] target", targetInfo?.type, targetInfo?.url);
      await applyUA(wc, sessionId);
      // target anak bisa punya anak lagi (iframe bersarang, worker milik iframe)
      await wc.debugger
        .sendCommand(
          "Target.setAutoAttach",
          { autoAttach: true, waitForDebuggerOnStart: true, flatten: true },
          sessionId,
        )
        .catch(() => {});
    } catch {
    } finally {
      // WAJIB: target yang menunggu debugger tidak akan jalan sebelum dilepas
      if (waitingForDebugger) {
        try {
          wc.debugger
            .sendCommand("Runtime.runIfWaitingForDebugger", {}, sessionId)
            .catch(() => {});
        } catch {}
      }
    }
  });
}

async function spoofUA(wc) {
  if (!config.identity.clientHints) return;
  try {
    if (wc.isDestroyed()) return;
    if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
    hookTargets(wc);
    await wc.debugger.sendCommand("Emulation.setUserAgentOverride", {
      userAgent: UA,
      userAgentMetadata: UA_META,
    });
    await wc.debugger.sendCommand("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    });
  } catch (err) {
    console.warn("[ua] gagal mengatur identitas:", err.message);
  }
}

// Header Client Hints dipasang di level session, bukan lewat CDP: berlaku untuk semua request
// (tab, popup login, worker, service worker) sejak request pertama, jadi selalu cocok dengan
// navigator.userAgentData. Electron hanya mengizinkan SATU listener onBeforeSendHeaders per session,
// jadi fungsi ini dipanggil ulang setelah ad blocker terpasang (lihat enableBlocking).
function installClientHints(ses) {
  if (!config.identity.clientHints) return;
  const CH = {
    "sec-ch-ua": UA_META.brands
      .map((b) => `"${b.brand}";v="${b.version}"`)
      .join(", "),
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": `"${UA_OS.name}"`,
  };
  ses.webRequest.onBeforeSendHeaders({ urls: ["https://*/*"] }, (d, cb) => {
    try {
      const h = d.requestHeaders;
      for (const k of Object.keys(h)) if (k.toLowerCase() in CH) delete h[k];
      cb({ requestHeaders: { ...h, ...CH } });
    } catch {
      cb({ requestHeaders: d.requestHeaders });
    }
  });
}

function setupSession() {
  const ses = session.defaultSession;
  ses.setUserAgent(UA); // cadangan untuk worker/fetch; tiap tab diatur penuh oleh spoofUA()

  setupPermissions(ses);
  setupDownloads(ses);
  installClientHints(ses);
}

// ---------------------------------------------------------------
// Izin per situs: tanya sekali, ingat pilihannya. Selain daftar ini semuanya ditolak.
// (Notifikasi tidak termasuk: Electron tidak mendukung status "tanya" untuk izin itu.)
// ---------------------------------------------------------------
const ALWAYS_ALLOWED = new Set(["fullscreen", "clipboard-sanitized-write"]);
const ASKABLE = new Set(["media", "geolocation", "clipboard-read"]);
const PERM_LABEL = {
  "media:audio": "microphone",
  "media:video": "camera",
  geolocation: "location",
  "clipboard-read": "clipboard contents",
};
const pendingAsk = new Map();

function originOf(u) {
  try {
    const x = new URL(u);
    return x.protocol === "http:" || x.protocol === "https:" ? x.origin : "";
  } catch {
    return "";
  }
}

function permKeys(permission, mediaTypes) {
  if (permission !== "media") return [permission];
  const t = (mediaTypes || []).filter((x) => x === "audio" || x === "video");
  return (t.length ? t : ["audio", "video"]).map((x) => "media:" + x);
}

function askPermission(origin, keys) {
  const id = origin + "|" + keys.join(",");
  if (pendingAsk.has(id)) return pendingAsk.get(id); // permintaan sama yang sedang ditanyakan
  const task = (async () => {
    const opts = {
      type: "question",
      buttons: ["Allow", "Block"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: "Site permission",
      message: `${new URL(origin).host} wants to access ${keys.map((k) => PERM_LABEL[k] || k).join(" and ")}`,
      detail:
        "Your choice is remembered for this site. You can reset it from the menu (⋯ > Reset site permissions).",
    };
    const { response } =
      win && !win.isDestroyed()
        ? await dialog.showMessageBox(win, opts)
        : await dialog.showMessageBox(opts);
    const allow = response === 0;
    for (const k of keys) stores.permissions.set(origin, k, allow);
    return allow;
  })().finally(() => pendingAsk.delete(id));
  pendingAsk.set(id, task);
  return task;
}

function setupPermissions(ses) {
  ses.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    // Mikrofon/kamera yang diizinkan = tab sedang dipakai (panggilan, rapat): jangan ditidurkan
    const grant = (allow) => {
      if (allow && permission === "media") {
        const tab = wc && tabOf(wc);
        if (tab) tab.keepAlive = true;
      }
      callback(allow);
    };
    if (ALWAYS_ALLOWED.has(permission)) return callback(true);
    const origin = originOf(details?.requestingUrl || wc?.getURL?.());
    if (!ASKABLE.has(permission) || !origin) return callback(false);
    const keys = permKeys(permission, details?.mediaTypes);
    const known = keys.map((k) => stores.permissions.get(origin, k));
    if (known.includes(false)) return callback(false);
    if (known.every((v) => v === true)) return grant(true);
    try {
      grant(
        await askPermission(
          origin,
          keys.filter((_k, i) => known[i] === undefined),
        ),
      );
    } catch {
      callback(false);
    }
  });

  ses.setPermissionCheckHandler(
    (_wc, permission, requestingOrigin, details) => {
      if (ALWAYS_ALLOWED.has(permission)) return true;
      if (!ASKABLE.has(permission)) return false;
      const origin = originOf(requestingOrigin);
      if (!origin) return false;
      const mt = details?.mediaType;
      const keys =
        permission === "media" && (mt === "audio" || mt === "video")
          ? ["media:" + mt]
          : permKeys(permission, []);
      return keys.some((k) => stores.permissions.get(origin, k) === true);
    },
  );
}

// ---------------------------------------------------------------
// Unduhan: langsung ke folder Downloads (nama bentrok -> "nama (1).ext"),
// progres di taskbar & ikon toolbar, notifikasi saat selesai (klik = tampilkan file).
// Daftar unduhan disimpan di downloads.json (store.js). Ada dua tampilan:
//   - panel kecil (WebContentsView di bawah ikon toolbar, pola sama dengan dropdown saran)
//   - halaman penuh saya://downloads (Ctrl+J)
// Renderer hanya mengirim id + aksi; path file tidak pernah datang dari renderer.
// ---------------------------------------------------------------
const live = new Map(); // id -> DownloadItem yang sedang berjalan
const reserved = new Set(); // path yang sedang dipakai unduhan berjalan (cegah tabrakan nama)
const notes = new Set();
let dlSeq = 0;

function uniquePath(dir, name) {
  const base = path.basename(String(name || "")) || "download";
  const ext = path.extname(base);
  const stem = path.basename(base, ext);
  let p = path.join(dir, base);
  for (let i = 1; (fs.existsSync(p) || reserved.has(p)) && i < 1000; i++)
    p = path.join(dir, `${stem} (${i})${ext}`);
  return p;
}

function updateProgress() {
  if (!win || win.isDestroyed()) return;
  if (!live.size) return win.setProgressBar(-1);
  let got = 0;
  let total = 0;
  let unknown = false;
  for (const d of live.values()) {
    got += d.getReceivedBytes();
    const t = d.getTotalBytes();
    if (t) total += t;
    else unknown = true;
  }
  if (unknown || !total) win.setProgressBar(2, { mode: "indeterminate" });
  else win.setProgressBar(Math.min(1, got / total));
}

// ---- teks status ----
function fmtSize(n) {
  if (!(n >= 0)) return "";
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < units.length - 1);
  return `${n >= 100 ? n.toFixed(0) : n.toFixed(1)} ${units[i]}`;
}

function fmtEta(sec) {
  if (sec < 60) return `${Math.max(1, Math.round(sec))} sec`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  return `${Math.round(sec / 3600)} hr`;
}

function fmtAgo(ts) {
  const m = (Date.now() - ts) / 60000;
  if (m < 1) return "Just now";
  if (m < 60) return `${Math.floor(m)} min ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)} hour${Math.floor(h) === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

function dlInfo(e) {
  if (e.st === "completed")
    return e.gone
      ? "File moved or deleted"
      : `${fmtSize(e.tot || e.got)} • ${fmtAgo(e.ts)}`;
  if (e.st === "cancelled") return "Cancelled";
  if (e.st === "interrupted") return "Failed";
  const got = fmtSize(e.got);
  const of = e.tot ? `${got} of ${fmtSize(e.tot)}` : got;
  if (e.paused) return `${e.interrupted ? "Interrupted" : "Paused"} • ${of}`;
  const speed = e.speed > 0 ? ` • ${fmtSize(e.speed)}/s` : "";
  const eta =
    e.tot && e.speed > 0 ? ` • ${fmtEta((e.tot - e.got) / e.speed)} left` : "";
  return of + speed + eta;
}

function dlHost(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// Ikon file dari sistem operasi (sama seperti Chrome): app.getFileIcon, di-cache per ekstensi.
// Ekstensi yang ikonnya ada di dalam file (exe, msi, ...) di-cache per file, tapi hanya setelah selesai
// diunduh (sebelum itu filenya belum ada, jadi dipakai ikon generik ekstensinya).
const iconCache = new Map(); // kunci -> data URL ("" = gagal -> UI memakai lencana teks)
const iconBusy = new Set();
const PER_FILE_ICON = new Set(["exe", "msi", "ico", "lnk", "scr", "dll", "cur", "appx"]);

function dlIconKey(e) {
  const ext = path.extname(e.n).slice(1).toLowerCase();
  return PER_FILE_ICON.has(ext) && e.st === "completed" && !e.gone
    ? "f:" + e.p
    : "e:" + ext;
}

function dlIconFor(e) {
  const key = dlIconKey(e);
  if (!iconCache.has(key) && !iconBusy.has(key)) {
    iconBusy.add(key);
    if (iconCache.size > 300) iconCache.clear();
    app
      .getFileIcon(e.p, { size: "large" })
      .then(
        (img) => iconCache.set(key, img.isEmpty() ? "" : img.toDataURL()),
        () => iconCache.set(key, ""),
      )
      .finally(() => {
        iconBusy.delete(key);
        dlNotify(true);
      });
  }
  return key;
}

function dlView(e) {
  const running = e.st === "progressing";
  return {
    ik: dlIconFor(e),
    id: e.id,
    name: e.n,
    host: dlHost(e.u),
    ext: path.extname(e.n).slice(1).toLowerCase().slice(0, 5),
    state: running
      ? e.paused
        ? "paused"
        : "active"
      : e.st === "completed"
        ? "done"
        : e.st === "cancelled"
          ? "cancelled"
          : "failed",
    pct: running && e.tot ? Math.min(1, e.got / e.tot) : -1, // -1 = ukuran tidak diketahui
    info: dlInfo(e),
    resumable: !!e.resumable,
    gone: !!e.gone,
  };
}

// { items, icons }: ikon dikirim sebagai peta kunci -> data URL, hanya untuk kunci yang dipakai
function dlPayload(limit = Infinity) {
  const items = stores.downloads.items.slice(0, limit).map(dlView);
  const icons = {};
  for (const it of items)
    if (!(it.ik in icons)) {
      const url = iconCache.get(it.ik);
      if (url) icons[it.ik] = url;
    }
  return { items, icons };
}

// File yang sudah dihapus/dipindah ditandai (dicek saat panel/halaman dibuka)
async function dlCheck() {
  await Promise.all(
    stores.downloads.items
      .filter((e) => e.st === "completed")
      .map((e) =>
        fs.promises.access(e.p).then(
          () => (e.gone = false),
          () => (e.gone = true),
        ),
      ),
  );
}

// ---- dorong perubahan ke ikon toolbar, panel, dan halaman (dibatasi ~2,5x/detik) ----
let dlTimer = null;
function dlNotify(now) {
  if (now) {
    clearTimeout(dlTimer);
    dlTimer = null;
    return dlFlush();
  }
  if (dlTimer) return;
  dlTimer = setTimeout(() => {
    dlTimer = null;
    dlFlush();
  }, 400);
}

function dlFlush() {
  if (!win || win.isDestroyed()) return;
  let active = 0;
  let got = 0;
  let total = 0;
  let unknown = false;
  for (const e of stores.downloads.items) {
    if (e.st !== "progressing") continue;
    active++;
    got += e.got;
    if (e.tot) total += e.tot;
    else unknown = true;
  }
  sendUI("downloads:badge", {
    active,
    progress: active && !unknown && total ? Math.min(1, got / total) : -1,
  });
  if (dlp.open) {
    dlpPaint();
    dlpLayout();
  }
  const url = PAGES.downloads;
  let snap = null;
  for (const t of tabs.values()) {
    if (t.suspended || !t.view) continue;
    const wc = t.view.webContents;
    if (wc.isDestroyed() || wc.getURL() !== url) continue;
    wc.send("saya:downloads:update", (snap ||= dlPayload()));
  }
}

function setupDownloads(ses) {
  ses.on("will-download", (_e, item) => {
    const file = uniquePath(app.getPath("downloads"), item.getFilename());
    item.setSavePath(file);
    reserved.add(file);
    const now = Date.now();
    const e = {
      id: now.toString(36) + (++dlSeq).toString(36),
      n: path.basename(file),
      p: file,
      u: String(item.getURL() || "").slice(0, 2048),
      tot: item.getTotalBytes(),
      got: 0,
      ts: now,
      st: "progressing",
      // hanya di memori:
      paused: false,
      interrupted: false,
      resumable: false,
      speed: 0,
      lastB: 0,
      lastT: now,
      gone: false,
    };
    stores.downloads.add(e);
    live.set(e.id, item);
    updateProgress();
    dlNotify(true);

    item.on("updated", (_e2, state) => {
      const t = Date.now();
      e.got = item.getReceivedBytes();
      e.tot = item.getTotalBytes();
      e.interrupted = state === "interrupted";
      e.paused = e.interrupted || item.isPaused();
      e.resumable = e.paused && item.canResume();
      const dt = (t - e.lastT) / 1000;
      if (e.paused) {
        e.speed = 0;
        e.lastB = e.got;
        e.lastT = t;
      } else if (dt >= 0.5) {
        const inst = (e.got - e.lastB) / dt;
        e.speed = e.speed ? e.speed * 0.7 + inst * 0.3 : inst; // dihaluskan
        e.lastB = e.got;
        e.lastT = t;
      }
      updateProgress();
      dlNotify();
    });

    item.once("done", (_e2, state) => {
      live.delete(e.id);
      reserved.delete(file);
      e.st =
        state === "completed" || state === "cancelled" ? state : "interrupted";
      e.got = item.getReceivedBytes();
      e.tot = item.getTotalBytes() || e.got;
      e.ts = Date.now();
      e.speed = 0;
      e.paused = false;
      e.gone = false;
      stores.downloads.touch();
      updateProgress();
      dlNotify(true);
      if (state === "cancelled" || !Notification.isSupported()) return;
      const ok = state === "completed";
      const n = new Notification({
        title: ok ? "Download complete" : "Download failed",
        body: path.basename(file),
        silent: true,
      });
      notes.add(n); // simpan referensi supaya tidak dibuang sebelum diklik
      n.on("close", () => notes.delete(n));
      if (ok) n.on("click", () => shell.showItemInFolder(file));
      n.show();
    });
  });
}

function dlAct(id, action) {
  if (action === "folder") {
    shell.openPath(app.getPath("downloads"));
    return;
  }
  const e = stores.downloads.get(id);
  if (!e) return;
  const item = live.get(id);
  switch (action) {
    case "open":
      if (e.st === "completed" && !e.gone)
        fs.promises.access(e.p).then(
          () => shell.openPath(e.p),
          () => {
            e.gone = true;
            dlNotify(true);
          },
        );
      break;
    case "show":
      if (e.st === "completed" && !e.gone) shell.showItemInFolder(e.p);
      else shell.openPath(path.dirname(e.p));
      break;
    case "pause":
      if (item && !item.isPaused()) {
        item.pause();
        e.paused = true;
        e.speed = 0;
      }
      break;
    case "resume":
      if (item?.canResume()) {
        item.resume();
        e.paused = false;
        e.interrupted = false;
        e.lastB = e.got;
        e.lastT = Date.now();
      }
      break;
    case "cancel":
      item?.cancel(); // 'done' menandai statusnya
      break;
    case "retry":
      if (!item && isWeb(e.u)) {
        stores.downloads.remove(id);
        session.defaultSession.downloadURL(e.u);
      }
      break;
    case "copy":
      if (isWeb(e.u)) clipboard.writeText(e.u);
      break;
    case "remove":
      if (!item) stores.downloads.remove(id); // unduhan berjalan tidak bisa dihapus dari daftar
      break;
    default:
      return;
  }
  dlNotify(true);
}

// ---- panel kecil di bawah ikon toolbar ----
const DL_W = 360;
const DL_HEAD = 50;
const DL_ROW = 56;
const DL_FOOT = 46;
const DL_EMPTY = 72;
const DL_MAX = 6; // baris terlihat sebelum daftar bisa di-scroll
const DL_PANEL_ITEMS = 50;
const dlp = {
  view: null,
  ready: false, // dlpanel.html sudah selesai dimuat
  open: false,
  rect: null, // posisi tombol toolbar {right, bottom}
  hiddenAt: 0,
  destroyTimer: null,
};

function dlpView() {
  clearTimeout(dlp.destroyTimer);
  if (dlp.view) return dlp.view;
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "dlpanelpreload.js"),
    },
  });
  view.setBackgroundColor("#1c1c22");
  try {
    view.setBorderRadius(13);
  } catch {}
  view.setVisible(false);
  const wc = view.webContents;
  wc.on("before-input-event", handleShortcut); // Ctrl+J dst. tetap jalan saat fokus di panel
  wc.on("will-navigate", (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  // Klik di luar panel (halaman / toolbar) = panel kehilangan fokus = tutup
  wc.on("blur", () => {
    if (dlp.view === view && dlp.open) dlpHide();
  });
  wc.once("did-finish-load", () => {
    if (dlp.view !== view) return;
    dlp.ready = true;
    if (dlp.open) {
      dlpPaint();
      wc.focus();
    }
  });
  wc.loadFile(path.join(RENDERER_DIR, "dlpanel.html")).catch(() => {});
  win.contentView.addChildView(view);
  dlp.view = view;
  dlp.ready = false;
  return view;
}

function dlpPaint() {
  const wc = dlp.view?.webContents;
  if (!dlp.ready || !wc || wc.isDestroyed()) return;
  wc.send("dl:render", dlPayload(DL_PANEL_ITEMS));
}

function dlpLayout() {
  if (!dlp.view || !dlp.open || !dlp.rect || !win || win.isDestroyed()) return;
  const [w, h] = win.getContentSize();
  const n = Math.min(stores.downloads.items.length, DL_PANEL_ITEMS);
  const body = n ? Math.min(n, DL_MAX) * DL_ROW : DL_EMPTY;
  const y = Math.round(dlp.rect.bottom) + 6;
  const height = Math.max(120, Math.min(DL_HEAD + body + DL_FOOT, h - y - 8));
  const width = Math.min(DL_W, w - 16);
  // rata kanan dengan ikon, tetap di dalam jendela
  const x = Math.max(8, Math.min(Math.round(dlp.rect.right - width + 6), w - width - 8));
  dlp.view.setBounds({ x, y, width, height });
}

function dlpShow(rect) {
  if (!win || win.isDestroyed()) return;
  sgHide();
  const r = rect && typeof rect === "object" ? rect : {};
  dlp.rect = {
    right: Number(r.right) || win.getContentSize()[0] - 8,
    bottom: Number(r.bottom) || CHROME_H - 6,
  };
  dlp.open = true;
  const view = dlpView();
  dlpLayout();
  win.contentView.addChildView(view); // dipasang ulang = naik ke lapisan paling atas
  view.setVisible(true);
  if (dlp.ready) {
    dlpPaint();
    view.webContents.focus();
  }
  // tandai file yang sudah dihapus, lalu gambar ulang
  dlCheck().then(() => {
    if (dlp.open && dlp.view === view) dlpPaint();
  });
}

function dlpHide(refocusPage = false) {
  if (!dlp.open) return;
  dlp.open = false;
  dlp.hiddenAt = Date.now();
  dlp.view?.setVisible(false);
  clearTimeout(dlp.destroyTimer);
  dlp.destroyTimer = setTimeout(dlpDestroy, 30_000);
  if (refocusPage) activeWC()?.focus();
}

function dlpDestroy() {
  const view = dlp.view;
  if (!view || dlp.open) return;
  dlp.view = null;
  dlp.ready = false;
  try {
    win?.contentView.removeChildView(view);
  } catch {}
  if (!view.webContents.isDestroyed()) view.webContents.close();
}

function dlpToggle(rect) {
  if (dlp.open) return dlpHide();
  // klik pada ikon saat panel terbuka: blur sudah menutupnya lebih dulu, jangan dibuka lagi
  if (Date.now() - dlp.hiddenAt < 300) return;
  dlpShow(rect);
}

const fromDlp = (e) =>
  !!dlp.view &&
  !dlp.view.webContents.isDestroyed() &&
  e.sender === dlp.view.webContents;

onUI("downloads:toggle", dlpToggle);
ipcMain.on("dl:act", (e, id, action) => {
  if (!fromDlp(e)) return;
  action = String(action || "");
  dlAct(String(id || ""), action);
  if (action === "open" || action === "show") dlpHide();
});
ipcMain.on("dl:all", (e) => {
  if (!fromDlp(e)) return;
  dlpHide();
  openInternal("downloads");
});
ipcMain.on("dl:close", (e) => {
  if (fromDlp(e)) dlpHide(true);
});

// ---- halaman penuh (hanya halaman internal yang boleh memanggil) ----
handleInternal("saya:downloads:list", async () => {
  await dlCheck();
  return dlPayload();
});
handleInternal("saya:downloads:act", (id, action) => {
  dlAct(String(id || ""), String(action || ""));
  return true;
});
handleInternal("saya:downloads:clear", () => {
  stores.downloads.clearDone();
  dlNotify(true);
  return true;
});

function setupDns() {
  const { mode, servers } = config.dns;
  try {
    app.configureHostResolver({
      enableBuiltInResolver: true,
      secureDnsMode: mode,
      secureDnsServers: servers,
    });
  } catch (err) {
    console.error("[dns] gagal mengatur DNS:", err.message);
  }
}

// ---------------------------------------------------------------
// Filter buatan sendiri: klik kanan banner > "Block this element".
// Aturan disimpan di custom-filters.txt (folder userData), format uBO: situs.com##selector
// ---------------------------------------------------------------
const customFiltersFile = () =>
  path.join(app.getPath("userData"), "custom-filters.txt");

function readCustomFilters() {
  try {
    return fs
      .readFileSync(customFiltersFile(), "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("!"));
  } catch {
    return [];
  }
}

// Dijalankan DI DALAM halaman (diserialisasi), jadi harus mandiri.
function pickScript(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const labels = location.hostname.replace(/^www\./, "").split(".");
  const n = labels.length;
  const sld = ["co", "com", "or", "go", "ac", "net", "web", "my", "sch"];
  const base = labels
    .slice(
      n >= 3 && labels[n - 1].length === 2 && sld.includes(labels[n - 2])
        ? -3
        : -2,
    )
    .join(".");
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s);
  const valid = (s) => {
    try {
      return document.querySelector(s) !== null;
    } catch {
      return false;
    }
  };
  const isExternal = (a) => {
    try {
      const u = new URL(a.href);
      return /^https?:$/.test(u.protocol) && !u.hostname.endsWith(base)
        ? u.hostname
        : "";
    } catch {
      return "";
    }
  };
  const chain = (node) => {
    const parts = [];
    for (
      let c = node, d = 0;
      c && c.nodeType === 1 && c !== document.documentElement && d < 6;
      c = c.parentElement, d++
    ) {
      if (c.id && !/\d{3,}/.test(c.id)) {
        parts.unshift("#" + esc(c.id));
        break;
      }
      const tag = c.tagName.toLowerCase();
      if (tag === "body") {
        parts.unshift("body");
        break;
      }
      const same = c.parentElement
        ? [...c.parentElement.children].filter((k) => k.tagName === c.tagName)
        : [];
      parts.unshift(
        same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(c) + 1})` : tag,
      );
    }
    return parts.join(" > ");
  };
  const a = el.closest("a[href]");
  const ext = a ? isExternal(a) : "";
  const target = ext ? a : el.closest("iframe, img, video") || el;
  const specific = ext ? `a[href*="${ext.replace(/"/g, "")}"]` : chain(target);
  let similar = "";
  if (ext) {
    let c = a.parentElement;
    for (
      let i = 0;
      i < 3 && c && c !== document.body;
      i++, c = c.parentElement
    ) {
      const hits = [...c.querySelectorAll("a[href]")].filter(
        (k) => isExternal(k) && k.querySelector("img"),
      );
      if (hits.length >= 2) {
        similar = `${chain(c)} a[href^="http"]:not([href*="${base}"]):has(img)`;
        break;
      }
    }
  }
  return {
    base,
    specific: valid(specific) ? specific : "",
    similar: similar && valid(similar) ? similar : "",
  };
}

async function blockElement(wc, x, y, similar) {
  let r = null;
  try {
    r = await wc.executeJavaScript(
      `(${pickScript.toString()})(${x | 0},${y | 0})`,
    );
  } catch {}
  const sel = r && (similar ? r.similar || r.specific : r.specific);
  if (!sel || /[\r\n]/.test(sel)) return;
  const line = `${r.base}##${sel}`;
  try {
    fs.appendFileSync(customFiltersFile(), line + "\n");
  } catch (e) {
    console.error("[adblock] gagal menyimpan custom filter:", e.message);
  }
  try {
    blocker?.updateFromDiff({ added: [line] }); // berlaku untuk halaman yang dimuat berikutnya
  } catch {}
  wc.insertCSS(`${sel}{display:none!important}`).catch(() => {}); // langsung hilang di halaman ini
}

// Popup / tab iklan. Aturannya sengaja konservatif supaya tidak merusak login & link biasa:
//  - tujuan satu situs dengan halaman asal, host/alur login, dan situs yang di-pause: selalu boleh
//  - filter generik (tanpa tipe, mis. /ads/ atau ||domain^) TIDAK dihitung, karena di mesin ini
//    filter semacam itu juga cocok untuk navigasi halaman biasa
//  - yang diblokir: tujuan lintas situs yang cocok dengan filter khusus dokumen ($document/$popup),
//    atau spam popup lintas situs (lebih dari 2 dalam 1 detik dari tab yang sama)
const popupTimes = new WeakMap();
function popupBlocked(wc, target) {
  if (!config.adblock.popups || !adblockOn || !blocker || !isWeb(target))
    return false;
  if (isAllowlisted({ url: target, webContents: wc })) return false;
  let req;
  try {
    const { Request } = require("@ghostery/adblocker");
    const src = wc.getURL();
    // Untuk tipe mainFrame, Ghostery selalu menganggap isThirdParty=false, jadi lintas-situs dihitung dengan tipe "other"
    const cross = Request.fromRawDetails({
      url: target,
      sourceUrl: src,
      type: "other",
    }).isThirdParty;
    if (!cross) return false; // satu situs dengan halaman asal: selalu boleh
    req = Request.fromRawDetails({
      url: target,
      sourceUrl: src,
      type: "mainFrame",
    });
  } catch {
    return false;
  }
  let hit = false;
  try {
    const m = blocker.match(req);
    hit = !!(
      m.match &&
      m.filter &&
      typeof m.filter.fromAny === "function" &&
      !m.filter.fromAny()
    );
  } catch {}
  const now = Date.now();
  const recent = popupTimes.get(wc) || [];
  const times = recent.filter((t) => now - t < 1000);
  times.push(now);
  popupTimes.set(wc, times);
  const spam = times.length > 2;
  if (hit || spam) {
    if (config.adblock.debug) console.log("[adblock] popup diblokir:", target);
    blockedCount++;
    sendUI("adblock:count", blockedCount);
    return true;
  }
  return false;
}

function adblockState() {
  return { available: !!blocker, enabled: adblockOn, blocked: blockedCount };
}

// ---------------------------------------------------------------
// Pengaman: ad blocker tidak boleh merusak login, captcha, dan pembayaran.
//  1. Host login/captcha/pembayaran bawaan + config.adblock.neverBlock + allowlist tidak disentuh.
//  2. Situs yang di-pause lewat menu klik kanan / menu situs (disimpan di adblock-paused.txt).
//  3. URL yang jelas berupa alur login (/oauth, /authorize, /login, /sso, ...) tidak diblokir.
//  4. Navigasi halaman utama tidak pernah diblokir; handler yang error = request dilepas (fail-open).
// ---------------------------------------------------------------
const AUTH_HOSTS = [
  "accounts.google.com",
  "accounts.youtube.com",
  "login.microsoftonline.com",
  "login.live.com",
  "login.microsoft.com",
  "appleid.apple.com",
  "idmsa.apple.com",
  "github.com",
  "gitlab.com",
  "auth0.com",
  "okta.com",
  "oktacdn.com",
  "recaptcha.net",
  "hcaptcha.com",
  "challenges.cloudflare.com",
  "paypal.com",
  "stripe.com",
  "midtrans.com",
  "xendit.co",
];
const AUTH_PATH =
  /\/(oauth2?|authorize|authorization|sso|saml2?|openid|signin|sign-in|login|logon|auth)(\/|$)/i;

const hostOf = (u) => {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return "";
  }
};
// cocokkan host dan semua induk domainnya: a.b.com -> a.b.com, b.com, com
function inSet(set, host) {
  while (host) {
    if (set.has(host)) return true;
    const i = host.indexOf(".");
    if (i < 0) return false;
    host = host.slice(i + 1);
  }
  return false;
}

// Tujuan yang jelas berupa login (host login/pembayaran bawaan atau path /oauth, /login, dst.)
function isAuthTarget(u) {
  try {
    const x = new URL(u);
    return (
      inSet(exemptHosts(), x.hostname.toLowerCase()) ||
      AUTH_PATH.test(x.pathname)
    );
  } catch {
    return false;
  }
}

let exemptSet = null;
function exemptHosts() {
  if (!exemptSet) {
    const extra = [
      ...(config.adblock.allowlist || []),
      ...(config.adblock.neverBlock || []),
    ];
    exemptSet = new Set(
      [...AUTH_HOSTS, ...extra]
        .map((d) => String(d).trim().toLowerCase())
        .filter(Boolean),
    );
  }
  return exemptSet;
}

// Situs yang di-pause oleh pengguna (runtime, bertahan antar sesi)
const pausedFile = () =>
  path.join(app.getPath("userData"), "adblock-paused.txt");
let pausedSites = null;
function paused() {
  if (!pausedSites) {
    try {
      pausedSites = new Set(
        fs
          .readFileSync(pausedFile(), "utf8")
          .split(/\r?\n/)
          .map((l) => l.trim().toLowerCase())
          .filter(Boolean),
      );
    } catch {
      pausedSites = new Set();
    }
  }
  return pausedSites;
}
const siteKey = (url) => hostOf(url).replace(/^www\./, "");
function isSitePaused(url) {
  const k = siteKey(url);
  return !!k && inSet(paused(), k);
}
function togglePause(url) {
  const k = siteKey(url);
  if (!k) return;
  const set = paused();
  if (set.has(k)) set.delete(k);
  else set.add(k);
  try {
    fs.writeFileSync(pausedFile(), [...set].join("\n") + "\n");
  } catch (e) {
    console.error("[adblock] gagal menyimpan daftar pause:", e.message);
  }
}

// Sumber request yang benar untuk mesin filter: dokumen/frame yang meminta, bukan header Referer
// (Referer kosong di banyak login & player karena Referrer-Policy, sehingga $domain= dan pengecualian unbreak gagal).
function sourceUrlOf(details) {
  try {
    const u = details.frame && details.frame.url;
    if (u) return u;
  } catch {}
  try {
    const u = details.webContents && details.webContents.getURL();
    if (u) return u;
  } catch {}
  return details.referrer || "";
}

// Apakah request/halaman ini harus dibiarkan lewat sepenuhnya?
function isAllowlisted(details) {
  try {
    const ex = exemptHosts();
    const urls = [details.url, sourceUrlOf(details), details.referrer];
    try {
      urls.push(details.webContents && details.webContents.getURL());
    } catch {}
    for (const u of urls) {
      const h = hostOf(u);
      if (h && (inSet(ex, h) || inSet(paused(), h.replace(/^www\./, ""))))
        return true;
    }
    if (details.url && /^https?:/i.test(details.url)) {
      try {
        if (AUTH_PATH.test(new URL(details.url).pathname)) return true;
      } catch {}
    }
  } catch {}
  return false;
}

function enableBlocking() {
  const ses = session.defaultSession;
  blocker.enableBlockingInSession(ses);
  // Bungkus handler bawaan: pengecualian, sumber request yang benar, dan fail-open
  const filter = { urls: ["<all_urls>"] };
  ses.webRequest.onBeforeRequest(filter, (details, cb) => {
    let called = false;
    const once = (r) => {
      if (called) return;
      called = true;
      cb(r);
    };
    try {
      if (details.resourceType === "mainFrame" || isAllowlisted(details))
        return once({});
      blocker.onBeforeRequest(
        { ...details, referrer: sourceUrlOf(details) },
        once,
      );
    } catch (err) {
      if (config.adblock.debug)
        console.warn(
          "[adblock] onBeforeRequest error, request dilepas:",
          err.message,
        );
      once({});
    }
  });
  ses.webRequest.onHeadersReceived(filter, (details, cb) => {
    let called = false;
    const once = (r) => {
      if (called) return;
      called = true;
      cb(r);
    };
    try {
      if (isAllowlisted(details)) return once({});
      blocker.onHeadersReceived(details, once);
    } catch {
      once({});
    }
  });
  // enableBlockingInSession bisa menimpa listener onBeforeSendHeaders: pasang lagi supaya Client Hints tetap terkirim
  installClientHints(ses);
}

// Scriptlet untuk satu frame, dibungkus fungsi sendiri-sendiri + try/catch agar tidak saling bentrok
// dan satu scriptlet yang error tidak menjatuhkan yang lain.
const wrapScriptlet = (code) => `(function(){try{\n${code}\n}catch(e){}})();`;
function scriptletsFor(url, wc) {
  if (
    !adblockOn ||
    !blocker ||
    !config.adblock.cosmetic ||
    config.adblock.scriptlets === false
  )
    return [];
  if (!isWeb(url) || isAllowlisted({ url, webContents: wc })) return [];
  const { Request } = require("@ghostery/adblocker");
  const r = Request.fromRawDetails({ url, type: "mainFrame" });
  const { active, scripts } = blocker.getCosmeticsFilters({
    domain: r.domain,
    hostname: r.hostname,
    url,
    classes: [],
    hrefs: [],
    ids: [],
    getBaseRules: false,
    getInjectionRules: true,
    getExtendedRules: false,
    getRulesFromHostname: true,
    getRulesFromDOM: false,
  });
  if (active === false || !scripts.length) return [];
  if (config.adblock.debug)
    console.log(`[adblock] ${scripts.length} scriptlet ->`, url);
  return scripts.map(wrapScriptlet);
}
// sendSync: harus selalu menjawab (returnValue), kalau tidak preload halaman akan menggantung
ipcMain.on("saya:scriptlets", (e) => {
  let out = [];
  try {
    out = scriptletsFor(e.senderFrame?.url || "", e.sender);
  } catch (err) {
    if (config.adblock.debug)
      console.warn("[adblock] scriptlet error:", err.message);
  }
  e.returnValue = out;
});

async function setupAdblock() {
  if (!config.adblock.enabled) return;
  try {
    const { ElectronBlocker } = require("@ghostery/adblocker-electron");
    const { adsLists, adsAndTrackingLists } = require("@ghostery/adblocker");
    const { level, cosmetic } = config.adblock;
    let lists;
    if (level === "ublock") {
      const custom = config.adblock.lists;
      lists =
        Array.isArray(custom) && custom.length ? custom : DEFAULT_ADBLOCK_LISTS;
    } else {
      lists = level === "adsAndTracking" ? adsAndTrackingLists : adsLists;
    }
    // Nama cache memuat pengaturan + daftar, supaya mengubah config tidak memakai cache lama
    const flags = `${config.adblock.csp ? "c" : ""}${config.adblock.html ? "h" : ""}`;
    const sig = require("crypto")
      .createHash("sha1")
      .update(lists.join("\n") + flags)
      .digest("hex")
      .slice(0, 8);
    const cacheName = `adblock-${level}-${cosmetic ? "cos" : "net"}-${sig}.bin`;
    // Cache dibuang tiap 3 hari supaya filter ikut diperbarui
    try {
      const f = path.join(app.getPath("userData"), cacheName);
      if (Date.now() - fs.statSync(f).mtimeMs > 3 * 24 * 3600 * 1000)
        fs.unlinkSync(f);
    } catch {}
    blocker = await ElectronBlocker.fromLists(
      fetch,
      lists,
      {
        loadCosmeticFilters: !!cosmetic,
        loadCSPFilters: !!config.adblock.csp,
        enableHtmlFiltering: !!config.adblock.html,
      },
      {
        path: path.join(app.getPath("userData"), cacheName),
        read: fs.promises.readFile,
        write: fs.promises.writeFile,
      },
    );
    const extra = readCustomFilters();
    if (extra.length) blocker.updateFromDiff({ added: extra });
    // Ghostery menjalankan scriptlet SETELAH halaman mulai, sebagai skrip global terpisah: scriptlet yang
    // berbagi class (JSONPath, RangeParser, ...) saling bentrok ("Identifier ... has already been declared"),
    // sehingga aturan uBO (mis. IDLIX) hanya berlaku sebagian dan request pertama lolos. Jadi di sini hanya
    // CSS (sembunyikan elemen) yang dibiarkan lewat Ghostery; scriptlet diinjeksi dini oleh pagepreload.js
    // lewat IPC "saya:scriptlets" (tiap scriptlet dibungkus fungsi sendiri).
    blocker.onInjectCosmeticFilters = (event, url, msg) => {
      try {
        if (isAllowlisted({ url, webContents: event.sender })) return;
        const { Request } = require("@ghostery/adblocker");
        const r = Request.fromRawDetails({ url, type: "mainFrame" });
        const first = msg === undefined;
        const { active, styles } = blocker.getCosmeticsFilters({
          domain: r.domain,
          hostname: r.hostname,
          url,
          classes: msg?.classes,
          hrefs: msg?.hrefs,
          ids: msg?.ids,
          getBaseRules: first,
          getInjectionRules: false,
          getExtendedRules: false,
          getRulesFromHostname: first,
          getRulesFromDOM: !first,
          callerContext: {
            frameId: event.frameId,
            processId: event.processId,
            lifecycle: msg?.lifecycle,
          },
        });
        if (active === false || !styles.length) return;
        event.sender.insertCSS(styles, { cssOrigin: "user" }).catch(() => {});
      } catch (err) {
        if (config.adblock.debug)
          console.warn("[adblock] cosmetic error:", err.message);
      }
    };
    enableBlocking();
    adblockOn = true;
    blocker.on("request-blocked", (request) => {
      if (config.adblock.debug)
        console.log("[adblock] diblokir:", request?.url);
      blockedCount++;
      if (countTimer) return;
      countTimer = setTimeout(() => {
        countTimer = null;
        sendUI("adblock:count", blockedCount);
      }, 500);
    });
    sendUI("adblock:state", adblockState());
  } catch (err) {
    console.error("[adblock] gagal diaktifkan:", err.message);
  }
}

// ---------------------------------------------------------------
// Window
// ---------------------------------------------------------------
// Ukuran/posisi terakhir; posisi dibuang kalau monitornya sudah tidak ada
function savedBounds() {
  const b = stores.session.bounds;
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
  win = new BrowserWindow({
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

  if (stores.session.maximized) win.maximize();
  win.loadFile(path.join(RENDERER_DIR, "index.html"));
  win.once("ready-to-show", () => win.show());

  // UI browser sendiri tidak boleh berpindah halaman / membuka jendela
  win.on("page-title-updated", (e) => e.preventDefault()); // judul jendela diatur syncWindowTitle(), bukan <title> index.html
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("before-input-event", handleShortcut);
  win.webContents.once("did-finish-load", startTabs);

  win.on("resize", layout);
  win.on("resize", sgHide);
  win.on("move", sgHide);
  win.on("resize", () => dlpHide());
  win.on("move", () => dlpHide());
  win.on("resize", scheduleSave);
  win.on("move", scheduleSave);
  win.on("close", () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    saveSession(); // simpan tab sebelum jendela dihancurkan
    sessionLocked = true;
  });
  win.on("maximize", layout);
  win.on("unmaximize", layout);
  win.on("enter-full-screen", layout);
  win.on("leave-full-screen", layout);
  win.on("closed", () => {
    win = null;
    sg.view = null;
    sg.open = false;
    find.view = null;
    find.open = false;
    find.ready = false;
    dlp.view = null;
    dlp.open = false;
    dlp.ready = false;
    tabs.clear();
  });
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
  engineIdx = ((i % engines.length) + engines.length) % engines.length;
  stores?.session.setEngine(engine().id);
  if (win && !win.isDestroyed() && (opts.fresh || opts.refocus))
    win.webContents.focus();
  sendUI("engine:changed", {
    name: engine().name,
    fresh: !!opts.fresh,
    refocus: !!opts.refocus,
  });
}
const cycleEngine = (dir) =>
  setEngine(engineIdx + dir, { fresh: !sg.editing, refocus: sg.editing });

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
    if (!win || win.isDestroyed() || sg.view !== view) return;
    if (sg.open || Date.now() - sg.createdAt < 1500) win.webContents.focus();
  };
  view.webContents.on("focus", giveFocusBack);
  view.webContents.once("did-finish-load", () => {
    sgPaint();
    giveFocusBack();
  });
  view.webContents
    .loadFile(path.join(RENDERER_DIR, "suggest.html"))
    .catch(() => {});
  win.contentView.addChildView(view);
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
  if (!sg.view || !sg.rect || !win || win.isDestroyed()) return;
  const [w] = win.getContentSize();
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
  if (!win || win.isDestroyed()) return;
  clearTimeout(sg.hideTimer);
  const view = sgView();
  sgLayout();
  win.contentView.addChildView(view); // dipasang ulang = naik ke lapisan paling atas
  view.setVisible(true);
  sg.open = true;
  sgPaint();
}

function sgDestroy() {
  const view = sg.view;
  if (!view || sg.open) return;
  sg.view = null;
  try {
    win?.contentView.removeChildView(view);
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
  for (const b of stores.bookmarks.items) {
    if (out.length >= 2) break;
    if (
      b.u.toLowerCase().includes(needle) ||
      (b.t || "").toLowerCase().includes(needle)
    )
      add(b.u, b.t, "star");
  }
  for (const h of stores.history.suggest(q, 4)) add(h.u, h.t, "clock");
  return out;
}

function sgQuery(text, rect, force) {
  if (!config.suggestions.enabled || !win || win.isDestroyed()) return;
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
  win.contentView.addChildView(view);
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
  if (!find.view || !find.open || !win || win.isDestroyed()) return;
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
  const kids = win.contentView.children;
  if (!sg.open && !dlp.open && kids[kids.length - 1] !== find.view)
    win.contentView.addChildView(find.view);
}

function findOpen() {
  const tab = activeTab();
  const wc = tab?.view?.webContents;
  if (!win || win.isDestroyed() || !wc || wc.isDestroyed()) return;
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
  win.contentView.addChildView(view); // naik ke lapisan paling atas
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
    win?.contentView.removeChildView(view);
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

// ---------------------------------------------------------------
// IPC dari UI browser
// ---------------------------------------------------------------
onUI("tab:new", () => createTab(NEWTAB_URL));
onUI("tab:close", (id) => closeTab(id));
onUI("tab:move", (id, index) => moveTab(id, index));
onUI("tab:activate", (id) => activateTab(id));
onUI("tab:mute", (id) => {
  const tab = tabs.get(id);
  if (!tab) return;
  tab.muted = !tab.muted;
  if (tab.view && !tab.view.webContents.isDestroyed())
    tab.view.webContents.setAudioMuted(tab.muted);
  pushTab(tab);
});
onUI("nav:go", (input) => {
  sgHide();
  navigateActive(toUrl(input));
});
onUI("nav:back", () => {
  const wc = activeWC();
  if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
});
onUI("nav:forward", () => {
  const wc = activeWC();
  if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
});
onUI("nav:reload", () => reload(activeId));
onUI("bookmark:toggle", toggleBookmark);
onUI("menu:open", showMenu);
onUI("site:open", showSiteMenu);

handleUI("ui:init", () => ({
  ...adblockState(),
  engine: engine().name,
  logo: appLogo(),
}));
handleUI("adblock:toggle", () => {
  if (!blocker) return adblockState();
  adblockOn = !adblockOn;
  if (adblockOn) enableBlocking();
  else {
    try {
      blocker.disableBlockingInSession(session.defaultSession);
    } catch {}
    installClientHints(session.defaultSession); // disable bisa ikut melepas listener header
  }
  return adblockState();
});

// ---------------------------------------------------------------
// IPC dari halaman internal (riwayat & bookmark)
// ---------------------------------------------------------------
handleInternal("saya:history:list", (opts) =>
  stores.history.list({
    q: typeof opts?.q === "string" ? opts.q : "",
    limit: Number(opts?.limit),
    offset: Number(opts?.offset),
  }),
);
handleInternal("saya:history:remove", (url) => {
  if (typeof url === "string") stores.history.remove(url);
  return true;
});
handleInternal("saya:history:clear", (since) => {
  stores.history.clear(Number(since) || 0);
  return true;
});
handleInternal("saya:bookmarks:list", () => stores.bookmarks.list());
handleInternal("saya:bookmarks:remove", (url) => {
  if (typeof url === "string") stores.bookmarks.remove(url);
  refreshActive();
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
  setupDns();
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
      win && !win.isDestroyed()
        ? await dialog.showMessageBox(win, opts)
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
    openInternal(name);
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
  stores = createStores(app.getPath("userData"), config);
  const savedEngine = engines.findIndex((e) => e.id === stores.session.engine);
  if (savedEngine >= 0) engineIdx = savedEngine;
  setupSession();
  setupDns();
  createWindow();
  setupAdblock();
  if (config.tabSuspend.enabled) setInterval(() => suspendIdle(false), 30_000);
});

app.on("before-quit", () => stores?.flush());
app.on("window-all-closed", () => app.quit());
