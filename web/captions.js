/**
 * 字幕ファイル / 文字起こしのコピーから字幕を作る。DOM も browser API も触らない —
 * test/captions.test.mjs が Node からそのまま import する。
 *
 * 時刻は字幕ファイルのものをそのまま使う。Gemini には「句読点を補って文に区切る」
 * 「日本語訳」だけを頼み、各文が何番目の字幕行から何番目までかを番号で答えさせる。
 * Gemini に時刻を書かせないので、動画から書き起こすときのようなずれが起きない。
 */

/* ---------- 読み取り ---------- */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function cleanText(text) {
  return text
    .replace(/<[^>]*>/g, '') // VTT の <c> や <00:00:01.234>、SRT の <i> など
    .replace(/&(#?\w+);/g, (m, name) =>
      name.startsWith('#') && name !== '#39'
        ? String.fromCodePoint(Number(name.slice(1)))
        : (ENTITIES[name] ?? m),
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/** 00:01:02,345 / 00:01:02.345 / 01:02.345 → 秒 */
function parseCueTime(text) {
  const m = text.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/);
  if (!m) return null;
  const [, h, min, sec, frac] = m;
  return Number(h ?? 0) * 3600 + Number(min) * 60 + Number(sec) + Number(`0.${frac ?? 0}`);
}

/** SRT / WebVTT。`-->` の行を持つブロックを1つの字幕行として読む。 */
function parseTimedBlocks(text) {
  const cues = [];
  // 時刻はあるのに文が無い字幕行。YouTube の VTT は字幕行の中に空白だけの行を含み、
  // ファイルによってはそれが空行になって、時刻と文が別々のブロックに割れる。
  // そのときは、続く「時刻の無いブロック」をこの字幕行の文として読む。
  let waiting = null;
  // 区切りは完全な空行だけ (空白だけの行では区切らない)。
  for (const block of text.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0) {
      // WEBVTT ヘッダ、NOTE、STYLE、番号だけの行など。割れた字幕行の文ならそれに付ける。
      const textLines = lines.map(cleanText).filter(Boolean);
      if (waiting && textLines.length && !/^(WEBVTT|NOTE|STYLE)\b/.test(lines[0])) {
        cues.push({ ...waiting, lines: textLines });
      }
      waiting = null;
      continue;
    }
    const [from, to] = lines[at].split('-->');
    const start = parseCueTime(from);
    const end = parseCueTime(to.trim().split(/\s+/)[0]); // VTT は後ろに位置指定が付く
    if (start === null || end === null) continue;
    const textLines = lines.slice(at + 1).map(cleanText).filter(Boolean);
    if (textLines.length) cues.push({ start, end, lines: textLines });
    waiting = textLines.length ? null : { start, end };
  }
  return dedupeRolling(cues);
}

/**
 * YouTube の自動生成字幕は「前の行 + 新しい行」の2行が流れていく形で、同じ文が何度も
 * 出てくる (10ミリ秒だけの重複行もある)。前の字幕行にあった行を取り除き、新しく
 * 出た部分だけを残す。
 */
function dedupeRolling(cues) {
  const out = [];
  let previous = [];
  for (const cue of cues) {
    const fresh = cue.lines.filter((l) => !previous.includes(l));
    previous = cue.lines;
    if (!fresh.length) continue;
    out.push({ start: cue.start, end: cue.end, text: fresh.join(' ') });
  }
  return out;
}

const STAMP = /^((?:\d{1,2}:)?\d{1,2}:\d{2})(?:\s+(.*))?$/;
// 読み上げ用に付いてくる「2 分 3 秒」「1 時間 2 分」のような行
const SPOKEN_TIME = /^(\d+\s*(時間|分|秒)\s*)+$|^(\d+\s*(hours?|minutes?|seconds?),?\s*)+$/i;

/**
 * YouTube の「文字起こしを表示」からコピーした文章。時刻の行 (0:12) のあとに文が続く形と、
 * 同じ行に「0:12 文」と並ぶ形の両方を読む。終わりの時刻は次の行の始まりにする。
 */
function parseTranscriptCopy(text) {
  const cues = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line || SPOKEN_TIME.test(line)) continue;
    const m = line.match(STAMP);
    if (m) {
      cues.push({ start: parseCueTime(m[1]), text: cleanText(m[2] ?? '') });
    } else if (cues.length) {
      const last = cues.at(-1);
      last.text = last.text ? `${last.text} ${cleanText(line)}` : cleanText(line);
    }
  }
  const kept = cues.filter((c) => c.text);
  return kept.map((c, i) => ({
    start: c.start,
    // 最後の行は終わりが分からないので、語数から見積もる (1語 0.4 秒、最低2秒)
    end: kept[i + 1]?.start ?? c.start + Math.max(2, c.text.split(' ').length * 0.4),
    text: c.text,
  }));
}

/**
 * 字幕の文章を読み取る。SRT / WebVTT / YouTube の文字起こしのコピーを見分ける。
 * @returns {{ start: number, end: number, text: string }[]} 時刻順の字幕行
 */
export function parseCaptions(text) {
  const source = String(text ?? '');
  const cues = source.includes('-->') ? parseTimedBlocks(source) : parseTranscriptCopy(source);
  return cues
    .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end))
    .sort((a, b) => a.start - b.start);
}

/** 区間 [start, end] に始まる字幕行だけを残す。区間を指定しないときは全部。 */
export function cuesInRange(cues, start, end) {
  return cues.filter(
    (c) => (start === null || c.start >= start - 0.5) && (end === null || c.start < end),
  );
}

/** 1回の依頼に渡す字幕行の数。多すぎると出力が長くなって途中で切れる。 */
export const CUES_PER_REQUEST = 120;

