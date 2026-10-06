// Dipasang di setiap tab, tapi hanya halaman internal (file://) yang mendapat API.
// Situs web biasa tidak melihat apa pun, dan main.js memeriksa ulang asal pemanggil.
const { contextBridge, ipcRenderer } = require('electron');

// Melengkapi hal-hal yang di Chrome asli ada tapi di Electron tidak. Default: semua situs (identity.chromeShim = "all"); atau hanya Google/YouTube.
// Dijalankan di "main world" SEBELUM skrip halaman (preload selalu lebih dulu), tanpa debugger.
// Fungsi ini diserialisasi, jadi harus mandiri (tidak boleh memakai variabel di luarnya).
function googleShim() {
  const def = (obj, key, getter) => {
    try {
      Object.defineProperty(obj, key, { get: getter, configurable: true });
    } catch {}
  };
  if (navigator.webdriver) def(Navigator.prototype, 'webdriver', () => false);

  if (!window.chrome) window.chrome = {};
  const c = window.chrome;
  const t0 = Date.now();
  if (!c.app) {
    c.app = {
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
      getDetails: () => null,
      getIsInstalled: () => false,
      runningState: () => 'cannot_run',
    };
  }
  if (!c.csi) c.csi = () => ({ startE: t0, onloadT: Date.now(), pageT: performance.now(), tran: 15 });
  if (!c.loadTimes) {
    c.loadTimes = () => ({
      requestTime: t0 / 1000,
      startLoadTime: t0 / 1000,
      commitLoadTime: t0 / 1000,
      finishDocumentLoadTime: 0,
      finishLoadTime: 0,
      firstPaintTime: 0,
      firstPaintAfterLoadTime: 0,
      navigationType: 'Other',
      wasFetchedViaSpdy: true,
      wasNpnNegotiated: true,
      npnNegotiatedProtocol: 'h2',
      wasAlternateProtocolAvailable: false,
      connectionInfo: 'h2',
    });
  }

  // Chrome asli: Notification.permission dan permissions.query('notifications') sama-sama "default"/"prompt".
  // Syptek selalu menolak notifikasi, jadi keduanya tidak konsisten (ciri browser tanpa UI).
  if (window.Notification && Notification.permission === 'denied') def(Notification, 'permission', () => 'default');
  if (navigator.permissions && navigator.permissions.query) {
    const q = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (d) =>
      d && d.name === 'notifications' ? Promise.resolve({ state: 'prompt', onchange: null }) : q(d);
  }
}

let shimAll = false;
try {
  shimAll = (process.argv || []).includes('--syptek-shim=all');
} catch {}

if (/^https?:$/.test(location.protocol) && (shimAll || /(^|\.)(google\.com|youtube\.com)$/.test(location.hostname))) {
  try {
    contextBridge.executeInMainWorld({ func: googleShim });
  } catch (err) {
    console.warn('[syptek] shim gagal:', err && err.message);
  }
}

if (location.protocol === 'file:') {
  const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
  const api = {
    historyList: (opts) => call('syptek:history:list', opts),
    historyRemove: (url) => call('syptek:history:remove', url),
    historyClear: (since) => call('syptek:history:clear', since),
    bookmarksList: () => call('syptek:bookmarks:list'),
    bookmarksRemove: (url) => call('syptek:bookmarks:remove', url),
    aboutInfo: () => call('syptek:about:info'),
    creditsList: () => call('syptek:credits:list'),
    creditsLicense: (id) => call('syptek:credits:license', id),
    open: (name) => call('syptek:open', name),
  };
  contextBridge.exposeInMainWorld('syptekAPI', api);
  contextBridge.exposeInMainWorld('siftAPI', api); // alias sementara untuk halaman internal lama (history, bookmarks, dst.)
}
