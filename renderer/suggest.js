(() => {
  const api = window.suggestAPI;
  if (!api) return;
  const q = document.getElementById('q');
  const topEl = document.getElementById('top');
  const listEl = document.getElementById('list');
  const footEl = document.getElementById('foot');
  const engEl = document.getElementById('engines');
  const actEl = document.getElementById('act-text');

  // Static strings only (no user data), so innerHTML is safe here
  const ICON = {
    search: '<svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>',
    clock: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/></svg>',
    star: '<svg viewBox="0 0 16 16"><path d="M8 1.9l1.9 3.8 4.2.6-3 3 .7 4.2L8 11.5l-3.8 2 .7-4.2-3-3 4.2-.6z"/></svg>',
    globe: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12"/></svg>',
    tab: '<svg viewBox="0 0 16 16"><rect x="2" y="3.5" width="12" height="9" rx="2"/><path d="M2 6.5h12"/></svg>',
    plus: '<svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10"/></svg>',
    reopen: '<svg viewBox="0 0 16 16"><path d="M3 8a5 5 0 1 0 1.6-3.7"/><path d="M3 2.5v3h3"/></svg>',
    sidebar: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="2.5"/><path d="M6 3v10"/></svg>',
    download: '<svg viewBox="0 0 16 16"><path d="M8 2.5v7M5 6.8l3 3 3-3M3 12.5h10"/></svg>',
    sliders: '<svg viewBox="0 0 16 16"><path d="M2.5 5h6M11.5 5h2M2.5 11h2M7.5 11h6"/><circle cx="10" cy="5" r="1.5"/><circle cx="6" cy="11" r="1.5"/></svg>',
  };

  let items = [];
  let sel = 0;
  let typed = '';

  function iconEl(it) {
    const ic = document.createElement('span');
    ic.className = 'ic';
    const fallback = () => { ic.innerHTML = ICON[it.icon] || ICON.search; };
    if (it.favicon) {
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      img.addEventListener('error', fallback);
      img.src = it.favicon;
      ic.append(img);
    } else {
      fallback();
    }
    return ic;
  }

  function row(it, i) {
    const li = document.createElement('li');
    li.className = 'it' + (i === sel ? ' sel' : '');
    li.dataset.i = i;
    const t = document.createElement('span');
    t.className = 't';
    const full = it.title || it.text;
    // Saran pencarian: bagian yang diketik biasa, kelanjutannya tebal
    if (it.kind === 'search' && !it.sub && typed && full.toLowerCase().startsWith(typed.toLowerCase()) && full.length > typed.length) {
      const b = document.createElement('b');
      b.textContent = full.slice(typed.length);
      t.append(full.slice(0, typed.length), b);
    } else {
      t.textContent = full;
    }
    li.append(iconEl(it), t);
    if (it.sub) {
      const s = document.createElement('span');
      s.className = 's';
      s.textContent = it.sub;
      li.append(s);
    }
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = it.hint || '';
    li.append(k);
    return li;
  }

  function updateAct() {
    actEl.textContent = (items[sel] && items[sel].hint) || 'Search';
  }

  function setSel(i, scroll) {
    if (!items.length) return;
    sel = (i + items.length) % items.length;
    listEl.querySelectorAll('.it').forEach((el) => el.classList.toggle('sel', Number(el.dataset.i) === sel));
    const el = listEl.querySelector('.it.sel');
    if (el && scroll) el.scrollIntoView({ block: 'nearest' });
    updateAct();
  }

  function report() {
    requestAnimationFrame(() => api.size(topEl.offsetHeight + listEl.scrollHeight + footEl.offsetHeight));
  }

  function footer(engines, current) {
    engEl.replaceChildren();
    for (const e of engines) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'eng' + (e.id === current ? ' on' : '');
      b.textContent = e.name;
      b.title = 'Ctrl+E switch search engine';
      b.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        api.engine(e.id);
      });
      engEl.append(b);
    }
  }

  function render(p) {
    items = p.items || [];
    typed = p.typed || '';
    if (p.placeholder) q.placeholder = p.placeholder;
    sel = p.reset ? 0 : Math.max(0, Math.min(sel, items.length - 1));
    const frag = document.createDocumentFragment();
    let lastSec = '';
    items.forEach((it, i) => {
      const sec = it.sec || '';
      if (sec && sec !== lastSec) {
        const h = document.createElement('li');
        h.className = 'sec';
        h.textContent = sec;
        frag.append(h);
      }
      lastSec = sec;
      frag.append(row(it, i));
    });
    listEl.replaceChildren(frag);
    if (p.reset) listEl.scrollTop = 0;
    footer(p.engines || [], p.current);
    updateAct();
    report();
  }

  // mousedown (bukan click): jaga fokus tetap di kotak ketik
  listEl.addEventListener('mousedown', (e) => {
    const li = e.target.closest('.it');
    if (!li) return;
    e.preventDefault();
    api.pick(Number(li.dataset.i));
  });
  listEl.addEventListener('mouseover', (e) => {
    const li = e.target.closest('.it');
    if (li && Number(li.dataset.i) !== sel) setSel(Number(li.dataset.i), false);
  });

  q.addEventListener('input', () => api.query(q.value));
  q.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel(sel + 1, true);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel(sel - 1, true);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items.length) api.pick(sel);
      else api.go(q.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      api.close();
    }
  });

  api.onShow(({ text, select }) => {
    q.value = text || '';
    q.focus();
    if (select) q.select();
    else q.setSelectionRange(q.value.length, q.value.length);
  });
  api.onRender(render);
})();
