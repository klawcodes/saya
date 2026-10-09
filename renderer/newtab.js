(() => {
  const api = window.newtabAPI; // dari newtabpreload.js
  const bar = document.getElementById("shortcuts");
  if (!api) {
    bar.hidden = true; // preload tidak terpasang: halaman tetap berfungsi tanpa shortcut
    return;
  }

  const overlay = document.getElementById("overlay");
  const form = document.getElementById("dlg");
  const titleEl = document.getElementById("dlg-title");
  const nameEl = document.getElementById("f-name");
  const urlEl = document.getElementById("f-url");
  const errEl = document.getElementById("err");
  const removeBtn = document.getElementById("b-remove");
  const cancelBtn = document.getElementById("b-cancel");
  const doneBtn = document.getElementById("b-done");

  const DOTS =
    '<svg viewBox="0 0 16 16"><circle cx="8" cy="3.5" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="8" cy="12.5" r="1.2"/></svg>';
  const PLUS = '<svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10"/></svg>';

  let items = [];
  let canAdd = true;
  let editing = null; // shortcut yang sedang diedit; null = mode tambah
  let busy = false;

  const el = (tag, cls) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  };

  function letter(it) {
    const s = el("span", "letter");
    s.textContent = (it.t || "?").trim().charAt(0).toUpperCase() || "?";
    return s;
  }

  function icon(it) {
    if (!it.f) return letter(it);
    const img = new Image();
    img.alt = "";
    img.draggable = false;
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => img.replaceWith(letter(it)), {
      once: true,
    });
    img.src = it.f;
    return img;
  }

  function tile(it) {
    const wrap = el("div", "tile");
    const a = el("a", "link");
    a.href = it.u;
    a.title = it.t;
    const ico = el("span", "ico");
    ico.append(icon(it));
    const label = el("span", "label");
    label.textContent = it.t;
    a.append(ico, label);

    const more = el("button", "more");
    more.type = "button";
    more.title = "Edit shortcut";
    more.setAttribute("aria-label", "Edit shortcut: " + it.t);
    more.innerHTML = DOTS;
    more.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openDialog(it);
    });
    wrap.append(a, more);
    return wrap;
  }

  function addTile() {
    const wrap = el("div", "tile");
    const b = el("button", "add");
    b.type = "button";
    const ico = el("span", "ico");
    ico.innerHTML = PLUS;
    const label = el("span", "label");
    label.textContent = "Add shortcut";
    b.append(ico, label);
    b.addEventListener("click", () => openDialog(null));
    wrap.append(b);
    return wrap;
  }

  function render() {
    bar.textContent = "";
    for (const it of items) bar.append(tile(it));
    if (canAdd) bar.append(addTile());
  }

  function apply(res) {
    items = Array.isArray(res.items) ? res.items : [];
    canAdd = !!res.canAdd;
    render();
  }

  // ---------- Dialog ----------
  function openDialog(it) {
    editing = it;
    titleEl.textContent = it ? "Edit shortcut" : "Add shortcut";
    nameEl.value = it ? it.t : "";
    urlEl.value = it ? it.u : "";
    errEl.textContent = "";
    removeBtn.hidden = !it;
    overlay.hidden = false;
    api.dialog(true); // ketikan tidak boleh dibelokkan ke address bar
    (it ? nameEl : urlEl).focus();
    (it ? nameEl : urlEl).select();
  }

  function closeDialog() {
    if (overlay.hidden) return;
    overlay.hidden = true;
    editing = null;
    api.dialog(false);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    doneBtn.disabled = true;
    errEl.textContent = "";
    try {
      const item = { t: nameEl.value, u: urlEl.value };
      const res = editing
        ? await api.edit(editing.id, item)
        : await api.add(item);
      if (!res || !res.ok) {
        errEl.textContent = (res && res.error) || "Could not save.";
        return;
      }
      apply(res);
      closeDialog();
    } finally {
      busy = false;
      doneBtn.disabled = false;
    }
  });

  removeBtn.addEventListener("click", async () => {
    if (!editing || busy) return;
    busy = true;
    try {
      const res = await api.remove(editing.id);
      if (res && res.ok) {
        apply(res);
        closeDialog();
      } else {
        errEl.textContent = (res && res.error) || "Could not remove.";
      }
    } finally {
      busy = false;
    }
  });

  cancelBtn.addEventListener("click", closeDialog);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) closeDialog();
  });

  document.addEventListener("keydown", (e) => {
    if (overlay.hidden) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeDialog();
    } else if (e.key === "Tab") {
      // Fokus tetap berputar di dalam dialog
      const f = [...form.querySelectorAll("input, button")].filter(
        (n) => !n.hidden && !n.disabled,
      );
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  window.addEventListener("pagehide", () => api.dialog(false));

  api.list().then((res) => {
    if (res && res.ok) apply(res);
    else bar.hidden = true;
  });
})();
