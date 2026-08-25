import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJson, CONFIG_PATH } from './paths.mjs';
import { loadTopics, pickTopics, slugify } from './topics.mjs';
import { levelProfile } from './level.mjs';
import { translateLabels } from './translate.mjs';

/**
 * Everything needed to produce one day set: which topic, at what level, and the
 * filled-in prompt. Shared by new-day.mjs (prints the prompt) and
 * generate-day.mjs (sends it to Gemini), so the two can never drift apart.
 */
/**
 * テーマの決め方は3通り:
 *   topicId   — ネタ帳の id を指定 (CLI / 再生成)
 *   topicText — 利用者が打ち込んだ自由入力。既存と一致すればそれを使い、
 *               新しければ英語フレーズを訳して新規テーマにする
 *   どちらも無し — 日付シードでネタ帳から選ぶ
 *
 * 訳が要るときだけ API を呼ぶので async。
 */
export async function resolveTopic(topics, { date, topicId, topicText, config }) {
  if (topicId) {
    const found = topics.find((t) => t.id === topicId);
    if (!found) throw new Error(`未知のトピック: ${topicId}`);
    return found;
  }

  const text = String(topicText ?? '').trim();
  if (!text) {
    return pickTopics(topics, {
      date,
      count: config.topicsPerDay,
      recentWindow: config.recentTopicWindow,
    })[0];
  }

  const key = text.toLowerCase();
  const existing = topics.find(
    (t) => t.label === text || t.id === slugify(text) || String(t.en).toLowerCase() === key,
  );
  if (existing) return existing;

  // 英語で打たれていればそのまま使い、日本語なら訳す。
  const looksEnglish = /^[\x20-\x7e]+$/.test(text);
  const en = looksEnglish ? text : (await translateLabels([text]))[text];
  if (!en) throw new Error(`"${text}" の英語フレーズを決められませんでした`);

  const id = slugify(en);
  if (!id) throw new Error(`"${en}" から id を作れませんでした`);
  return { id, label: text, en };
}

export async function planDay(date, { topicId, topicText } = {}) {
  const config = readJson(CONFIG_PATH);
  const topics = loadTopics();
  const level = levelProfile(config.level.toeic);
  const topic = await resolveTopic(topics, { date, topicId, topicText, config });

  return { date, config, level, topic, prompt: buildPrompt({ date, config, level, topic }) };
}

function sectionSpec(s) {
  return [
    s.listening.enabled &&
      `- リスニング: ${s.listening.scriptWords[0]}〜${s.listening.scriptWords[1]}語のスクリプト + 4択問題 ${s.listening.questions}問`,
    s.dictation.enabled && `- ディクテーション: ${s.dictation.sentences}文`,
    s.reading.enabled &&
      `- リーディング: ${s.reading.passageWords[0]}〜${s.reading.passageWords[1]}語のパッセージ + 4択問題 ${s.reading.questions}問`,
    s.writing.enabled && `- 英作文: ${s.writing.words[0]}〜${s.writing.words[1]}語の課題1問`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildPrompt({ date, config, level, topic }) {
  const template = fs.readFileSync(path.join(ROOT, 'prompts/generate.md'), 'utf8');
  const values = {
    DATE: date,
    TOPIC_ID: topic.id,
    TOPIC_LABEL: topic.label,
    TOPIC_EN: topic.en,
    TOEIC: String(level.toeic),
    CEFR: level.cefr,
    VOCABULARY: level.vocabulary,
    SENTENCE: level.sentence,
    SPEECH: level.speech,
    SECTION_SPEC: sectionSpec(config.sections),
    WRITING_MIN: String(config.sections.writing.words[0]),
    WRITING_MAX: String(config.sections.writing.words[1]),
  };

  return template.replace(/{{(\w+)}}/g, (_, key) => {
    if (!(key in values)) throw new Error(`prompts/generate.md の未知のプレースホルダ: {{${key}}}`);
    return values[key];
  });
}

/** Wrap the model's content object into the full day set the schema expects. */
export function assembleDay({ date, level, topic }, content) {
  return {
    date,
    topic: { id: topic.id, label: topic.label, en: topic.en },
    level: { toeic: level.toeic, cefr: level.cefr },
    ...content,
  };
}
