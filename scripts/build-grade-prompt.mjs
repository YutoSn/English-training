#!/usr/bin/env node
/**
 * Turns a grading request into a prompt for Claude. Used by
 * .github/workflows/grade.yml, which passes the issue through the environment.
 *
 *   ISSUE_BODY=... ISSUE_TITLE=... node scripts/build-grade-prompt.mjs
 *   node scripts/build-grade-prompt.mjs --file=submission.md   # ローカル採点用
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJson, CONFIG_PATH, dayPath, todayJst } from './lib/paths.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = true] = a.replace(/^--/, '').split('=');
    return [k, v];
  }),
);

const submission = args.file
  ? fs.readFileSync(args.file, 'utf8')
  : (process.env.ISSUE_BODY ?? '');

if (!submission.trim()) {
  console.error('採点対象がありません (ISSUE_BODY または --file を指定してください)');
  process.exit(1);
}

// The web app stamps `<!-- date:YYYY-MM-DD -->` into the submission; the issue
// title is the fallback for hand-written requests.
const date =
  args.date ??
  submission.match(/<!--\s*date:(\d{4}-\d{2}-\d{2})\s*-->/)?.[1] ??
  (process.env.ISSUE_TITLE ?? '').match(/(\d{4}-\d{2}-\d{2})/)?.[1] ??
  todayJst();

if (!fs.existsSync(dayPath(date))) {
  console.error(`data/days/${date}.json がありません`);
  process.exit(1);
}

const config = readJson(CONFIG_PATH);
const template = fs.readFileSync(path.join(ROOT, 'prompts/grade.md'), 'utf8');

let prompt = template
  .replaceAll('{{DATE}}', date)
  .replaceAll('{{TOEIC}}', String(config.level.toeic))
  .replace('{{SUBMISSION}}', submission);

if (process.env.GITHUB_EVENT_NAME === 'issues') {
  const issue = process.env.ISSUE_NUMBER ?? '${ISSUE_NUMBER}';
  prompt += `\n\n採点結果は \`gh issue comment ${issue} --body-file <file>\` でこの Issue にコメントしてください。\n`;
}

console.log(prompt);
