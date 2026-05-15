// I.A GX — Service Worker
// Estratégias:
// - /api/* → sempre rede (nunca cache)
// - navegação HTML → NetworkFirst (3s timeout) com fallback offline
// - assets estáticos (mesmo origem) → StaleWhileRevalidate
// Versão: bump para invalidar caches antigos
const VERSION = "v1";
const STATIC_CACHE = `gx-static-${VERSION}`;
const HTML_CACHE = `gx-html-${VERSION}`;
const OFFLINE_URL = "/offline.html";

const PRECACHE = [
  "/",
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await cache.addAll(PRECACHE).catch(() => {});
      self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => ![STATIC_CACHE, HTML_CACHE].includes(n))
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

function timeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Nunca cachear API (chat, geração de imagem, etc.)
  if (url.pathname.startsWith("/api/")) return;

  // HTML / navegação → NetworkFirst com fallback offline
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await timeout(fetch(req), 3000);
          const cache = await caches.open(HTML_CACHE);
          cache.put(req, fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          const cache = await caches.open(HTML_CACHE);
          const cached = await cache.match(req);
          if (cached) return cached;
          const offline = await caches.match(OFFLINE_URL);
          if (offline) return offline;
          return new Response("Offline", { status: 503 });
        }
      })(),
    );
    return;
  }

  // Assets estáticos do mesmo origem → StaleWhileRevalidate
  event.respondWith(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            cache.put(req, res.clone()).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })(),
  );
});
