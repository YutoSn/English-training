import fs from 'node:fs';
import { readJson, dayPath } from './paths.mjs';
import { validateDay } from './schema.mjs';
import { loadTopics, saveTopics, markUsed } from './topics.mjs';
import { buildIndex } from './index.mjs';

/**
 * The step that must never be skipped after a day file appears: without it the
 * topic stays "unused" and data/index.json never learns about the new day.
 * Throws with the validation errors rather than writing a broken set.
 */
export function finalizeDay(date) {
  const file = dayPath(date);
  if (!fs.existsSync(file)) throw new Error(`${file} がありません`);

  const day = readJson(file);
  const { ok, errors } = validateDay(day, { date });
  if (!ok) {
    const err = new Error(`${date} の検証に失敗しました:\n  - ${errors.join('\n  - ')}`);
    err.errors = errors;
    throw err;
  }

  const topics = loadTopics();
  if (topics.some((t) => t.id === day.topic.id)) {
    saveTopics(markUsed(topics, [day.topic.id], date));
  } else {
    console.warn(`警告: topic "${day.topic.id}" は data/topics.json に未登録です`);
  }

  return { day, index: buildIndex() };
}
