import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSubmission, countWords, scoreChoices, issueUrl } from '../web/store.js';
import { readJson, dayPath } from '../scripts/lib/paths.mjs';

const day = readJson(dayPath('2026-08-20'));

const answers = {
  listening: { l1: 1, l2: 3 },
  dictation: { d1: 'The launch window closed' },
  reading: { r1: 1 },
  writing: 'I agree with this idea because it saves money.',
};

test('未回答も含めて全設問を提出内容に載せる', () => {
  const md = buildSubmission(day, answers);
  for (const q of day.listening.questions) assert.match(md, new RegExp(`- ${q.id}:`));
  assert.match(md, /l3: 未回答/);
  assert.match(md, /d2: \(未回答\)/);
});

test('英作文は語数付きで載る', () => {
  assert.match(buildSubmission(day, answers), /\(9 words\)/);
});

test('scoreChoices は未回答を total にだけ数える', () => {
  const result = scoreChoices(day.listening.questions, answers.listening);
  assert.deepEqual(result, { correct: 1, answered: 2, total: 4 });
});

test('countWords は空白を無視する', () => {
  assert.equal(countWords('  one   two \n three '), 3);
});

test('issueUrl は date マーカー付きの本文を作る', () => {
  const url = issueUrl('owner/repo', day, 'body');
  assert.ok(url.startsWith('https://github.com/owner/repo/issues/new?labels=grade'));
  assert.ok(decodeURIComponent(url).includes('<!-- date:2026-08-20 -->'));
});
