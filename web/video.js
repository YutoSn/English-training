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

/* ---------- 生成プロンプトと responseSchema ---------- */

/**
 * @param {object} o
 * @param {number} o.start  動画内の秒
 * @param {number} o.end
 * @param {string[]} [o.feedback]  前回の検証エラー (再生成時に添える)
 */
export function buildVideoPrompt({ start, end, feedback = [] }) {
  const range = `${formatTime(start)}〜${formatTime(end)} (${start}秒〜${end}秒)`;
  const lines = [
    'あなたは日本人英語学習者のための字幕作成者です。',
    `添付した YouTube 動画の **${range} の区間だけ** の英語字幕と日本語訳を JSON で作ってください。`,
    '区間の外で話されている内容は含めないでください。',
    '',
    '## transcript',
    '- 区間内で話されている英語を、聞こえたとおりに一字一句書き起こす。要約・言い換えはしない。',
    '- 1要素は1文か、ひと息で話される句 (目安3〜12秒)。',
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
export function validateVideoSet(set, { start, end }) {
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
    } else if (l.start < start - slack || l.end > end + slack) {
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

/* ---------- 字幕の表示 ---------- */

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
