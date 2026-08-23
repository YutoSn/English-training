import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPayload,
  extractPayload,
  isApplied,
  isEmptyPayload,
  normalizeTopicInput,
  pendingChanges,
  renderSettingsBody,
  settingsIssueUrl,
} from '../web/settings.js';
import { applyPayload, labelsNeedingTranslation } from '../scripts/lib/settings.mjs';

const config = { level: { toeic: 730 } };
const topics = [{ id: 'remote-work', label: 'リモートワーク', en: 'remote work', usedCount: 1 }];

test('TOEIC は 350〜990 に丸められる', () => {
  assert.equal(buildPayload({ toeic: 1200 }).toeic, 990);
  assert.equal(buildPayload({ toeic: 100 }).toeic, 350);
  assert.equal(buildPayload({ toeic: '805' }).toeic, 805);
  assert.equal(buildPayload({ toeic: 'abc' }).toeic, undefined);
});

test('英語フレーズは任意', () => {
  assert.deepEqual(normalizeTopicInput('深海探査', ''), { label: '深海探査' });
  assert.deepEqual(normalizeTopicInput('深海探査', ' deep-sea exploration '), {
    label: '深海探査',
    en: 'deep-sea exploration',
  });
  assert.equal(normalizeTopicInput('  ', ''), null);
});

test('英語だけ入力されたらラベルにも使う', () => {
  assert.deepEqual(normalizeTopicInput('', 'coral reefs'), { label: 'coral reefs', en: 'coral reefs' });
});

test('Issue 本文に埋めた payload を取り出せる', () => {
  const payload = buildPayload({ toeic: 800, addTopics: [{ label: '深海探査' }] });
  const body = renderSettingsBody(payload, { toeic: 730 });
  assert.match(body, /TOEIC 730 → 800/);
  assert.deepEqual(extractPayload(body), payload);
});

test('payload が無い本文からは null', () => {
  assert.equal(extractPayload('ただの Issue です'), null);
  assert.equal(extractPayload('<!-- settings\n{壊れた JSON\n-->'), null);
});

test('issueUrl は settings ラベル付き', () => {
  const url = settingsIssueUrl('owner/repo', buildPayload({ toeic: 800 }), { toeic: 730 });
  assert.ok(url.startsWith('https://github.com/owner/repo/issues/new?labels=settings'));
});

test('空の payload を判定できる', () => {
  assert.ok(isEmptyPayload(buildPayload({ toeic: null, addTopics: [] })));
  assert.ok(!isEmptyPayload(buildPayload({ toeic: 800 })));
});

test('反映済みなら未反映リストは空になる', () => {
  const payload = buildPayload({ toeic: 800, addTopics: [{ label: 'リモートワーク', en: 'remote work' }] });
  assert.deepEqual(pendingChanges(payload, { config, topics }), { toeic: 800, topics: [] });
  assert.ok(isApplied(payload, { config: { level: { toeic: 800 } }, topics }));
});

test('applyPayload はレベルを更新する', () => {
  const result = applyPayload({ config, topics }, { toeic: 860 }, { today: '2026-08-24' });
  assert.equal(result.config.level.toeic, 860);
  assert.equal(config.level.toeic, 730, '元のオブジェクトを壊さない');
  assert.match(result.applied.join(), /730 → 860/);
});

test('applyPayload は同じ値なら何もしない', () => {
  const result = applyPayload({ config, topics }, { toeic: 730 }, { today: '2026-08-24' });
  assert.deepEqual(result.applied, []);
  assert.match(result.skipped.join(), /現在値と同じ/);
});

test('applyPayload はテーマを追加する', () => {
  const payload = { addTopics: [{ label: '深海探査', en: 'deep-sea exploration' }] };
  const result = applyPayload({ config, topics }, payload, { today: '2026-08-24' });
  const added = result.topics.at(-1);
  assert.deepEqual(added, {
    id: 'deep-sea-exploration',
    label: '深海探査',
    en: 'deep-sea exploration',
    tags: [],
    addedAt: '2026-08-24',
    usedCount: 0,
    lastUsedOn: null,
  });
});

test('applyPayload は登録済みテーマを飛ばす', () => {
  const payload = { addTopics: [{ label: '在宅勤務', en: 'Remote Work' }] };
  const result = applyPayload({ config, topics }, payload, { today: '2026-08-24' });
  assert.equal(result.topics.length, topics.length);
  assert.match(result.skipped.join(), /登録済み/);
});

test('英語フレーズは translate で補われる', () => {
  const payload = { addTopics: [{ label: '発酵食品' }] };
  assert.deepEqual(labelsNeedingTranslation(payload), ['発酵食品']);
  const result = applyPayload({ config, topics }, payload, {
    today: '2026-08-24',
    translate: { 発酵食品: 'fermented food' },
  });
  assert.equal(result.topics.at(-1).id, 'fermented-food');
});

test('英語フレーズを決められなければ飛ばす', () => {
  const result = applyPayload({ config, topics }, { addTopics: [{ label: '謎' }] }, { today: '2026-08-24' });
  assert.equal(result.topics.length, topics.length);
  assert.match(result.skipped.join(), /英語フレーズを決められませんでした/);
});

test('「変更なし」の下書きは TOEIC を送らない', () => {
  // Number(null) は 0 なので、素直に丸めると 350 が送られてしまう。
  for (const value of [null, undefined, '', false]) {
    assert.equal(buildPayload({ toeic: value }).toeic, undefined, `${String(value)} で送信された`);
  }
});
