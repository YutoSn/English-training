#!/usr/bin/env node
/**
 * Picks the topic for a date and prints the filled generation prompt on stdout.
 * It deliberately does NOT write the day file — Claude does that, driven by the
 * prompt this emits (see .github/workflows/daily.yml).
 *
 *   node scripts/new-day.mjs                 # today (JST)
 *   node scripts/new-day.mjs --date=2026-09-01
 *   node scripts/new-day.mjs --topic=climate-tech
 *   node scripts/new-day.mjs --json          # print the picked topic only
 *   node scripts/new-day.mjs --print-date    # print the resolved date and exit
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJson, CONFIG_PATH, dayPath, todayJst } from './lib/paths.mjs';
import { loadTopics, pickTopics } from './lib/topics.mjs';
import { levelProfile } from './lib/level.mjs';

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

if (args['print-date']) {
  console.log(date);
  process.exit(0);
}

if (fs.existsSync(dayPath(date)) && !args.force) {
  console.error(`${date} は既に存在します (--force で上書き用プロンプトを出力)`);
  process.exit(2);
}

const config = readJson(CONFIG_PATH);
const topics = loadTopics();
const level = levelProfile(config.level.toeic);

const picked = args.topic
  ? [topics.find((t) => t.id === args.topic) ?? fail(`未知のトピック: ${args.topic}`)]
  : pickTopics(topics, {
      date,
      count: config.topicsPerDay,
      recentWindow: config.recentTopicWindow,
    });

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (args.json) {
  console.log(JSON.stringify({ date, level, topics: picked }, null, 2));
  process.exit(0);
}

const s = config.sections;
const spec = [
  s.listening.enabled &&
    `- リスニング: ${s.listening.scriptWords[0]}〜${s.listening.scriptWords[1]}語のスクリプト + 4択問題 ${s.listening.questions}問`,
  s.dictation.enabled && `- ディクテーション: ${s.dictation.sentences}文`,
  s.reading.enabled &&
    `- リーディング: ${s.reading.passageWords[0]}〜${s.reading.passageWords[1]}語のパッセージ + 4択問題 ${s.reading.questions}問`,
  s.writing.enabled && `- 英作文: ${s.writing.words[0]}〜${s.writing.words[1]}語の課題1問`,
]
  .filter(Boolean)
  .join('\n');

const topic = picked[0];
const template = fs.readFileSync(path.join(ROOT, 'prompts/generate.md'), 'utf8');

const filled = template.replace(/{{(\w+)}}/g, (_, key) => {
  const values = {
    DATE: date,
    TOPIC_ID: topic.id,
    TOPIC_LABEL: topic.label,
    TOPIC_EN: topic.en,
    TOEIC: String(level.toeic),
    CEFR: level.cefr,
    VOCABULARY: level.vocabulary,
    SENTENCE: level.sentence,
    SPEECH: level.speech,
    SECTION_SPEC: spec,
    WRITING_MIN: String(s.writing.words[0]),
    WRITING_MAX: String(s.writing.words[1]),
  };
  if (!(key in values)) fail(`prompts/generate.md の未知のプレースホルダ: {{${key}}}`);
  return values[key];
});

console.log(filled);
