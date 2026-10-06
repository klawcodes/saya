(() => {
  const api = window.siftAPI;
  const listEl = document.getElementById('list');
  const qEl = document.getElementById('q');
  const countEl = document.getElementById('count');
  const X = '<svg viewBox="0 0 8 8"><path d="M1 1l6 6M7 1L1 7"/></svg>';
  let items = [];

  function row(item) {
    let host = '';
    try { host = new URL(item.u).hostname.replace(/^www\./, ''); } catch { return null; }
    if (!/^https?:\/\//i.test(item.u)) return null;
    const el = document.createElement('div');
    el.className = 'row';
    const a = document.createElement('a');
    a.href = item.u;
    a.title = item.u;
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = item.t || item.u;
    const h = document.createElement('span');
    h.className = 'h';
    h.textContent = host;
    a.append(t, h);
    const x = document.createElement('button');
    x.className = 'x';
    x.type = 'button';
    x.title = 'Remove bookmark';
    x.innerHTML = X;
    x.addEventListener('click', async () => {
      await api.bookmarksRemove(item.u);
      items = items.filter((b) => b.u !== item.u);
      render();
    });
    el.append(a, x);
    return el;
  }

  function render() {
    const needle = qEl.value.trim().toLowerCase();
    const shown = needle
      ? items.filter((b) => b.u.toLowerCase().includes(needle) || (b.t || '').toLowerCase().includes(needle))
      : items;
    countEl.textContent = items.length ? String(items.length) : '';
    listEl.replaceChildren();
    if (!shown.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = needle
        ? `No results for “${qEl.value.trim()}”.`
        : 'No bookmarks yet. Press Ctrl+D or the star in the toolbar to save a page.';
      listEl.append(p);
      return;
    }
    const frag = document.createDocumentFragment();
    for (const b of shown) {
      const r = row(b);
      if (r) frag.append(r);
    }
    listEl.append(frag);
  }

  qEl.addEventListener('input', render);

  if (!api) {
    listEl.innerHTML = '<p class="empty">This page only works inside Sift.</p>';
  } else {
    api.bookmarksList().then((res) => {
      items = Array.isArray(res) ? res : [];
      render();
    });
  }
})();
