(() => {
  const api = window.sayaAPI;
  const ver = document.getElementById("ver");
  // Logo: renderer/logo.png. Kalau belum ada, pakai logo SVG bawaan.
  const img = document.getElementById("logo-img");
  const fallback = document.getElementById("logo-fallback");
  const useFallback = () => {
    img.hidden = true;
    fallback.hidden = false;
  };
  img.addEventListener("error", useFallback);
  if (img.complete && img.naturalWidth === 0) useFallback();

  // Copyright: tahun otomatis dari jam perangkat, author dari package.json (dikirim main process)
  const copy = document.getElementById("copy");
  const setCopy = (author) => {
    copy.textContent = `Copyright ${new Date().getFullYear()}${author ? " " + author : ""}. All rights reserved.`;
  };
  setCopy(""); // tahun langsung tampil

  if (!api) {
    ver.textContent = "This page only works inside Saya.";
    return;
  }
  api.aboutInfo().then((i) => {
    if (!i) return;
    ver.textContent = `Version ${i.version} (Electron ${i.electron}, Chromium ${i.chromium}) (${i.bits})`;
    setCopy(i.author);
  });
  for (const el of document.querySelectorAll("[data-open]")) {
    el.addEventListener("click", () => api.open(el.dataset.open));
  }
})();
