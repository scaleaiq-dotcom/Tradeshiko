// sw.js — minimal service worker, just enough to make the app installable
// ("Add to Home Screen") on Android/Chrome, which requires a service worker
// with a fetch handler to be present.
//
// IMPORTANT: this deliberately does NOT cache anything meaningful. This is
// a live-data trading app — stock prices, portfolio value, and trade
// history must always come from the network, never from a stale cache.
// Caching HTML pages or API responses here would risk showing someone an
// old price or an outdated portfolio balance, which is exactly wrong for
// this kind of app. So every fetch just passes straight through to the
// network, unchanged — this file exists purely to satisfy the browser's
// "is this installable as an app?" requirement.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Always go to network — no caching, no offline fallback. Freshness
  // matters more than offline support for a live trading simulator.
  event.respondWith(fetch(event.request));
});
