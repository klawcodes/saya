(() => {
  const api = window.menuAPI;
  const root = document.getElementById("m");
  const svg = (d) => `<svg viewBox="0 0 16 16"><path d="${d}"/></svg>`;
  const ICONS = {
    newtab: "M3 3.5h10v9H3zM8 6v4M6 8h4",
    history: "M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 5v3.2l2 1.3",
    star: "M8 1.9l1.9 3.8 4.2.6-3 3 .7 4.2L8 11.5l-3.8 2 .7-4.2-3-3 4.2-.6z",
    download: "M8 2.5v7M5 6.8l3 3 3-3M3 12.5h10",
    folder: "M2 4.5h4l1.5 1.5H14v6.5H2z",
    reopen: "M12.5 8A4.5 4.5 0 1 1 11 4.7M12 2.5v3H9",
    moon: "M12.5 9.5A5 5 0 1 1 6.5 3.5a4 4 0 0 0 6 6z",
    shield: "M8 1.8l5 1.8v4c0 3-2.1 5.2-5 6.4-2.9-1.2-5-3.4-5-6.4v-4z",
    sliders: "M2.5 5h6M11.5 5h2M2.5 11h2M7.5 11h6M10 3.5v3M6 9.5v3",
    info: "M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 7.4v3.6M8 5.3v.1",
    heart: "M8 13S3 10 3 6.5A2.7 2.7 0 0 1 8 5a2.7 2.7 0 0 1 5 1.5C13 10 8 13 8 13z",
    zoom: "M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM10.3 10.3l3.2 3.2",
    theme: "M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 2.5v11",
    full: "M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3",
    minus: "M4 8h8",
    plus: "M8 4v8M4 8h8",
  };
  let last = "";
  let pct;

  function build(items) {
    root.textContent = "";
    for (const it of items) {
      let el;
      if (it.sep) {
        el = document.createElement("div");
        el.className = "sep";
      } else if (it.info) {
        el = document.createElement("div");
        el.className = "info";
        el.textContent = it.label;
        el.dataset.info = "1";
      } else if (it.theme) {
        el = document.createElement("button");
        el.className = "item";
        el.dataset.id = "theme:toggle";
        el.setAttribute("role", "switch");
        el.setAttribute("aria-checked", String(!!it.on));
        el.title = "Dark mode for websites";
        el.innerHTML = `<span class="ic">${svg(ICONS.theme)}</span><span class="lb">Dark mode for websites</span><span class="sw"></span>`;
      } else if (it.zoom) {
        el = document.createElement("div");
        el.className = "zoom";
        el.innerHTML =
          `<span class="ic">${svg(ICONS.zoom)}</span><span class="lb">Zoom</span>` +
          `<div class="zg"><button class="zb" data-id="zoom:out" title="Zoom out (Ctrl+-)" aria-label="Zoom out">${svg(ICONS.minus)}</button>` +
          `<button class="zb pct" data-id="zoom:reset" title="Reset to 100% (Ctrl+0)"></button>` +
          `<button class="zb" data-id="zoom:in" title="Zoom in (Ctrl++)" aria-label="Zoom in">${svg(ICONS.plus)}</button>` +
          `<span class="zd"></span>` +
          `<button class="zb" data-id="fullscreen" title="Full screen (F11)" aria-label="Full screen">${svg(ICONS.full)}</button></div>`;
        pct = el.querySelector(".pct");
      } else {
        el = document.createElement("button");
        el.className = "item";
        el.dataset.id = it.id;
        el.disabled = !!it.disabled;
        el.innerHTML = `<span class="ic">${it.icon ? svg(ICONS[it.icon]) : ""}</span><span class="lb"></span><span class="ac"></span>`;
        el.querySelector(".lb").textContent = it.label;
        el.querySelector(".ac").textContent = it.accel || "";
      }
      root.appendChild(el);
    }
  }

  api.onRender(({ items, zoom }) => {
    // Susunan menu sama (mis. hanya angka zoom berubah): jangan bangun ulang supaya fokus tombol tetap
    const key = JSON.stringify(items);
    if (key !== last) {
      last = key;
      const focusId = document.activeElement?.dataset?.id; // bangun ulang tidak boleh menghilangkan fokus keyboard
      build(items);
      if (focusId) root.querySelector(`[data-id="${focusId}"]`)?.focus();
    }
    pct.textContent = `${zoom}%`;
    api.size(root.scrollHeight + 18); // + padding atas/bawah + border
  });

  root.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-id]");
    if (b && !b.disabled) api.act(b.dataset.id);
  });

  // Navigasi keyboard: panah atas/bawah menggeser fokus antar tombol, Esc menutup
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") return api.close();
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const btns = [...root.querySelectorAll("button:not(:disabled)")];
    if (!btns.length) return;
    const i = btns.indexOf(document.activeElement);
    const next = e.key === "ArrowDown" ? i + 1 : i - 1;
    btns[(next + btns.length) % btns.length].focus();
  });
})();
