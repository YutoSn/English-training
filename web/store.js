/**
 * Answers live in localStorage only — the site is static and there is no server.
 * Grading happens by handing `buildSubmission()` output to Claude (copy-paste,
 * or the prefilled GitHub issue that .github/workflows/grade.yml reacts to).
 */
const KEY = 'english-training:answers';

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function loadAnswers(date) {
  return readAll()[date] ?? { listening: {}, dictation: {}, reading: {}, writing: '' };
}

export function saveAnswers(date, answers) {
  const all = readAll();
  all[date] = answers;
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* private mode / quota — answers simply do not persist */
  }
}

export function scoreChoices(questions, picked) {
  const answered = questions.filter((q) => picked[q.id] !== undefined);
  const correct = answered.filter((q) => picked[q.id] === q.answer);
  return { correct: correct.length, answered: answered.length, total: questions.length };
}

export function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * The markdown block Claude grades. Keep it self-describing: the grader is told
 * to read data/days/<date>.json for the correct answers, so this only needs to
 * carry what the learner produced.
 */
export function buildSubmission(day, answers) {
  const lines = [`# ${day.date} 解答 (${day.topic.label} / TOEIC ${day.level.toeic})`, ''];

  if (day.listening) {
    lines.push('## リスニング');
    for (const q of day.listening.questions) {
      const pick = answers.listening[q.id];
      lines.push(`- ${q.id}: ${pick === undefined ? '未回答' : `${pick} (${q.choices[pick]})`}`);
    }
    lines.push('');
  }

  if (day.dictation) {
    lines.push('## ディクテーション');
    for (const s of day.dictation.sentences) {
      lines.push(`- ${s.id}: ${answers.dictation[s.id]?.trim() || '(未回答)'}`);
    }
    lines.push('');
  }

  if (day.reading) {
    lines.push('## リーディング');
    for (const q of day.reading.questions) {
      const pick = answers.reading[q.id];
      lines.push(`- ${q.id}: ${pick === undefined ? '未回答' : `${pick} (${q.choices[pick]})`}`);
    }
    lines.push('');
  }

  if (day.writing) {
    const text = answers.writing?.trim();
    lines.push('## 英作文', `課題: ${day.writing.prompt}`, '');
    lines.push(text ? `${text}\n\n(${countWords(text)} words)` : '(未回答)');
    lines.push('');
  }

  return lines.join('\n');
}

export function issueUrl(repo, day, submission) {
  const title = `採点依頼 ${day.date} (${day.topic.label})`;
  const body = `${submission}\n\n---\n<!-- date:${day.date} -->`;
  return `https://github.com/${repo}/issues/new?labels=grade&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

/**
 * 設定タブの下書きと「送信済みだが未反映」の payload。
 * 解答とは別キーにして、日付をまたいで持ち越す。
 */
const SETTINGS_KEY = 'english-training:settings';

function readSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function writeSettings(value) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
  } catch {
    /* private mode / quota — 下書きが残らないだけ */
  }
}

export function loadDraft() {
  return readSettings().draft ?? { toeic: null, addTopics: [] };
}

export function saveDraft(draft) {
  writeSettings({ ...readSettings(), draft });
}

export function loadSent() {
  return readSettings().sent ?? null;
}

export function saveSent(payload) {
  writeSettings({ ...readSettings(), sent: payload });
}

export function clearSent() {
  const { sent, ...rest } = readSettings();
  writeSettings(rest);
}
