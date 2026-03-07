// Service Worker
const CACHE_NAME = "dinamika-v4";
const urlsToCache = ["/", "/index.html", "/chatbot.html", "/scanner.html", "/css/style.css", "/js/app.js", "/js/chatbot.js", "/js/scanner.js", "/manifest.json"];

// Install event
self.addEventListener("install", (event) => {
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
      );
    }),
  );
});

// Fetch event
self.addEventListener("fetch", (event) => {
  // Only handle GET requests
  if (event.request.method !== "GET") {
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
          cache.put(event.request, responseClone);
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
