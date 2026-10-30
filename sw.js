'use strict';
importScripts('core.js');

const CACHE = 'vector-fiscal-v5';
const ARCHIVOS = ['./', 'index.html', 'styles.css', 'core.js', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok && new URL(e.request.url).origin === location.origin) {
        const copia = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copia));
      }
      return res;
    }).catch(() => caches.match('index.html')))
  );
});

async function revisar() {
  const st = await KV.get('state');
  if (st) await revisarAvisos(st, self.registration);
}

/* Android/Chrome: el sistema despierta la app cada cierto tiempo. */
self.addEventListener('periodicsync', e => {
  if (e.tag === 'revisar-pagos') e.waitUntil(revisar());
});
self.addEventListener('message', e => {
  if (e.data === 'revisar') e.waitUntil(revisar());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    for (const w of ws) if ('focus' in w) return w.focus();
    return self.clients.openWindow('./');
  }));
});
