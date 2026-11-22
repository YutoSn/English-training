/**
 * YouTube 教材 (動画タブ) の純粋ロジック。DOM も browser API も触らない —
 * test/video.test.mjs が Node からそのまま import する。
 *
 * 生成の流れ: アプリ → GAS ウェブアプリ (gas/Code.gs) → Gemini。
 * GAS は「合言葉を確かめて Gemini に中継するだけ」にしてあり、プロンプトと
 * responseSchema と検証はすべてここに置く。GAS の再デプロイは手作業なので、
 * 教材の作り方を変えるたびに GAS を触らずに済むようにするため。
 */
import { normalize } from './diff.js';

export const VIDEO_DEFAULTS = {
  model: 'gemini-flash-latest',
  // 長い区間は Gemini の処理が GAS の実行時間内に収まらなくなる。
  maxSeconds: 300,
  blanks: 8,
  questions: 3,
  attempts: 2,
};

export function videoConfig(config) {
  return { ...VIDEO_DEFAULTS, ...(config?.video ?? {}) };
}

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

/** 区間の入力チェック。問題があれば日本語のメッセージ、無ければ null。 */
export function checkRange(start, end, maxSeconds = VIDEO_DEFAULTS.maxSeconds) {
  if (start === null || end === null || Number.isNaN(start) || Number.isNaN(end)) {
    return '開始と終了の時刻を 1:20 のような形で入れてください';
  }
  if (start < 0) return '開始時刻が負になっています';
  if (end <= start) return '終了は開始より後にしてください';
  if (end - start < 10) return '区間は10秒以上にしてください';
  if (end - start > maxSeconds) return `区間は${formatTime(maxSeconds)}以内にしてください`;
  return null;
}

/* ---------- 生成プロンプトと responseSchema ---------- */

/**
 * @param {object} o
 * @param {number} o.start  動画内の秒
 * @param {number} o.end
 * @param {object} o.level  levelProfile() の戻り値
 * @param {number} o.blanks
 * @param {number} o.questions
 * @param {string[]} [o.feedback]  前回の検証エラー (再生成時に添える)
 */
