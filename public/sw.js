/* Офлайн-режим: у під'їзді й на околиці зв'язок пропадає, а маршрут має лишатись
   у кишені. Оболонку і дані поїздок тримаємо в кеші, зміни — у черзі на клієнті. */

const CACHE = "postman-v1";
const SHELL = ["/", "/history", "/addresses", "/offline"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL).catch(() => undefined)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      return (await cache.match("/offline")) ?? Response.error();
    }
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // тайли карти не кешуємо

  // Статика Next має незмінні імена — беремо з кешу одразу.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Сторінки і дані поїздок: свіже, якщо є мережа; інакше — останнє відоме.
  if (request.mode === "navigate" || url.pathname.startsWith("/api/trips") || url.pathname.startsWith("/api/settings")) {
    event.respondWith(networkFirst(request));
  }
});
