const CACHE = "school-lan-shell-v1";
self.addEventListener("install", (e) =>
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/app.js"]))),
);
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (
    e.request.method !== "GET" ||
    u.origin !== self.location.origin ||
    u.pathname.startsWith("/api/") ||
    u.pathname === "/health"
  )
    return;
  e.respondWith(
    fetch(e.request).catch(() =>
      caches.match(e.request.mode === "navigate" ? "/" : e.request),
    ),
  );
});