export function buildVideoPrompt({ start, end, level, blanks, questions, feedback = [] }) {
  const range = `${formatTime(start)}〜${formatTime(end)} (${start}秒〜${end}秒)`;
  const lines = [
    'あなたは日本人学習者向けの英語教材を作るプロの教材作成者です。',
    `添付した YouTube 動画の **${range} の区間だけ** を素材に、聞き取り教材を JSON で作ってください。`,
    '区間の外で話されている内容は使わないでください。',
    '',
    '## 学習者のレベル',
    `- TOEIC ${level.toeic} 相当 / CEFR ${level.cefr}`,
    `- 語彙の目安: ${level.vocabulary}`,
    '',
    '## transcript',
    '- 区間内で話されている英語を、聞こえたとおりに一字一句書き起こす。要約・言い換えはしない。',
    '- 1要素は1文か、ひと息で話される句 (目安3〜12秒)。',
    `- start / end は**動画の先頭からの秒数** (区間の先頭からではない)。${start}〜${end} の範囲に収め、時系列順に並べる。`,
    '- 話者が複数いて区別できるときは speaker に名前か "A" "B" を入れる。分からなければ空文字。',
    '- BGM だけ・無音の部分は含めない。',
    '- ja はその行の自然な日本語訳。直訳ではなく、話の流れが分かる訳にする。',
    '  前後の行に意味がまたがるときも、その行に対応する部分だけを訳す。',
    '',
    '## blanks (字幕の穴埋め)',
    `- ${blanks}個。transcript の語から、学習者のレベルで聞き取りにくい・覚える価値がある語を選ぶ。`,
    '- 冠詞・代名詞など機能語だけの穴は作らない。固有名詞も避ける。',
    '- line は transcript の添字 (0始まり)。word はその行の text に**そのまま含まれる1語**',
    '  (大文字小文字も含めて一致させ、句読点は含めない)。1行に穴は1つまで。',
    '- hint は日本語で、意味か聞き取りのコツ (連結・脱落など) を短く書く。答えの語そのものは書かない。',
    '',
    '## quiz (内容理解クイズ)',
    `- ${questions}問。区間の内容についての英語の設問と、英語の4択。`,
    '- 正解は本文の語句をそのまま使わず言い換える。',
    '- 不正解の選択肢には「部分的に正しい」「言い換えの罠 (本文の語を借りて意味をずらす)」「本文にない情報」を混ぜる。',
    '  3つとも動画と無関係な話で埋めない — 聞かずに消去法で解けてしまう。最低1つは動画で話された語句を含める。',
    '- answer は正解の添字 (0〜3)。問題ごとに散らす。',
    '- explanation は日本語。根拠となる発話を英語で引用する。',
    '- id は q1, q2, ... の連番。',
    '',
    '## title',
    '- この区間の内容を表す日本語の短い見出し (30字以内)。',
  ];

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
    blanks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          line: { type: 'INTEGER', description: 'transcript の添字 (0始まり)' },
          word: str('その行の text にそのまま含まれる1語'),
          hint: str('日本語のヒント'),
        },
        required: ['line', 'word', 'hint'],
        propertyOrdering: ['line', 'word', 'hint'],
      },
    },
    quiz: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: str('q1 のような連番'),
          prompt: str('英語の設問'),
          choices: { type: 'ARRAY', items: { type: 'STRING' }, minItems: 4, maxItems: 4 },
          answer: { type: 'INTEGER', description: '正解の添字 0〜3' },
          explanation: str('日本語の解説'),
        },
        required: ['id', 'prompt', 'choices', 'answer', 'explanation'],
        propertyOrdering: ['id', 'prompt', 'choices', 'answer', 'explanation'],
      },
    },
  },
  required: ['title', 'transcript', 'blanks', 'quiz'],
  propertyOrdering: ['title', 'transcript', 'blanks', 'quiz'],
};

/* ---------- 検証 ---------- */

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 行の中で `word` が単語として現れる位置。無ければ -1。 */
export function findWord(text, word) {
  if (!word) return -1;
  const re = new RegExp(`(?<![A-Za-z0-9'’])${escapeRe(word)}(?![A-Za-z0-9'’])`);
  return text.search(re);
}

/**
 * 生成結果を検証する。エラーの文言はそのまま再生成プロンプトに添えるので、
 * モデルが直し方を読み取れる書き方にする。
 */
