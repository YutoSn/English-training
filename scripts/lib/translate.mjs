import { readJson, CONFIG_PATH } from './paths.mjs';
import { generateWithRetry } from './gemini.mjs';

/**
 * 日本語のテーマ名を、生成プロンプトに埋められる英語の名詞句にする。
 * 利用者が日本語だけで入力できるようにするための一手間 (スマホで毎回
 * 英語を打たせない)。id もこの英語から作る。
 */
export async function translateLabels(labels, { model } = {}) {
  const unique = [...new Set(labels.map((l) => String(l).trim()).filter(Boolean))];
  if (unique.length === 0) return {};

  const { generator } = readJson(CONFIG_PATH);
  const prompt = [
    '次の日本語の語句を、英語学習教材のテーマ名として自然な英語の名詞句に訳してください。',
    '出力は JSON オブジェクトのみ。キーを入力の日本語、値を英語にすること。',
    '英語は小文字中心の一般的な表現にし、固有名詞以外は大文字にしない。',
    '',
    ...unique.map((l) => `- ${l}`),
  ].join('\n');

  const text = await generateWithRetry(
    {
      prompt,
      model: model ?? generator.gradeModel ?? generator.model,
      temperature: 0.2,
      maxOutputTokens: 2048,
      schema: {
        type: 'OBJECT',
        properties: Object.fromEntries(unique.map((l) => [l, { type: 'STRING' }])),
        required: unique,
      },
    },
    { attempts: 3 },
  );
  return JSON.parse(text);
}
