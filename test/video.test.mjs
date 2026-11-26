import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGasRequest,
  buildVideoPrompt,
  checkRange,
  currentLineIndex,
  applyAnchors,
  effectiveAnchors,
  endsSentence,
  fitAnchors,
  formatTime,
  GasError,
  groupTranscript,
  parseGasResponse,
  parseTime,
  parseYouTubeUrl,
  makeTimeMap,
  mergeParts,
  PART_OVERRUN,
  splitRange,
  resolveSubtitleMode,
  setAnchor,
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

const L = (start, end, text, extra = {}) => ({ start, end, speaker: '', text, ...extra });

test('endsSentence は . ? ! と閉じ引用符を文末とし、言いさしは文末としない', () => {
  assert.equal(endsSentence('It works.'), true);
  assert.equal(endsSentence('Really?'), true);
  assert.equal(endsSentence('He said "stop."'), true);
  assert.equal(endsSentence('and then'), false);
  assert.equal(endsSentence('So...'), false);
  assert.equal(endsSentence('Well…'), false);
});

test('groupTranscript は "Hi." だけの行を次の文とつなぐ', () => {
  const groups = groupTranscript([
    L(10, 10.6, 'Hi.', { ja: 'こんにちは。' }),
    L(10.7, 15, "Today I'm going to show you how we built the new battery.", {
      ja: '今日は新しいバッテリーの作り方をお見せします。',
    }),
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0], {
    start: 10,
    end: 15,
    speaker: '',
    text: "Hi. Today I'm going to show you how we built the new battery.",
    ja: 'こんにちは。今日は新しいバッテリーの作り方をお見せします。',
  });
});

test('groupTranscript は文の途中では切らず、文末まで待つ', () => {
  const groups = groupTranscript([
    L(0, 4, 'We spent three long years testing every single cell'),
    L(4, 6, 'in the lab.'),
    L(6, 12, 'Then we finally shipped it to customers around the world.'),
  ]);
  assert.deepEqual(
    groups.map((g) => g.text),
    [
      'We spent three long years testing every single cell in the lab.',
      'Then we finally shipped it to customers around the world.',
    ],
  );
  for (const g of groups) assert.ok(endsSentence(g.text));
});

test('groupTranscript は十分な長さの文はそのまま1行にする', () => {
  const lines = [
    L(0, 6, 'This first sentence is already long enough to stand on its own.'),
    L(6, 12, 'And so is this second one, which also has plenty of words.'),
  ];
  assert.deepEqual(groupTranscript(lines), lines);
});

test('groupTranscript は文末が来なくても maxSeconds で切る', () => {
  const lines = Array.from({ length: 8 }, (_, i) => L(i * 5, i * 5 + 5, 'and then we kept going'));
  const groups = groupTranscript(lines, { maxSeconds: 20 });
  assert.equal(groups.length, 2);
  assert.equal(groups[0].end - groups[0].start, 20);
});

test('groupTranscript は最後の短い端切れを1つ前の行に足す', () => {
  const groups = groupTranscript([
    L(0, 6, 'This first sentence is already long enough to stand on its own.'),
    L(6, 7, 'Okay.'),
  ]);
  assert.equal(groups.length, 1);
  assert.match(groups[0].text, /own\. Okay\.$/);
});

test('groupTranscript は端切れを足すと長すぎるなら別の行に残す', () => {
  const groups = groupTranscript(
    [L(0, 18, 'This first sentence is already long enough to stand on its own.'), L(18, 22, 'Okay.')],
    { maxSeconds: 20 },
  );
  assert.deepEqual(
    groups.map((g) => g.text),
    ['This first sentence is already long enough to stand on its own.', 'Okay.'],
  );
});

test('groupTranscript は空の話者を別人として扱わない', () => {
  const [g] = groupTranscript([
    L(0, 1, 'Hi.', { speaker: 'Host' }),
    L(1, 8, "Today we're unveiling something truly remarkable for everyone."),
  ]);
  assert.equal(g.speaker, 'Host');
  assert.equal(g.text, "Hi. Today we're unveiling something truly remarkable for everyone.");
});

