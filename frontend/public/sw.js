const STATIC_CACHE = "minidraft-static-v1";
const AVATAR_CACHE = "minidraft-avatars-v1";
const ACTIVE_CACHES = new Set([STATIC_CACHE, AVATAR_CACHE]);

const NETWORK_ONLY_PREFIXES = [
  "/auth",
  "/billing",
  "/predict",
  "/draft",
  "/user",
  "/admin",
  "/telemetry",
  "/survey",
  "/feedback",
  "/health",
  "/analytics/",
  "/privacy",
  "/combat",
  "/heroes",
  "/heroes-media",
  "/items-media",
];

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !ACTIVE_CACHES.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isNetworkOnlyPath(pathname) {
  return NETWORK_ONLY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);
  if (cached) return cached;
  const network = await fetchPromise;
  if (network) return network;
  return new Response("Offline", { status: 503, statusText: "Service Unavailable" });
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const response = await fetch(request);
    const contentType = response.headers.get("content-type") || "";
    if (response && response.ok && !response.redirected && contentType.includes("text/html")) {
      cache.put("/", response.clone()).catch(() => {});
    }
    return response;
  } catch {
    return (
      (await cache.match(request)) ||
      (await cache.match("/")) ||
      new Response("Offline", { status: 503, statusText: "Service Unavailable" })
    );
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const { pathname } = url;
  if (isNetworkOnlyPath(pathname) || pathname === "/sw.js") {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (pathname.startsWith("/avatars/")) {
    event.respondWith(cacheFirst(request, AVATAR_CACHE));
    return;
  }

  if (
    pathname.startsWith("/assets/") ||
    pathname === "/favicon.svg" ||
    pathname === "/icon-192.png" ||
    pathname === "/logo.png" ||
    pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
  }
});