export function validateVideoSet(set, { start, end, blanks, questions }) {
  const errors = [];
  if (!set || typeof set !== 'object') return ['JSON オブジェクトではありません'];
  if (typeof set.title !== 'string' || !set.title.trim()) errors.push('title が空です');

  const lines = Array.isArray(set.transcript) ? set.transcript : [];
  if (lines.length === 0) errors.push('transcript が空です');
  // 端の発話は区間をまたぐことがあるので少しだけ許す。
  const slack = 3;
  lines.forEach((l, i) => {
    if (typeof l?.text !== 'string' || !l.text.trim()) errors.push(`transcript[${i}].text が空です`);
    if (typeof l?.ja !== 'string' || !l.ja.trim()) errors.push(`transcript[${i}].ja (日本語訳) が空です`);
    if (!Number.isFinite(l?.start) || !Number.isFinite(l?.end) || l.end < l.start) {
      errors.push(`transcript[${i}] の start/end が不正です`);
    } else if (l.start < start - slack || l.end > end + slack) {
      errors.push(
        `transcript[${i}] (${l.start}〜${l.end}秒) が指定区間 ${start}〜${end}秒の外です。秒数は動画の先頭から数えてください`,
      );
    }
    if (i > 0 && Number.isFinite(l?.start) && l.start < lines[i - 1].start) {
      errors.push(`transcript[${i}] が時系列順になっていません`);
    }
  });

  const blankList = Array.isArray(set.blanks) ? set.blanks : [];
  if (blankList.length < Math.min(blanks, lines.length)) {
    errors.push(`blanks が ${blankList.length} 個しかありません (${blanks} 個必要)`);
  }
  const usedLines = new Set();
  blankList.forEach((b, i) => {
    const line = lines[b?.line];
    if (!Number.isInteger(b?.line) || !line) {
      return errors.push(`blanks[${i}].line=${b?.line} は transcript の範囲外です`);
    }
    if (usedLines.has(b.line)) errors.push(`blanks[${i}]: transcript[${b.line}] に穴が2つあります`);
    usedLines.add(b.line);
    if (typeof b.word !== 'string' || /\s/.test(b.word.trim()) || !b.word.trim()) {
      errors.push(`blanks[${i}].word は1語にしてください`);
    } else if (findWord(line.text, b.word) < 0) {
      errors.push(`blanks[${i}].word "${b.word}" が transcript[${b.line}].text に含まれていません`);
    }
    if (typeof b.hint !== 'string' || !b.hint.trim()) errors.push(`blanks[${i}].hint が空です`);
  });

  const quiz = Array.isArray(set.quiz) ? set.quiz : [];
  if (quiz.length !== questions) errors.push(`quiz は ${questions} 問必要です (${quiz.length} 問)`);
  const ids = new Set();
  quiz.forEach((q, i) => {
    if (ids.has(q?.id)) errors.push(`quiz[${i}].id "${q?.id}" が重複しています`);
    ids.add(q?.id);
    if (!Array.isArray(q?.choices) || q.choices.length !== 4) {
      errors.push(`quiz[${i}].choices は4つ必要です`);
    } else if (new Set(q.choices.map((c) => String(c).trim().toLowerCase())).size !== 4) {
      errors.push(`quiz[${i}].choices に同じ選択肢があります`);
    }
    if (!Number.isInteger(q?.answer) || q.answer < 0 || q.answer > 3) {
      errors.push(`quiz[${i}].answer は 0〜3 の整数にしてください`);
    }
    if (typeof q?.prompt !== 'string' || !q.prompt.trim()) errors.push(`quiz[${i}].prompt が空です`);
    if (typeof q?.explanation !== 'string' || !q.explanation.trim()) {
      errors.push(`quiz[${i}].explanation が空です`);
    }
  });

  return errors;
}

/* ---------- 穴埋め ---------- */

/**
 * 行を「地の文」と「穴」に分ける。穴は blank の添字 (= 解答の key) を持つ。
 * @returns {{ type: 'text', value: string } | { type: 'blank', index: number, answer: string }}[]
 */
export function clozeTokens(text, blankList, lineIndex) {
  const hits = blankList
    .map((b, index) => ({ ...b, index }))
    .filter((b) => b.line === lineIndex)
    .map((b) => ({ ...b, at: findWord(text, b.word) }))
    .filter((b) => b.at >= 0)
    .sort((a, b) => a.at - b.at);

  const tokens = [];
  let pos = 0;
  for (const b of hits) {
    if (b.at < pos) continue;
    if (b.at > pos) tokens.push({ type: 'text', value: text.slice(pos, b.at) });
    tokens.push({ type: 'blank', index: b.index, answer: b.word });
    pos = b.at + b.word.length;
  }
  if (pos < text.length) tokens.push({ type: 'text', value: text.slice(pos) });
  return tokens;
}

/** 穴の答え合わせ。ディクテーションと同じく大文字小文字・句読点は見ない。 */
export function checkBlank(expected, typed) {
  const want = normalize(expected);
  return want !== '' && want === normalize(String(typed ?? '').trim());
}

export function scoreBlanks(blankList, typed) {
  const correct = blankList.filter((b, i) => checkBlank(b.word, typed[i])).length;
  return { correct, total: blankList.length };
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