test('groupTranscript は話者が替わるとき話者名を本文に残す', () => {
  const [g] = groupTranscript([
    L(0, 1, 'Hi.', { speaker: 'A' }),
    L(1, 2, 'Hello.', { speaker: 'B' }),
    L(2, 8, 'Shall we start the meeting with the quarterly numbers?', { speaker: 'A' }),
  ]);
  assert.equal(g.speaker, '');
  assert.equal(g.text, 'A: Hi. B: Hello. A: Shall we start the meeting with the quarterly numbers?');
});

test('buildVideoPrompt は短い挨拶を単独の行にしないよう頼む', () => {
  const prompt = buildVideoPrompt({ start: 0, end: 60 });
  assert.match(prompt, /文末 \(ピリオド・\?・!\) で終わる/);
  assert.match(prompt, /"Hi\."/);
});

test('makeTimeMap は印が無ければ時刻を変えない', () => {
  const f = makeTimeMap([]);
  assert.equal(f(123.4), 123.4);
});

test('makeTimeMap は印1つなら全体を同じだけずらす', () => {
  const f = makeTimeMap([{ at: 100, to: 103 }]);
  assert.equal(f(90), 93);
  assert.equal(f(150), 153);
});

test('makeTimeMap は2つの印の間を直線で直し、外側は端の印と同じだけずらす', () => {
  // 先頭は合っているが、後ろほど遅れていく (100秒で20秒ずれる) ケース
  const f = makeTimeMap([
    { at: 100, to: 100 },
    { at: 200, to: 220 },
  ]);
  assert.equal(f(90), 90);
  assert.equal(f(150), 160);
  assert.equal(f(200), 220);
  assert.equal(f(250), 270);
});

test('applyAnchors は start/end を直し、元の時刻を at に残す', () => {
  const lines = [L(100, 105, 'a.'), L(150, 155, 'b.')];
  const fixed = applyAnchors(lines, [
    { at: 100, to: 100 },
    { at: 200, to: 220 },
  ]);
  assert.deepEqual(
    fixed.map(({ at, start, end }) => ({ at, start, end })),
    [
      { at: 100, start: 100, end: 106 },
      { at: 150, start: 160, end: 166 },
    ],
  );
  // 印が無ければ時刻はそのまま
  assert.equal(applyAnchors(lines)[1].start, 150);
});

test('setAnchor は同じ行の印を置き換え、順序の食い違う古い印を外す', () => {
  let anchors = setAnchor([], 100, 101);
  anchors = setAnchor(anchors, 200, 215);
  assert.deepEqual(anchors, [
    { at: 100, to: 101 },
    { at: 200, to: 215 },
  ]);
  // 同じ行を押し直したら置き換え
  anchors = setAnchor(anchors, 200, 218);
  assert.deepEqual(anchors.at(-1), { at: 200, to: 218 });
  assert.equal(anchors.length, 2);
  // 後ろの行 (200) より遅い時刻を前の行 (150) に付けたら、食い違う 200 の印を外す
  anchors = setAnchor(anchors, 150, 230);
  assert.deepEqual(anchors, [
    { at: 100, to: 101 },
    { at: 150, to: 230 },
  ]);
});

test('buildVideoPrompt は時刻を音声に合わせるよう頼む', () => {
  assert.match(buildVideoPrompt({ start: 0, end: 60 }), /最初の単語が実際に聞こえ始める時刻/);
});

test('effectiveAnchors は印1つなら先頭の行から比例させる', () => {
  assert.deepEqual(effectiveAnchors([{ at: 120, to: 130 }], 80), [
    { at: 80, to: 80 },
    { at: 120, to: 130 },
  ]);
  // 先頭の行そのものに付けた印は、全体を同じだけずらす (従来どおり)
  assert.deepEqual(effectiveAnchors([{ at: 80, to: 83 }], 80), [{ at: 80, to: 83 }]);
  // 2つ以上ならそのまま
  const two = [
    { at: 80, to: 81 },
    { at: 120, to: 130 },
  ];
  assert.equal(effectiveAnchors(two, 80), two);
  // 1か所押すだけで、間の行も比例して直る
  const lines = [L(80, 85, 'a.'), L(100, 105, 'b.'), L(120, 125, 'c.')];
  const fixed = applyAnchors(lines, effectiveAnchors([{ at: 120, to: 128 }], 80));
  assert.deepEqual(
    fixed.map((l) => l.start),
    [80, 104, 128],
  );
});

