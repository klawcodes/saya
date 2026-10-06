(() => {
  const api = window.suggestAPI;
  const listEl = document.getElementById('list');
  const engEl = document.getElementById('engines');

  // Static strings only (no user data), so innerHTML is safe here
  const ICON = {
    search: '<svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>',
    clock: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/></svg>',
    star: '<svg viewBox="0 0 16 16"><path d="M8 1.9l1.9 3.8 4.2.6-3 3 .7 4.2L8 11.5l-3.8 2 .7-4.2-3-3 4.2-.6z"/></svg>',
    globe: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12"/></svg>',
  };

  function row(it, i, sel, typed) {
    const li = document.createElement('li');
    li.className = 'it' + (i === sel ? ' sel' : '');
    const ic = document.createElement('span');
    ic.className = 'ic';
    ic.innerHTML = ICON[it.icon] || ICON.search;
    const t = document.createElement('span');
    t.className = 't';
    const full = it.title || it.text;
    // Search suggestion: typed part is regular, the continuation is bold
    if (it.kind === 'search' && !it.sub && full.toLowerCase().startsWith(typed.toLowerCase()) && full.length > typed.length) {
      const b = document.createElement('b');
      b.textContent = full.slice(typed.length);
      t.append(full.slice(0, typed.length), b);
    } else {
      t.textContent = full;
    }
    li.append(ic, t);
    if (it.sub) {
      const s = document.createElement('span');
      s.className = 's';
      s.textContent = it.sub;
      li.append(s);
    }
    // mousedown (not click): the address bar input loses focus when the button is pressed
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      api.pick(i);
    });
    return li;
  }

  function footer(engines, current) {
    engEl.replaceChildren();
    for (const e of engines) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'eng' + (e.id === current ? ' on' : '');
      b.textContent = e.name;
      b.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        api.engine(e.id);
      });
      engEl.append(b);
    }
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = 'Ctrl+E switch';
    engEl.append(hint);
  }

  if (!api) return;
  api.onRender(({ items, sel, typed, engines, current }) => {
    const frag = document.createDocumentFragment();
    (items || []).forEach((it, i) => frag.append(row(it, i, sel, typed || '')));
    listEl.replaceChildren(frag);
    footer(engines || [], current);
  });
})();
