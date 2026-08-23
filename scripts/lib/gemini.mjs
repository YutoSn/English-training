/**
 * Minimal Gemini API client. No SDK — the REST endpoint is one POST and Node's
 * built-in fetch covers it, which keeps this repo dependency-free.
 *
 * API key: GEMINI_API_KEY (https://aistudio.google.com/apikey で無料取得できる)
 */
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiError extends Error {
  constructor(message, { status, retriable = false } = {}) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
    this.retriable = retriable;
  }
}

function apiKey() {
  const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!key) {
    throw new GeminiError(
      'GEMINI_API_KEY が設定されていません。https://aistudio.google.com/apikey で取得して ' +
        '環境変数か GitHub Secrets に登録してください。',
    );
  }
  return key;
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey() },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text();
    // 429 = 無料枠のレート上限、5xx = 一時障害。どちらも待てば通ることがある。
    const retriable = res.status === 429 || res.status >= 500;
    // 404 はモデル名の誤りか、そのキーに公開されていないモデル。使える名前は
    // キーごとに違うので、一覧の出し方を添える。
    const hint =
      res.status === 404 ? '\n使えるモデル名は `node --run models` で確認できます。' : '';
    throw new GeminiError(`Gemini API ${res.status}: ${detail.slice(0, 500)}${hint}`, {
      status: res.status,
      retriable,
    });
  }
  return res.json();
}

/** Extract the text payload, turning Gemini's non-STOP finish reasons into errors. */
function textOf(response) {
  const candidate = response.candidates?.[0];
  const reason = candidate?.finishReason;
  if (reason && reason !== 'STOP') {
    throw new GeminiError(
      `生成が完了しませんでした (finishReason: ${reason})。` +
        (reason === 'MAX_TOKENS' ? ' maxOutputTokens を増やしてください。' : ''),
      { retriable: reason === 'MAX_TOKENS' },
    );
  }
  const text = (candidate?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim();
  if (!text) throw new GeminiError('Gemini が空の応答を返しました', { retriable: true });
  return text;
}

/**
 * One-shot generation.
 *
 * @param {object} options
 * @param {string} options.prompt
 * @param {string} options.model      e.g. 'gemini-2.5-pro'
 * @param {object} [options.schema]   responseSchema — 渡すと JSON 強制になる
 * @param {number} [options.temperature]
 */
export async function generate({ prompt, model, schema, temperature = 0.9, maxOutputTokens = 32768 }) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens,
      ...(schema ? { responseMimeType: 'application/json', responseSchema: schema } : {}),
    },
  };
  return textOf(await post(`/models/${model}:generateContent`, body));
}

/** Same as generate(), but retries the transient failures (rate limit, 5xx, truncation). */
export async function generateWithRetry(options, { attempts = 3, onRetry } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await generate(options);
    } catch (err) {
      lastError = err;
      if (!(err instanceof GeminiError) || !err.retriable || attempt === attempts) throw err;
      const waitMs = 2000 * 2 ** (attempt - 1);
      onRetry?.(err, attempt, waitMs);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastError;
}

export async function listModels() {
  const res = await fetch(`${BASE}/models?pageSize=100`, {
    headers: { 'x-goog-api-key': apiKey() },
  });
  if (!res.ok) throw new GeminiError(`Gemini API ${res.status}: ${await res.text()}`);
  const { models = [] } = await res.json();
  return models
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => ({ id: m.name.replace(/^models\//, ''), display: m.displayName }));
}
