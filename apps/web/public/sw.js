/**
 * Service Worker — AVANTE HIS Bedside PWA
 *
 * Estrategias:
 *  - Assets estáticos JS/CSS/icons: CacheFirst (Workbox precache).
 *  - API /api/bedside/*: NetworkFirst (30s timeout), fallback a cache.
 *  - API /api/sync/replay: NetworkOnly (no cachear mutations).
 *  - Páginas: NetworkFirst, fallback a /offline.html si existe.
 *
 * Background Sync: registra syncTag "bedside-sync" para replay automático
 * cuando el navegador recupere conexión.
 *
 * NOTA: workbox-sw se carga desde CDN en producción. En local se importa
 * via importScripts desde /node_modules o CDN según disponibilidad.
 */

// workbox-sw desde CDN (Next.js copia los workbox scripts via next-pwa o manual)
// Usamos importScripts compatible con todos los navegadores móviles.
const WORKBOX_CDN = "https://storage.googleapis.com/workbox-cdn/releases/7.0.0/workbox-sw.js";

// Cache names
const CACHE_STATIC = "his-static-v1";
const CACHE_API = "his-api-v1";
const CACHE_PAGES = "his-pages-v1";

const PRECACHE_URLS = [
  "/",
  "/bedside",
  "/manifest.json",
  "/avante-logo.svg",
];

// ─── Install ────────────────────────────────────────────────────────────────

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    }).then(() => self.skipWaiting()),
  );
});

// ─── Activate ───────────────────────────────────────────────────────────────

self.addEventListener("activate", (event) => {
  const CURRENT_CACHES = [CACHE_STATIC, CACHE_API, CACHE_PAGES];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => !CURRENT_CACHES.includes(name))
          .map((name) => caches.delete(name)),
      );
    }).then(() => self.clients.claim()),
  );
});

// ─── Fetch ──────────────────────────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // No interceptar requests de otras origins
  if (url.origin !== location.origin) return;

  // Mutations de sync — siempre NetworkOnly (idempotente en servidor)
  if (url.pathname.startsWith("/api/sync/")) {
    return; // pasa directo a la red
  }

  // API bedside — NetworkFirst con fallback a cache (TTL 60 min)
  if (url.pathname.startsWith("/api/") || url.pathname.includes("/trpc/")) {
    event.respondWith(networkFirstApi(request));
    return;
  }

  // Assets estáticos — CacheFirst
  if (
    url.pathname.match(/\.(js|css|svg|png|ico|woff2?|mp3)$/) ||
    url.pathname.startsWith("/_next/static/")
  ) {
    event.respondWith(cacheFirstStatic(request));
    return;
  }

  // Páginas — NetworkFirst
  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
    return;
  }
});

async function networkFirstApi(request) {
  const cache = await caches.open(CACHE_API);
  try {
    const response = await fetchWithTimeout(request.clone(), 8000);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: "offline", cached: false }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function cacheFirstStatic(request) {
  const cache = await caches.open(CACHE_STATIC);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return new Response("", { status: 503 });
  }
}

async function networkFirstPage(request) {
  const cache = await caches.open(CACHE_PAGES);
  try {
    const response = await fetchWithTimeout(request.clone(), 8000);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached ?? new Response("Offline — recarga cuando tengas conexión", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

function fetchWithTimeout(request, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ─── Background Sync ────────────────────────────────────────────────────────

self.addEventListener("sync", (event) => {
  if (event.tag === "bedside-sync") {
    event.waitUntil(triggerReplay());
  }
});

async function triggerReplay() {
  // Notifica a los clients para que ejecuten replayQueue() desde el hook React.
  const clients = await self.clients.matchAll({ type: "window" });
  for (const client of clients) {
    client.postMessage({ type: "BEDSIDE_SYNC_TRIGGER" });
  }
}

// ─── Message ────────────────────────────────────────────────────────────────

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});
