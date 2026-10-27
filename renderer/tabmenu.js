// tabmenu.js — menggambar menu klik kanan tab dari data main-tabmenu.js (teks lewat textContent).
const api = window.tabMenuAPI;
const root = document.getElementById("m");
const s = (d) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  splitu: s('<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M8 2.5v11"/><path d="M5.2 8.6V5.4M4 6.5l1.2-1.2L6.4 6.5"/>'),
  splitd: s('<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M8 2.5v11"/><path d="M10.8 7.4v3.2M9.6 9.5l1.2 1.2 1.2-1.2"/>'),
  splitl: s('<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M8 2.5v11"/><path d="M6.6 6l-1.4 2 1.4 2"/>'),
  splitr: s('<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M8 2.5v11"/><path d="M9.4 6l1.4 2-1.4 2"/>'),
  unsplit: s('<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5"/>'),
  close: s('<path d="M4 4l8 8M12 4l-8 8"/>'),
  below: s('<path d="M3 3.5h10M3 6.5h6"/><path d="M5 10l3 3 3-3"/>'),
  after: s('<path d="M3.5 3v10M6.5 3v6"/><path d="M10 5l3 3-3 3"/>'),
  all: s('<rect x="2.5" y="4.5" width="8" height="8" rx="1.8"/><path d="M5.5 2.5h6.2A1.8 1.8 0 0 1 13.5 4.3V10.5"/>'),
};

let items = [];
let focus = -1;
const btns = () => [...root.querySelectorAll(".it")];

function setFocus(i) {
  const list = btns();
  if (!list.length) return;
  focus = (i + list.length) % list.length;
  list.forEach((b, n) => b.classList.toggle("on", n === focus));
  list[focus].focus({ preventScroll: true });
}

function render(p) {
  items = p.items || [];
  root.replaceChildren();
  focus = -1;
  for (const it of items) {
    if (it.sep) {
      const d = document.createElement("div");
      d.className = "sep";
      d.setAttribute("role", "separator");
      root.append(d);
      continue;
    }
    const b = document.createElement("button");
    b.type = "button";
    b.className = "it" + (it.danger ? " danger" : "");
    b.setAttribute("role", "menuitem");
    b.dataset.id = it.id;
    b.innerHTML = ICON[it.icon] || "";
    const t = document.createElement("span");
    t.textContent = it.label;
    b.append(t);
    b.addEventListener("click", () => api.act(it.id));
    b.addEventListener("mouseenter", () => {
      const n = btns().indexOf(b);
      focus = n;
      btns().forEach((x, k) => x.classList.toggle("on", k === n));
    });
    root.append(b);
  }
  // Tinggi isi dilaporkan supaya main bisa memasang ukuran panel sebelum ditampilkan.
  // Dilaporkan LANGSUNG (offsetHeight memaksa layout), bukan lewat requestAnimationFrame: saat panel masih
  // tersembunyi (view belum ditampilkan), Chromium tidak menjalankan rAF sehingga laporan tidak pernah terkirim
  // dan menu tidak pernah muncul.
  api.size(root.offsetHeight);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    api.close();
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    setFocus(focus < 0 ? 0 : focus + 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    setFocus(focus < 0 ? -1 : focus - 1);
  } else if (e.key === "Home") {
    e.preventDefault();
    setFocus(0);
  } else if (e.key === "End") {
    e.preventDefault();
    setFocus(-1);
  }
});
document.addEventListener("contextmenu", (e) => e.preventDefault());

api.onRender(render);
