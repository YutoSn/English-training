/**
 * YouTube 教材 (動画タブ) の純粋ロジック。DOM も browser API も触らない —
 * test/video.test.mjs が Node からそのまま import する。
 *
 * 生成の流れ: アプリ → GAS ウェブアプリ (gas/Code.gs) → Gemini。
 * GAS は「合言葉を確かめて Gemini に中継するだけ」にしてあり、プロンプトと
 * responseSchema と検証はすべてここに置く。GAS の再デプロイは手作業なので、
 * 教材の作り方を変えるたびに GAS を触らずに済むようにするため。
 */
export const VIDEO_DEFAULTS = {
  model: 'gemini-flash-latest',
  // 長い区間は Gemini の処理が GAS の実行時間内に収まらなくなる。
  maxSeconds: 300,
  attempts: 2,
  // 長い区間はこの長さずつに分けて字幕を作る (splitRange)。Gemini の時刻は後ろほど
  // ずれていくので、短く区切って区間ごとに数え直させ、ずれが溜まらないようにする。
  chunkSeconds: 60,
  // 字幕1行 (= ▶ で再生する単位) の大きさ。groupTranscript が短い行をこの大きさまでつなぐ。
  segment: { minWords: 12, minSeconds: 5, maxSeconds: 30 },
};

export function videoConfig(config) {
  return { ...VIDEO_DEFAULTS, ...(config?.video ?? {}) };
}

import { normalize, tokenize } from './diff.js';

/* ---------- URL と時刻 ---------- */

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

/** 1:20 / 01:02:03 / 80 / 80s / 1m20s / 1h2m3s → 秒。読めなければ null。 */
export function parseTime(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^\d+(:\d{1,2}){1,2}$/.test(s)) {
    const parts = s.split(':').map(Number);
    if (parts.slice(1).some((n) => n >= 60)) return null;
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  }
  const m = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (m && (m[1] || m[2] || m[3])) {
    return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  }
  return null;
}

export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/**
 * 共有リンク・watch・shorts・embed・live のどれからでも動画 id を取り出す。
 * `t=` が付いていれば開始位置の候補として返す。
 */
