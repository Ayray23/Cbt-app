const CACHE_NAME = "cbt-app-shell-v2";
const BUILD_ASSETS = /* CBT_ASSETS */ [];
const APP_SHELL = ["/", "/offline.html", "/manifest.webmanifest", "/app-icon.svg",
  "/app-icon-180.png", "/app-icon-192.png", "/app-icon-512.png", ...BUILD_ASSETS];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  // A new worker waits for existing exam tabs to close before activating.
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys
    .filter((key) => key.startsWith("cbt-app-shell-") && key !== CACHE_NAME)
    .map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin ||
      url.pathname.startsWith("/api/") || url.pathname.startsWith("/__/")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put("/", copy)));
      }
      return response;
    }).catch(async () => (await caches.match("/")) || caches.match("/offline.html")));
    return;
  }
  if (!["script", "style", "image", "font"].includes(request.destination) &&
      !APP_SHELL.includes(url.pathname)) return;
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
    }
    return response;
  })));
});
