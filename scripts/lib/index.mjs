import { readJson, writeJson, dayPath, listDays, INDEX_PATH } from './paths.mjs';

/**
 * data/index.json is what the web app fetches first: it must stay small, so it
 * carries only what the day picker renders. Rebuilt from the day files, never
 * edited by hand.
 */
export function buildIndex() {
  const days = listDays().map((date) => {
    const day = readJson(dayPath(date));
    return {
      date,
      topic: day.topic?.label ?? '',
      toeic: day.level?.toeic ?? null,
      sections: ['listening', 'dictation', 'reading', 'writing'].filter((s) => day[s]),
    };
  });
  const index = { generatedAt: new Date().toISOString(), days: days.reverse() };
  writeJson(INDEX_PATH, index);
  return index;
}
