#!/usr/bin/env node
/**
 * 設定変更 Issue を data/config.json と data/topics.json に反映する。
 *
 *   ISSUE_BODY="$(cat issue.md)" node scripts/apply-settings.mjs
 *   node scripts/apply-settings.mjs --file=issue.md
 *   node scripts/apply-settings.mjs --file=issue.md --dry-run
 *
 * 英語フレーズが省略されたテーマは Gemini に訳させる (GEMINI_API_KEY が必要)。
 * 反映内容は stdout に Markdown で出す — settings.yml がそれを Issue に返す。
 */
import fs from 'node:fs';
import { readJson, writeJson, CONFIG_PATH, todayJst } from './lib/paths.mjs';
import { loadTopics, saveTopics } from './lib/topics.mjs';
import { extractPayload, applyPayload, labelsNeedingTranslation } from './lib/settings.mjs';
import { generateWithRetry, GeminiError } from './lib/gemini.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = true] = a.replace(/^--/, '').split('=');
    return [k, v];
  }),
);

const body = args.file ? fs.readFileSync(args.file, 'utf8') : (process.env.ISSUE_BODY ?? '');
const payload = extractPayload(body);

if (!payload) {
  console.error('設定の JSON が見つかりません (<!-- settings ... --> ブロックが必要)');
  process.exit(1);
}

const config = readJson(CONFIG_PATH);

/** ラベルだけ渡されたテーマを、生成プロンプトに埋められる英語フレーズにする。 */
async function translateLabels(labels) {
  if (labels.length === 0) return {};
  const prompt = [
    '次の日本語の語句を、英語学習教材のテーマ名として自然な英語の名詞句に訳してください。',
    '出力は JSON オブジェクトのみ。キーを入力の日本語、値を英語にすること。',
    '英語は小文字中心の一般的な表現にし、固有名詞以外は大文字にしない。',
    '',
    ...labels.map((l) => `- ${l}`),
  ].join('\n');

  const text = await generateWithRetry(
    {
      prompt,
      model: config.generator.gradeModel ?? config.generator.model,
      temperature: 0.2,
      maxOutputTokens: 2048,
      schema: {
        type: 'OBJECT',
        properties: Object.fromEntries(labels.map((l) => [l, { type: 'STRING' }])),
        required: labels,
      },
    },
    { attempts: 3 },
  );
  return JSON.parse(text);
}

try {
  const topics = loadTopics();
  const needed = labelsNeedingTranslation(payload);
  const translate = args['dry-run'] && !process.env.GEMINI_API_KEY ? {} : await translateLabels(needed);

  const result = applyPayload({ config, topics }, payload, { today: todayJst(), translate });

  if (result.applied.length === 0 && result.skipped.length === 0) {
    console.log('反映する変更がありませんでした。');
    process.exit(0);
  }

  if (!args['dry-run']) {
    if (result.config.level.toeic !== config.level.toeic) writeJson(CONFIG_PATH, result.config);
    if (result.topics.length !== topics.length) saveTopics(result.topics);
  }

  const out = ['## 設定を反映しました', ''];
  if (result.applied.length) out.push(...result.applied.map((a) => `- ✅ ${a}`));
  if (result.skipped.length) out.push(...result.skipped.map((s) => `- ⏭️ ${s}`));
  if (result.config.level.toeic !== config.level.toeic) {
    out.push('', `レベルの変更は **次回の生成分から** 反映されます (既存の問題は作り直しません)。`);
  }
  console.log(out.join('\n'));
} catch (err) {
  console.error(err instanceof GeminiError ? `Gemini API: ${err.message}` : err.message);
  process.exit(1);
}
