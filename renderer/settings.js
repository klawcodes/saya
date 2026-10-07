const api = window.sayaAPI;
const $ = (id) => document.getElementById(id);

function fmt(n) {
  if (n == null) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < 3) {
    n /= 1024;
    i++;
  }
  return (i === 0 ? String(n) : n.toFixed(n < 10 ? 1 : 0)) + " " + units[i];
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// ---------------------------------------------------------------
// Disk & cache
// ---------------------------------------------------------------
const ITEMS = [
  {
    id: "http",
    list: "safe",
    name: "Web cache",
    desc: "Saved copies of pages, images and scripts. Sites download them again when needed, so the next visit may be a little slower.",
  },
  {
    id: "code",
    list: "safe",
    name: "Code & graphics cache",
    desc: "Compiled JavaScript and GPU shaders. Rebuilt automatically the next time a page needs them.",
  },
  {
    id: "offline",
    list: "safe",
    name: "Offline site files",
    desc: "Files that web apps keep for offline use (Cache Storage). They download again when the site needs them.",
  },
  {
    id: "adblock",
    list: "safe",
    name: "Ad blocker filter cache",
    desc: "Compiled filter lists. Rebuilt on the next start, which takes a little longer once.",
  },
  {
    id: "cookies",
    list: "risky",
    name: "Cookies & logins",
    button: "Clear…",
    desc: "Signs you out of every site. Saya does not store passwords itself, so your logins live in cookies.",
  },
  {
    id: "sitedata",
    list: "risky",
    name: "Site data",
    button: "Clear…",
    desc: "Local storage, IndexedDB and service workers. Web apps can lose offline data, unsent drafts and saved settings.",
  },
];

const sizeEls = {};

function buildRows() {
  for (const it of ITEMS) {
    const li = el("li");
    const txt = el("div", "txt");
    txt.append(el("div", "name", it.name), el("div", "desc", it.desc));
    const size = el("span", "size", "");
    sizeEls[it.id] = size;
    const btn = el(
      "button",
      it.list === "risky" ? "danger" : "",
      it.button || "Clear",
    );
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const r = await api.cacheClear(it.id);
      btn.disabled = false;
      if (r && r.cancelled) return;
      if (!r || !r.ok) {
        size.className = "size";
        size.textContent = (r && r.error) || "Failed";
        return;
      }
      await refreshSizes();
      size.classList.add("done");
      size.textContent = r.freed > 0 ? fmt(r.freed) + " freed" : "Cleared";
    });
    li.append(txt, size, btn);
    $(it.list).append(li);
  }
}

async function refreshSizes() {
  const s = await api.cacheSizes();
  if (!s) return;
  $("total").textContent = fmt(s.total);
  for (const it of ITEMS) {
    sizeEls[it.id].className = "size";
    sizeEls[it.id].textContent = fmt(s[it.id]);
  }
}

// ---------------------------------------------------------------
// DNS
// ---------------------------------------------------------------
const MODES = [
  {
    id: "secure",
    name: "Secure",
    tag: "Strictest",
    desc: [
      "Every lookup goes through an encrypted DNS-over-HTTPS (DoH) provider. Your ISP or network cannot see or change which sites you look up.",
      "There is no fallback: if the provider cannot be reached, sites will not load. It may fail on networks that block DoH, and for internal names on company networks.",
    ],
  },
  {
    id: "automatic",
    name: "Automatic",
    tag: "Balanced",
    desc: [
      "Tries encrypted DoH first. If that fails, it falls back to your system DNS (your ISP or router).",
      "Sites keep loading on restrictive networks, but any lookup that falls back is visible to your ISP.",
    ],
  },
  {
    id: "off",
    name: "None",
    tag: "System DNS",
    desc: [
      "Uses only your system DNS, unencrypted. Most compatible, nothing extra to configure.",
      "Your ISP and network can see, block or redirect lookups.",
    ],
  },
];

