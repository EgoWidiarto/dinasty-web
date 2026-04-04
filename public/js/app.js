const CLIENT_BUILD_VERSION = "2026-04-05-3";

async function resetClientCachesIfNeeded() {
  const lastVersion = localStorage.getItem("dinasty-client-version");
  if (lastVersion === CLIENT_BUILD_VERSION) return;

  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }

    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch (error) {
    console.warn("Cache reset gagal:", error);
  }

  localStorage.setItem("dinasty-client-version", CLIENT_BUILD_VERSION);
  window.location.reload();
}

// Service Worker Registration dengan auto-reload saat update
if ("serviceWorker" in navigator) {
  resetClientCachesIfNeeded().catch((error) => console.warn(error));

  let refreshing = false;

  // Detect controller change dan reload
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!refreshing) {
      refreshing = true;
      console.log("🔄 Service Worker updated, reloading page...");
      window.location.reload();
    }
  });

  navigator.serviceWorker
    .register("/sw.js")
    .then((registration) => {
      console.log("✅ Service Worker berhasil didaftarkan");

      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            newWorker.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });

      // Check for updates setiap 30 detik
      setInterval(() => {
        registration.update();
      }, 30000);
    })
    .catch((err) => console.error("❌ Error registrasi Service Worker:", err));
}

// App initialization
console.log("🚀 Aplikasi Dinamika Sejarah Indonesia dimulai");

// Menu cards navigation (avoid inline onclick)
window.addEventListener("DOMContentLoaded", () => {
  const menuCards = document.querySelectorAll(".menu-card[data-target]");

  menuCards.forEach((card) => {
    const target = card.getAttribute("data-target");
    if (!target) return;

    card.addEventListener("click", () => {
      window.location.href = target;
    });

    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        window.location.href = target;
      }
    });
  });
});
