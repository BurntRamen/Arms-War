const CACHE_NAME = "arms-war-app-v8";
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
  "/assets/factions/bizi-city.jpg",
  "/assets/music/rumin-theme-1.mp3",
  "/assets/music/rumin-theme-2.mp3",
  "/assets/music/sheen-theme-1.mp3",
  "/assets/music/sheen-theme-2.mp3",
  "/assets/music/frumo-theme-1.mp3",
  "/assets/music/frumo-theme-2.mp3",
  "/assets/music/bizi-theme-1.mp3"
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
