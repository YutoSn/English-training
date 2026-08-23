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

/**
 * Gemini responseSchema (OpenAPI subset) for the *content* half of a day set.
 * date / topic / level are filled in by the script, not the model — those are
 * facts we already know, and asking for them only invites the model to get the
 * date wrong.
 *
 * Kept next to validateDay on purpose: a field added to one must be added to
 * the other, or generation starts failing validation.
 */
export function daySchema(sections) {
  const string = (description) => ({ type: 'STRING', description });

  const choiceQuestion = (kind) => ({
    type: 'OBJECT',
    properties: {
      id: string(`${kind}1 のような連番 id`),
      prompt: string('英語の設問文'),
      choices: {
        type: 'ARRAY',
        items: string('選択肢 (英語)'),
        description:
          '4択。誤答は「部分的に正しい」「言い換えの罠」「本文にない情報」を混ぜ、' +
          '少なくとも1つは本文の語句を含める',
        minItems: 4,
        maxItems: 4,
      },
      answer: { type: 'INTEGER', description: '正解の choices インデックス (0-3)' },
      explanation: string('日本語の解説。根拠となる英文を引用する'),
    },
    required: ['id', 'prompt', 'choices', 'answer', 'explanation'],
    propertyOrdering: ['id', 'prompt', 'choices', 'answer', 'explanation'],
  });

  const properties = {};

  if (sections.listening?.enabled) {
    properties.listening = {
      type: 'OBJECT',
      properties: {
        title: string('英語のタイトル'),
        script: string('読み上げ用の英文スクリプト。記号や箇条書きを含めない'),
        questions: { type: 'ARRAY', items: choiceQuestion('l') },
      },
      required: ['title', 'script', 'questions'],
      propertyOrdering: ['title', 'script', 'questions'],
    };
  }

  if (sections.dictation?.enabled) {
    properties.dictation = {
      type: 'OBJECT',
      properties: {
        sentences: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              id: string('d1 のような連番 id'),
              text: string('10〜20語の英文。listening.script と重複させない'),
              hint: string('狙う音声現象の日本語説明'),
            },
            required: ['id', 'text', 'hint'],
            propertyOrdering: ['id', 'text', 'hint'],
          },
        },
      },
      required: ['sentences'],
    };
  }

  if (sections.reading?.enabled) {
    properties.reading = {
      type: 'OBJECT',
      properties: {
        passage: string('英文パッセージ。段落は \\n\\n で区切る'),
        glossary: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: { word: string('英単語'), meaning: string('日本語訳') },
            required: ['word', 'meaning'],
            propertyOrdering: ['word', 'meaning'],
          },
        },
        questions: { type: 'ARRAY', items: choiceQuestion('r') },
      },
      required: ['passage', 'glossary', 'questions'],
      propertyOrdering: ['passage', 'glossary', 'questions'],
    };
  }

  if (sections.writing?.enabled) {
    properties.writing = {
      type: 'OBJECT',
      properties: {
        prompt: string('英作文の課題文'),
        words: {
          type: 'ARRAY',
          items: { type: 'INTEGER' },
          description: '[最小語数, 最大語数]',
          minItems: 2,
          maxItems: 2,
        },
        keyPoints: { type: 'ARRAY', items: string('日本語の採点観点') },
        modelAnswer: string('指定語数に収まる模範解答 (英語)'),
      },
      required: ['prompt', 'words', 'keyPoints', 'modelAnswer'],
      propertyOrdering: ['prompt', 'words', 'keyPoints', 'modelAnswer'],
    };
  }

  return {
    type: 'OBJECT',
    properties,
    required: Object.keys(properties),
    propertyOrdering: SECTIONS.filter((s) => s in properties),
  };
}

export { SECTIONS };
