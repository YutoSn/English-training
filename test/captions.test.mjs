import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCaptionPrompt,
  buildCaptionRequest,
  captionSchema,
  cuesInRange,
  cuesToExtend,
  MASK,
  parseCaptions,
  splitCues,
  toTranscript,
  validateCaptionSet,
} from '../web/captions.js';

// YouTube の自動生成字幕 (VTT) の実際の形: 前の行 + 新しい行の2行が流れ、10ミリ秒の
// 重複行が挟まり、字幕行の中に空白だけの行がある。
const YOUTUBE_VTT = `WEBVTT
Kind: captions
Language: en

00:00:00.160 --> 00:00:02.510 align:start position:0%

so<00:00:00.320><c> today</c><00:00:00.640><c> we're</c><00:00:00.960><c> going</c>

00:00:02.510 --> 00:00:02.520 align:start position:0%
so today we're going


00:00:02.520 --> 00:00:05.110 align:start position:0%
so today we're going
to<00:00:02.800><c> talk</c><00:00:03.040><c> about</c><00:00:03.360><c> Halloween</c>

00:00:05.110 --> 00:00:05.120 align:start position:0%
to talk about Halloween


00:00:05.120 --> 00:00:07.990 align:start position:0%
to talk about Halloween
or<00:00:05.440><c> something</c><00:00:05.760><c> like</c><00:00:06.000><c> that</c>
`;

test('YouTube の自動生成 VTT は、流れる重複行を除いて新しく出た部分だけにする', () => {
  assert.deepEqual(parseCaptions(YOUTUBE_VTT), [
    { start: 0.16, end: 2.51, text: "so today we're going" },
    { start: 2.52, end: 5.11, text: 'to talk about Halloween' },
    { start: 5.12, end: 7.99, text: 'or something like that' },
  ]);
});

test('字幕行の中の空白だけの行が残っている VTT も同じように読む', () => {
  // YouTube から落とした元の形。上のテストは、空白が消えて空行になった形にあたる。
  const withSpaces = YOUTUBE_VTT.replace(/position:0%\n\n/g, 'position:0%\n \n');
  assert.notEqual(withSpaces, YOUTUBE_VTT);
  assert.deepEqual(parseCaptions(withSpaces), parseCaptions(YOUTUBE_VTT));
});

test('SRT は番号・タグ・文字参照を取り除いて読む', () => {
  const srt = `1
00:00:00,160 --> 00:00:02,510
so today we&#39;re going

2
00:01:02,520 --> 00:01:05,110
<i>to talk about</i> Halloween &amp; costumes
`;
  assert.deepEqual(parseCaptions(srt), [
    { start: 0.16, end: 2.51, text: "so today we're going" },
    { start: 62.52, end: 65.11, text: 'to talk about Halloween & costumes' },
  ]);
});

test('CRLF の SRT も読める', () => {
  const srt = [
    '1',
    '00:00:01,000 --> 00:00:02,000',
    'hello',
    '',
    '2',
    '00:00:02,000 --> 00:00:03,000',
    'world',
    '',
  ].join('\r\n');
  assert.deepEqual(
    parseCaptions(srt).map((c) => c.text),
    ['hello', 'world'],
  );
});

test('文字起こしのコピー (時刻の行 + 文の行) を読み、終わりは次の行の始まりにする', () => {
  const copy = `0:00
so today we're going
0:02
to talk about Halloween
2 分 3 秒
1:05
or something like that`;
  const cues = parseCaptions(copy);
  assert.deepEqual(
    cues.map((c) => [c.start, c.text]),
    [
      [0, "so today we're going"],
      [2, 'to talk about Halloween'],
      [65, 'or something like that'],
    ],
  );
  assert.equal(cues[0].end, 2);
  assert.equal(cues[1].end, 65);
  assert.ok(cues[2].end > 65, '最後の行の終わりは語数から見積もる');
});

