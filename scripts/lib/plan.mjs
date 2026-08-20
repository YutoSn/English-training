import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJson, CONFIG_PATH } from './paths.mjs';
import { loadTopics, pickTopics } from './topics.mjs';
import { levelProfile } from './level.mjs';

/**
 * Everything needed to produce one day set: which topic, at what level, and the
 * filled-in prompt. Shared by new-day.mjs (prints the prompt) and
 * generate-day.mjs (sends it to Gemini), so the two can never drift apart.
 */
export function planDay(date, { topicId } = {}) {
  const config = readJson(CONFIG_PATH);
  const topics = loadTopics();
  const level = levelProfile(config.level.toeic);

  const topic = topicId
    ? (topics.find((t) => t.id === topicId) ??
      (() => {
        throw new Error(`未知のトピック: ${topicId}`);
      })())
    : pickTopics(topics, {
        date,
        count: config.topicsPerDay,
        recentWindow: config.recentTopicWindow,
      })[0];

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