export function parseYouTubeUrl(input) {
  let url;
  try {
    url = new URL(String(input ?? '').trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  let id = null;
  if (host === 'youtu.be') {
    id = url.pathname.slice(1).split('/')[0];
  } else if (HOSTS.has(host)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else id = url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1] ?? null;
  }
  if (!id || !ID_RE.test(id)) return null;
  const t = url.searchParams.get('t') ?? url.searchParams.get('start');
  return { id, start: t === null ? null : parseTime(t) };
}

export function watchUrl(id) {
  return `https://www.youtube.com/watch?v=${id}`;
}

/**
 * 区間の入力チェック。問題があれば日本語のメッセージ、無ければ null。
 * minSeconds は字幕を作るときの下限。作成済みの字幕の中で再生区間を狭めるだけなら
 * 1文だけのくり返しもしたいので、呼び出し側が小さくする。
 */
export function checkRange(start, end, maxSeconds = VIDEO_DEFAULTS.maxSeconds, minSeconds = 10) {
  if (start === null || end === null || Number.isNaN(start) || Number.isNaN(end)) {
    return '開始と終了の時刻を 1:20 のような形で入れてください';
  }
  if (start < 0) return '開始時刻が負になっています';
  if (end <= start) return '終了は開始より後にしてください';
  if (end - start < minSeconds) return `区間は${minSeconds}秒以上にしてください`;
  if (end - start > maxSeconds) return `区間は${formatTime(maxSeconds)}以内にしてください`;
  return null;
}

/* ---------- 長い区間の分割 ---------- */

/** 分けた区間の終わりで文の途中だったとき、その文を言い切るまで許すはみ出し (秒)。 */
export const PART_OVERRUN = 15;

/**
 * [start, end] を chunkSeconds 前後の区間に分ける。最後に短い端切れ (半分未満) が
 * 残るときは1つ前の区間に足す (短すぎる依頼は文の途中で切れやすく、無駄が多い)。
 */
export function splitRange(start, end, chunkSeconds = VIDEO_DEFAULTS.chunkSeconds) {
  const parts = [];
  for (let s = start; s < end; s += chunkSeconds) parts.push([s, Math.min(end, s + chunkSeconds)]);
  if (parts.length > 1 && parts.at(-1)[1] - parts.at(-1)[0] < chunkSeconds / 2) {
    const [, lastEnd] = parts.pop();
    parts.at(-1)[1] = lastEnd;
  }
  return parts;
}

const textKey = (text) => tokenize(text).map(normalize).filter(Boolean).join(' ');

/**
 * 分けて作った字幕をつなぐ。境目の文を、前の区間 (言い切るまで書いてよい) と次の区間の
 * 両方が書いていることがある。次の区間の先頭の行のうち、前の区間の最後より前に始まる行と、
 * 前の区間の最後の数行と同じ文 (片方がもう片方を含む) は捨てる。時刻はずれていることが
 * あるので、文章の一致でも見る。短い文 ("Yes." など) は偶然一致するので文章では比べない。
 */
export function mergeParts(parts) {
  const merged = [];
  for (const lines of parts) {
    const lastEnd = merged.at(-1)?.end ?? -Infinity;
    const tail = merged.slice(-3).map((l) => textKey(l.text));
    const duplicate = (line) => {
      if (line.start < lastEnd - 1) return true;
      const key = textKey(line.text);
      return key.length >= 15 && tail.some((t) => t.includes(key) || key.includes(t));
    };
    let i = 0;
    while (i < lines.length && duplicate(lines[i])) i++;
    merged.push(...lines.slice(i));
  }
  return merged;
}

/* ---------- 生成プロンプトと responseSchema ---------- */

/**
 * @param {object} o
 * @param {number} o.start  動画内の秒
 * @param {number} o.end
 * @param {string[]} [o.feedback]  前回の検証エラー (再生成時に添える)
 * @param {{ index: number, count: number }} [o.part]  長い区間を分けて作るときの何番目か
 */
export function buildVideoPrompt({ start, end, feedback = [], part }) {
  const range = `${formatTime(start)}〜${formatTime(end)} (${start}秒〜${end}秒)`;
  const lines = [
    'あなたは日本人英語学習者のための字幕作成者です。',
    `添付した YouTube 動画の **${range} の区間だけ** の英語字幕と日本語訳を JSON で作ってください。`,
    '区間の外で話されている内容は含めないでください。',
    '',
    '## transcript',
    '- 区間内で話されている英語を、聞こえたとおりに一字一句書き起こす。要約・言い換えはしない。',
    `- **区間の最後 (${formatTime(end)}) まで、すべての発話を漏らさず書き起こす。途中でやめない。**`,
    '- 1要素は、文末 (ピリオド・?・!) で終わる意味のまとまり (目安15〜40語、5〜20秒)。',
    '  "Hi." "Okay." のような短い挨拶・相づちは単独の要素にせず、次の文とつなげる。',
    '  文の途中で要素を切らない。',
    '- start は**その要素の最初の単語が実際に聞こえ始める時刻**、end は最後の単語を言い終えた時刻。',
    '  音声を聞いて合わせ、文の長さから見積もったり等間隔に割り振ったりしない。',
    '  区間の後半ほどずれやすいので、後半も一つずつ音声で確かめる。',
    `- start / end は**動画の先頭からの秒数** (区間の先頭からではない)。` +
      `${start}〜${end} の範囲に収め、時系列順に並べる。`,
    '- 話者が複数いて区別できるときは speaker に名前か "A" "B" を入れる。分からなければ空文字。',
    '- BGM だけ・無音の部分は含めない。',
    '- ja はその行の自然な日本語訳。直訳ではなく、話の流れが分かる訳にする。',
    '  前後の行に意味がまたがるときも、その行に対応する部分だけを訳す。',
    '',
    '## title',
    '- この区間の内容を表す日本語の短い見出し (30字以内)。',
  ];

  if (part && part.count > 1) {
    lines.push('', '## 区間の境目', `この区間は、長い動画を分けたうちの ${part.index + 1} / ${part.count} 番目です。`);
    if (part.index > 0) {
      lines.push('- 区間の始まりの時点ですでに話されている途中の文は含めない (前の区間で書き起こし済み)。');
    }
    if (part.index < part.count - 1) {
      lines.push(
        `- 区間の終わりで文の途中なら、その文の最後まで書き起こす (end が ${formatTime(end)} を` +
          `最大${PART_OVERRUN}秒はみ出してよい)。`,
      );
    }
  }

  if (feedback.length) {
    lines.push(
      '',
      '## 前回の出力の問題点',
      '前回の出力は次の理由で使えませんでした。直したうえで全体を出力し直してください。',
      ...feedback.map((f) => `- ${f}`),
    );
  }
  return lines.join('\n');
}

const str = (description) => ({ type: 'STRING', description });

export const videoSchema = {
  type: 'OBJECT',
  properties: {
    title: str('区間の内容を表す日本語の見出し'),
    transcript: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          start: { type: 'NUMBER', description: '動画先頭からの秒数' },
          end: { type: 'NUMBER', description: '動画先頭からの秒数' },
          speaker: str('話者名。不明なら空文字'),
          text: str('聞こえたとおりの英文'),
          ja: str('その行の自然な日本語訳'),
        },
        required: ['start', 'end', 'speaker', 'text', 'ja'],
        propertyOrdering: ['start', 'end', 'speaker', 'text', 'ja'],
      },
    },
  },
  required: ['title', 'transcript'],
  propertyOrdering: ['title', 'transcript'],
};

