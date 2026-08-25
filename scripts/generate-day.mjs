#!/usr/bin/env node
/**
 * Gemini で学習セットを1つ作り、data/days/<setId>.json に書く。
 *
 *   node scripts/generate-day.mjs                        # ネタ帳から自動でテーマを選ぶ
 *   node scripts/generate-day.mjs --topic-text=深海探査   # テーマを指定 (日本語可・新規可)
 *   node scripts/generate-day.mjs --topic=climate-tech   # ネタ帳の id を指定
 *   node scripts/generate-day.mjs --date=2026-09-01
 *   node scripts/generate-day.mjs --model=gemini-flash-latest
 *   node scripts/generate-day.mjs --from-file=content.json   # API を呼ばず手元の JSON を採用
 *
 * setId は同じ日に何度でも作れるよう `YYYY-MM-DD`, `YYYY-MM-DD-2`, ... と振る。
 * 生成できた setId は stdout の最終行に出す (ワークフローが拾う)。
 * --from-file 以外は GEMINI_API_KEY が要る。
 */
import { readJson, writeJson, dayPath, todayJst, nextSetId } from './lib/paths.mjs';
import { planDay, assembleDay } from './lib/plan.mjs';
import { validateDay, daySchema } from './lib/schema.mjs';
import { finalizeDay } from './lib/finalize.mjs';
import { generateWithRetry, GeminiError } from './lib/gemini.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=');
    return [k, rest.length ? rest.join('=') : true];
  }),
);

const date = args.date ?? todayJst();
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(`不正な日付: ${date}`);
  process.exit(1);
}

/**
 * 構造化出力でも「ディクテーション文がスクリプトと重複」「answer が範囲外」までは
 * 防げないので、検証に落ちたらエラーを添えて作り直す。
 */
async function generateContent(plan, { model, maxAttempts }) {
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
    const { ok, errors } = validateDay(day, { setId: date });
    if (ok) return day;

    console.error(`  検証エラー: ${errors.join(' / ')}`);
    prompt = `${plan.prompt}\n\n## 直前の失敗\n以下の点で検証に落ちました。同じ誤りを繰り返さずに作り直してください。\n${errors.map((e) => `- ${e}`).join('\n')}`;
  }

  throw new Error(`${maxAttempts}回試しましたが検証を通る学習セットを生成できませんでした`);
}

try {
  const plan = await planDay(date, {
    topicId: args.topic || undefined,
    // 利用者が打ち込んだ自由文はシェルを経由させたくないので環境変数でも受ける。
    topicText: args['topic-text'] || process.env.TOPIC_TEXT || undefined,
  });
  const { generator } = plan.config;
  const model = args.model ?? generator.model;

  const day = args['from-file']
    ? assembleDay(plan, readJson(args['from-file']))
    : await generateContent(plan, {
        model,
        maxAttempts: Number(args.attempts ?? generator.maxAttempts ?? 3),
      });

  const setId = nextSetId(date);
  writeJson(dayPath(setId), day);
  const { index } = finalizeDay(setId);
  console.error(`OK: ${setId} (${day.topic.label}) — 全 ${index.days.length} セット`);
  console.log(setId);
} catch (err) {
  console.error(err instanceof GeminiError ? `Gemini API: ${err.message}` : err.message);
  process.exit(1);
}
