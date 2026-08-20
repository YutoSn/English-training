import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickTopics, seededRandom, slugify } from '../scripts/lib/topics.mjs';

const topics = [
  { id: 'a', label: 'A', en: 'a', usedCount: 0, lastUsedOn: null },
  { id: 'b', label: 'B', en: 'b', usedCount: 3, lastUsedOn: '2026-08-01' },
  { id: 'c', label: 'C', en: 'c', usedCount: 1, lastUsedOn: null },
];

test('同じ日付なら常に同じトピックを選ぶ', () => {
  const first = pickTopics(topics, { date: '2026-09-01' });
  const second = pickTopics(topics, { date: '2026-09-01' });
  assert.deepEqual(first, second);
});

test('直近で使ったトピックは除外される', () => {
  const recent = [
    { id: 'a', label: 'A', en: 'a', usedCount: 0, lastUsedOn: '2026-08-30' },
    { id: 'b', label: 'B', en: 'b', usedCount: 0, lastUsedOn: null },
  ];
  const picked = pickTopics(recent, { date: '2026-09-01', recentWindow: 14 });
  assert.equal(picked[0].id, 'b');
});

test('候補が足りなければ全件から選ぶ', () => {
  const all = [{ id: 'a', label: 'A', en: 'a', usedCount: 0, lastUsedOn: '2026-09-01' }];
  assert.equal(pickTopics(all, { date: '2026-09-01' }).length, 1);
});

test('要求件数だけ重複なく選ぶ', () => {
  const picked = pickTopics(topics, { date: '2026-09-02', count: 3 });
  assert.equal(new Set(picked.map((t) => t.id)).size, 3);
});

test('seededRandom は 0..1 を返し、シードが同じなら同じ列', () => {
  const a = seededRandom('x');
  const b = seededRandom('x');
  for (let i = 0; i < 5; i++) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1);
  }
});

test('slugify は英語フレーズから id を作る', () => {
  assert.equal(slugify('Deep-Sea Exploration!'), 'deep-sea-exploration');
});
