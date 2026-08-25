/**
 * 設定変更 (レベル / テーマ追加) の受け渡し形式。
 *
 * サイトは静的配信で、問題を作るのは Actions 側。ブラウザの localStorage は
 * Actions から読めないので、変更は Issue 本文に埋めた JSON として渡し、
 * settings.yml が data/config.json と data/topics.json に書き戻す。
 *
 * このファイルは DOM も Node API も触らない — ブラウザと scripts/ の両方から
 * import される「形式そのもの」の定義。
 */

/** 本文に埋め込む JSON の目印。<!-- date: --> と同じ手口。 */
const OPEN = '<!-- settings';
const CLOSE = '-->';

export const TOEIC_MIN = 350;
export const TOEIC_MAX = 990;

export function clampToeic(value) {
  // null / '' / undefined は「変更なし」。Number(null) が 0 になるため、
  // ここで弾かないと下書きの「変更なし」が最低スコアとして送信されてしまう。
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    return null;
  }
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.min(TOEIC_MAX, Math.max(TOEIC_MIN, n));
}

/** テーマの同一判定キー。英語フレーズが id の素になるので、そこで揃える。 */
export function topicKey(topic) {
  return String(topic?.en ?? '')
    .toLowerCase()
    .trim();
}

/**
 * 入力を payload の 1 件に整える。en は任意 — 空なら Actions 側で Gemini が
 * 自然な英語フレーズに訳す (スマホで毎回英語を打たなくて済むように)。
 */
export function normalizeTopicInput(label, en = '') {
  const trimmed = { label: String(label ?? '').trim(), en: String(en ?? '').trim() };
  if (!trimmed.label && !trimmed.en) return null;
  // ラベルだけ英語で書かれた場合は en としても使う。
  if (!trimmed.label) trimmed.label = trimmed.en;
  return trimmed.en ? trimmed : { label: trimmed.label };
}

export function buildPayload({ toeic, addTopics = [] } = {}) {
  const payload = {};
  const score = clampToeic(toeic);
  if (score !== null) payload.toeic = score;
  const topics = addTopics.map((t) => normalizeTopicInput(t.label, t.en)).filter(Boolean);
  if (topics.length) payload.addTopics = topics;
  return payload;
}

export function isEmptyPayload(payload) {
  return !payload || (payload.toeic === undefined && !payload.addTopics?.length);
}

/** Issue 本文: 人が読む要約 + 機械が読む JSON。 */
export function renderSettingsBody(payload, current = {}) {
  const lines = [];
  if (payload.toeic !== undefined) {
    lines.push(
      current.toeic
        ? `- 目標レベル: TOEIC ${current.toeic} → ${payload.toeic}`
        : `- 目標レベル: TOEIC ${payload.toeic}`,
    );
  }
  for (const t of payload.addTopics ?? []) {
    lines.push(`- テーマ追加: ${t.label}${t.en ? ` (${t.en})` : ' (英語フレーズは自動で補う)'}`);
  }
  return [
    lines.join('\n'),
    '',
    'この Issue は自動で処理され、反映後にコメントが付きます。',
    '',
    `${OPEN}`,
    JSON.stringify(payload),
    CLOSE,
  ].join('\n');
}

export function settingsIssueUrl(repo, payload, current = {}) {
  const title = payload.toeic !== undefined ? `設定変更 (TOEIC ${payload.toeic})` : '設定変更';
  const body = renderSettingsBody(payload, current);
  return `https://github.com/${repo}/issues/new?labels=settings&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

/** Issue 本文から JSON を取り出す。見つからなければ null。 */
export function extractPayload(body) {
  const start = String(body ?? '').indexOf(OPEN);
  if (start === -1) return null;
  const end = body.indexOf(CLOSE, start);
  if (end === -1) return null;
  const json = body.slice(start + OPEN.length, end).trim();
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 送信済み payload のうち、まだ data/*.json に届いていないもの。
 * 反映が済んだら「未反映」表示を自動で消すために使う。
 */
export function pendingChanges(payload, { config, topics }) {
  if (isEmptyPayload(payload)) return { toeic: null, topics: [] };
  const known = new Set((topics ?? []).map(topicKey));
  const knownLabels = new Set((topics ?? []).map((t) => t.label));
  return {
    toeic: payload.toeic !== undefined && payload.toeic !== config?.level?.toeic ? payload.toeic : null,
    topics: (payload.addTopics ?? []).filter(
      (t) => !(t.en && known.has(topicKey(t))) && !knownLabels.has(t.label),
    ),
  };
}

export function isApplied(payload, state) {
  const pending = pendingChanges(payload, state);
  return pending.toeic === null && pending.topics.length === 0;
}

/* ---------- 問題作成のリクエスト ---------- */

const GEN_OPEN = '<!-- generate';

/** テーマ1つを添えた生成リクエストの Issue 本文。 */
export function renderGenerateBody(topicText = '') {
  const topic = String(topicText).trim();
  return [
    topic ? `- テーマ: ${topic}` : '- テーマ: おまかせ (ネタ帳から選ぶ)',
    '',
    'この Issue は自動で処理され、完成したらコメントが付きます。',
    '',
    GEN_OPEN,
    JSON.stringify(topic ? { topic } : {}),
    CLOSE,
  ].join('\n');
}

export function generateIssueUrl(repo, topicText = '') {
  const topic = String(topicText).trim();
  const title = `問題作成${topic ? ` (${topic})` : ''}`;
  return `https://github.com/${repo}/issues/new?labels=generate&title=${encodeURIComponent(title)}&body=${encodeURIComponent(renderGenerateBody(topic))}`;
}

export function extractGeneratePayload(body) {
  const start = String(body ?? '').indexOf(GEN_OPEN);
  if (start === -1) return null;
  const end = body.indexOf(CLOSE, start);
  if (end === -1) return null;
  try {
    const parsed = JSON.parse(body.slice(start + GEN_OPEN.length, end).trim());
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
