import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJson, CONFIG_PATH, dayPath, todayJst } from './paths.mjs';

/**
 * The web app stamps `<!-- set:<setId> -->` into every submission so the grader
 * can find the right question file (`date:` は旧形式。既存の Issue のために残す)。
 * The issue title is the fallback for hand-written requests.
 */
export function resolveSetId(submission, { fallbackText = '', explicit } = {}) {
  const marker = /<!--\s*(?:set|date):(\d{4}-\d{2}-\d{2}(?:-\d+)?)\s*-->/;
  return (
    explicit ??
    submission.match(marker)?.[1] ??
    fallbackText.match(/(\d{4}-\d{2}-\d{2}(?:-\d+)?)/)?.[1] ??
    todayJst()
  );
}

export function buildGradePrompt({ submission, setId }) {
  if (!fs.existsSync(dayPath(setId))) throw new Error(`data/days/${setId}.json がありません`);

  const config = readJson(CONFIG_PATH);
  const day = readJson(dayPath(setId));
  const template = fs.readFileSync(path.join(ROOT, 'prompts/grade.md'), 'utf8');

  return template
    .replaceAll('{{DATE}}', setId)
    .replaceAll('{{TOEIC}}', String(config.level.toeic))
    .replace('{{DAY_JSON}}', JSON.stringify(day, null, 2))
    .replace('{{SUBMISSION}}', submission.trim());
}
