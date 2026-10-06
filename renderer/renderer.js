(() => {
  const api = window.browserAPI;
  const tabsEl = document.getElementById('tabs');
  const addressEl = document.getElementById('address');
  const backBtn = document.getElementById('back');
  const forwardBtn = document.getElementById('forward');
  const reloadBtn = document.getElementById('reload');
  const starBtn = document.getElementById('star');
  const menuBtn = document.getElementById('menu');
  const adblockBtn = document.getElementById('adblock');
  const adblockCount = document.getElementById('adblock-count');
  const siteBtn = document.getElementById('site');

  const CLOSE_SVG =
    '<svg viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M1 1l6 6M7 1L1 7"/></svg>';

  const state = new Map(); // id -> tab data
  let activeId = null;

  const countTabs = () => tabsEl.style.setProperty('--n', String(tabsEl.children.length || 1));

  function formatCount(n) {
    if (!n) return '';
    return n > 999 ? Math.floor(n / 100) / 10 + 'k' : String(n);
  }

  const setFav = (fav, url) => {
    const v = url ? `url(${JSON.stringify(url)})` : '';
    if (fav.style.backgroundImage !== v) fav.style.backgroundImage = v;
  };

  function renderTab(data) {
    let el = tabsEl.querySelector(`[data-id="${data.id}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'tab';
      el.dataset.id = data.id;
      el.innerHTML =
        '<div class="body"><span class="favicon"></span><span class="title"></span>' +
        `<button class="close" title="Close tab">${CLOSE_SVG}</button></div>`;
      el.addEventListener('mousedown', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          api.closeTab(data.id);
        } else if (e.button === 0 && !e.target.closest('.close')) {
          api.activateTab(data.id);
        }
      });
      el.querySelector('.favicon').style.backgroundSize = 'cover';
      el.querySelector('.close').addEventListener('click', (e) => {
        e.stopPropagation();
        api.closeTab(data.id);
      });
      tabsEl.appendChild(el);
      countTabs();
    }

    // Spinner: class hanya diubah kalau memang berubah (animasi tidak terganggu), dan dimatikan
    // dengan jeda singkat supaya jeda antar redirect/navigasi tidak membuatnya tampak berhenti.
    const fav = el.querySelector('.favicon');
    if (data.loading) {
      if (el._stop) {
        clearTimeout(el._stop);
        el._stop = 0;
      }
      fav.classList.add('loading');
      setFav(fav, '');
    } else if (fav.classList.contains('loading')) {
      if (!el._stop) {
        el._stop = setTimeout(() => {
          el._stop = 0;
          fav.classList.remove('loading');
          const d = state.get(Number(el.dataset.id));
          setFav(fav, d && !d.loading ? d.favicon : '');
        }, 350);
      }
    } else {
      setFav(fav, data.favicon);
    }
    el.classList.toggle('suspended', !!data.suspended);
    el.classList.toggle('active', data.id === activeId);
    el.querySelector('.title').textContent = data.title || 'New Tab';
    el.title = (data.title || '') + (data.suspended ? ' (sleeping, loads when opened)' : '');
  }

  function syncToolbar() {
    const data = state.get(activeId);
    if (!data) return;
    backBtn.disabled = !data.canGoBack;
    forwardBtn.disabled = !data.canGoForward;
    starBtn.disabled = !data.bookmarkable;
    siteBtn.disabled = !data.bookmarkable;
    starBtn.classList.toggle('on', !!data.bookmarked);
    starBtn.title = data.bookmarked ? 'Remove bookmark (Ctrl+D)' : 'Add bookmark (Ctrl+D)';
    // activeElement stays the input even after focus moves to the web page, so also check hasFocus()
    const editing = document.activeElement === addressEl && document.hasFocus();
    if (!editing) addressEl.value = data.url || '';
  }

  function setActive(id) {
    activeId = id;
    for (const el of tabsEl.children) {
      el.classList.toggle('active', Number(el.dataset.id) === id);
    }
    syncToolbar();
  }

  api.on('tab:created', (data) => {
    if (!data) return;
    state.set(data.id, data);
    renderTab(data);
  });
  api.on('tab:update', (data) => {
    if (!data) return;
    state.set(data.id, data);
    renderTab(data);
    if (data.id === activeId) syncToolbar();
  });
  api.on('tab:active', (id) => setActive(id));
  api.on('tab:closed', (id) => {
    state.delete(id);
    const gone = tabsEl.querySelector(`[data-id="${id}"]`);
    if (gone) {
      clearTimeout(gone._stop);
      gone.remove();
    }
    countTabs();
  });

  // ---------- Geser tab untuk mengubah urutan ----------
  // Ringan: listener bergerak hanya terpasang selama drag; tab digeser dengan transform (tanpa layout ulang
  // berulang) dan urutan DOM ditukar saat melewati tengah tab tetangga. Urutan akhir dikirim sekali ke main.
  let drag = null;
  const DRAG_THRESHOLD = 5;

  function dragMove(e) {
    if (!drag) return;
    const el = drag.el;
    if (!drag.on) {
      if (Math.abs(e.clientX - drag.x0) < DRAG_THRESHOLD) return;
      drag.on = true;
      el.classList.add('dragging');
      try {
        el.setPointerCapture(drag.pid);
      } catch {}
    }
    const box = tabsEl.getBoundingClientRect();
    const place = () => {
      const r = el.getBoundingClientRect();
      const natural = r.left - drag.tx; // posisi tanpa transform
      let left = e.clientX - drag.grab;
      left = Math.max(box.left, Math.min(left, box.right - r.width));
      drag.tx = left - natural;
      el.style.transform = `translateX(${drag.tx}px)`;
      return left + r.width / 2; // pusat tab saat ini
    };
    let center = place();
    const next = el.nextElementSibling;
    const prev = el.previousElementSibling;
    if (next && center > next.getBoundingClientRect().left + next.offsetWidth / 2) {
      next.after(el);
      place();
    } else if (prev && center < prev.getBoundingClientRect().left + prev.offsetWidth / 2) {
      prev.before(el);
      place();
    }
  }

  function dragEnd() {
    window.removeEventListener('pointermove', dragMove);
    window.removeEventListener('pointerup', dragEnd);
    window.removeEventListener('pointercancel', dragEnd);
    if (!drag) return;
    const { el, on, id, from } = drag;
    drag = null;
    if (!on) return;
    el.classList.remove('dragging');
    el.style.transform = '';
    const to = [...tabsEl.children].indexOf(el);
    if (to !== from) api.moveTab(id, to);
  }

  tabsEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || drag) return;
    const el = e.target.closest('.tab');
    if (!el || e.target.closest('.close')) return;
    drag = {
      el,
      id: Number(el.dataset.id),
      from: [...tabsEl.children].indexOf(el),
      x0: e.clientX,
      grab: e.clientX - el.getBoundingClientRect().left,
      tx: 0,
      pid: e.pointerId,
      on: false,
    };
    window.addEventListener('pointermove', dragMove);
    window.addEventListener('pointerup', dragEnd);
    window.addEventListener('pointercancel', dragEnd);
  });
  api.on('focus-address', () => {
    addressEl.focus();
    addressEl.select();
  });

  const setPlaceholder = (name) => {
    addressEl.placeholder = name ? `Search with ${name} or type an address` : 'Search or type an address';
  };
  function querySuggest(force) {
    const r = addressEl.getBoundingClientRect();
    api.suggestQuery(addressEl.value, { x: r.left, width: r.width, bottom: r.bottom }, !!force);
  }
  api.on('engine:changed', (e) => {
    if (!e) return;
    setPlaceholder(e.name);
    if (e.fresh) {
      addressEl.focus();
      addressEl.value = '';
    } else if (e.refocus) {
      addressEl.focus();
      const n = addressEl.value.length;
      addressEl.setSelectionRange(n, n);
    }
    if (document.activeElement === addressEl) querySuggest(true);
  });
  api.on('suggest:fill', (text) => {
    if (typeof text === 'string') addressEl.value = text;
  });

  function applyAdblock(s) {
    if (!s) return;
    adblockBtn.disabled = !s.available;
    adblockBtn.classList.toggle('on', s.available && s.enabled);
    adblockBtn.title = !s.available
      ? 'Ad blocker not ready'
      : s.enabled
        ? `Ad blocker on (${s.blocked} blocked). Click to turn off`
        : 'Ad blocker off. Click to turn on';
    adblockCount.textContent = s.enabled ? formatCount(s.blocked) : '';
  }
  api.on('adblock:state', applyAdblock);
  api.on('adblock:count', (n) => {
    adblockCount.textContent = formatCount(n);
  });
  adblockBtn.addEventListener('click', async () => applyAdblock(await api.toggleAdblock()));

  document.getElementById('new-tab').addEventListener('click', () => api.newTab());
  backBtn.addEventListener('click', () => api.back());
  forwardBtn.addEventListener('click', () => api.forward());
  reloadBtn.addEventListener('click', () => api.reload());
  starBtn.addEventListener('click', () => api.toggleBookmark());
  menuBtn.addEventListener('click', () => api.menu());
  siteBtn.addEventListener('click', () => api.site());

  addressEl.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      api.suggestMove(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      api.go(addressEl.value);
      addressEl.blur();
    } else if (e.key === 'Escape') {
      addressEl.value = state.get(activeId)?.url || '';
      addressEl.blur();
    }
  });
  addressEl.addEventListener('focus', () => {
    addressEl.select();
    api.suggestFocus();
  });
  addressEl.addEventListener('blur', () => {
    api.suggestBlur();
    syncToolbar();
  });
  addressEl.addEventListener('input', () => querySuggest(false));

  api.init().then((s) => {
    applyAdblock(s);
    setPlaceholder(s && s.engine);
  });
})();
