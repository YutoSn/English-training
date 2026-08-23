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
} from './settings.js';
// バンド定義は生成プロンプトが使うものと同じ実体 (二重管理を避ける)。
import { levelProfile } from './level.js';

const state = { config: null, index: null, topics: [], day: null, answers: null, tab: null };

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
  saveAnswers(state.day.date, state.answers);
}

/* ---------- shared question rendering ---------- */

function renderChoiceQuestions(section, questions) {
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
      input.checked = state.answers[section][q.id] === i;
      input.addEventListener('change', () => {
        state.answers[section][q.id] = i;
        persist();
        mark();
        updateScore();
      });
      return el('label', { class: 'choice' }, input, el('span', {}, choice));
    });

    // Feedback is immediate: choice questions have an objective answer, so
    // there is nothing to gain by making the learner wait for grading.
    function mark() {
      const picked = state.answers[section][q.id];
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
  const submission = () => buildSubmission(day, state.answers);
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
              href: issueUrl(state.config.repo, day, submission()),
              onclick: (e) => {
                e.currentTarget.href = issueUrl(state.config.repo, day, submission());
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

/* ---------- shell ---------- */

const PANELS = [
  ['listening', 'リスニング', listeningPanel],
  ['dictation', 'ディクテーション', dictationPanel],
  ['reading', 'リーディング', readingPanel],
  ['writing', '英作文', writingPanel],
];

/** その日の問題に紐づかないタブ。常に最後に並ぶ。 */
const EXTRA_PANELS = [
  ['review', '採点', reviewPanel],
  ['settings', '設定', settingsPanel],
];

function render(day) {
  stop();
  const tabs = $('#tabs');
  const panels = $('#panels');
  tabs.replaceChildren();
  panels.replaceChildren();

  const entries = [...PANELS.filter(([key]) => day[key]), ...EXTRA_PANELS];

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
  stop();
  document.querySelectorAll('#panels .panel').forEach((p) => {
    p.classList.toggle('active', p.id === `panel-${key}`);
  });
  document.querySelectorAll('#tabs button').forEach((b) => {
    b.setAttribute('aria-selected', String(b.getAttribute('aria-controls') === `panel-${key}`));
  });
  if (key === 'review') {
    // The preview is a snapshot; rebuild it whenever the tab is opened.
    const preview = document.querySelector('#panel-review textarea');
    if (preview) preview.value = buildSubmission(state.day, state.answers);
  }
}

async function loadDay(date) {
  const res = await fetch(`data/days/${date}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${date} の問題を読み込めませんでした`);
  state.day = await res.json();
  state.answers = loadAnswers(date);
  $('#day-meta').textContent = `${state.day.topic.label} · TOEIC ${state.day.level.toeic} 相当`;
  const url = new URL(location.href);
  url.searchParams.set('date', date);
  history.replaceState(null, '', url);
  render(state.day);
}

async function boot() {
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

    const select = $('#day-select');
    select.replaceChildren(
      ...index.days.map((d) => el('option', { value: d.date }, `${d.date} · ${d.topic}`)),
    );
    const requested = new URL(location.href).searchParams.get('date');
    const initial = index.days.some((d) => d.date === requested) ? requested : index.days[0].date;
    select.value = initial;
    select.addEventListener('change', () => loadDay(select.value).catch(showError));

    await loadDay(initial);

    // Voice loading can take up to a second in some browsers; never make the
    // learner wait on it to see the questions.
    if (!isSupported()) toast('この端末では音声再生が使えません');
    else initSpeech(config.speech.lang);
  } catch (err) {
    showError(err);
  }
}

function showError(err) {
  $('#status').textContent = err.message ?? String(err);
}

boot();
