const CACHE_NAME = "arms-war-app-v1";
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/manifest.json",
  "/icon.svg",
  "/assets/factions/rumin-commander.jpg",
  "/assets/factions/rumin-city.jpg",
  "/assets/factions/sheen-commander.jpg",
  "/assets/factions/sheen-city.jpg",
  "/assets/factions/frumo-commander.jpg",
  "/assets/factions/frumo-city.jpg",
  "/assets/factions/bizi-commander.jpg",
  "/assets/factions/bizi-city.jpg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("/index.html")))
  );
});
