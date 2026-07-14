self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// passthrough simples — não faz cache agressivo, só existe pra
// satisfazer o requisito de "instalável" do navegador
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
