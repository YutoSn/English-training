import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffWords, normalize } from '../web/diff.js';

test('句読点と大文字小文字の差は減点しない', () => {
  const { accuracy, ops } = diffWords('The launch window closed.', 'the launch window closed');
  assert.equal(accuracy, 1);
  assert.ok(ops.every((o) => o.type === 'same'));
});

test('聞き落とした語を missing として返す', () => {
  const { ops, matched, total } = diffWords('We had to postpone the docking attempt', 'We had to postpone the attempt');
  assert.equal(total, 7);
  assert.equal(matched, 6);
  assert.deepEqual(
    ops.filter((o) => o.type === 'missing').map((o) => o.word),
    ['docking'],
  );
});

test('余分に入力した語を extra として返す', () => {
  const { ops } = diffWords('Nobody expected the moon', 'Nobody really expected the moon');
  assert.deepEqual(
    ops.filter((o) => o.type === 'extra').map((o) => o.word),
    ['really'],
  );
});

test('空の解答は accuracy 0', () => {
  assert.equal(diffWords('one two three', '').accuracy, 0);
});

test('normalize はアポストロフィを保持する', () => {
  assert.equal(normalize("Don't!"), "don't");
});