test('fitAnchors は最後の文が区間の終わりで終わるよう全体を伸縮させる', () => {
  // 実際の音声は生成時刻の1.2倍のペース: 最後の行 (生成 120〜127.5) は実際には 137 で終わる
  const lines = [L(80, 85.5, 'a.'), L(100, 105.5, 'b.'), L(120, 127.5, 'c.')];
  const anchors = fitAnchors(lines, 137);
  assert.deepEqual(anchors, [
    { at: 80, to: 80 },
    { at: 127.5, to: 137 },
  ]);
  assert.deepEqual(
    applyAnchors(lines, anchors).map((l) => [l.start, l.end]),
    [
      [80, 86.6],
      [104, 110.6],
      [128, 137],
    ],
  );
});

test('fitAnchors は字幕が空・区間がおかしいときは何もしない', () => {
  assert.deepEqual(fitAnchors([], 100), []);
  assert.deepEqual(fitAnchors([L(80, 85, 'a.')], 70), []);
});

test('splitRange は約1分ずつに分け、短い端切れは1つ前に足す', () => {
  assert.deepEqual(splitRange(80, 260, 60), [
    [80, 140],
    [140, 200],
    [200, 260],
  ]);
  // 最後が 20 秒 (半分未満) なら前に足す
  assert.deepEqual(splitRange(80, 220, 60), [
    [80, 140],
    [140, 220],
  ]);
  // 1分以内ならそのまま1つ
  assert.deepEqual(splitRange(0, 50, 60), [[0, 50]]);
});

test('mergeParts は境目で重なった行を、時刻か文章の一致で1つにする', () => {
  const a = [
    L(80, 100, 'We started this project three years ago.'),
    L(130, 142, 'It took us dozens of failed attempts to get there.'),
  ];
  const b = [
    // 時刻はずれているが、同じ文を次の区間も書いている
    L(145, 150, 'dozens of failed attempts to get there.'),
    L(150, 158, 'Today we are finally ready to show you.'),
  ];
  assert.deepEqual(
    mergeParts([a, b]).map((l) => l.text),
    [
      'We started this project three years ago.',
      'It took us dozens of failed attempts to get there.',
      'Today we are finally ready to show you.',
    ],
  );
});

test('mergeParts は短い文の偶然の一致では捨てない', () => {
  const merged = mergeParts([[L(0, 10, 'Yes.')], [L(60, 61, 'Yes.'), L(61, 65, 'Right.')]]);
  assert.equal(merged.length, 3);
});

test('buildVideoPrompt は分けた区間の境目の扱いを伝える', () => {
  const middle = buildVideoPrompt({ start: 140, end: 200, part: { index: 1, count: 3 } });
  assert.match(middle, /2 \/ 3 番目/);
  assert.match(middle, /途中の文は含めない/);
  assert.match(middle, new RegExp(`最大${PART_OVERRUN}秒はみ出してよい`));
  const last = buildVideoPrompt({ start: 200, end: 260, part: { index: 2, count: 3 } });
  assert.doesNotMatch(last, /はみ出してよい/);
  assert.doesNotMatch(buildVideoPrompt({ start: 0, end: 50 }), /区間の境目/);
});

test('validateVideoSet は endSlack の分だけ区間の終わりのはみ出しを許す', () => {
  const set = { title: 't', transcript: [L(190, 210, 'a.', { ja: 'あ' })] };
  assert.notDeepEqual(validateVideoSet(set, { start: 140, end: 200 }), []);
  assert.deepEqual(validateVideoSet(set, { start: 140, end: 200, endSlack: PART_OVERRUN }), []);
});

test('currentLineIndex は再生位置の行を返し、行の間では直前の行のまま', () => {
  const lines = [L(80, 85, 'a.'), L(90, 95, 'b.'), L(100, 105, 'c.')];
  assert.equal(currentLineIndex(lines, 70), -1);
  assert.equal(currentLineIndex(lines, 80), 0);
  assert.equal(currentLineIndex(lines, 87), 0);
  assert.equal(currentLineIndex(lines, 92), 1);
  assert.equal(currentLineIndex(lines, 200), 2);
});
