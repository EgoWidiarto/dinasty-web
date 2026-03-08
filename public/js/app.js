// Service Worker Registration dengan auto-reload saat update
if ("serviceWorker" in navigator) {
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
    .register("sw.js")
    .then((registration) => {
      console.log("✅ Service Worker berhasil didaftarkan");

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
