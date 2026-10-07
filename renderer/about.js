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
  if (!api) {
    ver.textContent = "This page only works inside Saya.";
    return;
  }
  api.aboutInfo().then((i) => {
    if (i)
      ver.textContent = `Version ${i.version} (Electron ${i.electron}, Chromium ${i.chromium}) (${i.bits})`;
  });
  for (const el of document.querySelectorAll("[data-open]")) {
    el.addEventListener("click", () => api.open(el.dataset.open));
  }
})();
