(() => {
  "use strict";

  const loadScript = (src) =>
    new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src^="${src.split("?")[0]}"]`);
      if (existing) {
        resolve();
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      script.async = false;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Gagal memuat script: ${src}`));
      document.head.appendChild(script);
    });

  const boot = async () => {
    try {
      if (typeof window.QrScanner === "undefined") {
        await loadScript("/js/libs/qr-scanner.umd.min.js?v=20260404-11");
      }

      await loadScript("/js/scanner.js?v=20260404-8");
    } catch (error) {
      const statusEl = document.getElementById("statusMessage");
      if (statusEl) {
        statusEl.className = "mt-4 text-center text-danger";
        statusEl.textContent = "Gagal memuat scanner terbaru. Coba refresh halaman.";
      }
      console.error(error);
    }
  };

  boot();
})();