export function splitCues(cues, size = CUES_PER_REQUEST) {
  const parts = [];
  for (let i = 0; i < cues.length; i += size) parts.push(cues.slice(i, i + size));
  // 最後に短い端切れが残るときは1つ前に足す (文の途中で切れる箇所を減らす)
  if (parts.length > 1 && parts.at(-1).length < size / 3) parts.at(-2).push(...parts.pop());
  return parts;
}

/* ---------- Gemini への依頼 ---------- */

/**
 * @param {object} o
 * @param {{ text: string }[]} o.cues      この依頼で扱う字幕行 (0 から番号を振る)
 * @param {string[]} [o.feedback]          前回の検証エラー
 * @param {{ index: number, count: number }} [o.part]
 */
export function buildCaptionPrompt({ cues, feedback = [], part }) {
  const lines = [
    'あなたは日本人英語学習者のための字幕作成者です。',
    '下の英語字幕は動画の字幕ファイルから取り出したもので、番号付きの短い行に分かれています。',
    '自動生成の字幕のため、句読点がなく、文の途中で行が切れています。',
    'これを、読みやすい文に区切り直し、日本語訳を付けた JSON にしてください。',
    '',
    '## sentences',
    '- 字幕の行を先頭から順につないで、文末 (ピリオド・?・!) で終わる意味のまとまりに区切る' +
      ' (目安15〜40語)。',
    '  "Hi." "Okay." のような短い挨拶・相づちは単独にせず、次の文とつなげる。',
    '- from はそのまとまりの最初の行の番号、to は最後の行の番号。',
    `- **0 番から ${cues.length - 1} 番まで、すべての行をちょうど1回ずつ、順番どおりに使う。**` +
      '次のまとまりの from は、前のまとまりの to + 1。',
    '- 行の途中で文が終わっている場合は、その行をどちらか一方のまとまりに入れる (行は分けない)。',
    '- text は、その行たちの英語をつないだもの。句読点・大文字・アポストロフィを補ってよいが、' +
      '単語の言い換えや要約はしない。明らかな聞き間違いだけは直してよい。',
    '- 字幕に混ざった [Music] [Applause] などの効果音表記は text から除く。',
    '- ja は text の自然な日本語訳。直訳ではなく、話の流れが分かる訳にする。',
    '',
    '## title',
    '- 内容を表す日本語の短い見出し (30字以内)。',
  ];

  if (part && part.count > 1) {
    lines.push(
      '',
      `この字幕は、長い字幕を分けたうちの ${part.index + 1} / ${part.count} 番目です。` +
        '前後の部分とは別に、この部分の行だけで区切ってください。',
    );
  }

  if (feedback.length) {
    lines.push(
      '',
      '## 前回の出力の問題点',
      '前回の出力は次の理由で使えませんでした。直したうえで全体を出力し直してください。',
      ...feedback.map((f) => `- ${f}`),
    );
  }

  lines.push('', '## 字幕', ...cues.map((c, i) => `[${i}] ${c.text}`));
  return lines.join('\n');
}

const str = (description) => ({ type: 'STRING', description });

export const captionSchema = {
  type: 'OBJECT',
  properties: {
    title: str('内容を表す日本語の見出し'),
    sentences: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          from: { type: 'INTEGER', description: '最初の字幕行の番号' },
          to: { type: 'INTEGER', description: '最後の字幕行の番号' },
          text: str('句読点を補った英文'),
          ja: str('自然な日本語訳'),
        },
        required: ['from', 'to', 'text', 'ja'],
        propertyOrdering: ['from', 'to', 'text', 'ja'],
      },
    },
  },
  required: ['title', 'sentences'],
  propertyOrdering: ['title', 'sentences'],
};

/** 番号の使い方を確かめる。文言はそのまま再生成プロンプトに添える。 */
export function validateCaptionSet(set, count) {
  const errors = [];
  if (!set || typeof set !== 'object') return ['JSON オブジェクトではありません'];
  if (typeof set.title !== 'string' || !set.title.trim()) errors.push('title が空です');
  const sentences = Array.isArray(set.sentences) ? set.sentences : [];
  if (!sentences.length) return [...errors, 'sentences が空です'];

  let expected = 0;
  sentences.forEach((s, i) => {
    if (!Number.isInteger(s?.from) || !Number.isInteger(s?.to) || s.to < s.from) {
      errors.push(`sentences[${i}] の from/to が不正です`);
      return;
    }
    if (s.from !== expected) {
      errors.push(
        `sentences[${i}].from は ${expected} のはずが ${s.from} です。` +
          '行を飛ばしたり重ねたりせず、前の to + 1 から始めてください',
      );
    }
    expected = s.to + 1;
    if (typeof s.text !== 'string' || !s.text.trim()) errors.push(`sentences[${i}].text が空です`);
    if (typeof s.ja !== 'string' || !s.ja.trim()) errors.push(`sentences[${i}].ja が空です`);
  });
  if (expected !== count) {
    errors.push(`最後の to は ${count - 1} のはずが ${expected - 1} です。最後の行まで使ってください`);
  }
  return errors;
}

/** Gemini の区切りと字幕行の時刻から、動画タブの transcript を作る。 */
export function toTranscript(cues, sentences) {
  return sentences.map((s) => ({
    start: cues[s.from].start,
    end: cues[s.to].end,
    speaker: '',
    text: s.text.trim(),
    ja: s.ja.trim(),
  }));
}

/** GAS に送る本文 (文章だけの依頼。videoUrl を付けない)。 */
export function buildCaptionRequest({ token, prompt, model }) {
  return { token, model, prompt, schema: captionSchema };
}
