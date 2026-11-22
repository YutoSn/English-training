import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGasRequest,
  buildVideoPrompt,
  checkBlank,
  checkRange,
  clozeTokens,
  formatTime,
  GasError,
  parseGasResponse,
  parseTime,
  parseYouTubeUrl,
  scoreBlanks,
  validateVideoSet,
  videoConfig,
  videoSchema,
} from '../web/video.js';
import { levelProfile } from '../web/level.js';
import { readJson } from '../scripts/lib/paths.mjs';

const ID = 'dQw4w9WgXcQ';

test('parseYouTubeUrl は主な URL 形式から id を取り出す', () => {
  for (const url of [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&list=PL123`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}?si=abc`,
  ]) {
    assert.equal(parseYouTubeUrl(url)?.id, ID, url);
  }
});

test('parseYouTubeUrl は t= を開始位置として返す', () => {
  assert.equal(parseYouTubeUrl(`https://youtu.be/${ID}?t=95`).start, 95);
  assert.equal(parseYouTubeUrl(`https://www.youtube.com/watch?v=${ID}&t=1m35s`).start, 95);
  assert.equal(parseYouTubeUrl(`https://youtu.be/${ID}`).start, null);
});

test('parseYouTubeUrl は YouTube 以外と壊れた id を弾く', () => {
  assert.equal(parseYouTubeUrl('https://example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseYouTubeUrl('https://www.youtube.com/watch?v=short'), null);
  assert.equal(parseYouTubeUrl('not a url'), null);
  assert.equal(parseYouTubeUrl(''), null);
});

test('parseTime は mm:ss / h:mm:ss / 秒 / 1m20s を読む', () => {
  assert.equal(parseTime('1:20'), 80);
  assert.equal(parseTime('01:02:03'), 3723);
  assert.equal(parseTime('95'), 95);
  assert.equal(parseTime('1m20s'), 80);
  assert.equal(parseTime('2h'), 7200);
  assert.equal(parseTime('1:75'), null);
  assert.equal(parseTime(''), null);
  assert.equal(parseTime('abc'), null);
});

test('formatTime は時間があるときだけ時を出す', () => {
  assert.equal(formatTime(80), '1:20');
  assert.equal(formatTime(3723), '1:02:03');
  assert.equal(formatTime(5.9), '0:05');
});

test('checkRange は順序・長さを確かめる', () => {
  assert.equal(checkRange(80, 125, 300), null);
  assert.match(checkRange(null, 125), /時刻/);
  assert.match(checkRange(125, 80), /後/);
  assert.match(checkRange(80, 85), /10秒/);
  assert.match(checkRange(0, 400, 300), /5:00/);
});

test('videoConfig は config.video で既定値を上書きする', () => {
  assert.equal(videoConfig({}).blanks, 8);
  assert.equal(videoConfig({ video: { blanks: 5 } }).blanks, 5);
  assert.equal(videoConfig(readJson('data/config.json')).maxSeconds <= 600, true);
});

test('buildVideoPrompt は区間・レベル・前回のエラーを埋め込む', () => {
  const prompt = buildVideoPrompt({
    start: 80,
    end: 125,
    level: levelProfile(820),
    blanks: 8,
    questions: 3,
    feedback: ['blanks[0].word "x" が transcript[0].text に含まれていません'],
  });
  assert.match(prompt, /1:20〜2:05 \(80秒〜125秒\)/);
  assert.match(prompt, /TOEIC 820/);
  assert.match(prompt, /8個/);
  assert.match(prompt, /3問/);
  assert.match(prompt, /前回の出力の問題点[\s\S]*blanks\[0\]/);
  const plain = { start: 0, end: 30, level: levelProfile(600), blanks: 1, questions: 1 };
  assert.doesNotMatch(buildVideoPrompt(plain), /前回/);
});

test('videoSchema の required は properties と一致する', () => {
  const check = (node, path) => {
    if (node.type === 'OBJECT') {
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), path);
      for (const [k, v] of Object.entries(node.properties)) check(v, `${path}.${k}`);
    }
    if (node.type === 'ARRAY') check(node.items, `${path}[]`);
  };
  check(videoSchema, 'root');
});

