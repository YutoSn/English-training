import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDay, assembleDay, resolveTopic } from '../scripts/lib/plan.mjs';
import { daySchema, validateDay } from '../scripts/lib/schema.mjs';
import { resolveSetId } from '../scripts/lib/grade.mjs';
import { readJson, dayPath, CONFIG_PATH, nextSetId, setDate, listSets } from '../scripts/lib/paths.mjs';

test('planDay はプロンプトに日付・テーマ・レベルを埋め込む', async () => {
  const plan = await planDay('2026-09-01', { topicId: 'climate-tech' });
  assert.equal(plan.topic.id, 'climate-tech');
  assert.match(plan.prompt, /2026-09-01/);
  assert.match(plan.prompt, /気候テック/);
  assert.match(plan.prompt, new RegExp(String(plan.level.toeic)));
  assert.doesNotMatch(plan.prompt, /{{\w+}}/);
});

test('未知のトピック id は失敗する', async () => {
  await assert.rejects(() => planDay('2026-09-01', { topicId: 'nope' }), /未知のトピック/);
});

test('assembleDay が付けた date/topic/level は検証を通る', async () => {
  const plan = await planDay('2026-09-01', { topicId: 'climate-tech' });
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
  assert.deepEqual(validateDay(day, { setId: '2026-09-01' }).errors, []);
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

test('resolveSetId は提出内容の set マーカーを優先する', () => {
  assert.equal(resolveSetId('本文\n<!-- set:2026-08-20-2 -->'), '2026-08-20-2');
});

test('resolveSetId は旧形式の date マーカーも読む', () => {
  assert.equal(resolveSetId('本文\n<!-- date:2026-08-20 -->'), '2026-08-20');
});

test('resolveSetId はマーカーが無ければ Issue タイトルから拾う', () => {
  assert.equal(resolveSetId('本文のみ', { fallbackText: '採点依頼 2026-07-15-3' }), '2026-07-15-3');
});

test('resolveSetId は明示指定を最優先する', () => {
  assert.equal(resolveSetId('<!-- set:2026-08-20 -->', { explicit: '2026-01-01' }), '2026-01-01');
});

const config = readJson(CONFIG_PATH);
const topics = [
  { id: 'remote-work', label: 'リモートワーク', en: 'remote work', usedCount: 0, lastUsedOn: null },
];

test('自由入力が既存テーマと一致すればそれを使う (API を呼ばない)', async () => {
  for (const text of ['リモートワーク', 'remote work', 'Remote Work']) {
    const topic = await resolveTopic(topics, { date: '2026-09-01', topicText: text, config });
    assert.equal(topic.id, 'remote-work', text);
  }
});

test('英語の自由入力は訳さずそのまま新規テーマにする', async () => {
  const topic = await resolveTopic(topics, {
    date: '2026-09-01',
    topicText: 'deep-sea exploration',
    config,
  });
  assert.deepEqual(topic, {
    id: 'deep-sea-exploration',
    label: 'deep-sea exploration',
    en: 'deep-sea exploration',
  });
});

test('テーマ未指定なら日付シードでネタ帳から選ぶ', async () => {
  const a = await resolveTopic(topics, { date: '2026-09-01', config });
  const b = await resolveTopic(topics, { date: '2026-09-01', config });
  assert.equal(a.id, b.id);
});

test('setId は同じ日の2本目から連番になる', () => {
  const existing = listSets();
  const free = '2999-01-01';
  assert.equal(nextSetId(free), free, '未使用の日付はそのまま');
  assert.ok(existing.includes('2026-08-20'));
  assert.equal(nextSetId('2026-08-20'), '2026-08-20-2');
  assert.equal(setDate('2026-08-20-2'), '2026-08-20');
});
