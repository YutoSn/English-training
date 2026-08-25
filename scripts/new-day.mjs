#!/usr/bin/env node
/**
 * Picks the topic for a date and prints the filled generation prompt on stdout.
 * It writes nothing — the prompt is meant to be handed to a model
 * (scripts/generate-day.mjs does that automatically with Gemini).
 *
 *   node scripts/new-day.mjs                 # today (JST)
 *   node scripts/new-day.mjs --date=2026-09-01
 *   node scripts/new-day.mjs --topic=climate-tech
 *   node scripts/new-day.mjs --json          # print the picked topic only
 *   node scripts/new-day.mjs --print-date    # print the resolved date and exit
 */
import { todayJst } from './lib/paths.mjs';
import { planDay } from './lib/plan.mjs';

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

try {
  const { level, topic, prompt } = await planDay(date, {
    topicId: args.topic || undefined,
    topicText: args['topic-text'] || undefined,
  });
  console.log(args.json ? JSON.stringify({ date, level, topic }, null, 2) : prompt);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
