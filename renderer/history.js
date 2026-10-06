(() => {
  const api = window.siftAPI;
  const listEl = document.getElementById('list');
  const moreEl = document.getElementById('more');
  const qEl = document.getElementById('q');
  const rangeEl = document.getElementById('range');
  const clearEl = document.getElementById('clear');
  const PAGE = 100;
  const X = '<svg viewBox="0 0 8 8"><path d="M1 1l6 6M7 1L1 7"/></svg>';

  let offset = 0;
  let total = 0;
  let lastDay = '';
  let query = '';
  let seq = 0;

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  function dayLabel(ts) {
    const today = startOfDay(new Date());
    const day = startOfDay(new Date(ts));
    if (day === today) return 'Today';
    if (day === today - 864e5) return 'Yesterday';
    return new Date(ts).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  const hhmm = (ts) => new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

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
    const time = document.createElement('time');
    time.textContent = hhmm(item.ts);
    const x = document.createElement('button');
    x.className = 'x';
    x.type = 'button';
    x.title = 'Remove from history';
    x.innerHTML = X;
    x.addEventListener('click', async () => {
      await api.historyRemove(item.u);
      const prev = el.previousElementSibling;
      const next = el.nextElementSibling;
      el.remove();
      if (prev?.tagName === 'H2' && (!next || next.tagName === 'H2')) prev.remove();
      total--;
      if (!listEl.children.length) showEmpty();
    });
    el.append(a, time, x);
    return el;
  }

  function showEmpty() {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = query
      ? `No results for “${query}”.`
      : 'No history yet. Pages you visit will appear here.';
    listEl.replaceChildren(p);
    moreEl.hidden = true;
  }

  async function load(reset) {
    const mine = ++seq;
    if (reset) { offset = 0; lastDay = ''; }
    const res = await api.historyList({ q: query, limit: PAGE, offset });
    if (mine !== seq || !res) return;
    total = res.total;
    if (reset) listEl.replaceChildren();
    const frag = document.createDocumentFragment();
    for (const item of res.items) {
      const day = dayLabel(item.ts);
      if (day !== lastDay) {
        const h = document.createElement('h2');
        h.textContent = day;
        frag.append(h);
        lastDay = day;
      }
      const r = row(item);
      if (r) frag.append(r);
    }
    listEl.append(frag);
    offset += res.items.length;
    moreEl.hidden = offset >= total;
    if (!listEl.children.length) showEmpty();
  }

  let timer;
  qEl.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { query = qEl.value.trim(); load(true); }, 200);
  });
  moreEl.addEventListener('click', () => load(false));

  // Bulk clear: first click arms, second click executes
  let armTimer;
  function disarm() {
    clearTimeout(armTimer);
    clearEl.classList.remove('armed');
    clearEl.textContent = 'Clear';
  }
  clearEl.addEventListener('click', async () => {
    if (!clearEl.classList.contains('armed')) {
      clearEl.classList.add('armed');
      clearEl.textContent = 'Sure? Click again';
      armTimer = setTimeout(disarm, 3000);
      return;
    }
    disarm();
    const v = rangeEl.value;
    const since = v === 'hour' ? Date.now() - 36e5 : v === 'today' ? startOfDay(new Date()) : 0;
    await api.historyClear(since);
    load(true);
  });
  rangeEl.addEventListener('change', disarm);

  if (!api) {
    listEl.innerHTML = '<p class="empty">This page only works inside Sift.</p>';
  } else {
    load(true);
  }
})();
