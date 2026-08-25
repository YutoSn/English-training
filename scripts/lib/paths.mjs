import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DATA_DIR = path.join(ROOT, 'data');
export const DAYS_DIR = path.join(DATA_DIR, 'days');
export const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
export const TOPICS_PATH = path.join(DATA_DIR, 'topics.json');
export const INDEX_PATH = path.join(DATA_DIR, 'index.json');

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** All JSON writes go through here so the repo diff stays stable (2-space, trailing newline). */
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

/**
 * セット id は `YYYY-MM-DD`、同じ日の2セット目以降は `YYYY-MM-DD-2`, `-3`。
 * オンデマンド生成で1日に何度でも作れるようにするため、日付そのものではなく
 * この id がファイル名になる。文字列順に並べれば作成順になる。
 */
export const SET_ID = /^\d{4}-\d{2}-\d{2}(-[2-9]\d*)?$/;

export function isSetId(value) {
  return SET_ID.test(String(value ?? ''));
}

export function setDate(setId) {
  return String(setId).slice(0, 10);
}

export function dayPath(setId) {
  return path.join(DAYS_DIR, `${setId}.json`);
}

export function listSets() {
  if (!fs.existsSync(DAYS_DIR)) return [];
  return fs
    .readdirSync(DAYS_DIR)
    .filter((f) => f.endsWith('.json') && isSetId(f.replace(/\.json$/, '')))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

/** その日でまだ使われていない id。1セット目は日付そのもの。 */
export function nextSetId(date) {
  const taken = new Set(listSets().filter((id) => setDate(id) === date));
  if (!taken.has(date)) return date;
  for (let n = 2; ; n++) {
    const candidate = `${date}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Today in Asia/Tokyo — the learner's day boundary, not the runner's UTC one. */
export function todayJst(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
