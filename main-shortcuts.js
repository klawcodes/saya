// main-shortcuts.js — Shortcut situs di halaman Tab Baru.
//
// Maks 8 ikon. Urutan dari kiri ke kanan: situs paling sering dikunjungi (otomatis; daftarnya diperbarui
// tiap 3 hari), lalu shortcut buatan pengguna. Pengguna baru mulai kosong (hanya tombol "Add shortcut") dan
// boleh menambah sampai 8 shortcut sendiri. Begitu daftar otomatis terisi (maks 7), tersisa 1 slot untuk
// shortcut buatan sendiri. Setiap ikon bisa diedit (nama + URL) atau dihapus lewat tombol titik tiga.
//
// Data disimpan di userData/shortcuts.json. Modul ini hanya bergantung pada main-core.

const { app, ipcMain, net, session } = require("electron");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");
const { NEWTAB_URL } = require("./main-core");

const MAX = 8; // total ikon
const MAX_AUTO = 7; // sisakan minimal 1 slot untuk shortcut buatan sendiri
const REFRESH_MS = 3 * 24 * 60 * 60 * 1000; // daftar otomatis diperbarui tiap 3 hari
const VISIT_GAP_MS = 5 * 60 * 1000; // satu "kunjungan" = kembali ke situs yang sama setelah >= 5 menit
const MAX_STATS = 300; // jumlah situs yang dihitung kunjungannya (yang paling jarang dibuang)
const MAX_HIDDEN = 200;
const FILE = path.join(app.getPath("userData"), "shortcuts.json");

// data: { v, autoAt, auto: [key], stats: {key: {u,t,f,n,last}}, overrides: {key: {t,u}}, hidden: [key], custom: [{id,t,u}] }
let data = null;
let saveTimer = null;
let dialogWc = 0; // id webContents Tab Baru yang sedang menampilkan dialog (ketikan tidak boleh dibelokkan ke address bar)

// ---------------------------------------------------------------
// Util URL & judul
// ---------------------------------------------------------------
function parse(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}
const keyOf = (u) => u.host.toLowerCase().replace(/^www\./, "");
const keyOfUrl = (s) => {
  const u = parse(s);
  return u ? keyOf(u) : "";
};
const originOf = (u) => `${u.protocol}//${u.host}/`;

// Input pengguna -> URL http(s) yang valid, atau null
function normalizeUrl(input) {
  let s = String(input ?? "").trim();
  if (!s || s.length > 2000 || /\s/.test(s)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "https://" + s;
  const u = parse(s);
  if (!u || u.username || u.password) return null;
  if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
  return u.href;
}

// "(4289) YouTube" -> "YouTube"
function cleanTitle(t) {
  return String(t ?? "")
    .replace(/^\(\d+\+?\)\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decodeEntities = (s) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n =
        e[1].toLowerCase() === "x"
          ? parseInt(e.slice(2), 16)
          : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000
        ? String.fromCodePoint(n)
        : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

// Ambil <title> dari awal halaman (maks ~100 KB, 4 detik). Dipakai kalau pengguna mengosongkan nama.
async function fetchTitle(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await net.fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "text/html" },
    });
    if (
      !res.ok ||
      !res.body ||
      !/html/i.test(res.headers.get("content-type") || "")
    )
      return "";
    const reader = res.body.getReader();
    const dec = new TextDecoder("utf-8");
    let html = "";
    try {
      while (html.length < 100_000) {
        const { done, value } = await reader.read();
        if (done) break;
        html += dec.decode(value, { stream: true });
        const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
        if (m) return cleanTitle(decodeEntities(m[1]));
      }
    } finally {
      reader.cancel().catch(() => {});
    }
    return "";
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

// Nama shortcut: yang diketik pengguna; kalau kosong -> judul yang sudah tercatat dari kunjungan,
// lalu judul hasil fetch, lalu nama host.
async function resolveName(raw, url) {
  const typed = cleanTitle(raw);
  if (typed) return typed;
  const key = keyOfUrl(url);
  const known = data.stats[key];
  if (known && known.t !== key) return known.t;
  return (await fetchTitle(url)) || key;
}

// ---------------------------------------------------------------
// Penyimpanan
// ---------------------------------------------------------------
const isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const strings = (a) => (Array.isArray(a) ? a.filter((k) => typeof k === "string") : []);

function load() {
  const d = {
    v: 1,
    autoAt: Date.now(), // pemasangan baru: pembaruan pertama 3 hari lagi
    auto: [],
    stats: {},
    overrides: {},
    hidden: [],
    custom: [],
  };
  let existed = false;
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (isObj(raw)) {
      existed = true;
      if (Number.isFinite(raw.autoAt)) d.autoAt = raw.autoAt;
      d.auto = strings(raw.auto);
      if (isObj(raw.stats)) d.stats = raw.stats;
      if (isObj(raw.overrides)) d.overrides = raw.overrides;
      d.hidden = strings(raw.hidden);
      if (Array.isArray(raw.custom))
        d.custom = raw.custom
          .filter(
            (c) =>
              c &&
              typeof c.id === "string" &&
              typeof c.t === "string" &&
              typeof c.u === "string",
          )
          .slice(0, MAX);
    }
  } catch {}
  data = d;
  if (!existed) flush(); // simpan waktu pemasangan supaya tidak ter-reset tiap Saya dibuka
  return d;
}

