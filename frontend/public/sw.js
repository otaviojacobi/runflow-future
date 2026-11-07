/* Runflow service worker (F30): installable app + offline "Hoje".
 * - Navigations: network first, fall back to the cached app shell.
 * - Hashed assets, fonts, icons: cache first.
 * - The student's own day (/my/workouts, /my/summary, /me): network first, cached copy when offline.
 * Everything else goes to the network untouched. The app clears the API cache on sign-out.
 * Push (S7b): `{id, title, body, link}` from the API becomes a system notification; a click opens its link. */
const SHELL = "rf-shell-v1", ASSETS = "rf-assets-v1", API = "rf-api-v1";
const KEEP = [SHELL, ASSETS, API];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/", "/manifest.webmanifest", "/favicon.svg", "/icons/icon-192.png"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("message", (e) => { if (e.data === "clear-api-cache") caches.delete(API); });

const networkFirst = async (req, cacheName) => {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
};
const cacheFirst = async (req) => {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
};

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) {
    if (/\/my\/(workouts|summary)|\/v1\/me$/.test(url.pathname)) e.respondWith(networkFirst(req, API));
    return;
  }
  if (req.mode === "navigate") { e.respondWith(fetch(req).then((res) => { caches.open(SHELL).then((c) => c.put("/", res.clone())); return res; }).catch(() => caches.match("/"))); return; }
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/") || /\.(woff2?|svg|png)$/.test(url.pathname)) e.respondWith(cacheFirst(req));
});

self.addEventListener("push", (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { body: e.data ? e.data.text() : "" }; }
  // One notification per id: a repeated delivery replaces the first.
  e.waitUntil(self.registration.showNotification(m.title || "Runflow", { body: m.body || undefined, icon: m.icon || "/icons/icon-192.png", badge: "/icons/icon-192.png", tag: m.id || undefined, data: { link: m.link || "/" } }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const link = new URL((e.notification.data && e.notification.data.link) || "/", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
    const w = wins.find((c) => new URL(c.url).origin === self.location.origin);
    if (w) return w.focus().then((f) => (f && "navigate" in f ? f.navigate(link) : undefined));
    return self.clients.openWindow(link);
  }));
});
