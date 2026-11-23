import { initSpeech, isSupported, speak, stop } from './speech.js';
import { diffWords } from './diff.js';
import {
  loadAnswers,
  saveAnswers,
  scoreChoices,
  countWords,
  buildSubmission,
  issueUrl,
  loadDraft,
  saveDraft,
  loadSent,
  saveSent,
  clearSent,
  loadPendingGeneration,
  savePendingGeneration,
  clearPendingGeneration,
  loadVideoConnection,
  saveVideoConnection,
  loadVideoLibrary,
  saveVideoEntry,
  removeVideoEntry,
  loadSubtitleMode,
  saveSubtitleMode,
} from './store.js';
import {
  TOEIC_MIN,
  TOEIC_MAX,
  buildPayload,
  isEmptyPayload,
  isApplied,
  normalizeTopicInput,
  pendingChanges,
  renderSettingsBody,
  settingsIssueUrl,
  topicKey,
  generateIssueUrl,
} from './settings.js';
// バンド定義は生成プロンプトが使うものと同じ実体 (二重管理を避ける)。
import { levelProfile } from './level.js';
import { fetchFromGitHub, fetchSetFile, RateLimitError } from './github.js';
import {
  buildGasRequest,
  buildVideoPrompt,
  checkRange,
  formatTime,
  GasError,
  groupTranscript,
  parseGasResponse,
  parseTime,
  parseYouTubeUrl,
  resolveSubtitleMode,
  SUBTITLE_MODES,
  validateVideoSet,
  videoConfig,
  videoLabel,
} from './video.js';
import { createPlayer } from './youtube.js';

const state = { config: null, index: null, topics: [], setId: null, day: null, answers: null, tab: null };

const $ = (sel) => document.querySelector(sel);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

let toastTimer;
function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 1800);
}

function persist() {
  saveAnswers(state.setId, state.answers);
}

/* ---------- shared question rendering ---------- */

/**
 * `bind` で解答の置き場所を差し替えられる。既定はその日のセットの解答
 * (動画タブは自分の保存先を渡す)。
 */
function renderChoiceQuestions(section, questions, bind = dayAnswerBinding(section)) {
  const list = el('ol', { class: 'questions' });

  for (const q of questions) {
    const item = el('li');
    item.append(el('p', { class: 'qprompt' }, q.prompt));

    const explanation = el('p', { class: 'explanation hidden' }, q.explanation);
    const labels = q.choices.map((choice, i) => {
      const input = el('input', {
        type: 'radio',
        name: `${section}-${q.id}`,
        value: String(i),
      });
      input.checked = bind.get(q.id) === i;
      input.addEventListener('change', () => {
        bind.set(q.id, i);
        mark();
      });
      return el('label', { class: 'choice' }, input, el('span', {}, choice));
    });

    // Feedback is immediate: choice questions have an objective answer, so
    // there is nothing to gain by making the learner wait for grading.
    function mark() {
      const picked = bind.get(q.id);
      labels.forEach((label, i) => {
        label.classList.toggle('correct', picked !== undefined && i === q.answer);
        label.classList.toggle('wrong', picked === i && i !== q.answer);
      });
      explanation.classList.toggle('hidden', picked === undefined);
    }
    mark();

    item.append(...labels, explanation);
    list.append(item);
  }

  return list;
}

function dayAnswerBinding(section) {
  return {
    get: (id) => state.answers[section][id],
    set: (id, value) => {
      state.answers[section][id] = value;
      persist();
      updateScore();
    },
  };
}

function updateScore() {
  for (const section of ['listening', 'reading']) {
    const node = document.querySelector(`[data-score="${section}"]`);
    if (!node || !state.day[section]) continue;
    const { correct, total } = scoreChoices(state.day[section].questions, state.answers[section]);
    node.textContent = `${correct} / ${total}`;
    node.classList.toggle('done', correct === total);
  }
}

function speechControls(getText, { rate }) {
  const rateInput = el('input', {
    type: 'range',
    min: '0.6',
    max: '1.3',
    step: '0.05',
    value: String(rate),
    'aria-label': '再生速度',
  });
  const rateLabel = el('span', { class: 'meta' }, `${Number(rate).toFixed(2)}x`);
  rateInput.addEventListener('input', () => {
    rateLabel.textContent = `${Number(rateInput.value).toFixed(2)}x`;
  });

  const play = el(
    'button',
    {
      class: 'btn primary',
      onclick: () =>
        speak(getText(), {
          rate: Number(rateInput.value),
          lang: state.config.speech.lang,
        }).catch((e) => toast(e.message ?? '再生できませんでした')),
    },
    '▶ 再生',
  );

  return el(
    'div',
    { class: 'controls' },
    play,
    el('button', { class: 'btn small', onclick: stop }, '■ 停止'),
    rateInput,
    rateLabel,
  );
}

/* ---------- panels ---------- */

function listeningPanel(day) {
  const section = day.listening;
  const card = el('div', { class: 'card' });
  const script = el('p', { class: 'script hidden' }, section.script);

  card.append(
    el(
      'h2',
      {},
      section.title,
      ' ',
      el('span', { class: 'score', 'data-score': 'listening' }, ''),
    ),
    speechControls(() => section.script, { rate: state.config.speech.defaultRate }),
    el(
      'button',
      {
        class: 'btn small',
        onclick: (e) => {
          script.classList.toggle('hidden');
          e.target.textContent = script.classList.contains('hidden')
            ? 'スクリプトを表示'
            : 'スクリプトを隠す';
        },
      },
      'スクリプトを表示',
    ),
    script,
    el('h3', {}, '設問'),
    renderChoiceQuestions('listening', section.questions),
  );
  return card;
}

