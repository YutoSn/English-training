#!/usr/bin/env node
/**
 * Add interest words to the topic pool.
 *
 *   node scripts/add-topic.mjs "深海探査:deep-sea exploration" "発酵食品:fermented food"
 *   node scripts/add-topic.mjs --tags=science "宇宙エレベーター:space elevator"
 *
 * Format is "日本語ラベル:english phrase". The English half seeds the id and is
 * what the generator uses as the theme, so keep it a natural noun phrase.
 */
import { loadTopics, saveTopics, slugify } from './lib/topics.mjs';
import { todayJst } from './lib/paths.mjs';

const argv = process.argv.slice(2);
const tags = (argv.find((a) => a.startsWith('--tags='))?.slice(7) ?? '')
  .split(',')
  .filter(Boolean);
const entries = argv.filter((a) => !a.startsWith('--'));

if (entries.length === 0) {
  console.error('使い方: node scripts/add-topic.mjs "日本語ラベル:english phrase" ...');
  process.exit(1);
}

const topics = loadTopics();
const added = [];

for (const entry of entries) {
  const [label, en] = entry.split(':').map((p) => p?.trim());
  if (!label || !en) {
    console.error(`形式が不正です: "${entry}" (期待: "日本語ラベル:english phrase")`);
    process.exit(1);
  }
  const id = slugify(en);
  if (topics.some((t) => t.id === id)) {
    console.log(`スキップ (登録済み): ${label} [${id}]`);
    continue;
  }
  topics.push({ id, label, en, tags, addedAt: todayJst(), usedCount: 0, lastUsedOn: null });
  added.push(`${label} [${id}]`);
}

saveTopics(topics);
console.log(added.length ? `追加: ${added.join(', ')}` : '追加なし');
console.log(`合計 ${topics.length} トピック`);
