/**
 * Service Worker。動画アプリ (video.html) を Android にインストールできるようにし、
 * 起動のたびに最新のファイルを読むためのもの。
 *
 * 方針は「ネットワーク優先、だめならキャッシュ」。GitHub Pages はファイルを約10分
 * キャッシュさせるので、no-cache で再検証して常に最新を取る (変わっていなければ 304 で軽い)。
 * キャッシュは圏外のときに前回の画面を出すためだけに使う。
 *
 * 触るのは同じオリジンの GET だけ。YouTube・GAS・GitHub API には一切手を出さない。
 */
const CACHE = 'english-training-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(new Request(request, { cache: 'no-cache' }));
        // ?v=... 付きの URL (問題ファイルのキャッシュ避け) は毎回別物なので残さない。
        if (response.ok && !url.search) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      } catch (err) {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        throw err;
      }
    })(),
  );
});
