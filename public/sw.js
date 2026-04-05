const CACHE_VERSION = "dinasty-static-v2026-04-05-8";
const APP_SHELL = [
  "/",
  "/index.html",
  "/chatbot",
  "/scanner",
  "/chatbot.html",
  "/scanner.html",
  "/css/style.css",
  "/js/app.js",
  "/js/chatbot.js",
  "/js/scanner.js",
  "/manifest.json",
  "/assets/component/logo-dinasty.png",
  "/assets/component/back_btn.png",
  "/assets/component/chatbot_icon.png",
  "/assets/component/scaner_icon.png",
  "/assets/component/bg_dinasty.png",
  "/assets/component/bg_chatbot.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(async (cache) => {
      await Promise.all(
        APP_SHELL.map(async (asset) => {
          try {
            await cache.add(asset);
          } catch (error) {
            console.warn("SW cache skip:", asset, error);
          }
        }),
      );
    }),
  );

  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((oldKey) => caches.delete(oldKey)))));

  self.clients.claim();
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(CACHE_VERSION);
    cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || caches.match("/index.html");
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const fetchPromise = fetch(request)
    .then(async (response) => {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  return cached || fetchPromise || Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request));
    return;
  }

  if (url.pathname.startsWith("/scanner") || url.pathname === "/js/scanner.js") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
