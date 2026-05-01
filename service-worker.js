const CACHE_NAME = "secure-clipboard-v1";

const ASSETS = [
  "/",
  "/manifest.json",
  "/index.html",
  "/style.css",
  "/script.js",

  // libs (based on your actual paths)
  "/libs/pouchdb.min.js",
  "/libs/date-fns.min.js",
  "/libs/quill.min.js",
  "/libs/quill.snow.css",
  "/libs/quill-better-table.css",
  "/libs/purify.min.js",
  "/libs/panzoom.min.js",
  "/libs/fuse-7.0.0.js",

  // ✅ fonts (IMPORTANT)
  "/fonts/WorkSans-Regular.woff2",
  "/fonts/WorkSans-Semibold.woff2",
  "/fonts/WorkSans-Bold.woff2",

  // optional
  "/assets/logo.png",
  "/assets/install app as pwa (edge).png",
];

// install → cache app shell
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

// activate
self.addEventListener("activate", () => {
  self.clients.claim();
});

// fetch → cache-first with fallback

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // 🖼️ Cache images dynamically
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(
      caches.open("assets-cache").then(async (cache) => {
        const cached = await cache.match(e.request);
        if (cached) return cached;

        try {
          const res = await fetch(e.request);
          const resClone = res.clone(); // 🔥 clone immediately
          await cache.put(e.request, resClone);
          return res;
        } catch {
          // optional fallback
          return new Response("", { status: 404 });
        }
      }),
    );
    return;
  }

  // 🎯 Handle fonts specifically
  if (url.pathname.startsWith("/fonts/")) {
    e.respondWith(
      caches.open("font-cache").then(async (cache) => {
        const cached = await cache.match(e.request);
        if (cached) return cached;

        const res = await fetch(e.request);
        const resClone = res.clone(); // 🔥 important
        await cache.put(e.request, resClone);
        return res;
      }),
    );
    return;
  }

  // default behavior
  e.respondWith(
    caches.match(e.request).then((res) => {
      return res || fetch(e.request).catch(() => caches.match("/index.html"));
    }),
  );
});