function dictationPanel(day) {
  const card = el('div', { class: 'card' });
  card.append(el('h2', {}, 'ディクテーション'), el('p', { class: 'meta' }, '聞こえた文をそのまま入力し、「答え合わせ」で照合します。'));

  const list = el('ol', { class: 'questions' });
  for (const sentence of day.dictation.sentences) {
    const item = el('li');
    const input = el('textarea', { rows: '2', placeholder: '聞こえた文を入力' });
    input.value = state.answers.dictation[sentence.id] ?? '';
    input.addEventListener('input', () => {
      state.answers.dictation[sentence.id] = input.value;
      persist();
    });

    const result = el('div', { class: 'diff hidden' });
    const hint = el('p', { class: 'explanation hidden' }, sentence.hint);

    const check = el(
      'button',
      {
        class: 'btn small',
        onclick: () => {
          const { ops, matched, total } = diffWords(sentence.text, input.value);
          result.replaceChildren(
            el('p', { class: 'score' }, `${matched} / ${total} 語一致`),
            el(
              'p',
              {},
              ops.map((op) =>
                op.type === 'same'
                  ? el('span', {}, `${op.word} `)
                  : op.type === 'missing'
                    ? el('del', {}, `${op.word} `)
                    : el('ins', {}, `${op.word} `),
              ),
            ),
            el('p', { class: 'explanation' }, `正解: ${sentence.text}`),
          );
          result.classList.remove('hidden');
          hint.classList.remove('hidden');
        },
      },
      '答え合わせ',
    );

    item.append(
      el(
        'div',
        { class: 'controls' },
        el(
          'button',
          {
            class: 'btn primary small',
            onclick: () =>
              speak(sentence.text, {
                rate: state.config.speech.dictationRate,
                lang: state.config.speech.lang,
              }).catch((e) => toast(e.message ?? '再生できませんでした')),
          },
          '▶ この文を再生',
        ),
        el(
          'button',
          {
            class: 'btn small',
            onclick: () =>
              speak(sentence.text, { rate: 0.65, lang: state.config.speech.lang }).catch(() => {}),
          },
          '🐢 ゆっくり',
        ),
        check,
      ),
      input,
      result,
      hint,
    );
    list.append(item);
  }

  card.append(list);
  return card;
}

function readingPanel(day) {
  const section = day.reading;
  const card = el('div', { class: 'card' });
  const glossary = el(
    'table',
    { class: 'glossary hidden' },
    (section.glossary ?? []).map((g) => el('tr', {}, el('td', {}, g.word), el('td', {}, g.meaning))),
  );

  card.append(
    el('h2', {}, 'リーディング ', el('span', { class: 'score', 'data-score': 'reading' }, '')),
    el('p', { class: 'passage' }, section.passage),
    section.glossary?.length
      ? el(
          'button',
          {
            class: 'btn small',
            onclick: (e) => {
              glossary.classList.toggle('hidden');
              e.target.textContent = glossary.classList.contains('hidden')
                ? '語注を表示'
                : '語注を隠す';
            },
          },
          '語注を表示',
        )
      : null,
    glossary,
    el('h3', {}, '設問'),
    renderChoiceQuestions('reading', section.questions),
  );
  return card;
}

function writingPanel(day) {
  const section = day.writing;
  const [min, max] = section.words;
  const card = el('div', { class: 'card' });

  const counter = el('p', { class: 'wordcount' }, '');
  const input = el('textarea', { rows: '10', placeholder: 'Write your answer in English.' });
  input.value = state.answers.writing ?? '';

  function refresh() {
    const n = countWords(input.value);
    counter.textContent = `${n} words (目標 ${min}〜${max})`;
    counter.classList.toggle('out', n > 0 && (n < min || n > max));
  }
  input.addEventListener('input', () => {
    state.answers.writing = input.value;
    persist();
    refresh();
  });
  refresh();

  const model = el('div', { class: 'hidden' }, el('p', { class: 'passage' }, section.modelAnswer));

  card.append(
    el('h2', {}, '英作文'),
    el('p', { class: 'qprompt' }, section.prompt),
    el(
      'ul',
      { class: 'explanation' },
      section.keyPoints.map((p) => el('li', {}, p)),
    ),
    input,
    counter,
    el(
      'button',
      {
        class: 'btn small',
        onclick: (e) => {
          model.classList.toggle('hidden');
          e.target.textContent = model.classList.contains('hidden')
            ? '模範解答を表示'
            : '模範解答を隠す';
        },
      },
      '模範解答を表示',
    ),
    model,
  );
  return card;
}

function reviewPanel(day) {
  const card = el('div', { class: 'card' });
  const submission = () => buildSubmission(day, state.answers, state.setId);
  const preview = el('textarea', { rows: '14', readonly: 'readonly' });
  preview.value = submission();

  card.append(
    el('h2', {}, 'Claude に採点してもらう'),
    el(
      'p',
      { class: 'meta' },
      'ディクテーションと英作文は自動採点できません。下の内容を Claude に渡すと、採点・添削・次の学習ポイントが返ってきます。',
    ),
    el(
      'div',
      { class: 'controls' },
      el(
        'button',
        {
          class: 'btn primary',
          onclick: async () => {
            preview.value = submission();
            try {
              await navigator.clipboard.writeText(preview.value);
              toast('コピーしました');
            } catch {
              preview.select();
              toast('選択しました。手動でコピーしてください');
            }
          },
        },
        '解答をコピー',
      ),
      state.config.repo
        ? el(
            'a',
            {
              class: 'btn',
              target: '_blank',
              rel: 'noopener',
              href: issueUrl(state.config.repo, day, submission(), state.setId),
              onclick: (e) => {
                e.currentTarget.href = issueUrl(
                  state.config.repo,
                  day,
                  submission(),
                  state.setId,
                );
              },
            },
            'GitHub Issue で提出',
          )
        : null,
      el(
        'button',
        {
          class: 'btn small',
          onclick: () => {
            preview.value = submission();
            toast('更新しました');
          },
        },
        '再読み込み',
      ),
    ),
    preview,
  );
  return card;
}

