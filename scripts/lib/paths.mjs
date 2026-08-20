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

export function dayPath(date) {
  return path.join(DAYS_DIR, `${date}.json`);
}

export function listDays() {
  if (!fs.existsSync(DAYS_DIR)) return [];
  return fs
    .readdirSync(DAYS_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
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
