(() => {
  const api = window.dlAPI;
  const list = document.getElementById("list");
  const empty = document.getElementById("empty");

  DL.bind(list, (id, action) => api.act(id, action));
  api.onRender(({ items, icons }) => {
    DL.reconcile(list, items, false, icons);
    empty.hidden = items.length > 0;
  });
  document.getElementById("all").addEventListener("click", () => api.all());
  document.getElementById("close").addEventListener("click", () => api.close());
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") api.close();
  });
})();