const DEFAULT_SERVERS = [
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/dns-query",
  "https://dns.quad9.net/dns-query",
];
const PROVIDERS = [
  {
    id: "default",
    name: "Default (Cloudflare → Google → Quad9)",
    servers: DEFAULT_SERVERS,
    desc: "Tries these in order, so one provider being down does not cut you off. Lookups can reach any of the three.",
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    servers: ["https://cloudflare-dns.com/dns-query"],
    desc: "Fast and widely reachable (1.1.1.1).",
  },
  {
    id: "google",
    name: "Google",
    servers: ["https://dns.google/dns-query"],
    desc: "Fast and widely reachable. Operated by Google.",
  },
  {
    id: "quad9",
    name: "Quad9",
    servers: ["https://dns.quad9.net/dns-query"],
    desc: "Blocks known malicious domains. Run by a non-profit foundation based in Switzerland.",
  },
  {
    id: "adguard",
    name: "AdGuard",
    servers: ["https://dns.adguard-dns.com/dns-query"],
    desc: "Also blocks many ad and tracker domains at the DNS level, on top of the ad blocker.",
  },
  {
    id: "mullvad",
    name: "Mullvad",
    servers: ["https://dns.mullvad.net/dns-query"],
    desc: "Run by Mullvad VPN. No filtering.",
  },
  {
    id: "custom",
    name: "Custom",
    servers: null,
    desc: "Your own DNS-over-HTTPS address. Separate several with commas; they are tried in order.",
  },
];

const dns = { mode: "automatic", provider: "default" };

function same(a, b) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function pickProvider(servers) {
  const p = PROVIDERS.find((x) => x.servers && same(x.servers, servers));
  return p ? p.id : "custom";
}

function renderCards(host, items, current, onPick, group) {
  host.textContent = "";
  for (const it of items) {
    const label = el("label", "card" + (it.id === current ? " sel" : ""));
    const input = el("input");
    input.type = "radio";
    input.name = group;
    input.checked = it.id === current;
    input.addEventListener("change", () => onPick(it.id));
    const body = el("div");
    const head = el("div", "name", it.name);
    if (it.tag) head.append(el("span", "tag", it.tag));
    body.append(head);
    for (const d of Array.isArray(it.desc) ? it.desc : [it.desc])
      body.append(el("div", "desc", d));
    label.append(input, body);
    host.append(label);
  }
}

function renderDns() {
  renderCards(
    $("modes"),
    MODES,
    dns.mode,
    (id) => {
      dns.mode = id;
      renderDns();
      setStatus("dns-status", "");
    },
    "mode",
  );
  renderCards(
    $("providers"),
    PROVIDERS,
    dns.provider,
    (id) => {
      dns.provider = id;
      renderDns();
      setStatus("dns-status", "");
    },
    "provider",
  );
  const off = dns.mode === "off";
  $("providers").classList.toggle("dim", off);
  for (const c of $("providers").children) c.classList.toggle("off", off);
  $("custom-line").hidden = dns.provider !== "custom" || off;
  $("provider-hint").textContent = off
    ? "Not used while the mode is None."
    : "The provider you choose can see which site names you look up, but not the pages you read.";
}

function setStatus(id, text, kind) {
  const s = $(id);
  s.textContent = text;
  s.className = "status" + (kind ? " " + kind : "");
}

function chosenServers() {
  const p = PROVIDERS.find((x) => x.id === dns.provider);
  if (p && p.servers) return p.servers;
  return $("custom")
    .value.split(/[\s,]+/)
    .filter(Boolean);
}

$("apply").addEventListener("click", async () => {
  const servers = chosenServers();
  if (dns.mode !== "off" && !servers.length) {
    setStatus("dns-status", "Enter a DNS address first.", "err");
    return;
  }
  $("apply").disabled = true;
  const r = await api.settingsDns(
    dns.mode,
    servers.length ? servers : DEFAULT_SERVERS,
  );
  $("apply").disabled = false;
  if (r && r.ok)
    setStatus("dns-status", "Applied. New lookups use this setting.", "ok");
  else setStatus("dns-status", (r && r.error) || "Could not apply.", "err");
});

$("limit").addEventListener("change", async () => {
  const r = await api.settingsCacheLimit(Number($("limit").value));
  if (r && r.ok)
    setStatus(
      "limit-status",
      r.restart ? "Saved. Restart Saya to apply." : "Saved.",
      "ok",
    );
  else setStatus("limit-status", (r && r.error) || "Could not save.", "err");
});

$("open-history").addEventListener("click", (e) => {
  e.preventDefault();
  api.open("history");
});

// ---------------------------------------------------------------
async function init() {
  buildRows();
  const s = await api.settingsGet();
  if (s) {
    $("dir").textContent = s.dataDir;
    $("limit").value = String(s.cacheLimitMB);
    dns.mode = s.dns.mode;
    dns.provider = pickProvider(s.dns.servers);
    if (dns.provider === "custom") $("custom").value = s.dns.servers.join(", ");
  }
  renderDns();
  refreshSizes();
}
init();
