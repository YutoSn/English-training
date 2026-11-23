/**
 * Android のホーム画面アプリ (PWA) の部品が揃っているか。どれかが欠けると
 * Chrome が「アプリをインストール」を出さなくなり、しかも静かに失敗するので、ここで見張る。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root));
const manifest = JSON.parse(read('manifest.webmanifest'));

/** PNG の IHDR から幅と高さを読む。 */
function pngSize(buf) {
  assert.equal(buf.subarray(1, 4).toString(), 'PNG');
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

test('manifest はインストールに必要な項目を持つ', () => {
  for (const key of ['name', 'short_name', 'start_url', 'scope', 'display', 'icons']) {
    assert.ok(manifest[key], key);
  }
  assert.equal(manifest.display, 'standalone');
  assert.ok(fs.existsSync(new URL(manifest.start_url, root)), 'start_url のファイルがある');
});

test('manifest のアイコンは実在し、書かれた大きさどおりで、192 と 512 と maskable が揃う', () => {
  for (const icon of manifest.icons) {
    const [w, h] = pngSize(read(icon.src));
    assert.equal(`${w}x${h}`, icon.sizes, icon.src);
  }
  const sizes = manifest.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
});

test('video.html は manifest を読み、動画だけのモードで app.js を起動する', () => {
  const html = read('video.html').toString();
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest"/);
  assert.match(html, /<body data-app="video">/);
  assert.match(html, /<script type="module" src="web\/app\.js">/);
});

test('sw.js はリポジトリ直下にあり (スコープがアプリ全体に掛かる)、fetch を扱う', () => {
  const listeners = {};
  const context = {
    self: { addEventListener: (type, fn) => (listeners[type] = fn), location: { origin: 'x' } },
  };
  vm.createContext(context);
  vm.runInContext(read('sw.js').toString(), context);
  assert.deepEqual(Object.keys(listeners).sort(), ['activate', 'fetch', 'install']);
});

test('sw.js は別オリジン (YouTube・GAS) とGET以外には手を出さない', () => {
  let handler;
  const context = {
    URL,
    self: {
      addEventListener: (type, fn) => type === 'fetch' && (handler = fn),
      location: { origin: 'https://yutosn.github.io' },
    },
  };
  vm.createContext(context);
  vm.runInContext(read('sw.js').toString(), context);
  for (const request of [
    { method: 'GET', url: 'https://www.youtube.com/iframe_api' },
    { method: 'POST', url: 'https://script.google.com/macros/s/x/exec' },
    { method: 'POST', url: 'https://yutosn.github.io/English-training/x' },
  ]) {
    let responded = false;
    handler({ request, respondWith: () => (responded = true) });
    assert.equal(responded, false, `${request.method} ${request.url}`);
  }
});
