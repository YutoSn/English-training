#!/usr/bin/env node
/** Lint every generated day set. Run by CI and by `npm test`. */
import { readJson, dayPath, listDays } from './lib/paths.mjs';
import { validateDay } from './lib/schema.mjs';

const dates = listDays();
let failed = 0;

for (const date of dates) {
  let day;
  try {
    day = readJson(dayPath(date));
  } catch (err) {
    console.error(`✗ ${date}: JSON として読めません — ${err.message}`);
    failed++;
    continue;
  }
  const { ok, errors } = validateDay(day, { date });
  if (ok) {
    console.log(`✓ ${date} (${day.topic.label})`);
  } else {
    failed++;
    console.error(`✗ ${date}`);
    for (const e of errors) console.error(`    - ${e}`);
  }
}

console.log(`${dates.length} 日分中 ${dates.length - failed} 件 OK`);
process.exit(failed > 0 ? 1 : 0);