function settingsPanel() {
  const draft = loadDraft();
  const current = state.config.level.toeic;
  const frag = document.createDocumentFragment();

  const persistDraft = () => saveDraft(draft);

  /* ---- レベル ---- */
  const scoreLabel = el('span', { class: 'score' }, '');
  const bandBox = el('div', { class: 'explanation' });
  const slider = el('input', {
    type: 'range',
    min: String(TOEIC_MIN),
    max: String(TOEIC_MAX),
    step: '10',
    'aria-label': '目標TOEICスコア',
  });
  slider.value = String(draft.toeic ?? current);

  function refreshLevel() {
    const score = Number(slider.value);
    const profile = levelProfile(score);
    scoreLabel.textContent = `TOEIC ${score}`;
    scoreLabel.classList.toggle('done', score !== current);
    bandBox.replaceChildren(
      el('div', {}, `CEFR ${profile.cefr}`),
      el('div', {}, `語彙: ${profile.vocabulary}`),
      el('div', {}, `文長・構文: ${profile.sentence}`),
      el('div', {}, `話速: ${profile.speech}`),
    );
    draft.toeic = score === current ? null : score;
    persistDraft();
    refreshApply();
  }
  slider.addEventListener('input', refreshLevel);

  frag.append(
    el(
      'div',
      { class: 'card' },
      el('h2', {}, 'レベル ', scoreLabel),
      el('p', { class: 'meta' }, `現在の設定: TOEIC ${current} — 変更は次回の生成分から反映されます。`),
      el('div', { class: 'controls' }, slider),
      bandBox,
    ),
  );

  /* ---- テーマ ---- */
  const labelInput = el('input', { type: 'text', placeholder: '深海探査', 'aria-label': 'テーマ (日本語)' });
  const enInput = el('input', { type: 'text', placeholder: 'deep-sea exploration (省略可)', 'aria-label': 'テーマ (英語)' });
  const queue = el('ul', { class: 'topic-queue' });

  function addFromForm() {
    const topic = normalizeTopicInput(labelInput.value, enInput.value);
    if (!topic) return toast('テーマを入力してください');
    const known = state.topics.some(
      (t) => t.label === topic.label || (topic.en && topicKey(t) === topicKey(topic)),
    );
    if (known) return toast('すでに登録されています');
    if (draft.addTopics.some((t) => t.label === topic.label)) return toast('追加予定にあります');
    draft.addTopics.push(topic);
    labelInput.value = '';
    enInput.value = '';
    persistDraft();
    refreshQueue();
    refreshApply();
  }

  function refreshQueue() {
    queue.replaceChildren(
      ...draft.addTopics.map((topic, i) =>
        el(
          'li',
          {},
          el('span', {}, topic.label),
          el('span', { class: 'meta' }, topic.en ? topic.en : '英語フレーズは自動で補われます'),
          el(
            'button',
            {
              class: 'btn small',
              'aria-label': `${topic.label} を取り消す`,
              onclick: () => {
                draft.addTopics.splice(i, 1);
                persistDraft();
                refreshQueue();
                refreshApply();
              },
            },
            '取消',
          ),
        ),
      ),
    );
    queue.classList.toggle('hidden', draft.addTopics.length === 0);
  }

  labelInput.addEventListener('keydown', (e) => e.key === 'Enter' && addFromForm());
  enInput.addEventListener('keydown', (e) => e.key === 'Enter' && addFromForm());

  const known = el(
    'details',
    {},
    el('summary', { class: 'meta' }, `登録済みのテーマ ${state.topics.length} 件`),
    el(
      'table',
      { class: 'glossary' },
      [...state.topics]
        .sort((a, b) => (a.usedCount ?? 0) - (b.usedCount ?? 0))
        .map((t) =>
          el(
            'tr',
            {},
            el('td', {}, t.label),
            el('td', { class: 'meta' }, t.en),
            el('td', { class: 'meta' }, t.usedCount ? `${t.usedCount}回` : '未出題'),
          ),
        ),
    ),
  );

  frag.append(
    el(
      'div',
      { class: 'card' },
      el('h2', {}, 'テーマ'),
      el(
        'p',
        { class: 'meta' },
        '興味のあるワードを足すと、以降の問題からランダムに選ばれます。英語フレーズを省くと Gemini が訳して補います。',
      ),
      el('div', { class: 'controls topic-form' }, labelInput, enInput, el('button', { class: 'btn', onclick: addFromForm }, '追加')),
      queue,
      known,
    ),
  );

  /* ---- 反映 ---- */
  const summary = el('div', {});
  const actions = el('div', { class: 'controls' });
  const sentNote = el('p', { class: 'explanation hidden' });

  function refreshApply() {
    const payload = buildPayload(draft);
    const empty = isEmptyPayload(payload);

    summary.replaceChildren(
      empty
        ? el('p', { class: 'meta' }, '変更はありません。')
        : el(
            'ul',
            {},
            payload.toeic !== undefined
              ? el('li', {}, `目標レベル: TOEIC ${current} → ${payload.toeic}`)
              : null,
            ...(payload.addTopics ?? []).map((t) => el('li', {}, `テーマ追加: ${t.label}`)),
          ),
    );

    const body = empty ? '' : renderSettingsBody(payload, { toeic: current });
    actions.replaceChildren(
      state.config.repo
        ? el(
            'a',
            {
              class: `btn primary${empty ? ' disabled' : ''}`,
              target: '_blank',
              rel: 'noopener',
              href: empty ? '#' : settingsIssueUrl(state.config.repo, payload, { toeic: current }),
              onclick: (e) => {
                if (empty) return e.preventDefault();
                // Issue を開いた時点で「送信済み」とみなす。実際に反映されたかは
                // 次回読み込み時に data/*.json と突き合わせて判定する。
                saveSent(payload);
                refreshSent();
              },
            },
            'GitHub Issue で送信',
          )
        : null,
      el(
        'button',
        {
          class: 'btn small',
          onclick: async () => {
            if (empty) return toast('変更はありません');
            try {
              await navigator.clipboard.writeText(body);
              toast('コピーしました');
            } catch {
              toast('コピーできませんでした');
            }
          },
        },
        '内容をコピー',
      ),
      draft.toeic !== null || draft.addTopics.length
        ? el(
            'button',
            {
              class: 'btn small',
              onclick: () => {
                draft.toeic = null;
                draft.addTopics = [];
                slider.value = String(current);
                persistDraft();
                refreshLevel();
                refreshQueue();
              },
            },
            '下書きを破棄',
          )
        : null,
    );
  }

  function refreshSent() {
    const sent = loadSent();
    if (!sent) return sentNote.classList.add('hidden');
    if (isApplied(sent, { config: state.config, topics: state.topics })) {
      clearSent();
      return sentNote.classList.add('hidden');
    }
    const pending = pendingChanges(sent, { config: state.config, topics: state.topics });
    const parts = [
      pending.toeic !== null ? `TOEIC ${pending.toeic}` : null,
      ...pending.topics.map((t) => t.label),
    ].filter(Boolean);
    sentNote.textContent = `送信済み・反映待ち: ${parts.join(' / ')} — Actions が処理すると Issue にコメントが付き、次回このページを開いた時点でこの表示は消えます。`;
    sentNote.classList.remove('hidden');
  }

  frag.append(
    el('div', { class: 'card' }, el('h2', {}, '変更を反映する'), summary, actions, sentNote),
  );

  refreshLevel();
  refreshQueue();
  refreshSent();
  return frag;
}