/* ---------- 検証 ---------- */

/**
 * 生成結果を検証する。エラーの文言はそのまま再生成プロンプトに添えるので、
 * モデルが直し方を読み取れる書き方にする。
 */
export function validateVideoSet(set, { start, end, endSlack = 3 }) {
  const errors = [];
  if (!set || typeof set !== 'object') return ['JSON オブジェクトではありません'];
  if (typeof set.title !== 'string' || !set.title.trim()) errors.push('title が空です');

  const lines = Array.isArray(set.transcript) ? set.transcript : [];
  if (lines.length === 0) errors.push('transcript が空です');
  // 端の発話は区間をまたぐことがあるので少しだけ許す。
  const slack = 3;
  lines.forEach((l, i) => {
    if (typeof l?.text !== 'string' || !l.text.trim()) errors.push(`transcript[${i}].text が空です`);
    if (typeof l?.ja !== 'string' || !l.ja.trim()) {
      errors.push(`transcript[${i}].ja (日本語訳) が空です`);
    }
    if (!Number.isFinite(l?.start) || !Number.isFinite(l?.end) || l.end < l.start) {
      errors.push(`transcript[${i}] の start/end が不正です`);
    } else if (l.start < start - slack || l.end > end + endSlack) {
      errors.push(
        `transcript[${i}] (${l.start}〜${l.end}秒) が指定区間 ${start}〜${end}秒の外です。` +
          '秒数は動画の先頭から数えてください',
      );
    }
    if (i > 0 && Number.isFinite(l?.start) && l.start < lines[i - 1].start) {
      errors.push(`transcript[${i}] が時系列順になっていません`);
    }
  });

  return errors;
}

/* ---------- 字幕の区切り ---------- */

