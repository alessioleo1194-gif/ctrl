/* CTRL · service worker
 * Rende l'app installabile e veloce ad aprirsi. Non salva MAI le risposte dell'API:
 * i dati arrivano sempre aggiornati dal server.
 */
const VERSION = 'ctrl-0.12.0';
const SHELL = [
  '/', '/index.html', '/css/ctrl.css', '/manifest.webmanifest', '/icons/icon.svg',
  '/js/app.js', '/js/api.js', '/js/config.js', '/js/ui.js', '/js/format.js',
  '/js/views/login.js', '/js/views/events.js', '/js/views/event.js', '/js/views/eventForm.js', '/js/views/settings.js', '/js/views/report.js', '/js/stats-popup.js', '/js/xlsx.js', '/js/report-xlsx.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const sameOrigin = url.origin === self.location.origin;
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !fonts) return; // API e altri domini: sempre rete
  // Rete prima, copia in cache come riserva per quando manca la connessione.
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || (e.request.mode === 'navigate' ? caches.match('/index.html') : Response.error())))
  );
});
