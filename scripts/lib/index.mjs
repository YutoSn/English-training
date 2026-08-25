import { readJson, writeJson, dayPath, listSets, setDate, INDEX_PATH } from './paths.mjs';

/**
 * data/index.json is what the web app fetches first: it must stay small, so it
 * carries only what the set picker renders. Rebuilt from the set files, never
 * edited by hand.
 */
export function buildIndex() {
  const days = listSets().map((id) => {
    const day = readJson(dayPath(id));
    return {
      id,
      date: setDate(id),
      topic: day.topic?.label ?? '',
      toeic: day.level?.toeic ?? null,
      sections: ['listening', 'dictation', 'reading', 'writing'].filter((s) => day[s]),
    };
  });
  const index = { generatedAt: new Date().toISOString(), days: days.reverse() };
  writeJson(INDEX_PATH, index);
  return index;
}
