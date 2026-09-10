/* EGX Desk service worker (G14) — an app-shell cache, nothing more:
 *  - Precache the shell route + icons + offline fallback.
 *  - Navigations: network-first with cache fallback, so the installed app
 *    opens instantly offline with its last-rendered shell (data views then
 *    show their honest "could not load" states instead of a browser error).
 *  - API calls are NEVER cached: market data must be live or honestly absent.
 *  - Static assets (icons, _next/static build files): cache-first. */

const VERSION = "egx-desk-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const STATIC_CACHE = `${VERSION}-static`;

const SHELL_ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-512-maskable.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.allSettled(SHELL_ASSETS.map((a) => cache.add(a)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // API: network-only (live data or honest absence — never a stale cache)
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: network-first → cache → shell
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(SHELL_CACHE);
          cache.put("/", fresh.clone());
          return fresh;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          return (await cache.match("/")) || Response.error();
        }
      })()
    );
    return;
  }

  // Static build assets & icons: cache-first
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icon-")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const fresh = await fetch(req);
          if (fresh.ok) cache.put(req, fresh.clone());
          return fresh;
        } catch {
          return Response.error();
        }
      })()
    );
  }
});
