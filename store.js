// Penyimpanan ringan untuk riwayat & bookmark: satu file JSON per jenis,
// ditulis dengan debounce (tidak membebani saat browsing) dan di-flush saat keluar.
const fs = require('fs');
const path = require('path');

const isWeb = (u) => typeof u === 'string' && u.length < 4096 && /^https?:\/\//i.test(u);
const clip = (s, n) => String(s || '').slice(0, n);

// Riwayat tidak membedakan #hash, jadi dibuang supaya tidak menumpuk
function stripHash(url) {
  try {
    const x = new URL(url);
    x.hash = '';
    return x.href;
  } catch {
    return '';
  }
}

class Persisted {
  constructor(file, delay = 2000) {
    this.file = file;
    this.delay = delay;
    this.timer = null;
    this.dirty = false;
  }
  read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return null;
    }
  }
  touch() {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.dirty) return;
      this.dirty = false;
      const tmp = this.file + '.tmp';
      fs.promises
        .writeFile(tmp, JSON.stringify(this.snapshot()))
        .then(() => fs.promises.rename(tmp, this.file))
        .catch((e) => console.error('[store] gagal menyimpan', path.basename(this.file), e.message));
    }, this.delay);
  }
  flushSync() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty) return;
    this.dirty = false;
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.snapshot()));
    } catch (e) {
      console.error('[store] gagal menyimpan', path.basename(this.file), e.message);
    }
  }
}

class History extends Persisted {
  constructor(file, max) {
    super(file);
    this.max = Math.max(100, max | 0);
    this.map = new Map(); // url -> { t: judul, ts: kunjungan terakhir, n: jumlah kunjungan }
    const data = this.read();
    if (Array.isArray(data)) {
      for (const [u, t, ts, n] of data) if (isWeb(u)) this.map.set(u, { t: t || '', ts: ts || 0, n: n || 1 });
    }
  }
  snapshot() {
    return [...this.map].map(([u, e]) => [u, e.t, e.ts, e.n]);
  }
  add(url, title) {
    const u = stripHash(url);
    if (!isWeb(u)) return;
    const e = this.map.get(u);
    if (e) {
      e.ts = Date.now();
      e.n++;
      if (title) e.t = clip(title, 300);
    } else {
      this.map.set(u, { t: clip(title, 300), ts: Date.now(), n: 1 });
      if (this.map.size > this.max * 1.1) this.prune();
    }
    this.touch();
  }
  setTitle(url, title) {
    const e = this.map.get(stripHash(url));
    if (e && title && e.t !== title) {
      e.t = clip(title, 300);
      this.touch();
    }
  }
  prune() {
    const keep = [...this.map].sort((a, b) => b[1].ts - a[1].ts).slice(0, this.max);
    this.map = new Map(keep);
  }
  // Saran address bar: awalan alamat > awalan judul > mengandung; lalu paling sering & terbaru
  suggest(q, limit = 4) {
    const needle = clip(q, 200).trim().toLowerCase();
    if (!needle) return [];
    const now = Date.now();
    const hits = [];
    for (const [u, e] of this.map) {
      const bare = u.slice(u.indexOf('//') + 2).replace(/^www\./, '').toLowerCase();
      const title = e.t.toLowerCase();
      const base = bare.startsWith(needle) ? 3 : title.startsWith(needle) ? 2 : bare.includes(needle) || title.includes(needle) ? 1 : 0;
      if (base) hits.push({ u, t: e.t, score: base * 100 + Math.min(e.n, 30) + e.ts / now });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }
  list({ q = '', limit = 100, offset = 0 } = {}) {
    const needle = clip(q, 200).trim().toLowerCase();
    limit = Math.min(500, Math.max(1, limit | 0 || 100));
    offset = Math.max(0, offset | 0);
    let rows = [...this.map].map(([u, e]) => ({ u, t: e.t, ts: e.ts }));
    if (needle) rows = rows.filter((r) => r.u.toLowerCase().includes(needle) || r.t.toLowerCase().includes(needle));
    rows.sort((a, b) => b.ts - a.ts);
    return { total: rows.length, items: rows.slice(offset, offset + limit) };
  }
  remove(url) {
    if (this.map.delete(url)) this.touch();
  }
  // since = batas waktu (ms epoch); kosong = hapus semuanya
  clear(since) {
    if (!since) this.map.clear();
    else for (const [u, e] of this.map) if (e.ts >= since) this.map.delete(u);
    this.touch();
  }
}

class Bookmarks extends Persisted {
  constructor(file) {
    super(file, 300);
    const data = this.read();
    this.items = Array.isArray(data) ? data.filter((b) => b && isWeb(b.u)) : [];
  }
  snapshot() {
    return this.items;
  }
  has(url) {
    return this.items.some((b) => b.u === url);
  }
  toggle(url, title) {
    if (!isWeb(url)) return false;
    const i = this.items.findIndex((b) => b.u === url);
    if (i >= 0) this.items.splice(i, 1);
    else this.items.push({ u: url, t: clip(title, 300) || url, ts: Date.now() });
    this.touch();
    return i < 0;
  }
  remove(url) {
    const i = this.items.findIndex((b) => b.u === url);
    if (i >= 0) {
      this.items.splice(i, 1);
      this.touch();
    }
  }
  list() {
    return [...this.items].sort((a, b) => b.ts - a.ts);
  }
}

// Izin per situs: { "https://meet.google.com|media:audio": true, ... }
class Permissions extends Persisted {
  constructor(file) {
    super(file, 300);
    this.map = new Map();
    const data = this.read();
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      for (const [k, v] of Object.entries(data)) if (typeof v === 'boolean') this.map.set(k, v);
    }
  }
  snapshot() {
    return Object.fromEntries(this.map);
  }
  get(origin, perm) {
    return this.map.get(origin + '|' + perm); // true | false | undefined (belum diputuskan)
  }
  set(origin, perm, allow) {
    this.map.set(origin + '|' + perm, !!allow);
    this.touch();
  }
  forget(origin, perm) {
    if (this.map.delete(origin + '|' + perm)) this.touch();
  }
  clearOrigin(origin) {
    let n = 0;
    for (const k of [...this.map.keys()]) if (k.startsWith(origin + '|') && this.map.delete(k)) n++;
    if (n) this.touch();
  }
  clear() {
    this.map.clear();
    this.touch();
  }
}

