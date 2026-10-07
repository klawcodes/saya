(() => {
  const api = window.sayaAPI;
  const listEl = document.getElementById("list");
  const qEl = document.getElementById("q");
  const countEl = document.getElementById("count");
  let items = [];

  function row(it) {
    const el = document.createElement("div");
    el.className = "pkg";
    const top = document.createElement("div");
    top.className = "top";
    const n = document.createElement("span");
    n.className = "n";
    n.textContent = it.name;
    const v = document.createElement("span");
    v.className = "v";
    v.textContent = it.version;
    const l = document.createElement("span");
    l.className = "l";
    l.textContent = it.license;
    const acts = document.createElement("span");
    acts.className = "acts";
    const show = document.createElement("button");
    show.type = "button";
    show.className = "lnk";
    show.textContent = "show license";
    let pre = null;
    show.addEventListener("click", async () => {
      if (pre) {
        pre.hidden = !pre.hidden;
      } else {
        pre = document.createElement("pre");
        pre.textContent = "Loading…";
        el.append(pre);
        pre.textContent =
          (await api.creditsLicense(it.id)) || "No license text available.";
      }
      show.textContent = pre.hidden ? "show license" : "hide license";
    });
    acts.append(show);
    if (it.homepage) {
      const a = document.createElement("a");
      a.className = "lnk";
      a.href = it.homepage;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "homepage";
      acts.append(a);
    }
    top.append(n, v, l, acts);
    el.append(top);
    return el;
  }

  function render() {
    const needle = qEl.value.trim().toLowerCase();
    const shown = needle
      ? items.filter(
          (c) =>
            c.name.toLowerCase().includes(needle) ||
            c.license.toLowerCase().includes(needle),
        )
      : items;
    countEl.textContent = items.length ? String(items.length) : "";
    listEl.replaceChildren();
    if (!shown.length) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = needle
        ? `No results for “${qEl.value.trim()}”.`
        : "No credits data.";
      listEl.append(p);
      return;
    }
    const frag = document.createDocumentFragment();
    for (const c of shown) frag.append(row(c));
    listEl.append(frag);
  }

  qEl.addEventListener("input", render);
  if (!api) {
    listEl.innerHTML = '<p class="empty">This page only works inside Saya.</p>';
  } else {
    api.creditsList().then((res) => {
      items = Array.isArray(res) ? res : [];
      render();
    });
  }
})();
