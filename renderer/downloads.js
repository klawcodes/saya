(() => {
  const api = window.sayaAPI;
  const $ = (id) => document.getElementById(id);
  const list = $("list");
  const empty = $("empty");
  const q = $("q");
  const clear = $("clear");
  let all = [];
  let icons = {};

  function render() {
    const needle = q.value.trim().toLowerCase();
    const rows = needle
      ? all.filter(
          (i) =>
            i.name.toLowerCase().includes(needle) ||
            i.host.toLowerCase().includes(needle),
        )
      : all;
    DL.reconcile(list, rows, true, icons);
    $("count").textContent = all.length ? String(all.length) : "";
    empty.hidden = rows.length > 0;
    empty.textContent = all.length ? "No matching downloads" : "No downloads yet";
    clear.disabled = !all.some((i) => i.state !== "active" && i.state !== "paused");
  }
  const set = (p) => {
    all = Array.isArray(p?.items) ? p.items : [];
    icons = p?.icons || {};
    render();
  };

  DL.bind(
    list,
    (id, action) => api.downloadsAct(id, action),
    (id) => api.downloadsDrag(id),
  );
  q.addEventListener("input", render);
  $("folder").addEventListener("click", () => api.downloadsAct("", "folder"));

  // Hapus riwayat: klik dua kali (konfirmasi 3 detik)
  let arm = 0;
  const disarm = () => {
    clearTimeout(arm);
    clear.classList.remove("armed");
    clear.textContent = "Clear history";
  };
  clear.addEventListener("click", () => {
    if (!clear.classList.contains("armed")) {
      clear.classList.add("armed");
      clear.textContent = "Click again to confirm";
      arm = setTimeout(disarm, 3000);
      return;
    }
    disarm();
    api.downloadsClear();
  });

  api.downloadsOnUpdate(set);
  api.downloadsList().then(set);
})();
