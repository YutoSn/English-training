#!/usr/bin/env node
/**
 * Generates one day set with the Gemini API and writes data/days/<date>.json.
 *
 *   node scripts/generate-day.mjs                      # today (JST)
 *   node scripts/generate-day.mjs --date=2026-09-01
 *   node scripts/generate-day.mjs --topic=climate-tech
 *   node scripts/generate-day.mjs --model=gemini-2.5-flash
 *   node scripts/generate-day.mjs --from-file=content.json   # API を呼ばず手元の JSON を採用
 *
 * Requires GEMINI_API_KEY unless --from-file is given.
 * Exits 2 when the day already exists, so the daily workflow can skip quietly.
 */
import fs from 'node:fs';
import { readJson, writeJson, dayPath, todayJst } from './lib/paths.mjs';
import { planDay, assembleDay } from './lib/plan.mjs';
import { validateDay, daySchema } from './lib/schema.mjs';
import { finalizeDay } from './lib/finalize.mjs';
import { generateWithRetry, GeminiError } from './lib/gemini.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = true] = a.replace(/^--/, '').split('=');
    return [k, v];
  }),
);

const date = args.date ?? todayJst();
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(`不正な日付: ${date}`);
  process.exit(1);
}

if (fs.existsSync(dayPath(date)) && !args.force) {
  console.error(`${date} は既に存在します (--force で上書き)`);
  process.exit(2);
}

const plan = planDay(date, { topicId: args.topic || undefined });
const { generator } = plan.config;
const model = args.model ?? generator.model;
const maxAttempts = Number(args.attempts ?? generator.maxAttempts ?? 3);

/**
 * Structured output makes malformed JSON rare but not impossible, and it cannot
 * enforce the rules validateDay checks (duplicate dictation lines, answer index
 * in range). So: generate, validate, and on failure hand the errors back to the
 * model rather than giving up.
 */
async function generateContent() {
  const schema = daySchema(plan.config.sections);
  let prompt = plan.prompt;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.error(`生成中 (${attempt}/${maxAttempts}) — ${model} / ${plan.topic.label}`);
    const text = await generateWithRetry(
      { prompt, model, schema },
      {
        attempts: 3,
        onRetry: (err, n, wait) =>
          console.error(`  再試行 ${n}: ${err.message.slice(0, 120)} — ${wait / 1000}秒待機`),
      },
    );

    let content;
    try {
      content = JSON.parse(text);
    } catch {
      prompt = `${plan.prompt}\n\n## 直前の失敗\n有効な JSON ではありませんでした。JSON オブジェクトだけを出力してください。`;
      continue;
    }

    const day = assembleDay(plan, content);
    const { ok, errors } = validateDay(day, { date });
    if (ok) return day;

    console.error(`  検証エラー: ${errors.join(' / ')}`);
    prompt = `${plan.prompt}\n\n## 直前の失敗\n以下の点で検証に落ちました。同じ誤りを繰り返さずに作り直してください。\n${errors.map((e) => `- ${e}`).join('\n')}`;
  }

  throw new Error(`${maxAttempts}回試しましたが検証を通る学習セットを生成できませんでした`);
}

try {
  const day = args['from-file']
    ? assembleDay(plan, readJson(args['from-file']))
    : await generateContent();

  writeJson(dayPath(date), day);
  const { index } = finalizeDay(date);
  console.log(`OK: ${date} (${day.topic.label}) — 全 ${index.days.length} 日分`);
} catch (err) {
  if (err instanceof GeminiError) console.error(`Gemini API: ${err.message}`);
  else console.error(err.message);
  process.exit(1);
}
