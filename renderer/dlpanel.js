(() => {
  const api = window.dlAPI;
  const list = document.getElementById("list");
  const empty = document.getElementById("empty");

  DL.bind(list, (id, action) => api.act(id, action), (id) => api.drag(id));
  api.onRender(({ items, icons }) => {
    DL.reconcile(list, items, false, icons);
    empty.hidden = items.length > 0;
  });
  document.getElementById("all").addEventListener("click", () => api.all());
  document.getElementById("close").addEventListener("click", () => api.close());
  // Selama kursor di atas panel yang muncul otomatis, panel tidak ditutup
  document.documentElement.addEventListener("mouseenter", () => api.hover(true));
  document.documentElement.addEventListener("mouseleave", () => api.hover(false));
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") api.close();
  });
})();
