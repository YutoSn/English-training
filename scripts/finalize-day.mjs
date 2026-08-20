#!/usr/bin/env node
/**
 * Run after a day file has been written: validates it, records the topic as
 * used, and rebuilds data/index.json.
 *
 *   node scripts/finalize-day.mjs --date=2026-09-01
 */
import { todayJst } from './lib/paths.mjs';
import { finalizeDay } from './lib/finalize.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = true] = a.replace(/^--/, '').split('=');
    return [k, v];
  }),
);

try {
  const { day, index } = finalizeDay(args.date ?? todayJst());
  console.log(`OK: ${day.date} (${day.topic.label}) — 全 ${index.days.length} 日分`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
