import { slugify } from './topics.mjs';
import { clampToeic, topicKey } from '../../web/settings.js';

export { extractPayload } from '../../web/settings.js';

/**
 * 設定 Issue の payload を config / topics に適用する。純粋関数 — 書き込みは
 * 呼び出し側 (scripts/apply-settings.mjs) が行う。
 *
 * @param {object} state   { config, topics } の現在値
 * @param {object} payload web/settings.js が作った payload
 * @param {object} options { today, translate } — translate は label → 英語フレーズ
 */
export function applyPayload({ config, topics }, payload, { today, translate = {} } = {}) {
  const applied = [];
  const skipped = [];
  const nextConfig = structuredClone(config);
  const nextTopics = structuredClone(topics);

  if (payload?.toeic !== undefined) {
    const score = clampToeic(payload.toeic);
    if (score === null) {
      skipped.push(`TOEIC "${payload.toeic}" は数値ではありません`);
    } else if (score === config.level.toeic) {
      skipped.push(`TOEIC ${score} は現在値と同じです`);
    } else {
      applied.push(`目標レベル: TOEIC ${config.level.toeic} → ${score}`);
      nextConfig.level.toeic = score;
    }
  }

  for (const topic of payload?.addTopics ?? []) {
    const label = String(topic?.label ?? '').trim();
    const en = String(topic?.en || translate[label] || '').trim();
    if (!label) {
      skipped.push('ラベルが空のテーマ');
      continue;
    }
    if (!en) {
      skipped.push(`${label}: 英語フレーズを決められませんでした`);
      continue;
    }
    const id = slugify(en);
    if (!id) {
      skipped.push(`${label}: "${en}" から id を作れませんでした`);
      continue;
    }
    const existing = nextTopics.find((t) => t.id === id || topicKey(t) === topicKey({ en }));
    if (existing) {
      skipped.push(`${label}: 登録済み (${existing.label})`);
      continue;
    }
    nextTopics.push({
      id,
      label,
      en,
      tags: [],
      addedAt: today,
      usedCount: 0,
      lastUsedOn: null,
    });
    applied.push(`テーマ追加: ${label} (${en})`);
  }

  return { config: nextConfig, topics: nextTopics, applied, skipped };
}

/** 英語フレーズが無いテーマのラベル一覧。Gemini に訳させる対象。 */
export function labelsNeedingTranslation(payload) {
  return (payload?.addTopics ?? [])
    .filter((t) => !String(t?.en ?? '').trim() && String(t?.label ?? '').trim())
    .map((t) => t.label.trim());
}
