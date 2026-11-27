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

export function loadAnswers(setId) {
  return readAll()[setId] ?? { listening: {}, dictation: {}, reading: {}, writing: '' };
}

export function saveAnswers(setId, answers) {
  const all = readAll();
  all[setId] = answers;
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
export function buildSubmission(day, answers, setId = day.date) {
  const lines = [`# ${setId} 解答 (${day.topic.label} / TOEIC ${day.level.toeic})`, ''];

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

export function issueUrl(repo, day, submission, setId = day.date) {
  const title = `採点依頼 ${setId} (${day.topic.label})`;
  // この印で採点側が問題ファイルを特定する。消すと日付を取り違える。
  const body = `${submission}\n\n---\n<!-- set:${setId} -->`;
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

/**
 * 生成待ちの状態。Issue を出したあと GitHub アプリに移動して戻ってきても
 * 待機を再開できるよう、既知のセット id ごと残しておく。
 */
export function loadPendingGeneration() {
  return readSettings().generating ?? null;
}

export function savePendingGeneration(pending) {
  writeSettings({ ...readSettings(), generating: pending });
}

export function clearPendingGeneration() {
  const { generating, ...rest } = readSettings();
  writeSettings(rest);
}

/**
 * 動画タブ。GAS の URL と合言葉は端末ごとの秘密なのでリポジトリには置かず、
 * ここにだけ保存する。生成済みの教材と解答も同じ理由でこの端末に残る。
 */
const VIDEO_KEY = 'english-training:video';
const VIDEO_LIMIT = 30;

function readVideo() {
  try {
    return JSON.parse(localStorage.getItem(VIDEO_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function writeVideo(value) {
  try {
    localStorage.setItem(VIDEO_KEY, JSON.stringify(value));
  } catch {
    /* private mode / quota */
  }
}

export function loadVideoConnection() {
  return readVideo().connection ?? { gasUrl: '', token: '' };
}

export function saveVideoConnection(connection) {
  writeVideo({ ...readVideo(), connection });
}

export function loadVideoLibrary() {
  return readVideo().library ?? [];
}

/** 新しいものを先頭に足す。同じ id は置き換え、古いものから捨てる。 */
export function saveVideoEntry(entry) {
  const library = loadVideoLibrary().filter((e) => e.id !== entry.id);
  writeVideo({ ...readVideo(), library: [entry, ...library].slice(0, VIDEO_LIMIT) });
}

export function removeVideoEntry(id) {
  writeVideo({ ...readVideo(), library: loadVideoLibrary().filter((e) => e.id !== id) });
}

/** 字幕の表示モード ('none' | 'en' | 'ja')。動画を変えても引き継ぐ。 */
export function loadSubtitleMode() {
  return readVideo().subtitleMode ?? 'en';
}

export function saveSubtitleMode(mode) {
  writeVideo({ ...readVideo(), subtitleMode: mode });
}

/** 最後に開いていた動画。アプリを開き直したとき、すぐ続きから見られるようにする。 */
export function loadLastVideoId() {
  return readVideo().lastId ?? null;
}

export function saveLastVideoId(id) {
  writeVideo({ ...readVideo(), lastId: id });
}

/** 再生中の行に合わせて字幕を自動でスクロールするか (既定は する)。 */
export function loadAutoScroll() {
  return readVideo().autoScroll ?? true;
}

export function saveAutoScroll(on) {
  writeVideo({ ...readVideo(), autoScroll: on });
}

/** 「動画を追加」の字幕の作り方 ('captions' | 'ai')。既定は字幕ファイル (時刻が正確)。 */
export function loadVideoSource() {
  return readVideo().source === 'ai' ? 'ai' : 'captions';
}

export function saveVideoSource(source) {
  writeVideo({ ...readVideo(), source });
}

/** 字幕の ▶ を押したときの再生のしかた ('continue' = 続けて再生 | 'loop' = 1文くり返し)。 */
export function loadRowPlayMode() {
  return readVideo().rowPlay === 'loop' ? 'loop' : 'continue';
}

export function saveRowPlayMode(mode) {
  writeVideo({ ...readVideo(), rowPlay: mode });
}

/**
 * 作成の途中経過 (1件だけ)。アプリが閉じられても続きから作れるよう、作成の入力
 * (字幕行 / 区間) と、分けた依頼ごとの結果を残す。作成が終われば消す。
 * @returns {{ key, source, videoId, cues?, start?, end?, label, pieces: object } | null}
 */
export function loadVideoJob() {
  return readVideo().job ?? null;
}

export function startVideoJob(job) {
  const current = loadVideoJob();
  // 同じ作成の続きなら、終わった分を引き継ぐ
  const pieces = current?.key === job.key ? current.pieces : {};
  writeVideo({ ...readVideo(), job: { ...job, pieces, updatedAt: Date.now() } });
  return pieces;
}

export function saveVideoJobPiece(key, pieceKey, result) {
  const job = loadVideoJob();
  if (!job || job.key !== key) return;
  job.pieces = { ...job.pieces, [pieceKey]: result };
  job.updatedAt = Date.now();
  writeVideo({ ...readVideo(), job });
}

export function clearVideoJob() {
  const { job, ...rest } = readVideo();
  writeVideo(rest);
}

/**
 * 読み込んだ字幕ファイル全体 (字幕行) を動画ごとに残す。作った区間の外へ再生区間を
 * 広げるとき、足りない部分をここから訳す。教材とは別のキーにして、新しい方から10本だけ持つ。
 */
const CAPTIONS_KEY = 'english-training:captions';
const CAPTIONS_LIMIT = 10;

function readCaptionFiles() {
  try {
    return JSON.parse(localStorage.getItem(CAPTIONS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function loadCaptionFile(videoId) {
  return readCaptionFiles()[videoId]?.cues ?? null;
}

export function saveCaptionFile(videoId, cues) {
  const files = { ...readCaptionFiles(), [videoId]: { cues, savedAt: Date.now() } };
  const kept = Object.entries(files)
    .sort(([, a], [, b]) => b.savedAt - a.savedAt)
    .slice(0, CAPTIONS_LIMIT);
  try {
    localStorage.setItem(CAPTIONS_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    /* 容量不足など — 広げられないだけで、作った字幕は使える */
  }
}
