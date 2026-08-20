#!/usr/bin/env node
/**
 * Run after Claude has written data/days/<date>.json: validates the file,
 * records the topic as used, and rebuilds data/index.json.
 *
 *   node scripts/finalize-day.mjs --date=2026-09-01
 */
import fs from 'node:fs';
import { readJson, dayPath, todayJst } from './lib/paths.mjs';
import { validateDay } from './lib/schema.mjs';
import { loadTopics, saveTopics, markUsed } from './lib/topics.mjs';
import { buildIndex } from './lib/index.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = true] = a.replace(/^--/, '').split('=');
    return [k, v];
  }),
);
const date = args.date ?? todayJst();
const file = dayPath(date);

if (!fs.existsSync(file)) {
  console.error(`${file} がありません。先に問題を生成してください。`);
  process.exit(1);
}

const day = readJson(file);
const { ok, errors } = validateDay(day, { date });
if (!ok) {
  console.error(`${date} の検証に失敗しました:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const topics = loadTopics();
if (topics.some((t) => t.id === day.topic.id)) {
  saveTopics(markUsed(topics, [day.topic.id], date));
} else {
  console.warn(`警告: topic "${day.topic.id}" は data/topics.json に未登録です`);
}

const index = buildIndex();
console.log(`OK: ${date} (${day.topic.label}) — 全 ${index.days.length} 日分`);
