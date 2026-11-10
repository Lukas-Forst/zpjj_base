// Minimal app-shell service worker. Network-first for same-origin GETs (never /api), cache fallback.
// On install the shell pages are fetched and their /_next/static assets cached, so the
// start screen and /timer/ work offline after the first load.
const CACHE = "base-v1";
const SHELL = ["/", "/timer/", "/stundenplan/", "/offline/"];
const SOUNDS = ["/sounds/start.mp3"]; // timer start signal must work offline in the gym

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const url of SHELL) {
        try {
          const res = await fetch(url, { credentials: "same-origin" });
          // Skip Access login redirects and 404s (e.g. /timer/ before M1)
          if (!res.ok || res.redirected) continue;
          await cache.put(url, res.clone());
          const html = await res.text();
          const assets = new Set(html.match(/\/_next\/static\/[^"'\\ )]+/g) || []);
          await Promise.all([...assets].map((a) => cache.add(a).catch(() => {})));
        } catch { /* offline during install: runtime caching will fill in */ }
      }
      await Promise.all(SOUNDS.map((u) => cache.add(u).catch(() => {})));
      self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        if (res.ok && !res.redirected) cache.put(req, res.clone());
        return res;
      } catch {
        const hit = (await cache.match(req, { ignoreSearch: true })) ||
          (req.mode === "navigate" ? await cache.match("/offline/") : undefined);
        return hit || Response.error();
      }
    })(),
  );
});
