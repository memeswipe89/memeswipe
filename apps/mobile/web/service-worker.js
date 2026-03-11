/* eslint-disable no-restricted-globals */
const APP_CACHE = 'memeswipe-static-v1';
const API_CACHE = 'memeswipe-api-v1';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/assets/images/icon.png',
  '/assets/images/favicon.png'
];

const API_PATH_REGEX = /\/tokens\//;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== APP_CACHE && key !== API_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  if (API_PATH_REGEX.test(url.pathname)) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }
  try {
    const response = await fetch(request);
    if (response && response.status === 200 && isSameOrigin(request.url)) {
      const cache = await caches.open(APP_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return fallbackResponse(error);
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(API_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
    return fallbackResponse(error);
  }
}

function isSameOrigin(url) {
  try {
    return new URL(url).origin === self.location.origin;
  } catch (error) {
    return false;
  }
}

function fallbackResponse(error) {
  return new Response('Offline', {
    status: 503,
    statusText: error?.message ?? 'Service Unavailable',
    headers: { 'Content-Type': 'text/plain' }
  });
}

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
