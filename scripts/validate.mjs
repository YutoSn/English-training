#!/usr/bin/env node
/** Lint every generated set. Run by CI and by `node --run test`. */
import { readJson, dayPath, listSets } from './lib/paths.mjs';
import { validateDay } from './lib/schema.mjs';

const sets = listSets();
let failed = 0;

for (const setId of sets) {
  let day;
  try {
    day = readJson(dayPath(setId));
  } catch (err) {
    console.error(`✗ ${setId}: JSON として読めません — ${err.message}`);
    failed++;
    continue;
  }
  const { ok, errors } = validateDay(day, { setId });
  if (ok) {
    console.log(`✓ ${setId} (${day.topic.label})`);
  } else {
    failed++;
    console.error(`✗ ${setId}`);
    for (const e of errors) console.error(`    - ${e}`);
  }
}

console.log(`${sets.length} セット中 ${sets.length - failed} 件 OK`);
process.exit(failed > 0 ? 1 : 0);
