// dialog.js — menggambar dialog dari data yang dikirim main-dialog.js. Teks pengguna selalu lewat textContent.
const $ = (id) => document.getElementById(id);
const api = window.dialogAPI;
let cur = null;

const svg = (d) =>
  `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  pin: svg('<path d="M10 18s5.5-4.8 5.5-9.2A5.5 5.5 0 0 0 4.5 8.8C4.5 13.2 10 18 10 18Z"/><circle cx="10" cy="8.6" r="1.9"/>'),
  camera: svg('<path d="M2.5 6.5a1.5 1.5 0 0 1 1.5-1.5h1.6l1-1.6h4.8l1 1.6H16a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 16 15H4a1.5 1.5 0 0 1-1.5-1.5Z"/><circle cx="10" cy="10" r="2.7"/>'),
  mic: svg('<rect x="7.5" y="2.5" width="5" height="9" rx="2.5"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5"/>'),
  clip: svg('<rect x="4.5" y="4" width="11" height="13" rx="2"/><path d="M7.5 4V3h5v1M7.5 9h5M7.5 12h3"/>'),
  info: svg('<circle cx="10" cy="10" r="7.5"/><path d="M10 9v4.5M10 6.5v.01"/>'),
  ask: svg('<circle cx="10" cy="10" r="7.5"/><path d="M7.8 8a2.3 2.3 0 1 1 3.4 2c-.8.5-1.2.9-1.2 1.8M10 14.3v.01"/>'),
  lock: svg('<rect x="4.5" y="9" width="11" height="8" rx="2"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/>'),
  unlock: svg('<rect x="4.5" y="9" width="11" height="8" rx="2"/><path d="M7 9V6.5a3 3 0 0 1 5.6-1.5"/>'),
  shield: svg('<path d="M10 2.8 16 5v4.6c0 3.4-2.4 6-6 7.6-3.6-1.6-6-4.2-6-7.6V5Z"/>'),
  bell: svg('<path d="M5 14V9a5 5 0 0 1 10 0v5l1.2 1.5H3.8ZM8.3 17.5h3.4"/>'),
};

const PERM = {
  geolocation: { icon: "pin", title: "Know your location", desc: "See where you are, based on your device and network." },
  "media:video": { icon: "camera", title: "Use your camera", desc: "Take photos and video." },
  "media:audio": { icon: "mic", title: "Use your microphone", desc: "Record audio." },
  "clipboard-read": { icon: "clip", title: "See copied text and images", desc: "Read what is on your clipboard." },
};
const SITE_ICON = { geolocation: "pin", "media:video": "camera", "media:audio": "mic", "clipboard-read": "clip" };
const STATE_TEXT = { allow: "Allowed", block: "Blocked", ask: "Ask every time" };

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

function focusables() {
  return [...$("card").querySelectorAll("button, input, [tabindex]:not([tabindex='-1'])")].filter((n) => !n.disabled && n.offsetParent !== null);
}

function finish(button) {
  if (!cur) return;
  const input = $("body").querySelector("input.input");
  const p = cur;
  cur = null;
  api.result({
    id: p.id,
    button,
    value: input ? input.value : null,
    checked: !$("check").hidden && $("checkbox").checked,
  });
}

function render(p) {
  const prevFocus = document.activeElement?.dataset?.f || "";
  const sameDialog = cur && cur.id === p.id;
  cur = p;
  const body = $("body");
  body.replaceChildren();
  $("sub").hidden = true;
  $("card").className = p.kind === "site" ? "wide" : "";

  if (p.kind === "permission") {
    const first = PERM[p.keys[0]] || PERM.geolocation;
    $("icon").innerHTML = ICON[first.icon];
    $("title").textContent = p.host;
    $("sub").textContent = "wants to";
    $("sub").hidden = false;
    const ul = el("ul", "perms");
    for (const k of p.keys) {
      const m = PERM[k] || { icon: "info", title: k, desc: "" };
      const li = el("li");
      const ic = el("div", "pi");
      ic.innerHTML = ICON[m.icon];
      const tx = el("div");
      tx.append(el("b", null, m.title), el("span", null, m.desc));
      li.append(ic, tx);
      ul.append(li);
    }
    body.append(ul, el("p", "note", "Your choice is remembered for this site. You can change it anytime from the site button in the address bar."));
  } else if (p.kind === "site") {
    $("icon").innerHTML = p.secure ? ICON.lock : ICON.unlock;
    $("title").textContent = p.host;
    $("sub").textContent = p.secure ? "Secure connection (HTTPS)" : "Connection is not secure (HTTP)";
    $("sub").hidden = false;
    const rows = el("div", "rows");
    for (const r of p.rows) {
      const row = el("div", "row");
      const lab = el("div", "lab");
      const ic = el("div", "pi");
      ic.innerHTML = ICON[SITE_ICON[r.key]] || ICON.info;
      const tx = el("div");
      tx.append(el("b", null, r.label), el("small", r.state, STATE_TEXT[r.state]));
      lab.append(ic, tx);
      const seg = el("div", "seg");
      seg.setAttribute("role", "group");
      seg.setAttribute("aria-label", r.label);
      for (const [value, text] of [["ask", "Ask"], ["allow", "Allow"], ["block", "Block"]]) {
        const b = el("button", value, text);
        b.type = "button";
        b.dataset.f = r.key + ":" + value;
        b.setAttribute("aria-pressed", String(r.state === value));
        b.addEventListener("click", () => api.site({ id: p.id, op: "set", key: r.key, value }));
        seg.append(b);
      }
      row.append(lab, seg);
      rows.append(row);
    }
    const nrow = el("div", "row");
    const nlab = el("div", "lab");
    const nic = el("div", "pi");
    nic.innerHTML = ICON.bell;
    const ntx = el("div");
    ntx.append(el("b", null, "Notifications"), el("small", "block", "Always blocked"));
    nlab.append(nic, ntx);
    nrow.append(nlab, el("span", "static", "Blocked"));
    rows.append(nrow);
    if (p.adblock) {
      const arow = el("div", "row");
      const alab = el("div", "lab");
      const aic = el("div", "pi");
      aic.innerHTML = ICON.shield;
      const atx = el("div");
      atx.append(el("b", null, "Ad blocker"), el("small", p.adblock.paused ? "block" : "allow", p.adblock.paused ? "Paused on this site" : "Active on this site"));
      alab.append(aic, atx);
      const ab = el("button", "btn", p.adblock.paused ? "Resume" : "Pause");
      ab.type = "button";
      ab.dataset.f = "adblock";
      ab.addEventListener("click", () => api.site({ id: p.id, op: "adblock" }));
      arow.append(alab, ab);
      rows.append(arow);
    }
    body.append(rows);
    const reset = el("button", "linkbtn", "Reset permissions for this site");
    reset.type = "button";
    reset.dataset.f = "reset";
    reset.addEventListener("click", () => api.site({ id: p.id, op: "reset" }));
    body.append(reset);
    if (p.changed) body.append(el("p", "note warn", "Reload the page to apply your changes."));
  } else {
    $("icon").innerHTML = p.kind === "confirm" || p.kind === "prompt" ? ICON.ask : ICON.info;
    $("title").textContent = p.title || "";
    if (p.message) body.append(el("div", "msg", p.message));
    if (p.kind === "prompt") {
      const input = el("input", "input");
      input.type = "text";
      input.value = p.value || "";
      input.spellcheck = false;
      input.setAttribute("aria-label", "Value");
      body.append(input);
    }
  }

  const chk = !!p.checkbox;
  $("check").hidden = !chk;
  if (chk) {
    $("checkbox").checked = false;
    $("checkLabel").textContent = p.checkbox.label;
  }

  const foot = $("foot");
  foot.replaceChildren();
  for (const b of p.buttons || []) {
    const btn = el("button", "btn" + (b.variant === "primary" ? " primary" : ""), b.label);
    btn.type = "button";
    btn.dataset.f = "btn:" + b.id;
    btn.addEventListener("click", () => finish(b.id));
    foot.append(btn);
  }
  $("scrim").hidden = false;

  // Fokus awal: kolom input (prompt) / tombol bawaan; render ulang panel izin mempertahankan fokus terakhir
  let target = null;
  if (sameDialog && prevFocus) target = document.querySelector(`[data-f="${CSS.escape(prevFocus)}"]`);
  if (!target) target = body.querySelector("input.input");
  if (!target) target = foot.querySelector(`[data-f="btn:${p.defaultId || ""}"]`);
  if (!target) target = foot.querySelector(".btn.primary") || foot.querySelector(".btn");
  if (target) {
    target.focus();
    if (target.select && target.tagName === "INPUT") target.select();
  }
}

document.addEventListener("keydown", (e) => {
  if (!cur) return;
  if (e.key === "Escape") {
    e.preventDefault();
    return finish(cur.cancelId || "");
  }
  if (e.key === "Tab") {
    const list = focusables();
    if (!list.length) return;
    const i = list.indexOf(document.activeElement);
    const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : i === list.length - 1 ? 0 : i + 1;
    e.preventDefault();
    list[next].focus();
    return;
  }
  if (e.key === "Enter") {
    const a = document.activeElement;
    if (a && a.tagName === "BUTTON") return; // tombol yang sedang fokus bekerja sendiri
    if (a && a.type === "checkbox") return;
    const def = cur.kind === "site" ? "close" : cur.defaultId || (cur.buttons || []).find((b) => b.variant === "primary")?.id;
    if (def) {
      e.preventDefault();
      finish(def);
    }
  }
});
// Klik di latar redup tidak menutup dialog: pilihan harus eksplisit (kecuali panel izin situs)
$("scrim").addEventListener("mousedown", (e) => {
  if (e.target === $("scrim") && cur && cur.kind === "site") finish(cur.cancelId || "close");
});

api.onRender(render);
