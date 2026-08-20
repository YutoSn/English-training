import { readJson, writeJson, TOPICS_PATH } from './paths.mjs';

export function slugify(en) {
  return en
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/**
 * Deterministic PRNG (mulberry32 over an FNV-1a hash of the seed) so that
 * `new-day.mjs --date=X` always picks the same topic for the same date.
 */
export function seededRandom(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick `count` topics for `date`. Topics used within `recentWindow` days are
 * excluded first; least-used topics are weighted higher so new words surface fast.
 */
export function pickTopics(topics, { date, count = 1, recentWindow = 14, seed = date }) {
  if (topics.length === 0) throw new Error('data/topics.json にトピックがありません');
  const cutoff = new Date(`${date}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - recentWindow);

  const fresh = topics.filter(
    (t) => !t.lastUsedOn || new Date(`${t.lastUsedOn}T00:00:00Z`) < cutoff,
  );
  const pool = fresh.length >= count ? fresh : [...topics];

  const rand = seededRandom(seed);
  const minUsed = Math.min(...pool.map((t) => t.usedCount ?? 0));
  const weighted = pool.flatMap((t) => {
    const weight = Math.max(1, 4 - ((t.usedCount ?? 0) - minUsed));
    return Array.from({ length: weight }, () => t);
  });

  const picked = [];
  while (picked.length < Math.min(count, pool.length)) {
    const candidate = weighted[Math.floor(rand() * weighted.length)];
    if (!picked.some((p) => p.id === candidate.id)) picked.push(candidate);
  }
  return picked;
}

export function loadTopics() {
  return readJson(TOPICS_PATH).topics;
}

export function saveTopics(topics) {
  writeJson(TOPICS_PATH, { topics });
}

export function markUsed(topics, ids, date) {
  return topics.map((t) =>
    ids.includes(t.id) ? { ...t, usedCount: (t.usedCount ?? 0) + 1, lastUsedOn: date } : t,
  );
}
