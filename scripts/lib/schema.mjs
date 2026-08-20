/**
 * Hand-rolled validator for a day set (data/days/YYYY-MM-DD.json).
 *
 * This file is the single source of truth for the day-set contract: the
 * generator prompt, the web app and the grader all assume a file that passes
 * `validateDay`. Change the shape here first, then update prompts/generate.md.
 */

const SECTIONS = ['listening', 'dictation', 'reading', 'writing'];

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function checkChoiceQuestion(q, where, errors) {
  if (!isNonEmptyString(q?.id)) errors.push(`${where}.id は必須の文字列`);
  if (!isNonEmptyString(q?.prompt)) errors.push(`${where}.prompt は必須の文字列`);
  if (!Array.isArray(q?.choices) || q.choices.length < 3) {
    errors.push(`${where}.choices は3件以上の配列`);
  } else if (!q.choices.every(isNonEmptyString)) {
    errors.push(`${where}.choices の要素はすべて空でない文字列`);
  }
  if (!Number.isInteger(q?.answer) || q.answer < 0 || q.answer >= (q.choices?.length ?? 0)) {
    errors.push(`${where}.answer は choices の有効なインデックス`);
  }
  if (!isNonEmptyString(q?.explanation)) errors.push(`${where}.explanation は必須の文字列`);
}

export function validateDay(day, { date } = {}) {
  const errors = [];

  if (!/^\d{4}-\d{2}-\d{2}$/.test(day?.date ?? '')) errors.push('date は YYYY-MM-DD 形式');
  if (date && day?.date !== date) errors.push(`date "${day?.date}" がファイル名 "${date}" と不一致`);
  if (!isNonEmptyString(day?.topic?.label)) errors.push('topic.label は必須');
  if (!isNonEmptyString(day?.topic?.id)) errors.push('topic.id は必須');
  if (!Number.isInteger(day?.level?.toeic)) errors.push('level.toeic は整数');

  const { listening, dictation, reading, writing } = day ?? {};

  if (listening) {
    if (!isNonEmptyString(listening.title)) errors.push('listening.title は必須');
    if (!isNonEmptyString(listening.script)) errors.push('listening.script は必須');
    if (!Array.isArray(listening.questions) || listening.questions.length === 0) {
      errors.push('listening.questions は1件以上の配列');
    } else {
      listening.questions.forEach((q, i) => checkChoiceQuestion(q, `listening.questions[${i}]`, errors));
    }
  }

  if (dictation) {
    if (!Array.isArray(dictation.sentences) || dictation.sentences.length === 0) {
      errors.push('dictation.sentences は1件以上の配列');
    } else {
      dictation.sentences.forEach((s, i) => {
        if (!isNonEmptyString(s?.id)) errors.push(`dictation.sentences[${i}].id は必須`);
        if (!isNonEmptyString(s?.text)) errors.push(`dictation.sentences[${i}].text は必須`);
        // The whole point of dictation is typing what you hear: a sentence that
        // is also visible elsewhere in the set would leak its own answer.
        if (isNonEmptyString(s?.text) && listening?.script?.includes(s.text.trim())) {
          errors.push(`dictation.sentences[${i}].text が listening.script と重複している`);
        }
      });
    }
  }

  if (reading) {
    if (!isNonEmptyString(reading.passage)) errors.push('reading.passage は必須');
    if (!Array.isArray(reading.questions) || reading.questions.length === 0) {
      errors.push('reading.questions は1件以上の配列');
    } else {
      reading.questions.forEach((q, i) => checkChoiceQuestion(q, `reading.questions[${i}]`, errors));
    }
    if (reading.glossary && !Array.isArray(reading.glossary)) {
      errors.push('reading.glossary は配列');
    }
  }

  if (writing) {
    if (!isNonEmptyString(writing.prompt)) errors.push('writing.prompt は必須');
    if (!Array.isArray(writing.keyPoints) || writing.keyPoints.length === 0) {
      errors.push('writing.keyPoints は1件以上の配列');
    }
    if (!isNonEmptyString(writing.modelAnswer)) errors.push('writing.modelAnswer は必須');
    const [min, max] = writing.words ?? [];
    if (!Number.isInteger(min) || !Number.isInteger(max) || min >= max) {
      errors.push('writing.words は [最小, 最大] の整数ペア');
    }
  }

  if (!SECTIONS.some((s) => day?.[s])) errors.push('セクションが1つも含まれていない');

  return { ok: errors.length === 0, errors };
}

export { SECTIONS };