/* ---------- 問題作成 ---------- */

/**
 * 生成は Actions 側で走るので、アプリは「Issue を出す → 新しいセットが
 * 増えるまで待つ → 出来たら開く」という形で追いかける。待機状態は
 * localStorage に置き、GitHub アプリへ移動して戻っても再開できるようにする。
 */
const generation = { running: false, message: '', error: '', listeners: new Set() };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function notifyGeneration() {
  for (const fn of generation.listeners) fn();
}

function setGenerationState({ message = '', error = '' }) {
  generation.message = message;
  generation.error = error;
  notifyGeneration();
}

async function pollForNewSet() {
  const pending = loadPendingGeneration();
  if (!pending || generation.running || !state.config.repo) return;

  generation.running = true;
  // 生成は 1 分前後かかる。無認証の GitHub API は 1 時間 60 回までなので、
  // 短い間隔で叩かず、最初だけ長めに待つ。
  const INTERVAL = 8000;
  const ATTEMPTS = 20;

  try {
    for (let i = 0; i < ATTEMPTS; i++) {
      if (!loadPendingGeneration()) return; // 待機を取り消された
      const waited = Math.round((Date.now() - pending.startedAt) / 1000);
      setGenerationState({ message: `作成中… (${waited}秒経過 / 目安1〜2分)` });
      await sleep(i === 0 ? 15000 : INTERVAL);
      if (!loadPendingGeneration()) return;

      let index;
      try {
        index = await fetchFromGitHub(state.config.repo, 'data/index.json');
      } catch (err) {
        if (err instanceof RateLimitError) {
          clearPendingGeneration();
          return setGenerationState({ error: err.message });
        }
        continue; // 一時的な失敗は次の周回で拾う
      }

      const fresh = index.days.find((d) => !pending.knownIds.includes(d.id));
      if (!fresh) continue;

      state.index = index;
      clearPendingGeneration();
      setGenerationState({ message: '' });
      refreshSetPicker(fresh.id);
      state.tab = OPEN_DAY; // 出来たての問題を、その日のセットの最初のタブで開く
      await loadSet(fresh.id);
      toast(`「${fresh.topic}」ができました`);
      return;
    }
    clearPendingGeneration();
    setGenerationState({
      error:
        '時間内に完成を確認できませんでした。Issue のコメントで失敗していないか確かめ、' +
        '成功していればページを開き直してください。',
    });
  } finally {
    generation.running = false;
    notifyGeneration();
  }
}

function generatePanel() {
  const card = el('div', { class: 'card' });
  const status = el('p', { class: 'explanation hidden' });

  const listId = 'known-topics';
  const input = el('input', {
    type: 'text',
    list: listId,
    placeholder: '深海探査 (空ならおまかせ)',
    'aria-label': 'テーマ',
  });
  const datalist = el(
    'datalist',
    { id: listId },
    state.topics.map((t) => el('option', { value: t.label })),
  );

  const stop = el(
    'button',
    {
      class: 'btn small hidden',
      onclick: () => {
        clearPendingGeneration();
        setGenerationState({ message: '' });
        toast('待機をやめました (作成自体は続きます)');
      },
    },
    '待機をやめる',
  );

  const submit = el(
    'a',
    {
      class: 'btn primary',
      target: '_blank',
      rel: 'noopener',
      href: '#',
      onclick: (e) => {
        if (!state.config.repo) {
          e.preventDefault();
          return toast('data/config.json の repo が未設定です');
        }
        e.currentTarget.href = generateIssueUrl(state.config.repo, input.value);
        savePendingGeneration({
          topic: input.value.trim(),
          startedAt: Date.now(),
          knownIds: state.index.days.map((d) => d.id),
        });
        input.value = '';
        setGenerationState({ message: '作成中… (0秒経過 / 目安1〜2分)' });
        pollForNewSet();
      },
    },
    '作成する',
  );

  function refresh() {
    const pending = loadPendingGeneration();
    const text = generation.error || generation.message;
    status.textContent = text;
    status.classList.toggle('hidden', !text);
    status.classList.toggle('error', Boolean(generation.error));
    stop.classList.toggle('hidden', !pending);
    submit.classList.toggle('disabled', Boolean(pending));
  }

  generation.listeners.clear();
  generation.listeners.add(refresh);

  card.append(
    el('h2', {}, '問題を作る'),
    el(
      'p',
      { class: 'meta' },
      'テーマを1つ入れて「作成する」を押すと GitHub の Issue が開きます。' +
        'そのまま送信すれば作成が始まり、出来たこのページが自動で開きます (目安1〜2分)。',
    ),
    el('div', { class: 'controls topic-form' }, input, datalist, submit, stop),
    status,
    el(
      'p',
      { class: 'meta' },
      '新しいテーマはそのままネタ帳にも追加されます。空のまま押すと、ネタ帳から自動で選びます。',
    ),
  );

  refresh();
  return card;
}