test('文字起こしのコピー (同じ行に時刻と文) と、1時間を超える時刻を読む', () => {
  const cues = parseCaptions(`0:00 so today we're going
1:02:05 or something like that`);
  assert.deepEqual(
    cues.map((c) => [c.start, c.text]),
    [
      [0, "so today we're going"],
      [3725, 'or something like that'],
    ],
  );
});

test('読めない文章は空を返す', () => {
  assert.deepEqual(parseCaptions('hello world'), []);
  assert.deepEqual(parseCaptions(''), []);
});

const cue = (start, text) => ({ start, end: start + 2, text });

test('cuesInRange は区間に始まる行だけを残し、指定が無ければ全部', () => {
  const cues = [cue(0, 'a'), cue(10, 'b'), cue(20, 'c')];
  assert.deepEqual(
    cuesInRange(cues, 5, 20).map((c) => c.text),
    ['b'],
  );
  assert.equal(cuesInRange(cues, null, null).length, 3);
  assert.deepEqual(
    cuesInRange(cues, 10, null).map((c) => c.text),
    ['b', 'c'],
  );
});

test('splitCues は決まった数ずつ分け、短い端切れは1つ前に足す', () => {
  const cues = Array.from({ length: 250 }, (_, i) => cue(i, `w${i}`));
  assert.deepEqual(
    splitCues(cues, 120).map((p) => p.length),
    [120, 130],
  );
  assert.deepEqual(
    splitCues(cues.slice(0, 200), 120).map((p) => p.length),
    [120, 80],
  );
});

test('buildCaptionPrompt は字幕行に 0 から番号を振り、全行を1回ずつ使うよう頼む', () => {
  const prompt = buildCaptionPrompt({ cues: [cue(0, 'so today'), cue(2, 'we are going')] });
  assert.match(prompt, /\[0\] so today\n\[1\] we are going$/);
  assert.match(prompt, /0 番から 1 番まで/);
  assert.doesNotMatch(prompt, /前回/);
  const retry = buildCaptionPrompt({
    cues: [cue(0, 'a')],
    feedback: ['最後の to は 0 のはず'],
    part: {},
  });
  assert.match(retry, /分けたうちの一部/);
  assert.match(retry, /前回の出力の問題点[\s\S]*最後の to/);
});

test('captionSchema の required は properties と一致し、時刻は持たない', () => {
  const item = captionSchema.properties.sentences.items;
  assert.deepEqual(item.required, Object.keys(item.properties));
  assert.deepEqual(Object.keys(item.properties), ['from', 'to', 'text', 'ja']);
});

const sentences = [
  { from: 0, to: 1, text: "So today we're going to talk about Halloween.", ja: '今日はハロウィンの話です。' },
  { from: 2, to: 2, text: 'Or something like that.', ja: 'そんな感じです。' },
];

test('validateCaptionSet は全行を順番に1回ずつ使っていれば通す', () => {
  assert.deepEqual(validateCaptionSet({ title: 't', sentences }, 3), []);
});

test('validateCaptionSet は行の飛ばし・重なり・最後まで使っていないことを弾く', () => {
  const skipped = validateCaptionSet(
    { title: 't', sentences: [{ ...sentences[0] }, { ...sentences[1], from: 3, to: 3 }] },
    4,
  ).join('\n');
  assert.match(skipped, /from は 2 のはずが 3/);

  const short = validateCaptionSet({ title: 't', sentences: [sentences[0]] }, 3).join('\n');
  assert.match(short, /最後の to は 2 のはずが 1/);

  const reversed = validateCaptionSet(
    { title: 't', sentences: [{ ...sentences[0], from: 1, to: 0 }] },
    2,
  ).join('\n');
  assert.match(reversed, /from\/to が不正/);

  const empty = validateCaptionSet({ title: '', sentences: [] }, 1).join('\n');
  assert.match(empty, /title[\s\S]*sentences/);
});

test('validateCaptionSet は複数の文をまとめすぎた行を弾くが、checkLength: false なら通す', () => {
  const bundled = {
    title: 't',
    sentences: [
      {
        from: 0,
        to: 2,
        text:
          "So today we're going to start the show. We talk about Halloween costumes. " +
          'Or something like that, I guess, every single year.',
        ja: 'あ',
      },
    ],
  };
  assert.match(validateCaptionSet(bundled, 3).join('\n'), /3文をまとめています/);
  assert.deepEqual(validateCaptionSet(bundled, 3, { checkLength: false }), []);
});

