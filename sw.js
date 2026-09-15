/* ============================================================
   Service Worker : un script qui tourne en arrière-plan et
   intercepte les requêtes réseau. C'est lui qui permet à la
   PWA de fonctionner hors ligne.

   Change le numéro de version quand tu modifies les fichiers,
   sinon l'ancienne version restera en cache.
   ============================================================ */
const CACHE = 'facture-plus-v5';

const FICHIERS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './icon.svg',
  './icon-maskable.svg',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js'
];

// 1) INSTALL : on met tous les fichiers en cache.
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(FICHIERS))
  );
  self.skipWaiting(); // active immédiatement la nouvelle version
});

// 2) ACTIVATE : on supprime les vieux caches.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((cles) =>
      Promise.all(cles.filter((c) => c !== CACHE).map((c) => caches.delete(c)))
    )
  );
  self.clients.claim();
});

// 3) FETCH : stratégie « cache d'abord, réseau ensuite ».
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((reponse) => reponse || fetch(e.request))
  );
});