/* ---------- 動画 (YouTube) ---------- */

/**
 * 生成は GAS ウェブアプリ (gas/Code.gs) 経由で Gemini を呼ぶ。Actions を通さないので
 * その場で結果が返る。プロンプトと検証は web/video.js が持ち、検証に落ちたら
 * エラーを添えて作り直す (generate-day.mjs と同じ考え方)。
 */
const video = { player: null, entryId: null, busy: false, open: null };

function destroyVideoPlayer() {
  video.player?.destroy();
  video.player = null;
}

async function requestVideoSet({ videoId, start, end }, onProgress) {
  const { gasUrl, token } = loadVideoConnection();
  if (!gasUrl || !token) throw new Error('先に「接続設定」で GAS の URL と合言葉を保存してください');

  const cfg = videoConfig(state.config);
  let feedback = [];

  for (let attempt = 1; attempt <= cfg.attempts; attempt++) {
    onProgress(attempt);
    const prompt = buildVideoPrompt({ start, end, feedback });
    const req = buildGasRequest({ token, videoId, start, end, prompt, model: cfg.model });
    // Content-Type を付けずに文字列で送る = text/plain の単純リクエスト。
    // GAS はプリフライト (OPTIONS) に答えられないので、これ以外の形だと CORS で落ちる。
    const res = await fetch(gasUrl, { method: 'POST', body: JSON.stringify(req) });
    if (!res.ok) throw new Error(`GAS に接続できませんでした (${res.status})`);

    let body;
    try {
      body = await res.json();
    } catch {
      throw new Error(
        'GAS の応答が JSON ではありません。' +
          'デプロイの「アクセスできるユーザー」が「全員」か確認してください',
      );
    }

    let set;
    try {
      set = parseGasResponse(body);
    } catch (err) {
      if (err instanceof GasError && err.retriable && attempt < cfg.attempts) continue;
      throw err;
    }

    const errors = validateVideoSet(set, { start, end });
    if (errors.length === 0) return set;
    feedback = errors.slice(0, 15);
  }
  throw new Error(`字幕が条件を満たしませんでした: ${feedback.slice(0, 3).join(' / ')}`);
}

/**
 * 字幕を作って保存する。進み具合は setStatus に流す。
 * 作成フォームと「再生区間を変更」(字幕の無い範囲へ広げたとき) の両方から使う。
 */
async function createVideoEntry({ videoId, start, end }, setStatus) {
  if (video.busy) throw new Error('作成中です。終わるまでお待ちください');
  video.busy = true;
  const began = Date.now();
  const tick = () =>
    setStatus(`作成中… (${Math.round((Date.now() - began) / 1000)}秒経過 / 目安30秒〜2分)`);
  tick();
  const timer = setInterval(tick, 1000);
  try {
    const set = await requestVideoSet({ videoId, start, end }, (attempt) => {
      if (attempt > 1) toast(`条件を満たさなかったので作り直しています (${attempt}回目)`);
    });
    const id = `${videoId}@${start}-${end}`;
    const entry = { id, videoId, start, end, createdAt: Date.now(), set };
    saveVideoEntry(entry);
    setStatus('');
    return entry;
  } finally {
    clearInterval(timer);
    video.busy = false;
  }
}

/** 入力欄の時刻を読み、区間として正しくなければ日本語のメッセージを返す。 */
function readRange(startInput, endInput, minSeconds) {
  const start = parseTime(startInput.value);
  const end = parseTime(endInput.value);
  const error = checkRange(start, end, videoConfig(state.config).maxSeconds, minSeconds);
  return error ? { error } : { start, end };
}

const timeInput = (placeholder, label) =>
  el('input', { type: 'text', placeholder, 'aria-label': label, inputmode: 'numeric' });

function statusLine() {
  const node = el('p', { class: 'explanation hidden' });
  node.set = (text, isError = false) => {
    node.textContent = text;
    node.classList.toggle('hidden', !text);
    node.classList.toggle('error', isError);
  };
  return node;
}

