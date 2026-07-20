const CACHE = "questia-v43";
const ASSETS = ["./", "./index.html", "./styles.css?v=43", "./character-packs.js?v=43", "./app.js?v=43", "./manifest.webmanifest", "./assets/icon.svg", "./assets/companion-streamer-01.webp", "./assets/companion-02.webp", "./assets/companion-03.webp", "./assets/companion-04.webp", "./assets/companion-05.webp", "./assets/companion-07.webp", "./assets/companion-08.webp", "./assets/gacha-machine.webp"];
self.addEventListener("install", event => event.waitUntil(
  caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
));
self.addEventListener("activate", event => event.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim())
    .then(() => self.clients.matchAll({ type: "window" }))
    .then(clients => Promise.all(clients.map(client => client.navigate(client.url).catch(() => null))))
));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match("./index.html"))));
});
