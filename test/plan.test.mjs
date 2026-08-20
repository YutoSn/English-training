import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDay, assembleDay } from '../scripts/lib/plan.mjs';
import { daySchema, validateDay } from '../scripts/lib/schema.mjs';
import { resolveDate } from '../scripts/lib/grade.mjs';
import { readJson, dayPath, CONFIG_PATH } from '../scripts/lib/paths.mjs';

test('planDay はプロンプトに日付・テーマ・レベルを埋め込む', () => {
  const plan = planDay('2026-09-01', { topicId: 'climate-tech' });
  assert.equal(plan.topic.id, 'climate-tech');
  assert.match(plan.prompt, /2026-09-01/);
  assert.match(plan.prompt, /気候テック/);
  assert.match(plan.prompt, new RegExp(String(plan.level.toeic)));
  assert.doesNotMatch(plan.prompt, /{{\w+}}/);
});

test('未知のトピックは失敗する', () => {
  assert.throws(() => planDay('2026-09-01', { topicId: 'nope' }), /未知のトピック/);
});

test('assembleDay が付けた date/topic/level は検証を通る', () => {
  const plan = planDay('2026-09-01', { topicId: 'climate-tech' });
  const sample = readJson(dayPath('2026-08-20'));
  const content = {
    listening: sample.listening,
    dictation: sample.dictation,
    reading: sample.reading,
    writing: sample.writing,
  };
  const day = assembleDay(plan, content);
  assert.equal(day.date, '2026-09-01');
  assert.equal(day.topic.id, 'climate-tech');
  assert.deepEqual(validateDay(day, { date: '2026-09-01' }).errors, []);
});

test('daySchema は有効なセクションだけを必須にする', () => {
  const sections = readJson(CONFIG_PATH).sections;
  const off = structuredClone(sections);
  off.writing.enabled = false;
  assert.deepEqual(daySchema(off).required, ['listening', 'dictation', 'reading']);
  assert.deepEqual(daySchema(sections).required, ['listening', 'dictation', 'reading', 'writing']);
});

test('daySchema の選択肢問題は4択で全項目必須', () => {
  const q = daySchema(readJson(CONFIG_PATH).sections).properties.listening.properties.questions.items;
  assert.equal(q.properties.choices.minItems, 4);
  assert.deepEqual(q.required, ['id', 'prompt', 'choices', 'answer', 'explanation']);
});

test('resolveDate は提出内容の date マーカーを優先する', () => {
  assert.equal(resolveDate('本文\n<!-- date:2026-08-20 -->'), '2026-08-20');
});

test('resolveDate はマーカーが無ければ Issue タイトルから拾う', () => {
  assert.equal(resolveDate('本文のみ', { fallbackText: '採点依頼 2026-07-15' }), '2026-07-15');
});

test('resolveDate は明示指定を最優先する', () => {
  assert.equal(
    resolveDate('<!-- date:2026-08-20 -->', { explicit: '2026-01-01' }),
    '2026-01-01',
  );
});