const CLOSERS = /["'”’)\]]+$/;

/**
 * 文末で終わっているか。"..." や "…" は言いさしなので文末とみなさない。
 * 区切りは英文で判断する (日本語訳の句点は見ない)。
 */
export function endsSentence(text) {
  const t = String(text ?? '').trim().replace(CLOSERS, '');
  if (/(\.\.|…)$/.test(t)) return false;
  return /[.!?]$/.test(t);
}

const wordCount = (text) => String(text ?? '').trim().split(/\s+/).filter(Boolean).length;

/**
 * 短い行をつないで、ある程度の長さで文末に終わるまとまりにする。
 * "Hi." だけの行を ▶ で再生しても練習にならないため。
 *
 * 1つのまとまりは、minWords 語以上か minSeconds 秒以上になり、かつ文末で終わるところで
 * 切る。文末が来ないまま maxSeconds 秒を超えたら、そこで切る (句読点の無い書き起こし対策)。
 * 生成済みのデータを書き換えず表示時に通すので、古い保存データにもそのまま効く。
 */
export function groupTranscript(lines, options = {}) {
  const { minWords, minSeconds, maxSeconds } = { ...VIDEO_DEFAULTS.segment, ...options };
  const groups = [];
  let current = [];
  const bigEnough = (group) =>
    group.reduce((n, l) => n + wordCount(l.text), 0) >= minWords ||
    group.at(-1).end - group[0].start >= minSeconds;

  for (const line of lines) {
    current.push(line);
    const seconds = line.end - current[0].start;
    if ((bigEnough(current) && endsSentence(line.text)) || seconds >= maxSeconds) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) {
    // 最後に短い端切れが残ったら、長くなりすぎない限り1つ前のまとまりに足す。
    const prev = groups.at(-1);
    if (prev && !bigEnough(current) && current.at(-1).end - prev[0].start <= maxSeconds) {
      prev.push(...current);
    } else {
      groups.push(current);
    }
  }
  return groups.map(mergeLines);
}

function mergeLines(lines) {
  if (lines.length === 1) return lines[0];
  // 空の話者は「不明」であって別人ではない。名前の付いた話者が2人以上いるときだけ、
  // 行の頭に話者名を残して誰の発言か分かるようにする。
  const named = [...new Set(lines.map((l) => l.speaker ?? '').filter(Boolean))];
  const mixed = named.length > 1;
  const text = lines
    .map((l) => (mixed && l.speaker ? `${l.speaker}: ${l.text}` : l.text).trim())
    .join(' ');
  const jaParts = lines.map((l) => (l.ja ?? '').trim()).filter(Boolean);
  return {
    start: lines[0].start,
    end: lines.at(-1).end,
    speaker: mixed ? '' : (named[0] ?? ''),
    text,
    ...(jaParts.length ? { ja: jaParts.join('') } : {}),
  };
}

/* ---------- 字幕の表示 ---------- */

/**
 * 再生位置 t に当たる行の添字 (行は時刻順)。行と行の間 (間や音楽) では直前の行のまま、
 * 最初の行より前なら -1。
 */
export function currentLineIndex(lines, t) {
  let index = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].start <= t + 0.05) index = i;
    else break;
  }
  return index;
}

/** 字幕の表示モード。動画タブの切り替えボタンはこの順に並ぶ。 */
export const SUBTITLE_MODES = [
  { id: 'none', label: '字幕なし' },
  { id: 'en', label: '英文のみ' },
  { id: 'ja', label: '日本語訳あり' },
];

/**
 * 保存されていたモードを、その教材で使えるものに丸める。
 * 日本語訳を作る前に保存した教材には ja が無いので、'ja' は 'en' に落とす。
 */
export function resolveSubtitleMode(mode, transcript = []) {
  const hasJa = transcript.some((l) => typeof l?.ja === 'string' && l.ja.trim());
  if (mode === 'ja' && !hasJa) return 'en';
  return SUBTITLE_MODES.some((m) => m.id === mode) ? mode : 'en';
}

/* ---------- GAS との受け渡し ---------- */

/**
 * GAS に POST する本文。fetch では Content-Type を付けずに文字列で送る —
 * text/plain の「単純リクエスト」になり、GAS が答えられない CORS の
 * プリフライトが起きない。
 */
export function buildGasRequest({ token, videoId, start, end, prompt, model }) {
  return {
    token,
    model,
    videoUrl: watchUrl(videoId),
    start: Math.floor(start),
    end: Math.ceil(end),
    prompt,
    schema: videoSchema,
  };
}

export class GasError extends Error {
  constructor(message, { retriable = false } = {}) {
    super(message);
    this.name = 'GasError';
    this.retriable = retriable;
  }
}

/** GAS の応答 ({ ok, text } | { ok:false, error }) から生成結果を取り出す。 */
export function parseGasResponse(body) {
  if (!body || typeof body !== 'object') throw new GasError('GAS から想定外の応答が返りました');
  if (!body.ok) {
    throw new GasError(body.error || 'GAS でエラーが起きました', {
      retriable: Boolean(body.retriable),
    });
  }
  try {
    return JSON.parse(body.text);
  } catch {
    throw new GasError('Gemini の出力が JSON として読めませんでした', { retriable: true });
  }
}

/* ---------- 保存形式 ---------- */

/** 保存一覧に出す見出し。 */
export function videoLabel(entry) {
  const range = `${formatTime(entry.start)}〜${formatTime(entry.end)}`;
  return `${entry.set?.title ?? entry.videoId} (${range})`;
}
