// 오프라인용 서비스 워커 (설계 2026-10-05 7.4).
// 화면 파일만 저장해 두고 먼저 꺼내 쓴다. 서버 요청(다른 주소)은 건드리지 않는다.
// 792c7e0c1392은 tools/sync.py --publish-phone이 올릴 때 파일 내용 지문으로 바꾼다.
const VERSION = "792c7e0c1392";
const CACHE = `workout-log-${VERSION}`;
const FILES = ["./", "index.html", "style.css", "app.js", "logic.js", "store.js", "net.js", "merge.js",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("workout-log-") && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data === "skip") self.skipWaiting(); // 화면의 [새로 고침]
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = req.mode === "navigate" ? "index.html" : req;
    const hit = await cache.match(key, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (e) {
      return (await cache.match("index.html")) || Response.error();
    }
  })());
});