function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!data) return;
  try {
    const tmp = FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, FILE);
  } catch (err) {
    console.warn("[shortcuts] gagal menyimpan:", err.message);
  }
}

function save(delay) {
  if (!data || saveTimer) return;
  saveTimer = setTimeout(flush, delay);
}

// ---------------------------------------------------------------
// Pencatatan kunjungan (dipanggil dari main-tabs.js)
// ---------------------------------------------------------------
function prune() {
  const keys = Object.keys(data.stats);
  if (keys.length <= MAX_STATS + 50) return;
  const keep = new Set([
    ...data.auto,
    ...Object.keys(data.overrides),
    ...data.custom.map((c) => keyOfUrl(c.u)),
  ]);
  const drop = keys
    .filter((k) => !keep.has(k))
    .sort(
      (a, b) =>
        data.stats[b].n - data.stats[a].n ||
        data.stats[b].last - data.stats[a].last,
    )
    .slice(MAX_STATS - keep.size);
  for (const k of drop) delete data.stats[k];
}

function visit(url) {
  if (!data) return;
  const u = parse(url);
  if (!u) return;
  const key = keyOf(u);
  const now = Date.now();
  const s = (data.stats[key] ||= { u: originOf(u), t: key, f: "", n: 0, last: 0 });
  if (now - s.last >= VISIT_GAP_MS) s.n++;
  s.last = now;
  s.u = originOf(u);
  prune();
  save(5000);
}

// Judul diambil dari halaman utama situs ("/") saja: judul halaman dalam (video, email, dsb.) tidak mewakili situsnya
function setTitle(url, title) {
  if (!data) return;
  const u = parse(url);
  const s = u && data.stats[keyOf(u)];
  if (!s || u.pathname !== "/") return;
  const t = cleanTitle(title);
  if (!t || t.toLowerCase() === u.host.toLowerCase() || t === s.t) return;
  s.t = t;
  save(5000);
}

