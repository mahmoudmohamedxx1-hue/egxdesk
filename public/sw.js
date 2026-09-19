/* EGX Desk service worker (G14 + G1 mobile) — app-shell cache + web push:
 *  - Precache the shell route + icons + offline fallback.
 *  - Navigations: network-first with cache fallback, so the installed app
 *    opens instantly offline with its last-rendered shell (data views then
 *    show their honest "could not load" states instead of a browser error).
 *  - API calls are NEVER cached: market data must be live or honestly absent.
 *  - Static assets (icons): cache-first (immutable files).
 *  - Build chunks (_next/static): network-first with cache fallback — dev
 *    servers reuse chunk FILENAMES across recompiles, so a cache-first
 *    policy would serve yesterday's code after every edit; network-first
 *    guarantees the running app always matches the server, and the cache
 *    still covers offline opens of previously-seen chunks.
 *  - Web push: server-evaluated alerts arrive as system notifications even
 *    when the app is closed (installed PWA on iOS 16.4+/Android/desktop);
 *    tapping one opens the app straight on the relevant company/view.
 *  - VERSION bump on every release so installed apps pick the new shell on
 *    their next launch (skipWaiting + clients.claim apply it immediately). */

const VERSION = "egx-desk-v35";
const SHELL_CACHE = `${VERSION}-shell`;
const STATIC_CACHE = `${VERSION}-static`;

const SHELL_ASSETS = [
  "/",
  "/manifest.webmanifest",
  // T34 — versioned URLs so installed apps drop the old 1.5MB logos from
  // cache the moment this SW activates (new version prefix = new cache)
  "/logo.png?v=224",
  "/logo-dark.png?v=224",
  "/icon-192.png",
  "/icon-512.png",
  // screenshots dropped from precache (T34): they are only read by app
  // stores from the manifest, never by the page — 240KB of install cost cut
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

  // Build chunks: network-first → cache (dev chunk filenames are reused
  // across recompiles, so cache-first would serve stale code)
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          if (fresh.ok) {
            const cache = await caches.open(STATIC_CACHE);
            cache.put(req, fresh.clone());
          }
          return fresh;
        } catch {
          const cache = await caches.open(STATIC_CACHE);
          return (await cache.match(req)) || Response.error();
        }
      })()
    );
    return;
  }

  // Icons & other static assets: cache-first (immutable)
  if (url.pathname.startsWith("/icon-") || url.pathname.startsWith("/logo") || url.pathname.startsWith("/favicon") || url.pathname.startsWith("/robots")) {
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

// ── Web push (G1 mobile) ──────────────────────────────────────────────────

self.addEventListener("push", (event) => {
  let payload = { title: "EGX Desk", body: "", url: "/?view=watchlist" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // non-JSON push — keep the defaults
  }
  const title = payload.title || "EGX Desk";
  const body = payload.body || "";
  const url = payload.url || "/?view=watchlist";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: payload.tag || `egx-push-${Date.now()}`,
      renotify: true,
      dir: "rtl",
      lang: payload.lang || "ar",
      data: { url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/?view=watchlist";
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin)) {
          await client.focus();
          if ("navigate" in client) {
            try { await client.navigate(url); } catch {}
          }
          return;
        }
      }
      await self.clients.openWindow(url);
    })()
  );
});

// the page asks the new SW to take over right away (update flow)
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
