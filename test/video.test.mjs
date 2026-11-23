import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGasRequest,
  buildVideoPrompt,
  checkRange,
  formatTime,
  GasError,
  parseGasResponse,
  parseTime,
  parseYouTubeUrl,
  resolveSubtitleMode,
  validateVideoSet,
  videoConfig,
  videoSchema,
} from '../web/video.js';
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
  // 作成済みの字幕の中で狭めるときは下限を下げられる。
  assert.equal(checkRange(84, 87, 300, 1), null);
  assert.match(checkRange(84, 84.5, 300, 1), /1秒/);
});

test('videoConfig は config.video で既定値を上書きする', () => {
  assert.equal(videoConfig({}).attempts, 2);
  assert.equal(videoConfig({ video: { attempts: 3 } }).attempts, 3);
  assert.equal(videoConfig(readJson('data/config.json')).maxSeconds <= 600, true);
});

test('buildVideoPrompt は区間・日本語訳の指示・前回のエラーを埋め込む', () => {
  const prompt = buildVideoPrompt({
    start: 80,
    end: 125,
    feedback: ['transcript[0].ja (日本語訳) が空です'],
  });
  assert.match(prompt, /1:20〜2:05 \(80秒〜125秒\)/);
  assert.match(prompt, /ja はその行の自然な日本語訳/);
  assert.match(prompt, /前回の出力の問題点[\s\S]*transcript\[0\]\.ja/);
  assert.doesNotMatch(buildVideoPrompt({ start: 0, end: 30 }), /前回/);
  // 穴埋め・クイズはやめたので、もう頼まない。
  assert.doesNotMatch(prompt, /blanks|quiz/);
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
  assert.deepEqual(Object.keys(videoSchema.properties), ['title', 'transcript']);
});

const good = () => ({
  title: '新製品の発表',
  transcript: [
    {
      start: 80.2,
      end: 84.5,
      speaker: '',
      text: "Today we're unveiling something remarkable.",
      ja: '本日、驚くべきものを発表します。',
    },
    {
      start: 84.6,
      end: 90,
      speaker: '',
      text: 'It took us three years to get the battery right.',
      ja: 'バッテリーを完成させるのに3年かかりました。',
    },
  ],
});
const opts = { start: 80, end: 125 };

test('validateVideoSet は正しい字幕を通す', () => {
  assert.deepEqual(validateVideoSet(good(), opts), []);
});

test('validateVideoSet は区間外の時刻を「先頭から数える」指示付きで弾く', () => {
  const set = good();
  set.transcript[0] = { ...set.transcript[0], start: 0.2, end: 4.5 };
  const errors = validateVideoSet(set, opts);
  assert.ok(errors.some((e) => /区間.*外.*先頭から/.test(e)), errors.join('\n'));
});

test('validateVideoSet は日本語訳の抜けを弾く', () => {
  const set = good();
  delete set.transcript[1].ja;
  assert.match(validateVideoSet(set, opts).join('\n'), /transcript\[1\]\.ja/);
});

test('validateVideoSet は空の字幕・順序の乱れを弾く', () => {
  assert.match(validateVideoSet({ title: 'x', transcript: [] }, opts).join('\n'), /空/);
  const set = good();
  set.transcript.reverse();
  assert.match(validateVideoSet(set, opts).join('\n'), /時系列/);
});

test('resolveSubtitleMode は日本語訳の無い動画で ja を英文のみに落とす', () => {
  const withJa = good().transcript;
  const withoutJa = withJa.map(({ ja, ...rest }) => rest);
  assert.equal(resolveSubtitleMode('ja', withJa), 'ja');
  assert.equal(resolveSubtitleMode('ja', withoutJa), 'en');
  assert.equal(resolveSubtitleMode('none', withoutJa), 'none');
  assert.equal(resolveSubtitleMode('bogus', withJa), 'en');
  assert.equal(resolveSubtitleMode(undefined, withJa), 'en');
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
