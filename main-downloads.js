// main-downloads.js — Unduhan: pelacakan, notifikasi, panel unduhan, dan IPC halaman Downloads.

const { app, WebContentsView, ipcMain, session, Notification, shell, clipboard, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const { isWeb } = require("./store");
const {
  APP_ICON,
  CHROME_H,
  INTERNAL_BASE,
  PAGES,
  RENDERER_DIR,
  activeWC,
  config,
  handleInternal,
  onUI,
  sendUI,
  shared,
  tabs,
} = require("./main-core");
const $tabs = require("./main-tabs");
const $ui = require("./main-ui");

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
  if (!shared.win || shared.win.isDestroyed()) return;
  if (!live.size) return shared.win.setProgressBar(-1);
  let got = 0;
  let total = 0;
  let unknown = false;
  for (const d of live.values()) {
    got += d.getReceivedBytes();
    const t = d.getTotalBytes();
    if (t) total += t;
    else unknown = true;
  }
  if (unknown || !total) shared.win.setProgressBar(2, { mode: "indeterminate" });
  else shared.win.setProgressBar(Math.min(1, got / total));
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
  if (h < 24)
    return `${Math.floor(h)} hour${Math.floor(h) === 1 ? "" : "s"} ago`;
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
const PER_FILE_ICON = new Set([
  "exe",
  "msi",
  "ico",
  "lnk",
  "scr",
  "dll",
  "cur",
  "appx",
]);

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
  const items = shared.stores.downloads.items.slice(0, limit).map(dlView);
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
    shared.stores.downloads.items
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
  if (!shared.win || shared.win.isDestroyed()) return;
  let active = 0;
  let got = 0;
  let total = 0;
  let unknown = false;
  for (const e of shared.stores.downloads.items) {
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
    shared.stores.downloads.add(e);
    live.set(e.id, item);
    updateProgress();
    dlNotify(true);
    dlpAuto();

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
      shared.stores.downloads.touch();
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
  const e = shared.stores.downloads.get(id);
  if (!e) return;
  const item = live.get(id);
  switch (action) {
    case "open":
      if (e.st === "completed" && !e.gone)
        fs.promises.access(e.p).then(
          () => {
            // gambar/txt/pdf dibuka di tab baru (seperti Chrome); jenis lain dengan aplikasi bawaan Windows
            if (config.downloads?.openInTab !== false && $tabs.isViewable(e.p))
              $tabs.openLocalFile(e.p);
            else shell.openPath(e.p);
          },
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
        shared.stores.downloads.remove(id);
        session.defaultSession.downloadURL(e.u);
      }
      break;
    case "copy":
      if (isWeb(e.u)) clipboard.writeText(e.u);
      break;
    case "remove":
      if (!item) shared.stores.downloads.remove(id); // unduhan berjalan tidak bisa dihapus dari daftar
      break;
    default:
      return;
  }
  dlNotify(true);
}

// Seret file unduhan ke aplikasi lain / desktop / area upload di situs (drag & drop sungguhan).
// Renderer hanya mengirim id; path diambil dari daftar. startDrag harus dipanggil dari event pengirim.
const DRAG_FALLBACK =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function dlDrag(sender, id) {
  const e = shared.stores.downloads.get(id);
  if (!e || e.st !== "completed" || e.gone) return;
  if (!fs.existsSync(e.p)) {
    e.gone = true;
    dlNotify(true);
    return;
  }
  let icon = nativeImage.createEmpty();
  const url = iconCache.get(dlIconKey(e));
  if (url) icon = nativeImage.createFromDataURL(url);
  if (icon.isEmpty())
    icon = nativeImage
      .createFromPath(APP_ICON)
      .resize({ width: 32, height: 32 });
  if (icon.isEmpty()) icon = nativeImage.createFromDataURL(DRAG_FALLBACK);
  try {
    sender.startDrag({ file: e.p, icon });
  } catch (err) {
    console.error("[downloads] gagal memulai drag:", err.message);
  }
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
  auto: false, // dibuka otomatis saat unduhan dimulai (tanpa fokus, tutup sendiri)
  autoTimer: null,
};
const DL_AUTO_MS = 5000;

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
  wc.on("before-input-event", $ui.handleShortcut); // Ctrl+J dst. tetap jalan saat fokus di panel
  wc.on("will-navigate", (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  // Klik di luar panel (halaman / toolbar) = panel kehilangan fokus = tutup
  wc.on("blur", () => {
    if (dlp.view === view && dlp.open) dlpHide();
  });
  // Pengguna mengklik panel yang muncul otomatis: dia sedang memakainya, jangan ditutup sendiri
  wc.on("focus", () => {
    if (dlp.view !== view) return;
    dlp.auto = false;
    clearTimeout(dlp.autoTimer);
  });
  wc.once("did-finish-load", () => {
    if (dlp.view !== view) return;
    dlp.ready = true;
    if (dlp.open) {
      dlpPaint();
      if (!dlp.auto) wc.focus();
    }
  });
  wc.loadFile(path.join(RENDERER_DIR, "dlpanel.html")).catch(() => {});
  shared.win.contentView.addChildView(view);
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
  if (!dlp.view || !dlp.open || !dlp.rect || !shared.win || shared.win.isDestroyed()) return;
  const [w, h] = shared.win.getContentSize();
  const n = Math.min(shared.stores.downloads.items.length, DL_PANEL_ITEMS);
  const body = n ? Math.min(n, DL_MAX) * DL_ROW : DL_EMPTY;
  const y = Math.round(dlp.rect.bottom) + 6;
  const height = Math.max(120, Math.min(DL_HEAD + body + DL_FOOT, h - y - 8));
  const width = Math.min(DL_W, w - 16);
  // rata kanan dengan ikon, tetap di dalam jendela
  const x = Math.max(
    8,
    Math.min(Math.round(dlp.rect.right - width + 6), w - width - 8),
  );
  dlp.view.setBounds({ x, y, width, height });
}

function dlpShow(rect, auto = false) {
  if (!shared.win || shared.win.isDestroyed()) return;
  $ui.sgHide();
  $ui.mpHide();
  dlp.auto = auto;
  const r = rect && typeof rect === "object" ? rect : dlp.rect || {};
  dlp.rect = {
    right: Number(r.right) || shared.win.getContentSize()[0] - 8,
    bottom: Number(r.bottom) || CHROME_H - 6,
  };
  dlp.open = true;
  const view = dlpView();
  dlpLayout();
  shared.win.contentView.addChildView(view); // dipasang ulang = naik ke lapisan paling atas
  view.setVisible(true);
  if (dlp.ready) {
    dlpPaint();
    if (!auto) view.webContents.focus(); // panel otomatis tidak boleh merebut fokus dari halaman/ketikan
  }
  // tandai file yang sudah dihapus, lalu gambar ulang
  dlCheck().then(() => {
    if (dlp.open && dlp.view === view) dlpPaint();
  });
}

function dlpHide(refocusPage = false) {
  if (!dlp.open) return;
  dlp.open = false;
  dlp.auto = false;
  clearTimeout(dlp.autoTimer);
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
    shared.win?.contentView.removeChildView(view);
  } catch {}
  if (!view.webContents.isDestroyed()) view.webContents.close();
}

function dlpToggle(rect) {
  if (dlp.open && dlp.auto) {
    // klik ikon saat panel otomatis tampil: jadikan panel biasa (fokus, tidak tutup sendiri)
    dlp.auto = false;
    clearTimeout(dlp.autoTimer);
    dlp.view?.webContents.focus();
    return;
  }
  if (dlp.open) return dlpHide();
  // klik pada ikon saat panel terbuka: blur sudah menutupnya lebih dulu, jangan dibuka lagi
  if (Date.now() - dlp.hiddenAt < 300) return;
  dlpShow(rect);
}

// Unduhan baru dimulai: tampilkan panel (tanpa fokus) lalu tutup sendiri setelah 5 detik.
// Tetap terbuka selama kursor di atas panel. Dilewati kalau dropdown saran sedang terbuka,
// jendela tidak terlihat, atau layar penuh.
function dlpArm() {
  clearTimeout(dlp.autoTimer);
  dlp.autoTimer = setTimeout(() => {
    if (dlp.open && dlp.auto) dlpHide();
  }, DL_AUTO_MS);
}

function dlpAuto() {
  if (config.downloads?.autoPanel === false) return;
  if (!shared.win || shared.win.isDestroyed() || !shared.win.isVisible() || shared.win.isMinimized())
    return;
  if (shared.htmlFullscreen || $ui.sg.open || $ui.mp.open) return;
  if (dlp.open) {
    if (dlp.auto) dlpArm(); // unduhan lain mulai: perpanjang
    return;
  }
  dlpShow(null, true);
  dlpArm();
}

const fromDlp = (e) =>
  !!dlp.view &&
  !dlp.view.webContents.isDestroyed() &&
  e.sender === dlp.view.webContents;

onUI("downloads:toggle", dlpToggle);
// Posisi ikon unduhan (dilaporkan UI saat mulai & saat jendela di-resize) untuk panel otomatis
onUI("downloads:anchor", (r) => {
  if (r && Number.isFinite(r.right) && Number.isFinite(r.bottom))
    dlp.rect = { right: r.right, bottom: r.bottom };
});
ipcMain.on("dl:hover", (e, over) => {
  if (!fromDlp(e) || !dlp.open || !dlp.auto) return;
  if (over) clearTimeout(dlp.autoTimer);
  else dlpArm();
});
ipcMain.on("dl:act", (e, id, action) => {
  if (!fromDlp(e)) return;
  action = String(action || "");
  dlAct(String(id || ""), action);
  if (action === "open" || action === "show") dlpHide();
});
ipcMain.on("dl:drag", (e, id) => {
  if (fromDlp(e)) dlDrag(e.sender, String(id || ""));
});
ipcMain.on("dl:all", (e) => {
  if (!fromDlp(e)) return;
  dlpHide();
  $tabs.openInternal("downloads");
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
ipcMain.on("saya:downloads:drag", (e, id) => {
  if (!(e.senderFrame?.url || "").startsWith(INTERNAL_BASE)) return;
  dlDrag(e.sender, String(id || ""));
});
handleInternal("saya:downloads:clear", () => {
  shared.stores.downloads.clearDone();
  dlNotify(true);
  return true;
});

Object.assign(module.exports, {
  dlp,
  dlpHide,
  setupDownloads,
});
