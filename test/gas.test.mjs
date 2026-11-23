/**
 * gas/Code.gs を Node の vm で動かす。Apps Script のサービスはスタブにする。
 * GAS は手作業でデプロイするので、壊れた版を貼らないようにここで確かめる。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildGasRequest, buildVideoPrompt, videoSchema } from '../web/video.js';

const source = fs.readFileSync(new URL('../gas/Code.gs', import.meta.url), 'utf8');

function loadGas({ props = { APP_TOKEN: 'secret', GEMINI_API_KEY: 'key' }, responses = [] } = {}) {
  const calls = [];
  const sleeps = [];
  const context = {
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null }),
    },
    UrlFetchApp: {
      fetch: (url, options) => {
        calls.push({ url, options, body: JSON.parse(options.payload) });
        const next = responses.shift() ?? { status: 500, body: {} };
        return {
          getResponseCode: () => next.status,
          getContentText: () => JSON.stringify(next.body),
        };
      },
    },
    Utilities: { sleep: (ms) => sleeps.push(ms) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text) => ({ text, setMimeType: () => ({ text }) }),
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const post = (req) =>
    JSON.parse(context.doPost({ postData: { contents: JSON.stringify(req) } }).text);
  return { context, calls, sleeps, post };
}

const request = (overrides = {}) => ({
  ...buildGasRequest({
    token: 'secret',
    videoId: 'dQw4w9WgXcQ',
    start: 80,
    end: 125,
    prompt: buildVideoPrompt({ start: 80, end: 125 }),
    model: 'gemini-flash-latest',
  }),
  ...overrides,
});

const ok = (text) => ({
  status: 200,
  body: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] },
});

test('doGet は疎通確認の JSON を返す', () => {
  const { context } = loadGas();
  assert.equal(JSON.parse(context.doGet().text).ok, true);
});

test('合言葉が違えば Gemini を呼ばない', () => {
  const { post, calls } = loadGas();
  const res = post(request({ token: 'wrong' }));
  assert.equal(res.ok, false);
  assert.match(res.error, /合言葉/);
  assert.equal(calls.length, 0);
});

test('スクリプト プロパティが未設定なら分かるエラーを返す', () => {
  const { post } = loadGas({ props: {} });
  assert.match(post(request()).error, /APP_TOKEN/);
});

test('YouTube 以外の URL や長すぎる区間は中継しない', () => {
  const { post, calls } = loadGas();
  assert.match(post(request({ videoUrl: 'https://example.com/x' })).error, /YouTube/);
  assert.match(post(request({ start: 0, end: 601 })).error, /長すぎ/);
  assert.match(post(request({ model: '../evil' })).error, /model/);
  assert.equal(calls.length, 0);
});

test('動画・区間・プロンプト・スキーマを Gemini に渡し、テキストを返す', () => {
  const { post, calls } = loadGas({ responses: [ok('{"title":"x"}')] });
  const res = post(request());
  assert.deepEqual(res, { ok: true, text: '{"title":"x"}' });

  const [call] = calls;
  assert.match(call.url, /models\/gemini-flash-latest:generateContent$/);
  assert.equal(call.options.headers['x-goog-api-key'], 'key');
  const [videoPart, textPart] = call.body.contents[0].parts;
  assert.equal(videoPart.fileData.fileUri, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.deepEqual(videoPart.videoMetadata, { startOffset: '80s', endOffset: '125s' });
  assert.match(textPart.text, /1:20〜2:05/);
  assert.deepEqual(call.body.generationConfig.responseSchema, videoSchema);
  assert.equal(call.body.generationConfig.responseMimeType, 'application/json');
});

test('429 は待って再試行し、400 は即座に失敗する', () => {
  const retry = loadGas({ responses: [{ status: 429, body: {} }, ok('{}')] });
  assert.equal(retry.post(request()).ok, true);
  assert.equal(retry.calls.length, 2);
  assert.equal(retry.sleeps.length, 1);

  const bad = loadGas({ responses: [{ status: 400, body: { error: 'bad' } }] });
  const res = bad.post(request());
  assert.equal(res.ok, false);
  assert.equal(res.retriable, false);
  assert.equal(bad.calls.length, 1);
});

test('MAX_TOKENS は再試行可能なエラーとしてアプリに返す', () => {
  const { post } = loadGas({
    responses: [
      { status: 200, body: { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] } },
    ],
  });
  const res = post(request());
  assert.equal(res.ok, false);
  assert.equal(res.retriable, true);
});
