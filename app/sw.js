/* CTRL · service worker
 * Rende l'app installabile e immediata ad aprirsi: tutti i file dell'interfaccia (pagina, stili, moduli) si
 * scaricano una volta per versione e poi si servono dalla memoria del dispositivo, senza attendere la rete.
 * Non salva MAI le risposte dell'API: i dati arrivano sempre aggiornati dal server.
 *
 * ATTENZIONE: i file sono serviti dalla cache finché VERSION non cambia. Ogni modifica a qualunque file di app/
 * richiede di aumentare VERSION (il test tests/unit/sw.test.mjs controlla che l'elenco sia completo).
 */
const VERSION = 'ctrl-0.13.0';
const SHELL = [
  '/',
  '/index.html',
  '/css/ctrl.css',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-180.png',
  '/icons/icon-192.png',
  '/js/api.js',
  '/js/app.js',
  '/js/config.js',
  '/js/documento-dati.js',
  '/js/format.js',
  '/js/giornate.js',
  '/js/grid.js',
  '/js/ids.js',
  '/js/livelli.js',
  '/js/orari.js',
  '/js/pdf.js',
  '/js/persone.js',
  '/js/report-xlsx.js',
  '/js/righe-mobile.js',
  '/js/salvataggio.js',
  '/js/stats-popup.js',
  '/js/tsv.js',
  '/js/ui.js',
  '/js/unisci.js',
  '/js/views/allegati.js',
  '/js/views/doc.js',
  '/js/views/event.js',
  '/js/views/eventForm.js',
  '/js/views/events.js',
  '/js/views/foglio.js',
  '/js/views/login.js',
  '/js/views/materiali.js',
  '/js/views/plan.js',
  '/js/views/report.js',
  '/js/views/settings.js',
  '/js/views/staff.js',
  '/js/xlsx.js'
];

self.addEventListener('install', (e) => {
  // cache: 'reload' salta la cache HTTP del browser, così la nuova versione è composta solo da file nuovi
  e.waitUntil(caches.open(VERSION)
    .then(c => Promise.all(SHELL.map(u => fetch(new Request(u, { cache: 'reload' })).then(r => { if (!r.ok) throw new Error(u + ' ' + r.status); return c.put(u, r); }))))
    .then(() => self.skipWaiting()));
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

  // La pagina si apre sempre dalla copia locale (index.html è la stessa per ogni indirizzo dell'app).
  if (e.request.mode === 'navigate') {
    e.respondWith(caches.match('/index.html').then(r => r || fetch(e.request)));
    return;
  }
  // Cache prima, poi rete; ciò che non c'è (librerie caricate al bisogno, caratteri) si salva alla prima richiesta.
  e.respondWith(caches.match(e.request, { ignoreSearch: sameOrigin }).then(hit => hit || fetch(e.request).then(res => {
    if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return res;
  })));
});