const good = () => ({
  title: '新製品の発表',
  transcript: [
    { start: 80.2, end: 84.5, speaker: '', text: "Today we're unveiling something remarkable." },
    { start: 84.6, end: 90, speaker: '', text: 'It took us three years to get the battery right.' },
  ],
  blanks: [
    { line: 0, word: 'unveiling', hint: '公開する' },
    { line: 1, word: 'battery', hint: '電池' },
  ],
  quiz: [
    {
      id: 'q1',
      prompt: 'How long did the development take?',
      choices: ['Three years', 'Three months', 'One year', 'Ten years'],
      answer: 0,
      explanation: '"It took us three years" とある。',
    },
  ],
});
const opts = { start: 80, end: 125, blanks: 2, questions: 1 };

test('validateVideoSet は正しい教材を通す', () => {
  assert.deepEqual(validateVideoSet(good(), opts), []);
});

test('validateVideoSet は区間外の時刻を「先頭から数える」指示付きで弾く', () => {
  const set = good();
  set.transcript[0] = { ...set.transcript[0], start: 0.2, end: 4.5 };
  const errors = validateVideoSet(set, opts);
  assert.ok(errors.some((e) => /区間.*外.*先頭から/.test(e)), errors.join('\n'));
});

test('validateVideoSet は行に無い穴・1行2穴・複数語を弾く', () => {
  const set = good();
  set.blanks = [
    { line: 0, word: 'banana', hint: 'x' },
    { line: 0, word: 'remarkable', hint: 'x' },
    { line: 1, word: 'the battery', hint: 'x' },
    { line: 7, word: 'x', hint: 'x' },
  ];
  const errors = validateVideoSet(set, opts).join('\n');
  assert.match(errors, /"banana" が transcript\[0\]/);
  assert.match(errors, /穴が2つ/);
  assert.match(errors, /1語/);
  assert.match(errors, /範囲外/);
});

test('validateVideoSet は語の一部への一致を認めない', () => {
  const set = good();
  set.blanks[1] = { line: 1, word: 'bat', hint: 'x' };
  assert.match(validateVideoSet(set, opts).join('\n'), /"bat"/);
});

test('validateVideoSet はクイズの数・選択肢・answer を確かめる', () => {
  const set = good();
  set.quiz.push({ ...set.quiz[0], choices: ['a', 'a', 'b', 'c'], answer: 4 });
  const errors = validateVideoSet(set, opts).join('\n');
  assert.match(errors, /1 問必要/);
  assert.match(errors, /重複/);
  assert.match(errors, /同じ選択肢/);
  assert.match(errors, /0〜3/);
});

test('clozeTokens は穴の前後の文を残す', () => {
  const set = good();
  assert.deepEqual(clozeTokens(set.transcript[0].text, set.blanks, 0), [
    { type: 'text', value: "Today we're " },
    { type: 'blank', index: 0, answer: 'unveiling' },
    { type: 'text', value: ' something remarkable.' },
  ]);
  assert.deepEqual(clozeTokens('No blanks here.', set.blanks, 5), [
    { type: 'text', value: 'No blanks here.' },
  ]);
});

test('checkBlank / scoreBlanks は大文字小文字と句読点を無視する', () => {
  assert.equal(checkBlank('Battery', ' battery. '), true);
  assert.equal(checkBlank("we're", 'were'), false);
  assert.equal(checkBlank('battery', ''), false);
  assert.deepEqual(scoreBlanks(good().blanks, { 0: 'Unveiling', 1: 'batery' }), {
    correct: 1,
    total: 2,
  });
});

test('buildGasRequest は正規化した watch URL と整数の区間を送る', () => {
  const req = buildGasRequest({
    token: 't',
    videoId: ID,
    start: 80.4,
    end: 124.2,
    prompt: 'p',
    model: 'm',
  });
  assert.equal(req.videoUrl, `https://www.youtube.com/watch?v=${ID}`);
  assert.equal(req.start, 80);
  assert.equal(req.end, 125);
  assert.equal(req.schema, videoSchema);
});

test('parseGasResponse は成否と再試行の可否を伝える', () => {
  assert.deepEqual(parseGasResponse({ ok: true, text: '{"a":1}' }), { a: 1 });
  assert.throws(() => parseGasResponse({ ok: false, error: '合言葉が一致しません' }), /合言葉/);
  assert.throws(
    () => parseGasResponse({ ok: true, text: 'not json' }),
    (err) => err instanceof GasError && err.retriable,
  );
  assert.throws(
    () => parseGasResponse({ ok: false, error: 'x', retriable: true }),
    (err) => err.retriable === true,
  );
});
