/* ============================================================================
   sw.js — service worker for offline use + installability.
   Precaches the app shell, runtime-caches CDN libraries, and always lets
   Supabase / Anthropic API calls hit the network (never cached).
   Bump CACHE when you change any local file.
   ========================================================================== */
const CACHE = "iron-console-v5";

const LOCAL = [
  "./",
  "./index.html",
  "./styles.css",
  "./engine.js",
  "./store.js",
  "./ai.js",
  "./game.js",
  "./app.js",
  "./manifest.webmanifest",
  "./icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(LOCAL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isApi(url) {
  return /supabase\.co|api\.anthropic\.com/.test(url);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = req.url;

  // Live data must never be served stale.
  if (isApi(url)) {
    event.respondWith(fetch(req).catch(() => new Response("", { status: 503 })));
    return;
  }

  // Cache-first for everything else (app shell + CDN libs), with runtime fill.
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          if (res && res.status === 200 && (res.type === "basic" || res.type === "cors")) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => {});
          }
          return res;
        })
        .catch(() => {
          // offline navigation → fall back to the cached shell
          if (req.mode === "navigate") return caches.match("./index.html");
          return new Response("", { status: 503 });
        });
    })
  );
});
