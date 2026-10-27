(() => {
  const api = window.browserAPI;
  const tabsEl = document.getElementById("tabs");
  const addressEl = document.getElementById("address");
  const addrText = document.getElementById("addr-text");
  const addrBoxEl = document.getElementById("addrbox");
  const backBtn = document.getElementById("back");
  const forwardBtn = document.getElementById("forward");
  const reloadBtn = document.getElementById("reload");
  const starBtn = document.getElementById("star");
  const menuBtn = document.getElementById("menu");
  const adblockBtn = document.getElementById("adblock");
  const adblockCount = document.getElementById("adblock-count");
  const siteBtn = document.getElementById("site");
  const dlBtn = document.getElementById("downloads");
  const brandEl = document.getElementById("brand");
  const toggleBtn = document.getElementById("sidebar-toggle");
  const hotEl = document.getElementById("hot");
  const sidebarEl = document.getElementById("sidebar");
  const tabbarEl = document.getElementById("tabbar");
  const tabzoneEl = document.getElementById("tabzone");
  let axis = "y"; // arah daftar tab: "y" (sidebar) atau "x" (baris tab atas)

  // --n = jumlah tab; dipakai CSS mode top untuk lebar dasar baris tab
  const countTabs = () =>
    tabsEl.style.setProperty("--n", String(tabsEl.children.length || 1));

  const CLOSE_SVG =
    '<svg viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M1 1l6 6M7 1L1 7"/></svg>';

  const state = new Map(); // id -> tab data
  const SPK =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.2h2.3L8 3.5v9L4.8 9.8H2.5z"/>';
  const AUDIO_SVG =
    SPK +
    '<path d="M10.5 6a3 3 0 0 1 0 4M12.2 4.3a5.4 5.4 0 0 1 0 7.4"/></svg>';
  const MUTED_SVG = SPK + '<path d="M10.5 6.2l3.5 3.6M14 6.2l-3.5 3.6"/></svg>';
  let activeId = null;

  function formatCount(n) {
    if (!n) return "";
    return n > 999 ? Math.floor(n / 100) / 10 + "k" : String(n);
  }

  const setFav = (fav, url) => {
    const v = url ? `url(${JSON.stringify(url)})` : "";
    if (fav.style.backgroundImage !== v) fav.style.backgroundImage = v;
  };

  function renderTab(data) {
    let el = tabsEl.querySelector(`[data-id="${data.id}"]`);
    if (!el) {
      el = document.createElement("div");
      el.className = "tab";
      el.dataset.id = data.id;
      el.innerHTML =
        '<div class="body"><span class="favicon"></span><span class="title"></span><button class="audio"></button>' +
        `<button class="close" title="Close tab">${CLOSE_SVG}</button></div>`;
      el.querySelector(".audio").addEventListener("click", (e) => {
        e.stopPropagation();
        api.muteTab(data.id);
      });
      el.addEventListener("mousedown", (e) => {
        if (e.button === 1) {
          e.preventDefault();
          api.closeTab(data.id);
        } else if (e.button === 0 && !e.target.closest(".close, .audio")) {
          // Ctrl+klik = buka tab ini berdampingan (split view) dengan tab aktif
          if (e.ctrlKey || e.metaKey) api.splitTab(data.id);
          else api.activateTab(data.id);
        }
      });
      // Klik kanan = menu tab (isi menu disusun main sesuai letak tab)
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        api.tabMenu(data.id);
      });
      el.querySelector(".favicon").style.backgroundSize = "cover";
      el.querySelector(".close").addEventListener("click", (e) => {
        e.stopPropagation();
        api.closeTab(data.id);
      });
      tabsEl.appendChild(el);
      countTabs();
    }

    const fav = el.querySelector(".favicon");
    if (data.loading) {
      if (el._stop) {
        clearTimeout(el._stop);
        el._stop = 0;
      }
      fav.classList.add("loading");
      setFav(fav, "");
    } else if (fav.classList.contains("loading")) {
      if (!el._stop) {
        el._stop = setTimeout(() => {
          el._stop = 0;
          fav.classList.remove("loading");
          const d = state.get(Number(el.dataset.id));
          setFav(fav, d && !d.loading ? d.favicon : "");
        }, 350);
      }
    } else {
      setFav(fav, data.favicon);
    }
    el.classList.toggle("suspended", !!data.suspended);
    el.classList.toggle("split", !!data.split);
    el.classList.toggle("active", data.id === activeId);
    el.querySelector(".title").textContent = data.title || "New Tab";

    const au = el.querySelector(".audio");
    const mode = data.muted ? "muted" : data.audible ? "on" : "";
    if (au.dataset.m !== mode) {
      au.dataset.m = mode;
      au.innerHTML =
        mode === "muted" ? MUTED_SVG : mode === "on" ? AUDIO_SVG : "";
      au.title = mode === "muted" ? "Unmute tab" : "Mute tab";
    }

    el.title =
      (data.title || "") +
      (data.suspended ? " (sleeping, loads when opened)" : "");
  }

  // Tampilan ringkas di toolbar (host saja, ala Arc); alamat lengkap dibuka di palette lewat klik / Ctrl+L
  function shortAddr(url) {
    if (!url) return "";
    if (/^https?:\/\//i.test(url)) {
      try {
        return new URL(url).host.replace(/^www\./, "");
      } catch {}
    }
    return url;
  }

  function syncToolbar() {
    const data = state.get(activeId);
    if (!data) return;
    backBtn.disabled = !data.canGoBack;
    forwardBtn.disabled = !data.canGoForward;
    starBtn.disabled = !data.bookmarkable;
    siteBtn.disabled = !data.bookmarkable;
    starBtn.classList.toggle("on", !!data.bookmarked);
    starBtn.title = data.bookmarked
      ? "Remove bookmark (Ctrl+D)"
      : "Add bookmark (Ctrl+D)";
    const short = shortAddr(data.url);
    addrText.textContent = short || "Search or enter address";
    addressEl.classList.toggle("empty", !short);
    syncLoad(!!data.loading);
  }

  // Indikator loading di address bar. Status "loading" tab aktif; ditunda sebentar supaya muatan
  // yang sangat singkat tidak berkedip. Tampil/tidaknya (mode top, sidebar di-pin) diatur CSS lewat class body.
  let loadTimer = 0;
  function syncLoad(on) {
    if (on) {
      if (!loadTimer && !addrBoxEl.classList.contains("loading"))
        loadTimer = setTimeout(() => {
          loadTimer = 0;
          addrBoxEl.classList.add("loading");
        }, 150);
    } else {
      clearTimeout(loadTimer);
      loadTimer = 0;
      addrBoxEl.classList.remove("loading");
    }
  }

  function setActive(id) {
    activeId = id;
    for (const el of tabsEl.children) {
      el.classList.toggle("active", Number(el.dataset.id) === id);
    }
    syncToolbar();
  }

  api.on("tab:created", (data) => {
    if (!data) return;
    state.set(data.id, data);
    renderTab(data);
  });
  api.on("tab:update", (data) => {
    if (!data) return;
    state.set(data.id, data);
    renderTab(data);
    if (data.id === activeId) syncToolbar();
  });
  api.on("tab:active", (id) => setActive(id));
  api.on("tab:closed", (id) => {
    state.delete(id);
    const gone = tabsEl.querySelector(`[data-id="${id}"]`);
    if (gone) {
      clearTimeout(gone._stop);
      gone.remove();
    }
    countTabs();
  });

  // ---------- Sidebar auto-hide ----------
  // Status dikirim main (yang juga menggeser area halaman). Kursor di tepi kiri = minta buka;
  // menutupnya diurus main lewat polling posisi kursor.
  // Letak tab dipilih di main (menu titik tiga / palette / Settings); di sini daftar tab dipindah ke tempatnya
  api.on("layout:state", (s) => {
    const top = !!s && s.mode === "top";
    document.body.classList.toggle("mode-top", top);
    (top ? tabbarEl : sidebarEl).appendChild(tabzoneEl);
    axis = top ? "x" : "y";
    requestAnimationFrame(() => reportAnchor());
  });
  // Lebar sidebar: --side-w diatur di sini; class sb-mini = mode icon-only (label teks disembunyikan)
  const resizeEl = document.getElementById("sb-resize");
  const sb = { w: 200, min: 34, max: 360, labelMin: 120 };
  let rs = null; // drag resize yang sedang berjalan
  const applyWidth = (w) => {
    sb.w = w;
    document.documentElement.style.setProperty("--side-w", w + "px");
    document.body.classList.toggle("sb-mini", w < sb.labelMin);
  };
  api.on("sidebar:state", (s) => {
    if (!s) return;
    document.body.classList.toggle("sb-open", !!s.open);
    toggleBtn.classList.toggle("on", !!s.pinned);
    if (Number.isFinite(s.width)) {
      sb.min = s.min || sb.min;
      sb.max = s.max || sb.max;
      sb.labelMin = s.labelMin || sb.labelMin;
      if (!rs) applyWidth(s.width);
    }
  });
  let hotTimer = 0;
  hotEl.addEventListener("mouseenter", () => {
    clearTimeout(hotTimer);
    hotTimer = setTimeout(() => api.sidebarHover(true), 100);
  });
  hotEl.addEventListener("mouseleave", () => clearTimeout(hotTimer));
  toggleBtn.addEventListener("click", () => api.sidebarToggle());

  // ---------- Resize sidebar ----------
  // Saat drag: CSS langsung mengikuti, lebar dikirim ke main (maks 1x per frame) supaya halaman ikut bergeser.
  // Saat dilepas: di bawah labelMin = snap ke lebar minimum (icon-only) dengan transisi halus.
  function resizeEnd() {
    if (!rs) return;
    const { w, raf } = rs;
    cancelAnimationFrame(raf);
    rs = null;
    document.body.classList.remove("sb-resizing");
    const final = w < sb.labelMin ? sb.min : w;
    applyWidth(final);
    api.sidebarResize(final, true);
  }
  resizeEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || rs) return;
    e.preventDefault();
    rs = { x0: e.clientX, w0: sb.w, w: sb.w, raf: 0 };
    try {
      resizeEl.setPointerCapture(e.pointerId);
    } catch {}
    document.body.classList.add("sb-resizing");
  });
  resizeEl.addEventListener("pointermove", (e) => {
    if (!rs) return;
    if (e.buttons === 0) return resizeEnd();
    const cur = rs;
    const w = Math.max(sb.min, Math.min(sb.max, Math.round(cur.w0 + e.clientX - cur.x0)));
    if (w === cur.w) return;
    cur.w = w;
    applyWidth(w);
    if (!cur.raf)
      cur.raf = requestAnimationFrame(() => {
        cur.raf = 0;
        if (rs === cur) api.sidebarResize(cur.w, false);
      });
  });
  resizeEl.addEventListener("pointerup", resizeEnd);
  resizeEl.addEventListener("pointercancel", resizeEnd);
  resizeEl.addEventListener("lostpointercapture", resizeEnd);
  resizeEl.addEventListener("dblclick", () => api.sidebarResizeToggle());

  // ---------- Geser tab untuk mengubah urutan (vertikal di sidebar, horizontal di baris tab atas) ----------
  // Listener bergerak hanya terpasang selama drag; tab digeser dengan transform dan urutan DOM ditukar
  // saat melewati tengah tab tetangga. Urutan akhir dikirim sekali ke main.
  let drag = null;
  const DRAG_THRESHOLD = 5;
  const mid = (n) => {
    const b = n.getBoundingClientRect();
    return axis === "x" ? b.left + b.width / 2 : b.top + b.height / 2;
  };

  function dragMove(e) {
    if (!drag) return;
    const horiz = axis === "x";
    const pos = horiz ? e.clientX : e.clientY;
    const el = drag.el;
    if (!drag.on) {
      if (Math.abs(pos - drag.p0) < DRAG_THRESHOLD) return;
      drag.on = true;
      el.classList.add("dragging");
      try {
        el.setPointerCapture(drag.pid);
      } catch {}
    }
    const box = tabsEl.getBoundingClientRect();
    const lo = horiz ? box.left : box.top;
    const hi = horiz ? box.right : box.bottom;
    const place = () => {
      const r = el.getBoundingClientRect();
      const size = horiz ? r.width : r.height;
      const natural = (horiz ? r.left : r.top) - drag.t; // posisi tanpa transform
      let start = pos - drag.grab;
      start = Math.max(lo, Math.min(start, hi - size));
      drag.t = start - natural;
      el.style.transform = `${horiz ? "translateX" : "translateY"}(${drag.t}px)`;
      return start + size / 2; // pusat tab saat ini
    };
    const center = place();
    const next = el.nextElementSibling;
    const prev = el.previousElementSibling;
    if (next && center > mid(next)) {
      next.after(el);
      place();
    } else if (prev && center < mid(prev)) {
      prev.before(el);
      place();
    }
  }

  function dragEnd() {
    window.removeEventListener("pointermove", dragMove);
    window.removeEventListener("pointerup", dragEnd);
    window.removeEventListener("pointercancel", dragEnd);
    if (!drag) return;
    const { el, on, id, from } = drag;
    drag = null;
    if (!on) return;
    el.classList.remove("dragging");
    el.style.transform = "";
    const to = [...tabsEl.children].indexOf(el);
    if (to !== from) api.moveTab(id, to);
  }

  tabsEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || drag) return;
    const el = e.target.closest(".tab");
    if (!el || e.target.closest(".close, .audio")) return;
    const r = el.getBoundingClientRect();
    const horiz = axis === "x";
    drag = {
      el,
      id: Number(el.dataset.id),
      from: [...tabsEl.children].indexOf(el),
      p0: horiz ? e.clientX : e.clientY,
      grab: horiz ? e.clientX - r.left : e.clientY - r.top,
      t: 0,
      pid: e.pointerId,
      on: false,
    };
    window.addEventListener("pointermove", dragMove);
    window.addEventListener("pointerup", dragEnd);
    window.addEventListener("pointercancel", dragEnd);
  });

  function applyAdblock(s) {
    if (!s) return;
    adblockBtn.disabled = !s.available;
    adblockBtn.classList.toggle("on", s.available && s.enabled);
    adblockBtn.title = !s.available
      ? "Ad blocker not ready"
      : s.enabled
        ? `Ad blocker on (${s.blocked} blocked). Click to turn off`
        : "Ad blocker off. Click to turn on";
    adblockCount.textContent = s.enabled ? formatCount(s.blocked) : "";
  }
  api.on("adblock:state", applyAdblock);
  api.on("adblock:count", (n) => {
    adblockCount.textContent = formatCount(n);
  });
  api.on("downloads:badge", (s) => {
    if (!s) return;
    const busy = s.active > 0;
    dlBtn.classList.toggle("busy", busy);
    dlBtn.classList.toggle("ind", busy && s.progress < 0);
    dlBtn.style.setProperty("--p", String(Math.max(0, s.progress)));
    dlBtn.title = busy
      ? `Downloading ${s.active} file${s.active > 1 ? "s" : ""} (Ctrl+J)`
      : "Downloads (Ctrl+J)";
  });
  // Laporkan posisi ikon unduhan ke main (dipakai panel yang muncul otomatis saat unduhan dimulai)
  const reportAnchor = () => {
    const r = dlBtn.getBoundingClientRect();
    api.downloadsAnchor({ right: r.right, bottom: r.bottom });
  };
  reportAnchor();
  let anchorRaf = 0;
  addEventListener("resize", () => {
    cancelAnimationFrame(anchorRaf);
    anchorRaf = requestAnimationFrame(reportAnchor);
  });
  dlBtn.addEventListener("click", () => {
    const r = dlBtn.getBoundingClientRect();
    api.downloadsToggle({ right: r.right, bottom: r.bottom });
  });
  adblockBtn.addEventListener("click", async () =>
    applyAdblock(await api.toggleAdblock()),
  );

  document
    .getElementById("new-tab")
    .addEventListener("click", () => api.newTab());
  backBtn.addEventListener("click", () => api.back());
  forwardBtn.addEventListener("click", () => api.forward());
  reloadBtn.addEventListener("click", () => api.reload());
  starBtn.addEventListener("click", () => api.toggleBookmark());
  menuBtn.addEventListener("click", () => {
    const r = menuBtn.getBoundingClientRect();
    api.menu({ right: r.right, bottom: r.bottom });
  });
  siteBtn.addEventListener("click", () => api.site());
  // Klik URL = buka command palette berisi alamat halaman ini (terpilih semua)
  addressEl.addEventListener("click", () =>
    api.openPalette(state.get(activeId)?.url || ""),
  );

  // Drop file (mis. dari panel unduhan) di sidebar / toolbar: gambar, txt, dan pdf dibuka di tab baru
  const hasFiles = (e) =>
    e.dataTransfer && [...e.dataTransfer.types].includes("Files");
  document.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  document.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    api.openFiles([...e.dataTransfer.files].map((f) => api.pathForFile(f)));
  });

  api.init().then((s) => {
    applyAdblock(s);
    // Logo di pojok kiri dinonaktifkan (di-comment). Hapus tanda comment di bawah untuk menampilkannya lagi.
    // if (s && s.logo) {
    //   brandEl.src = s.logo;
    //   brandEl.hidden = false;
    // }
  });
})();