function setFavicon(url, favicon) {
  if (!data) return;
  const u = parse(url);
  const s = u && data.stats[keyOf(u)];
  const f = String(favicon ?? "");
  if (!s || !/^https?:\/\//i.test(f) || f.length > 500 || s.f === f) return;
  s.f = f;
  save(5000);
}

// ---------------------------------------------------------------
// Daftar otomatis (most visited)
// ---------------------------------------------------------------
function rank() {
  const skip = new Set([...data.hidden, ...data.custom.map((c) => keyOfUrl(c.u))]);
  return Object.entries(data.stats)
    .filter(([k, s]) => !skip.has(k) && s.n > 0)
    .sort((a, b) => b[1].n - a[1].n || b[1].last - a[1].last)
    .map(([k]) => k);
}

const autoSlots = () => Math.max(0, Math.min(MAX_AUTO, MAX - data.custom.length));

function recomputeAuto() {
  data.auto = rank().slice(0, autoSlots());
  data.autoAt = Date.now();
  // Edit nama/URL hanya berlaku untuk situs yang masih ada di daftar
  for (const k of Object.keys(data.overrides))
    if (!data.auto.includes(k)) delete data.overrides[k];
}

// Setelah satu ikon otomatis dihapus: isi slot kosong dengan situs berikutnya (urutan lain tidak berubah)
function backfillAuto() {
  const have = new Set(data.auto);
  for (const k of rank()) {
    if (data.auto.length >= autoSlots()) break;
    if (!have.has(k)) data.auto.push(k);
  }
}

function maybeRefresh() {
  if (!data) return;
  const age = Date.now() - data.autoAt;
  if (age >= 0 && age < REFRESH_MS) return;
  recomputeAuto();
  flush();
}

// ---------------------------------------------------------------
// Data untuk halaman Tab Baru
// ---------------------------------------------------------------
function faviconFor(url) {
  const u = parse(url);
  if (!u) return "";
  return data.stats[keyOf(u)]?.f || originOf(u) + "favicon.ico";
}

function viewState() {
  const customKeys = new Set(data.custom.map((c) => keyOfUrl(c.u)));
  const items = [];
  for (const key of data.auto) {
    const s = data.stats[key];
    if (!s || data.hidden.includes(key) || customKeys.has(key)) continue;
    const o = data.overrides[key];
    const u = o?.u || s.u;
    items.push({ id: "a:" + key, t: o?.t || s.t, u, f: faviconFor(u), kind: "auto" });
  }
  for (const c of data.custom)
    items.push({ id: c.id, t: c.t, u: c.u, f: faviconFor(c.u), kind: "custom" });
  const list = items.slice(0, MAX);
  return { items: list, canAdd: list.length < MAX };
}

const ok = () => ({ ok: true, ...viewState() });
const fail = (error) => ({ ok: false, error });

// Hanya halaman Tab Baru (frame utama) yang boleh memakai API ini
function fromNewTab(e) {
  const f = e.senderFrame;
  return (
    !!data &&
    !!f &&
    f === e.sender.mainFrame &&
    String(f.url).split(/[?#]/)[0] === NEWTAB_URL
  );
}

ipcMain.handle("newtab:sc:list", (e) => {
  if (!fromNewTab(e)) return null;
  maybeRefresh();
  return ok();
});

ipcMain.handle("newtab:sc:add", async (e, item) => {
  if (!fromNewTab(e)) return fail("Not available.");
  const full = () => viewState().items.length >= MAX;
  if (full()) return fail("You can have up to 8 shortcuts. Remove one first.");
  const u = normalizeUrl(item?.u);
  if (!u) return fail("Enter a valid web address, for example example.com.");
  const t = await resolveName(item?.t, u);
  if (full()) return fail("You can have up to 8 shortcuts. Remove one first.");
  data.custom.push({ id: "c:" + randomUUID(), t, u });
  flush();
  return ok();
});

ipcMain.handle("newtab:sc:edit", async (e, id, item) => {
  if (!fromNewTab(e) || typeof id !== "string") return fail("Not available.");
  const u = normalizeUrl(item?.u);
  if (!u) return fail("Enter a valid web address, for example example.com.");
  const t = await resolveName(item?.t, u);
  if (id.startsWith("c:")) {
    const c = data.custom.find((x) => x.id === id);
    if (!c) return fail("Shortcut not found.");
    c.t = t;
    c.u = u;
  } else if (id.startsWith("a:")) {
    const key = id.slice(2);
    if (!data.auto.includes(key)) return fail("Shortcut not found.");
    data.overrides[key] = { t, u };
  } else return fail("Shortcut not found.");
  flush();
  return ok();
});

ipcMain.handle("newtab:sc:remove", (e, id) => {
  if (!fromNewTab(e) || typeof id !== "string") return fail("Not available.");
  if (id.startsWith("c:")) {
    data.custom = data.custom.filter((x) => x.id !== id);
  } else if (id.startsWith("a:")) {
    const key = id.slice(2);
    data.auto = data.auto.filter((k) => k !== key);
    delete data.overrides[key];
    if (!data.hidden.includes(key)) data.hidden.push(key); // tidak diusulkan lagi
    if (data.hidden.length > MAX_HIDDEN) data.hidden.shift();
    backfillAuto();
  } else return fail("Shortcut not found.");
  flush();
  return ok();
});

// Dialog tambah/edit terbuka: ketikan di Tab Baru tidak boleh dialihkan ke address bar (lihat newTabTyping di main-tabs.js)
ipcMain.on("newtab:sc:dialog", (e, open) => {
  if (!fromNewTab(e)) return;
  dialogWc = open ? e.sender.id : 0;
});
const typingBlocked = (wc) => dialogWc !== 0 && wc.id === dialogWc;
const resetDialog = (wc) => {
  if (wc.id === dialogWc) dialogWc = 0;
};

// ---------------------------------------------------------------
// Start
// ---------------------------------------------------------------
function init() {
  load();
  // Preload khusus Tab Baru (mengekspos window.newtabAPI hanya di newtab.html)
  try {
    session.defaultSession.registerPreloadScript({
      type: "frame",
      filePath: path.join(__dirname, "newtabpreload.js"),
    });
  } catch (err) {
    console.warn(
      "[shortcuts] registerPreloadScript tidak tersedia (butuh Electron 35+):",
      err.message,
    );
  }
  maybeRefresh();
  setInterval(maybeRefresh, 60 * 60 * 1000);
}

Object.assign(module.exports, {
  flush,
  init,
  resetDialog,
  setFavicon,
  setTitle,
  typingBlocked,
  visit,
});
