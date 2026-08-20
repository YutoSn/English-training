#!/usr/bin/env node
/**
 * Grades a submission with the Gemini API and prints the feedback as Markdown.
 *
 *   node scripts/grade.mjs --file=解答.md
 *   ISSUE_BODY="$(cat 解答.md)" node scripts/grade.mjs      # grade.yml が使う経路
 *   node scripts/grade.mjs --file=解答.md --prompt-only     # プロンプトだけ出す
 *
 * Requires GEMINI_API_KEY unless --prompt-only is given.
 */
import fs from 'node:fs';
import { readJson, CONFIG_PATH } from './lib/paths.mjs';
import { buildGradePrompt, resolveDate } from './lib/grade.mjs';
import { generateWithRetry, GeminiError } from './lib/gemini.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = true] = a.replace(/^--/, '').split('=');
    return [k, v];
  }),
);

const submission = args.file ? fs.readFileSync(args.file, 'utf8') : (process.env.ISSUE_BODY ?? '');
if (!submission.trim()) {
  console.error('採点対象がありません (--file または ISSUE_BODY を指定してください)');
  process.exit(1);
}

try {
  const date = resolveDate(submission, {
    fallbackText: process.env.ISSUE_TITLE ?? '',
    explicit: args.date || undefined,
  });
  const prompt = buildGradePrompt({ submission, date });

  if (args['prompt-only']) {
    console.log(prompt);
    process.exit(0);
  }

  const { generator } = readJson(CONFIG_PATH);
  const model = args.model ?? generator.gradeModel ?? generator.model;
  console.error(`採点中 — ${model} / ${date}`);

  // Grading is judgement, not invention: keep the temperature low so the same
  // answer sheet does not swing between scores.
  const feedback = await generateWithRetry(
    { prompt, model, temperature: 0.3 },
    {
      attempts: 3,
      onRetry: (err, n, wait) =>
        console.error(`  再試行 ${n}: ${err.message.slice(0, 120)} — ${wait / 1000}秒待機`),
    },
  );
  console.log(feedback);
} catch (err) {
  if (err instanceof GeminiError) console.error(`Gemini API: ${err.message}`);
  else console.error(err.message);
  process.exit(1);
}
