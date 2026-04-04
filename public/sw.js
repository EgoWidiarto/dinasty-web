// Service Worker
const CACHE_NAME = "dinamika-v8";
const urlsToCache = ["/", "/index.html", "/chatbot.html", "/scanner.html", "/css/style.css", "/js/app.js", "/js/chatbot.js", "/js/scanner-nimiq.js?v=20260404-2", "/manifest.json"];

// Install event - skip waiting untuk langsung aktif
self.addEventListener("install", (event) => {
  self.skipWaiting(); // Aktifkan service worker baru langsung
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("✅ Cache opened");
      return cache.addAll(urlsToCache);
    }),
  );
});

// Activate event
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log("🗑️ Deleting old cache:", cacheName);
            return caches.delete(cacheName);
          }
        }),
      ).then(() => {
        // Claim semua clients agar service worker baru langsung aktif
        return self.clients.claim();
      });
    }),
  );
});

// Fetch event
self.addEventListener("fetch", (event) => {
  // Only handle GET requests
  if (event.request.method !== "GET") {
    return;
  }

  // Abaikan skema non-http(s), contoh: chrome-extension://
  const requestUrl = new URL(event.request.url);
  if (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:") {
    return;
  }

  // Skip API calls - let them go through network
  if (event.request.url.includes("/api/")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => response)
        .catch(() => {
          return new Response("Offline - API tidak tersedia", {
            status: 503,
            statusText: "Service Unavailable",
          });
        }),
    );
    return;
  }

  // Network first strategy for HTML/CSS/JS
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (!response || response.status !== 200) {
          return response;
        }

        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone).catch((err) => {
            console.warn("Lewati cache untuk request ini:", event.request.url, err);
          });
        });

        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((response) => {
          if (response) {
            return response;
          }
          return new Response("Halaman tidak tersedia offline", {
            status: 404,
            statusText: "Not Found",
          });
        });
      }),
  );
});
