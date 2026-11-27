/**
 * Service Worker。動画アプリ (video.html) を Android にインストールできるようにし、
 * 起動のたびに最新のファイルを読むためのもの。
 *
 * 方針は「ネットワーク優先、だめならキャッシュ」。GitHub Pages はファイルを約10分
 * キャッシュさせるので、no-cache で再検証して常に最新を取る (変わっていなければ 304 で軽い)。
 * キャッシュは圏外のときに前回の画面を出すためだけに使う。
 *
 * 触るのは同じオリジンの GET と、共有の受け口 (share-target への POST) だけ。
 * YouTube・GAS・GitHub API には一切手を出さない。
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

/**
 * Android の「共有」で English Video を選ぶと、manifest の share_target どおり
 * ./share-target に POST が来る (YouTube アプリの URL や、ファイルアプリの字幕ファイル)。
 * 中身を Cache に置いて video.html?shared=1 に移り、アプリ側が読み出して「動画を追加」に入れる。
 */
const SHARE_CACHE = 'english-training-share';
const SHARE_KEY = 'shared-payload';

async function receiveShare(request) {
  const form = await request.formData();
  const payload = {
    title: String(form.get('title') ?? ''),
    text: String(form.get('text') ?? ''),
    url: String(form.get('url') ?? ''),
  };
  const file = form.get('captions');
  if (file && typeof file !== 'string') {
    payload.fileName = file.name;
    payload.fileText = await file.text();
  }
  const cache = await caches.open(SHARE_CACHE);
  await cache.put(SHARE_KEY, new Response(JSON.stringify(payload)));
  return Response.redirect(new URL('video.html?shared=1', self.registration.scope).href, 303);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (
    request.method === 'POST' &&
    url.origin === self.location.origin &&
    url.pathname.endsWith('/share-target')
  ) {
    event.respondWith(receiveShare(request));
    return;
  }
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
