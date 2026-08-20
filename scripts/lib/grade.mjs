import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJson, CONFIG_PATH, dayPath, todayJst } from './paths.mjs';

/**
 * The web app stamps `<!-- date:YYYY-MM-DD -->` into every submission, so the
 * grader can find the right question file. The issue title is the fallback for
 * hand-written requests.
 */
export function resolveDate(submission, { fallbackText = '', explicit } = {}) {
  return (
    explicit ??
    submission.match(/<!--\s*date:(\d{4}-\d{2}-\d{2})\s*-->/)?.[1] ??
    fallbackText.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ??
    todayJst()
  );
}

export function buildGradePrompt({ submission, date }) {
  if (!fs.existsSync(dayPath(date))) throw new Error(`data/days/${date}.json がありません`);

  const config = readJson(CONFIG_PATH);
  const day = readJson(dayPath(date));
  const template = fs.readFileSync(path.join(ROOT, 'prompts/grade.md'), 'utf8');

  return template
    .replaceAll('{{DATE}}', date)
    .replaceAll('{{TOEIC}}', String(config.level.toeic))
    .replace('{{DAY_JSON}}', JSON.stringify(day, null, 2))
    .replace('{{SUBMISSION}}', submission.trim());
}
