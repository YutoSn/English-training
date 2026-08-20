import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDay } from '../scripts/lib/schema.mjs';
import { readJson, dayPath } from '../scripts/lib/paths.mjs';

const sample = readJson(dayPath('2026-08-20'));

test('サンプルの学習セットは検証を通る', () => {
  const { ok, errors } = validateDay(sample, { date: '2026-08-20' });
  assert.deepEqual(errors, []);
  assert.ok(ok);
});

test('answer が範囲外なら失敗する', () => {
  const broken = structuredClone(sample);
  broken.reading.questions[0].answer = 9;
  const { ok, errors } = validateDay(broken, { date: '2026-08-20' });
  assert.equal(ok, false);
  assert.match(errors.join(), /reading\.questions\[0\]\.answer/);
});

test('ディクテーション文がスクリプトと重複していたら失敗する', () => {
  const broken = structuredClone(sample);
  broken.dictation.sentences[0].text = 'Good afternoon, everyone.';
  const { ok, errors } = validateDay(broken, { date: '2026-08-20' });
  assert.equal(ok, false);
  assert.match(errors.join(), /重複/);
});

test('ファイル名と date の不一致を検出する', () => {
  const { errors } = validateDay(sample, { date: '2026-08-21' });
  assert.match(errors.join(), /不一致/);
});

test('セクションが1つも無ければ失敗する', () => {
  const { ok } = validateDay({ date: '2026-08-20', topic: { id: 'x', label: 'X' }, level: { toeic: 730 } });
  assert.equal(ok, false);
});