function videoPanel() {
  const frag = document.createDocumentFragment();
  const viewer = el('div', {});

  /* ---- 作成フォーム ---- */
  const urlInput = el('input', {
    type: 'url',
    placeholder: 'https://www.youtube.com/watch?v=...',
    'aria-label': 'YouTube の URL',
  });
  const startInput = timeInput('開始 1:20', '開始時刻');
  const endInput = timeInput('終了 2:05', '終了時刻');
  const status = statusLine();

  // 共有リンクに t= が付いていれば開始に入れておく。
  urlInput.addEventListener('change', () => {
    const parsed = parseYouTubeUrl(urlInput.value);
    if (parsed?.start != null && !startInput.value) startInput.value = formatTime(parsed.start);
  });

  const submit = el(
    'button',
    {
      class: 'btn primary',
      onclick: async () => {
        const parsed = parseYouTubeUrl(urlInput.value);
        if (!parsed) return status.set('YouTube の動画 URL を入れてください', true);
        const range = readRange(startInput, endInput);
        if (range.error) return status.set(range.error, true);

        submit.classList.add('disabled');
        try {
          const entry = await createVideoEntry({ videoId: parsed.id, ...range }, status.set);
          openEntry(entry.id);
          toast('字幕ができました');
        } catch (err) {
          status.set(err.message ?? String(err), true);
        } finally {
          submit.classList.remove('disabled');
        }
      },
    },
    '作成する',
  );

  /* ---- 接続設定 ---- */
  const conn = loadVideoConnection();
  const gasInput = el('input', {
    type: 'url',
    placeholder: 'https://script.google.com/macros/s/.../exec',
    'aria-label': 'GAS ウェブアプリの URL',
  });
  gasInput.value = conn.gasUrl;
  const tokenInput = el('input', {
    type: 'password',
    placeholder: '合言葉',
    'aria-label': '合言葉',
    autocomplete: 'off',
  });
  tokenInput.value = conn.token;
  const connection = el(
    'details',
    conn.gasUrl && conn.token ? {} : { open: 'open' },
    el('summary', { class: 'meta' }, '接続設定 (GAS の URL と合言葉)'),
    el(
      'p',
      { class: 'meta' },
      'この端末にだけ保存されます。作り方はリポジトリの gas/README.md を参照してください。',
    ),
    el(
      'div',
      { class: 'controls topic-form' },
      gasInput,
      tokenInput,
      el(
        'button',
        {
          class: 'btn',
          onclick: () => {
            saveVideoConnection({ gasUrl: gasInput.value.trim(), token: tokenInput.value });
            toast('保存しました');
          },
        },
        '保存',
      ),
    ),
  );

  /* ---- 保存した動画 ---- */
  const libraryList = el('ul', { class: 'video-library' });
  const libraryCard = el('div', { class: 'card' }, el('h2', {}, '保存した動画'), libraryList);

  function refreshLibrary() {
    const entries = loadVideoLibrary();
    libraryList.replaceChildren(
      ...entries.map((entry) =>
        el(
          'li',
          { class: entry.id === video.entryId ? 'current' : '' },
          el(
            'button',
            { class: 'link', onclick: () => openEntry(entry.id) },
            el('span', {}, entry.set?.title ?? entry.videoId),
            el('span', { class: 'meta' }, `${formatTime(entry.start)}〜${formatTime(entry.end)}`),
          ),
          el(
            'button',
            {
              class: 'btn small',
              'aria-label': `${videoLabel(entry)} を削除`,
              onclick: () => {
                if (!confirm(`「${videoLabel(entry)}」を削除しますか？`)) return;
                removeVideoEntry(entry.id);
                if (entry.id === video.entryId) openEntry(null);
                else refreshLibrary();
                toast('削除しました');
              },
            },
            '削除',
          ),
        ),
      ),
    );
    libraryCard.classList.toggle('hidden', entries.length === 0);
  }

  function openEntry(id) {
    const entry = id ? loadVideoLibrary().find((e) => e.id === id) : null;
    destroyVideoPlayer();
    video.entryId = entry?.id ?? null;
    viewer.replaceChildren(...(entry ? videoViewer(entry) : []));
    refreshLibrary();
  }
  // 再生区間の変更で新しい字幕を作ったとき、ビューアからも開けるように。
  video.open = openEntry;

  frag.append(
    el(
      'div',
      { class: 'card' },
      el('h2', {}, '動画を追加'),
      el(
        'p',
        { class: 'meta' },
        'YouTube の公開動画の URL と区間 (5分以内) を入れると、英語字幕と日本語訳を作ります。',
      ),
      el('div', { class: 'controls topic-form' }, urlInput),
      el('div', { class: 'controls topic-form' }, startInput, endInput, submit),
      status,
      connection,
    ),
    viewer,
    libraryCard,
  );

  // タブを作り直したとき (別のセットを開いたとき) も開いていた動画を戻す。
  openEntry(video.entryId);
  return frag;
}