test('buildCaptionPrompt は原則1文ずつ区切るよう頼む', () => {
  const prompt = buildCaptionPrompt({ cues: [cue(0, 'a')] });
  assert.match(prompt, /原則1文ずつ/);
  assert.match(prompt, /2文以上を1つのまとまりにしない/);
});

test('toTranscript は字幕行の時刻から文の始まりと終わりを付ける', () => {
  const cues = parseCaptions(YOUTUBE_VTT);
  assert.deepEqual(toTranscript(cues, sentences), [
    {
      start: 0.16,
      end: 5.11,
      speaker: '',
      text: "So today we're going to talk about Halloween.",
      ja: '今日はハロウィンの話です。',
    },
    { start: 5.12, end: 7.99, speaker: '', text: 'Or something like that.', ja: 'そんな感じです。' },
  ]);
});

test('buildCaptionRequest は動画を付けない (GAS の文章だけの依頼)', () => {
  const req = buildCaptionRequest({ token: 't', prompt: 'p', model: 'm' });
  assert.equal(req.videoUrl, undefined);
  assert.equal(req.schema, captionSchema);
});

test('cuesToExtend は訳し済みの範囲を除いて、足りない前後の字幕行だけを返す', () => {
  const all = Array.from({ length: 10 }, (_, i) => ({
    start: 60 + i * 5,
    end: 65 + i * 5,
    text: `c${i}`,
  }));
  // 訳し済み: c3〜c5 (75〜90秒)
  const transcript = [
    { start: 75, end: 85, text: 'a', ja: 'あ' },
    { start: 85, end: 90, text: 'b', ja: 'い' },
  ];
  const { before, after } = cuesToExtend(all, transcript, 60, 100);
  assert.deepEqual(
    before.map((c) => c.text),
    ['c0', 'c1', 'c2'],
  );
  assert.deepEqual(
    after.map((c) => c.text),
    ['c6', 'c7'],
  );
  // 後ろだけ広げる
  const onlyAfter = cuesToExtend(all, transcript, 75, 95);
  assert.deepEqual(onlyAfter.before, []);
  assert.deepEqual(
    onlyAfter.after.map((c) => c.text),
    ['c6'],
  );
  // 訳し済みの内側なら何も無い
  const inside = cuesToExtend(all, transcript, 76, 89);
  assert.deepEqual([inside.before, inside.after], [[], []]);
});

test('伏せ字 [ __ ] は読み取りで消さずに残す (Gemini が補う)', () => {
  const cues = parseCaptions('1\n00:00:01,000 --> 00:00:03,000\nthat was [ __ ] good\n');
  assert.equal(cues[0].text, `that was ${MASK} good`);
});

test('buildCaptionPrompt は伏せ字を効果音と区別し、推測して [[ ]] で囲むよう頼む', () => {
  const prompt = buildCaptionPrompt({ cues: [cue(0, `that was ${MASK} good`)] });
  assert.match(prompt, /YouTube が汚い言葉などを伏せた印/);
  assert.match(prompt, /\[\[ \]\] で囲む/);
});

test('validateCaptionSet は伏せ字が残っていれば作り直させるが、最後の試行では受け入れる', () => {
  const set = {
    title: 't',
    sentences: [{ from: 0, to: 0, text: `That was ${MASK} good.`, ja: 'あ' }],
  };
  assert.match(validateCaptionSet(set, 1).join('\n'), /\[ __ \] が残っています/);
  assert.deepEqual(validateCaptionSet(set, 1, { checkLength: false }), []);
  const filled = {
    title: 't',
    sentences: [{ from: 0, to: 0, text: 'That was [[damn]] good.', ja: 'あ' }],
  };
  assert.deepEqual(validateCaptionSet(filled, 1), []);
});