// Tab yang terbuka + ukuran/posisi jendela, dipulihkan saat Syptek dibuka lagi
class SessionState extends Persisted {
  constructor(file) {
    super(file, 1000);
    const d = this.read();
    const ok = d && typeof d === 'object';
    this.tabs = ok && Array.isArray(d.tabs)
      ? d.tabs.filter((t) => t && isWeb(t.u)).slice(0, 50).map((t) => ({ u: t.u, t: clip(t.t, 300) }))
      : [];
    this.active = ok && Number.isInteger(d.active) && d.active >= 0 ? d.active : 0;
    const b = ok ? d.bounds : null;
    const num = (n) => Number.isFinite(n);
    this.bounds = b && num(b.x) && num(b.y) && num(b.width) && num(b.height) && b.width >= 640 && b.height >= 400
      ? { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }
      : null;
    this.maximized = !!ok && d.maximized === true;
    this.engine = ok && typeof d.engine === 'string' ? d.engine.slice(0, 40) : ''; // id mesin pencari terakhir
  }
  snapshot() {
    return { tabs: this.tabs, active: this.active, bounds: this.bounds, maximized: this.maximized, engine: this.engine };
  }
  setEngine(id) {
    if (this.engine === id) return;
    this.engine = id;
    this.touch();
  }
  set(tabs, active, bounds, maximized) {
    this.tabs = tabs;
    this.active = active;
    if (bounds) this.bounds = bounds;
    this.maximized = !!maximized;
    this.touch();
  }
}

function createStores(dir, cfg) {
  const history = new History(path.join(dir, 'history.json'), cfg.history.maxEntries);
  const bookmarks = new Bookmarks(path.join(dir, 'bookmarks.json'));
  const permissions = new Permissions(path.join(dir, 'permissions.json'));
  const session = new SessionState(path.join(dir, 'session.json'));
  return {
    history,
    bookmarks,
    permissions,
    session,
    flush() {
      history.flushSync();
      bookmarks.flushSync();
      permissions.flushSync();
      session.flushSync();
    },
  };
}

module.exports = { createStores, isWeb };
