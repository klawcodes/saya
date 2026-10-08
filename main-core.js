// main-core.js — Konfigurasi, pengaturan, mesin pencari, state bersama (shared), dan util dasar.
// Modul ini TIDAK boleh require modul main-* lain (dimuat paling awal).

const { app, ipcMain, nativeTheme } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const { isWeb } = require("./store");

// State bersama lintas-modul (variabel yang di-assign ulang di banyak file; akses lewat shared.nama)
const shared = {
  win: null,
  htmlFullscreen: false,
  stores: null,
  nextId: 1,
  activeId: null,
  sessionLocked: false,
  saveTimer: null,
  blocker: null,
  adblockOn: false,
  blockedCount: 0,
  countTimer: null,
  engineIdx: 0,
};


// ---------------------------------------------------------------
// Layout (piksel) — skema golden ratio: 26 : 42 = 1 : 1.615.
// Samakan dengan --tab-h dan --bar-h di renderer/style.css.
// ---------------------------------------------------------------
const TAB_BAR_H = 28;
const TOOLBAR_H = 34;
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
shared.engineIdx = Math.max(
  0,
  engines.findIndex(
    (e) => e.id === config.searchEngine || e.url === config.searchEngine,
  ),
);
const engine = () => engines[shared.engineIdx] || engines[0];
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
if (process.platform === "win32") app.setAppUserModelId("com.saya.browser"); // ikon & pengelompokan taskbar

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
const closedTabs = []; // URL tab yang baru ditutup (maks 10), untuk Ctrl+Shift+T

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
  if (shared.win && !shared.win.isDestroyed()) shared.win.webContents.send(channel, payload);
}

function onUI(channel, handler) {
  ipcMain.on(channel, (event, ...args) => {
    if (shared.win && event.sender === shared.win.webContents) handler(...args);
  });
}

function handleUI(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!shared.win || event.sender !== shared.win.webContents) return null;
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

const activeTab = () => tabs.get(shared.activeId);
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
    bookmarked: shared.stores.bookmarks.has(s.url),
  };
}

// Judul jendela = judul tab aktif ("(96) WhatsApp - Saya"). Windows memakainya untuk preview taskbar dan Alt+Tab.
let winTitle = "";
function syncWindowTitle(s) {
  if (!shared.win || shared.win.isDestroyed()) return;
  const t = s?.title ? `${String(s.title).slice(0, 200)} - Saya` : "Saya";
  if (t === winTitle) return;
  winTitle = t;
  shared.win.setTitle(t);
}

const pushTab = (tab) => {
  if (!tabs.has(tab.id)) return;
  const s = tabState(tab);
  sendUI("tab:update", s);
  if (tab.id === shared.activeId) syncWindowTitle(s);
};

Object.assign(module.exports, {
  APP_ICON,
  BG,
  CACHE_LIMITS,
  CHROME_H,
  DEFAULT_ADBLOCK_LISTS,
  DNS_MODES,
  ERROR_URL,
  INTERNAL_BASE,
  NEWTAB_URL,
  PAGES,
  PAGE_PRELOAD,
  RENDERER_DIR,
  TAB_BAR_H,
  activeTab,
  activeWC,
  cacheLimitAtStart,
  closedTabs,
  config,
  engine,
  engines,
  handleInternal,
  handleUI,
  isDohUrl,
  onUI,
  pushTab,
  searchUrl,
  sendUI,
  shared,
  tabState,
  tabs,
  toUrl,
  writeSettings,
});
