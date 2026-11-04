// Service worker: app shell works offline. PDFs are stored by the app itself in IndexedDB.
const V = "dyala-__V__";
const SHELL = ["/", "/assets/app.js?v=__V__", "/assets/styles.css?v=__V__", "/assets/pdf.worker.js", "/manifest.webmanifest", "/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== V && k !== "dyala-covers").map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    if (/^\/api\/books\/[^/]+\/cover$/.test(url.pathname)) {
      e.respondWith(
        caches.open("dyala-covers").then(async (c) => {
          const hit = await c.match(req);
          if (hit) return hit;
          const res = await fetch(req);
          if (res.ok) c.put(req, res.clone());
          return res;
        })
      );
    }
    return;
  }
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/")));
    return;
  }
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res.ok) caches.open(V).then((c) => c.put(req, res.clone()));
        return res;
      });
      return hit || net;
    })
  );
});
