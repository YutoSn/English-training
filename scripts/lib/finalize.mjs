import fs from 'node:fs';
import { readJson, dayPath, setDate } from './paths.mjs';
import { validateDay } from './schema.mjs';
import { loadTopics, saveTopics, markUsed } from './topics.mjs';
import { buildIndex } from './index.mjs';

/**
 * The step that must never be skipped after a set file appears: without it the
 * topic stays "unused" and data/index.json never learns about the new set.
 * Throws with the validation errors rather than leaving a broken set behind.
 *
 * オンデマンド生成では利用者が新しいテーマを打ち込むので、未登録のテーマは
 * ここでネタ帳に加える (「興味あるワードを貯める」経路を兼ねる)。
 */
export function finalizeDay(setId) {
  const file = dayPath(setId);
  if (!fs.existsSync(file)) throw new Error(`${file} がありません`);

  const day = readJson(file);
  const { ok, errors } = validateDay(day, { setId });
  if (!ok) {
    const err = new Error(`${setId} の検証に失敗しました:\n  - ${errors.join('\n  - ')}`);
    err.errors = errors;
    throw err;
  }

  let topics = loadTopics();
  if (!topics.some((t) => t.id === day.topic.id)) {
    topics = [
      ...topics,
      {
        id: day.topic.id,
        label: day.topic.label,
        en: day.topic.en,
        tags: [],
        addedAt: setDate(setId),
        usedCount: 0,
        lastUsedOn: null,
      },
    ];
  }
  saveTopics(markUsed(topics, [day.topic.id], setDate(setId)));

  return { day, index: buildIndex() };
}
