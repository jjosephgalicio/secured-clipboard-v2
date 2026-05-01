// Bump APP_VERSION on each release to invalidate the app shell cache.
const APP_VERSION = "v2";
const APP_CACHE = `secure-clipboard-${APP_VERSION}`;
const RUNTIME_CACHES = ["assets-cache", "font-cache"];
const KNOWN_CACHES = new Set([APP_CACHE, ...RUNTIME_CACHES]);

const APP_SHELL = [
  "/",
  "/manifest.json",
  "/index.html",
  "/style.css",
  "/script.js",

  // libs
  "/libs/pouchdb.min.js",
  "/libs/date-fns.min.js",
  "/libs/quill.min.js",
  "/libs/quill.snow.css",
  "/libs/quill-better-table.css",
  "/libs/purify.min.js",
  "/libs/panzoom.min.js",
  "/libs/fuse-7.0.0.js",

  // fonts (lowercase to match disk — Linux is case-sensitive)
  "/fonts/worksans-regular.woff2",
  "/fonts/worksans-semibold.woff2",
  "/fonts/worksans-bold.woff2",

  // assets
  "/assets/logo.png",
  "/assets/install app as pwa (edge).png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => !KNOWN_CACHES.has(k)).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;

  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(cacheFirst(e.request, "assets-cache"));
    return;
  }
  if (url.pathname.startsWith("/fonts/")) {
    e.respondWith(cacheFirst(e.request, "font-cache"));
    return;
  }
  if (url.pathname.startsWith("/libs/")) {
    e.respondWith(cacheFirst(e.request, APP_CACHE));
    return;
  }

  // App shell (HTML / script.js / style.css / manifest): network-first so deploys
  // reach users on next reload; falls back to cache when offline.
  e.respondWith(networkFirst(e.request, APP_CACHE));
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    return new Response("", { status: 504 });
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const indexCached = await cache.match("/index.html");
      if (indexCached) return indexCached;
    }
    return new Response("", { status: 504 });
  }
}
