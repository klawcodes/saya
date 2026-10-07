// Baris unduhan, dipakai bersama oleh panel (dlpanel.js) dan halaman penuh (downloads.js).
// Semua teks lewat textContent; ikon adalah konstanta statis. Tidak ada style inline (CSP style-src 'self').
(() => {
  const I = {
    pause: '<svg viewBox="0 0 16 16"><path d="M5.5 3.5v9M10.5 3.5v9"/></svg>',
    play: '<svg viewBox="0 0 16 16" class="f"><path d="M5 3.2l7.5 4.8L5 12.8z"/></svg>',
    x: '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
    folder: '<svg viewBox="0 0 16 16"><path d="M2 4.5h4l1.5 1.5H14v6.5H2z"/></svg>',
    retry: '<svg viewBox="0 0 16 16"><path d="M12.5 8A4.5 4.5 0 1 1 11 4.7M12 2.5v3H9"/></svg>',
    link: '<svg viewBox="0 0 16 16"><path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-.6.6M9.2 6.8a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l.6-.6"/></svg>',
  };
  const BTN = {
    pause: ["Pause", I.pause],
    resume: ["Resume", I.play],
    cancel: ["Cancel download", I.x],
    show: ["Show in folder", I.folder],
    retry: ["Retry", I.retry],
    copy: ["Copy link", I.link],
    remove: ["Remove from list", I.x],
  };

  const KINDS = {
    pdf: "pdf",
    zip: "zip", rar: "zip", "7z": "zip", tar: "zip", gz: "zip", xz: "zip", iso: "zip",
    png: "img", jpg: "img", jpeg: "img", gif: "img", webp: "img", svg: "img", bmp: "img", avif: "img", ico: "img",
    mp4: "media", mkv: "media", webm: "media", avi: "media", mov: "media",
    mp3: "media", wav: "media", flac: "media", ogg: "media", m4a: "media",
    exe: "exe", msi: "exe", dmg: "exe", apk: "exe", bat: "exe", cmd: "exe", ps1: "exe",
    doc: "doc", docx: "doc", xls: "doc", xlsx: "doc", ppt: "doc", pptx: "doc",
    txt: "doc", csv: "doc", rtf: "doc", odt: "doc",
  };

  function actions(it, full) {
    switch (it.state) {
      case "active":
        return ["pause", "cancel"];
      case "paused":
        return it.resumable ? ["resume", "cancel"] : ["cancel"];
      case "done":
        return it.gone ? ["remove"] : full ? ["show", "copy", "remove"] : ["show", "remove"];
      default: // cancelled | failed
        return full ? ["retry", "copy", "remove"] : ["retry", "remove"];
    }
  }

  function make() {
    const el = document.createElement("div");
    el.className = "dl";
    el.tabIndex = 0;
    el.innerHTML =
      '<div class="ic"><img alt="" draggable="false" hidden><span></span></div><div class="tx"><div class="nm"></div><div class="in"></div>' +
      '<div class="bar"><i></i></div></div><div class="ac"></div>';
    return el;
  }

  function update(el, it, full, icons) {
    el.dataset.id = it.id;
    el.dataset.s = it.state;
    if (it.gone) el.dataset.g = "1";
    else delete el.dataset.g;

    const ic = el.querySelector(".ic");
    ic.dataset.k = KINDS[it.ext] || "file"; // lencana teks: cadangan kalau ikon sistem tidak tersedia
    const [img, tag] = [ic.firstChild, ic.lastChild];
    const url = icons && icons[it.ik];
    if (img._u !== url) {
      img._u = url;
      if (url) img.src = url;
    }
    img.hidden = !url;
    tag.hidden = !!url;
    tag.textContent = (it.ext || "").toUpperCase().slice(0, 4);
    ic.classList.toggle("has", !!url);

    const nm = el.querySelector(".nm");
    nm.textContent = it.name;
    nm.title = it.name;
    el.querySelector(".in").textContent =
      full && it.host ? `${it.info} • ${it.host}` : it.info;

    const running = it.state === "active" || it.state === "paused";
    const bar = el.querySelector(".bar");
    bar.hidden = !running;
    bar.classList.toggle("ind", running && it.pct < 0);
    if (running && it.pct >= 0)
      bar.firstChild.style.width = Math.round(it.pct * 1000) / 10 + "%"; // CSSOM, bukan atribut style
    else bar.firstChild.style.removeProperty("width");

    // tombol hanya dibangun ulang kalau set aksinya berubah (hover/fokus tidak hilang saat progres jalan)
    const names = actions(it, full);
    const key = names.join();
    const ac = el.querySelector(".ac");
    if (ac.dataset.k !== key) {
      ac.dataset.k = key;
      ac.textContent = "";
      for (const n of names) {
        const b = document.createElement("button");
        b.dataset.a = n;
        b.title = BTN[n][0];
        b.setAttribute("aria-label", BTN[n][0]);
        b.innerHTML = BTN[n][1];
        ac.appendChild(b);
      }
    }
  }

  // Sinkronkan daftar dengan elemen yang ada (kunci = id): tidak membangun ulang semuanya
  function reconcile(list, items, full, icons) {
    const have = new Map();
    for (const c of list.children) if (c.dataset.id) have.set(c.dataset.id, c);
    items.forEach((it, i) => {
      let el = have.get(it.id);
      have.delete(it.id);
      if (!el) el = make();
      update(el, it, !!full, icons);
      if (list.children[i] !== el) list.insertBefore(el, list.children[i] || null);
    });
    for (const el of have.values()) el.remove();
  }

  // Satu listener untuk semua baris: tombol -> aksinya, klik baris -> "open"
  function bind(list, onAct) {
    list.addEventListener("click", (e) => {
      const row = e.target.closest(".dl");
      if (!row) return;
      const b = e.target.closest("button[data-a]");
      onAct(row.dataset.id, b ? b.dataset.a : "open");
    });
    list.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.classList.contains("dl"))
        onAct(e.target.dataset.id, "open");
    });
  }

  window.DL = { reconcile, bind };
})();
