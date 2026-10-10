// main-network.js — Identitas browser (UA/Client Hints), izin per situs, DNS-over-HTTPS, ad blocker.

const { app, ipcMain, session, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { isWeb } = require("./store");
const {
  DEFAULT_ADBLOCK_LISTS,
  config,
  sendUI,
  shared,
} = require("./main-core");
const $downloads = require("./main-downloads");
const $tabs = require("./main-tabs");

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
  const params = $tabs.identityFor(wc);
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
    await wc.debugger.sendCommand(
      "Emulation.setUserAgentOverride",
      $tabs.identityFor(wc),
    );
    await wc.debugger.sendCommand("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    });
    const rt = $tabs.tabOf(wc);
    if (rt?.resp?.on) $tabs.respApply(rt); // debugger terpasang ulang: pasang lagi emulasi responsive
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
      const r = $tabs.tabByWcId(d.webContentsId)?.resp;
      const ch = r?.on
        ? {
            ...CH,
            "sec-ch-ua-mobile": r.tablet ? "?0" : "?1",
            "sec-ch-ua-platform": '"Android"',
          }
        : CH;
      for (const k of Object.keys(h)) if (k.toLowerCase() in ch) delete h[k];
      cb({ requestHeaders: { ...h, ...ch } });
    } catch {
      cb({ requestHeaders: d.requestHeaders });
    }
  });
}

function setupSession() {
  const ses = session.defaultSession;
  ses.setUserAgent(UA); // cadangan untuk worker/fetch; tiap tab diatur penuh oleh spoofUA()

  setupPermissions(ses);
  $downloads.setupDownloads(ses);
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
      shared.win && !shared.win.isDestroyed()
        ? await dialog.showMessageBox(shared.win, opts)
        : await dialog.showMessageBox(opts);
    const allow = response === 0;
    for (const k of keys) shared.stores.permissions.set(origin, k, allow);
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
        const tab = wc && $tabs.tabOf(wc);
        if (tab) tab.keepAlive = true;
      }
      callback(allow);
    };
    if (ALWAYS_ALLOWED.has(permission)) return callback(true);
    const origin = originOf(details?.requestingUrl || wc?.getURL?.());
    if (!ASKABLE.has(permission) || !origin) return callback(false);
    const keys = permKeys(permission, details?.mediaTypes);
    const known = keys.map((k) => shared.stores.permissions.get(origin, k));
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
      return keys.some((k) => shared.stores.permissions.get(origin, k) === true);
    },
  );
}

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
    shared.blocker?.updateFromDiff({ added: [line] }); // berlaku untuk halaman yang dimuat berikutnya
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
  if (!config.adblock.popups || !shared.adblockOn || !shared.blocker || !isWeb(target))
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
    const m = shared.blocker.match(req);
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
    shared.blockedCount++;
    sendUI("adblock:count", shared.blockedCount);
    return true;
  }
  return false;
}