function videoViewer(entry) {
  const { set } = entry;
  // 再生区間。字幕を作った範囲の内側なら、作り直さずに狭めたり動かしたりできる。
  const play = { start: entry.play?.start ?? entry.start, end: entry.play?.end ?? entry.end };

  /* ---- プレーヤー ---- */
  const host = el('div', {});
  const frame = el('div', { class: 'video-frame' }, host);
  const rate = el(
    'select',
    { 'aria-label': '再生速度' },
    [0.5, 0.75, 1, 1.25].map((r) => el('option', { value: String(r) }, `${r}x`)),
  );
  rate.value = '1';
  rate.addEventListener('change', () => video.player?.setRate(Number(rate.value)));

  const ready = createPlayer(host, { videoId: entry.videoId, ...play })
    .then((player) => {
      // 待っている間に別の動画を開いていたら捨てる。
      if (video.entryId !== entry.id) return player.destroy();
      video.player = player;
    })
    .catch((err) => toast(err.message));
  const withPlayer = (fn) => () => ready.then(() => video.player && fn(video.player));

  /* ---- 再生区間 ---- */
  const rangeLabel = el('p', { class: 'meta' });
  const playStart = timeInput('開始', '再生区間の開始');
  const playEnd = timeInput('終了', '再生区間の終了');
  const rangeStatus = statusLine();
  const resetBtn = el(
    'button',
    { class: 'btn small', onclick: () => applyPlayRange(entry.start, entry.end) },
    '最初の区間に戻す',
  );

  function refreshRange() {
    playStart.value = formatTime(play.start);
    playEnd.value = formatTime(play.end);
    const narrowed = play.start !== entry.start || play.end !== entry.end;
    rangeLabel.textContent =
      `再生区間 ${formatTime(play.start)}〜${formatTime(play.end)}` +
      (narrowed ? ` (字幕は ${formatTime(entry.start)}〜${formatTime(entry.end)})` : '');
    resetBtn.classList.toggle('hidden', !narrowed);
  }

  function applyPlayRange(start, end) {
    play.start = start;
    play.end = end;
    entry.play = start === entry.start && end === entry.end ? undefined : { start, end };
    saveVideoEntry(entry);
    video.player?.setSegment(start, end);
    refreshRange();
    renderTranscript();
  }

  const changeBtn = el(
    'button',
    {
      class: 'btn small',
      onclick: async () => {
        // 字幕のある範囲の内側なら、再生区間を変えるだけ (API を呼ばない)。
        // 1文だけのくり返しもできるよう、このときは1秒から受け付ける。
        const inner = readRange(playStart, playEnd, 1);
        if (!inner.error && inner.start >= entry.start && inner.end <= entry.end) {
          rangeStatus.set('');
          applyPlayRange(inner.start, inner.end);
          return toast('再生区間を変更しました');
        }
        const range = readRange(playStart, playEnd);
        if (range.error) return rangeStatus.set(range.error, true);
        rangeStatus.set('');
        // 外側にはみ出すときは、その区間の字幕を新しく作る。
        changeBtn.classList.add('disabled');
        try {
          const created = await createVideoEntry(
            { videoId: entry.videoId, ...range },
            rangeStatus.set,
          );
          video.open?.(created.id);
          toast('新しい区間の字幕ができました');
        } catch (err) {
          rangeStatus.set(err.message ?? String(err), true);
        } finally {
          changeBtn.classList.remove('disabled');
        }
      },
    },
    '変更',
  );

  // 見出しと区間の変更はスクロールで流れてよい。動画と再生ボタンだけを上に固定する
  // (player-stage)。固定は親 (ビューア) の中で効くので、字幕カードを読み進める間ずっと見える。
  const infoCard = el(
    'div',
    { class: 'card' },
    el('h2', {}, set.title),
    rangeLabel,
    el(
      'details',
      {},
      el('summary', { class: 'meta' }, '再生区間を変更'),
      el(
        'p',
        { class: 'meta' },
        `字幕のある ${formatTime(entry.start)}〜${formatTime(entry.end)} の内側ならすぐ切り替わります。` +
          'はみ出す区間は字幕を新しく作ります。',
      ),
      el('div', { class: 'controls topic-form' }, playStart, playEnd, changeBtn, resetBtn),
      rangeStatus,
    ),
  );

  const stage = el(
    'div',
    { class: 'player-stage' },
    frame,
    el(
      'div',
      { class: 'controls' },
      el(
        'button',
        {
          class: 'btn primary small',
          'aria-label': '区間をくり返す',
          onclick: withPlayer((p) => p.playSegment(true)),
        },
        '🔁 くり返す',
      ),
      el(
        'button',
        {
          class: 'btn small',
          'aria-label': '区間を1回だけ再生',
          onclick: withPlayer((p) => p.playSegment(false)),
        },
        '▶ 1回',
      ),
      el('button', { class: 'btn small', onclick: withPlayer((p) => p.pause()) }, '■ 停止'),
      rate,
    ),
  );

  /* ---- 字幕 ---- */
  const transcriptList = el('ol', { class: 'transcript' });
  const noneNote = el(
    'p',
    { class: 'meta' },
    '字幕を隠しています。各行の ▶ でその部分だけ再生できます。',
  );
  // ▶ で再生する単位。短い行は文末までつないでおく (表示時に通すので古いデータにも効く)。
  const segments = groupTranscript(set.transcript, videoConfig(state.config).segment);
  let mode = resolveSubtitleMode(loadSubtitleMode(), set.transcript);
  const hasJa = resolveSubtitleMode('ja', set.transcript) === 'ja';

  const modeButtons = SUBTITLE_MODES.map((m) =>
    el(
      'button',
      {
        class: 'btn small',
        'aria-pressed': 'false',
        // 日本語訳を作る前に保存した動画には ja が無い。
        ...(m.id === 'ja' && !hasJa ? { disabled: 'disabled', title: '日本語訳がありません' } : {}),
        onclick: () => {
          mode = m.id;
          saveSubtitleMode(mode);
          refreshMode();
        },
      },
      m.label,
    ),
  );

  function refreshMode() {
    SUBTITLE_MODES.forEach((m, i) => {
      modeButtons[i].setAttribute('aria-pressed', String(m.id === mode));
    });
    transcriptList.className = `transcript subs-${mode}`;
    noneNote.classList.toggle('hidden', mode !== 'none');
  }

  function renderTranscript() {
    // 再生区間に少しでも掛かる行だけを出す。
    const lines = segments.filter((l) => l.end > play.start && l.start < play.end);
    transcriptList.replaceChildren(
      ...lines.map((line) =>
        el(
          'li',
          {},
          el(
            'button',
            {
              class: 'btn small',
              'aria-label': `${formatTime(line.start)} から再生`,
              onclick: withPlayer((p) => p.playLine(line)),
            },
            `▶ ${formatTime(line.start)}`,
          ),
          el(
            'div',
            { class: 'line' },
            el(
              'div',
              { class: 'line-en' },
              line.speaker ? el('span', { class: 'meta' }, `${line.speaker}: `) : null,
              line.text,
            ),
            line.ja ? el('div', { class: 'line-ja' }, line.ja) : null,
          ),
        ),
      ),
    );
  }

  // 表示の切り替えは、字幕を読み進めながら押せるよう動画の下 (固定部分) に置く。
  stage.append(
    el(
      'div',
      { class: 'controls segmented', role: 'group', 'aria-label': '字幕の表示' },
      modeButtons,
    ),
  );

  const subtitleCard = el('div', { class: 'card' }, el('h2', {}, '字幕'), noneNote, transcriptList);

  refreshRange();
  renderTranscript();
  refreshMode();
  return [infoCard, stage, subtitleCard];
}

