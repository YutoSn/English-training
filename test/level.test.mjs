import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelProfile } from '../scripts/lib/level.mjs';
import { levelProfile as fromWeb } from '../web/level.js';

test('scripts/lib と web/ は同じ実体を指す', () => {
  assert.equal(levelProfile, fromWeb);
});

test('バンドの境界', () => {
  assert.equal(levelProfile(450).cefr, 'A2');
  assert.equal(levelProfile(451).cefr, 'B1');
  assert.equal(levelProfile(730).cefr, 'B2');
  assert.equal(levelProfile(850).cefr, 'C1');
  assert.equal(levelProfile(990).cefr, 'C2');
});

test('範囲外は 350〜990 に丸める', () => {
  assert.equal(levelProfile(100).toeic, 350);
  assert.equal(levelProfile(2000).toeic, 990);
  assert.equal(levelProfile(undefined).toeic, 600);
});

test('生成プロンプトに埋める文言がそろっている', () => {
  const p = levelProfile(730);
  for (const key of ['vocabulary', 'sentence', 'speech']) {
    assert.ok(p[key]?.length > 0, `${key} が空`);
  }
});