function adblockState() {
  return { available: !!shared.blocker, enabled: shared.adblockOn, blocked: shared.blockedCount };
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

// Host yang benar-benar dipakai untuk jendela login (OAuth). Sengaja BUKAN AUTH_HOSTS: daftar itu
// untuk pengecualian ad blocker dan berisi situs biasa (github.com, paypal.com, stripe.com, dst.), jadi
// kalau dipakai di sini, link biasa ke situs-situs itu ikut terbuka sebagai jendela popup.
const AUTH_POPUP_HOSTS = new Set([
  "accounts.google.com",
  "accounts.youtube.com",
  "login.microsoftonline.com",
  "login.live.com",
  "login.microsoft.com",
  "appleid.apple.com",
  "idmsa.apple.com",
  "auth0.com",
  "okta.com",
]);
// Hanya path OAuth/SSO. "/login", "/signin", "/auth" sengaja tidak dihitung: itu halaman login biasa
// (mis. tombol "Login" di sebuah situs) dan harus dibuka sebagai tab.
const AUTH_POPUP_PATH =
  /\/(oauth2?|authorize|authorization|saml2?|openid)(\/|$)/i;

// Tujuan yang jelas berupa alur login lintas situs. `from` = URL halaman yang membuka popup.
function isAuthTarget(u, from) {
  try {
    const x = new URL(u);
    if (!/^https?:$/.test(x.protocol)) return false;
    const host = x.hostname.toLowerCase();
    // Satu situs dengan halaman asal bukan popup login, tapi link biasa
    const src = hostOf(from);
    if (
      src &&
      (host === src || host.endsWith("." + src) || src.endsWith("." + host))
    )
      return false;
    return inSet(AUTH_POPUP_HOSTS, host) || AUTH_POPUP_PATH.test(x.pathname);
  } catch {
    return false;
  }
}

// Apakah host termasuk penyedia login (Google, Microsoft, Apple, dst.)
const isAuthHost = (u) => inSet(AUTH_POPUP_HOSTS, hostOf(u));

// window.open(url, name, "width=500,height=600") = popup. Fitur "noopener,noreferrer" saja bukan popup:
// itu hanya memutus window.opener dan sering dipakai untuk link biasa.
function wantsPopupWindow(features) {
  const f = String(features || "")
    .toLowerCase()
    .replace(/\bno(opener|referrer)\b/g, "");
  return /\b(width|height|left|top|screenx|screeny|innerwidth|innerheight|popup)\b/.test(
    f,
  );
}
// Nama jendela sungguhan (window.open(url, "oauth")). "_blank" bukan nama, hanya artinya "jendela baru".
const isNamedWindow = (name) =>
  !!name && String(name).toLowerCase() !== "_blank";

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
  shared.blocker.enableBlockingInSession(ses);
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
      shared.blocker.onBeforeRequest(
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
      shared.blocker.onHeadersReceived(details, once);
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
    !shared.adblockOn ||
    !shared.blocker ||
    !config.adblock.cosmetic ||
    config.adblock.scriptlets === false
  )
    return [];
  if (!isWeb(url) || isAllowlisted({ url, webContents: wc })) return [];
  const { Request } = require("@ghostery/adblocker");
  const r = Request.fromRawDetails({ url, type: "mainFrame" });
  const { active, scripts } = shared.blocker.getCosmeticsFilters({
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
    shared.blocker = await ElectronBlocker.fromLists(
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
    if (extra.length) shared.blocker.updateFromDiff({ added: extra });
    // Ghostery menjalankan scriptlet SETELAH halaman mulai, sebagai skrip global terpisah: scriptlet yang
    // berbagi class (JSONPath, RangeParser, ...) saling bentrok ("Identifier ... has already been declared"),
    // sehingga aturan uBO (mis. IDLIX) hanya berlaku sebagian dan request pertama lolos. Jadi di sini hanya
    // CSS (sembunyikan elemen) yang dibiarkan lewat Ghostery; scriptlet diinjeksi dini oleh pagepreload.js
    // lewat IPC "saya:scriptlets" (tiap scriptlet dibungkus fungsi sendiri).
    shared.blocker.onInjectCosmeticFilters = (event, url, msg) => {
      try {
        if (isAllowlisted({ url, webContents: event.sender })) return;
        const { Request } = require("@ghostery/adblocker");
        const r = Request.fromRawDetails({ url, type: "mainFrame" });
        const first = msg === undefined;
        const { active, styles } = shared.blocker.getCosmeticsFilters({
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
    shared.adblockOn = true;
    shared.blocker.on("request-blocked", (request) => {
      if (config.adblock.debug)
        console.log("[adblock] diblokir:", request?.url);
      shared.blockedCount++;
      if (shared.countTimer) return;
      shared.countTimer = setTimeout(() => {
        shared.countTimer = null;
        sendUI("adblock:count", shared.blockedCount);
      }, 500);
    });
    sendUI("adblock:state", adblockState());
  } catch (err) {
    console.error("[adblock] gagal diaktifkan:", err.message);
  }
}

Object.assign(module.exports, {
  CHROME_MAJOR,
  UA,
  UA_META,
  adblockState,
  blockElement,
  enableBlocking,
  hostOf,
  inSet,
  installClientHints,
  isAuthHost,
  isAuthTarget,
  isNamedWindow,
  isSitePaused,
  originOf,
  popupBlocked,
  setupAdblock,
  setupDns,
  setupSession,
  siteKey,
  spoofUA,
  togglePause,
  wantsPopupWindow,
});