/* ---------- shell ---------- */

const PANELS = [
  ['listening', 'リスニング', listeningPanel],
  ['dictation', 'ディクテーション', dictationPanel],
  ['reading', 'リーディング', readingPanel],
  ['writing', '英作文', writingPanel],
];

/** 動画タブがメイン。先頭に置き、起動時はここを開く。 */
const MAIN_PANELS = [['video', '動画', videoPanel]];

/** その日の問題に紐づかないタブ。常に最後に並ぶ。 */
const EXTRA_PANELS = [
  ['review', '採点', reviewPanel],
  ['generate', '作成', generatePanel],
  ['settings', '設定', settingsPanel],
];

/** state.tab に入れると「その日のセットの最初のタブ」を開く。 */
const OPEN_DAY = Symbol('open-day');

function render(day) {
  stop();
  destroyVideoPlayer();
  const tabs = $('#tabs');
  const panels = $('#panels');
  tabs.replaceChildren();
  panels.replaceChildren();

  const dayEntries = PANELS.filter(([key]) => day[key]);
  const entries = [...MAIN_PANELS, ...dayEntries, ...EXTRA_PANELS];
  if (state.tab === OPEN_DAY) state.tab = dayEntries[0]?.[0] ?? null;

  for (const [key, label, build] of entries) {
    const panel = el('section', { class: 'panel', id: `panel-${key}` });
    panel.append(build(day));
    panels.append(panel);

    const tab = el(
      'button',
      {
        role: 'tab',
        'aria-selected': 'false',
        'aria-controls': `panel-${key}`,
        onclick: () => selectTab(key),
      },
      label,
    );
    tabs.append(tab);
  }

  selectTab(state.tab && entries.some(([k]) => k === state.tab) ? state.tab : entries[0][0]);
  updateScore();
}

function selectTab(key) {
  state.tab = key;
  // 動画タブでは日付の選択がいらないので、ヘッダを詰めて字幕の表示幅を空ける (CSS 側)。
  document.body.dataset.tab = key;
  stop();
  if (key !== 'video') video.player?.pause();
  document.querySelectorAll('#panels .panel').forEach((p) => {
    p.classList.toggle('active', p.id === `panel-${key}`);
  });
  document.querySelectorAll('#tabs button').forEach((b) => {
    b.setAttribute('aria-selected', String(b.getAttribute('aria-controls') === `panel-${key}`));
  });
  if (key === 'review') {
    // The preview is a snapshot; rebuild it whenever the tab is opened.
    const preview = document.querySelector('#panel-review textarea');
    if (preview) preview.value = buildSubmission(state.day, state.answers, state.setId);
  }
}

async function loadSet(setId) {
  state.day = await fetchSetFile(state.config.repo, setId);
  state.setId = setId;
  state.answers = loadAnswers(setId);
  $('#day-meta').textContent = `${state.day.topic.label} · TOEIC ${state.day.level.toeic} 相当`;
  const url = new URL(location.href);
  url.searchParams.set('set', setId);
  url.searchParams.delete('date');
  history.replaceState(null, '', url);
  render(state.day);
}

/**
 * 選択肢を index の内容から作り直す (生成直後に新しいセットを足すため)。
 * 同じ日に複数セットがあると日付とテーマだけでは区別できないので、
 * id の連番 (`YYYY-MM-DD-2` の 2) を添える。
 */
function setLabel({ id, date, topic }) {
  const seq = String(id).slice(11);
  return `${date} · ${topic}${seq ? ` #${seq}` : ''}`;
}

function refreshSetPicker(selected) {
  const select = $('#day-select');
  select.replaceChildren(
    ...state.index.days.map((d) => el('option', { value: d.id }, setLabel(d))),
  );
  select.value = selected;
}

/** sticky な動画の top に使うヘッダの高さ。折り返しや表示切り替えで変わるので見張る。 */
function trackHeaderHeight() {
  const header = document.querySelector('header');
  const update = () =>
    document.documentElement.style.setProperty('--header-h', `${header.offsetHeight}px`);
  update();
  if ('ResizeObserver' in window) new ResizeObserver(update).observe(header);
}

async function boot() {
  trackHeaderHeight();
  try {
    const [config, index, topics] = await Promise.all([
      fetch('data/config.json', { cache: 'no-cache' }).then((r) => r.json()),
      fetch('data/index.json', { cache: 'no-cache' }).then((r) => r.json()),
      // 設定タブでしか使わないが、失敗してもアプリ全体は動かす。
      fetch('data/topics.json', { cache: 'no-cache' })
        .then((r) => r.json())
        .catch(() => ({ topics: [] })),
    ]);
    state.config = config;
    state.index = index;
    state.topics = topics.topics ?? [];

    if (index.days.length === 0) throw new Error('問題がまだありません');

    const params = new URL(location.href).searchParams;
    const requested = params.get('set') ?? params.get('date');
    const initial = index.days.some((d) => d.id === requested) ? requested : index.days[0].id;
    refreshSetPicker(initial);
    $('#day-select').addEventListener('change', (e) => loadSet(e.target.value).catch(showError));

    await loadSet(initial);

    // Voice loading can take up to a second in some browsers; never make the
    // learner wait on it to see the questions.
    if (!isSupported()) toast('この端末では音声再生が使えません');
    else initSpeech(config.speech.lang);

    // 生成待ちのまま離脱していたら追いかけを再開する。
    if (loadPendingGeneration()) pollForNewSet();
  } catch (err) {
    showError(err);
  }
}

function showError(err) {
  $('#status').textContent = err.message ?? String(err);
}

boot();
