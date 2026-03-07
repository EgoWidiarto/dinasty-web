// Service Worker Registration
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("sw.js")
    .then(() => console.log("✅ Service Worker berhasil didaftarkan"))
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
