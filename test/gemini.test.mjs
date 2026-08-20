import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generate, generateWithRetry, GeminiError } from '../scripts/lib/gemini.mjs';

const realFetch = globalThis.fetch;
const realKey = process.env.GEMINI_API_KEY;

function stubFetch(...responses) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    const next = responses.shift() ?? responses.at(-1);
    return {
      ok: next.status === undefined || next.status < 400,
      status: next.status ?? 200,
      json: async () => next.body,
      text: async () => JSON.stringify(next.body ?? {}),
    };
  };
  return calls;
}

const reply = (text, finishReason = 'STOP') => ({
  body: { candidates: [{ finishReason, content: { parts: [{ text }] } }] },
});

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key';
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = realKey;
});

test('API キーが無ければ分かるエラーを出す', async () => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  await assert.rejects(() => generate({ prompt: 'x', model: 'm' }), /GEMINI_API_KEY/);
});

test('本文を連結して返す', async () => {
  stubFetch({ body: { candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] } });
  assert.equal(await generate({ prompt: 'x', model: 'gemini-2.5-pro' }), 'ab');
});

test('schema を渡すと JSON 強制のリクエストになる', async () => {
  const calls = stubFetch(reply('{}'));
  await generate({ prompt: 'x', model: 'gemini-2.5-pro', schema: { type: 'OBJECT' } });
  assert.equal(calls[0].body.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(calls[0].body.generationConfig.responseSchema, { type: 'OBJECT' });
  assert.equal(calls[0].headers['x-goog-api-key'], 'test-key');
  assert.match(calls[0].url, /models\/gemini-2\.5-pro:generateContent$/);
});

test('schema を渡さなければ JSON 強制しない', async () => {
  const calls = stubFetch(reply('# 採点'));
  await generate({ prompt: 'x', model: 'm' });
  assert.equal(calls[0].body.generationConfig.responseMimeType, undefined);
});

test('MAX_TOKENS は再試行可能なエラーになる', async () => {
  stubFetch(reply('途中まで', 'MAX_TOKENS'));
  await assert.rejects(
    () => generate({ prompt: 'x', model: 'm' }),
    (err) => err instanceof GeminiError && err.retriable && /MAX_TOKENS/.test(err.message),
  );
});

test('429 は再試行し、成功すればその結果を返す', async () => {
  stubFetch({ status: 429, body: { error: 'rate limit' } }, reply('ok'));
  const waits = [];
  const result = await generateWithRetry(
    { prompt: 'x', model: 'm' },
    { attempts: 2, onRetry: (_e, _n, wait) => waits.push(wait) },
  );
  assert.equal(result, 'ok');
  assert.deepEqual(waits, [2000]);
});

test('400 は再試行せず即座に失敗する', async () => {
  stubFetch({ status: 400, body: { error: 'bad request' } });
  let retries = 0;
  await assert.rejects(
    () => generateWithRetry({ prompt: 'x', model: 'm' }, { attempts: 3, onRetry: () => retries++ }),
    /Gemini API 400/,
  );
  assert.equal(retries, 0);
});
