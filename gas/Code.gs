/**
 * English Training の動画教材 API (Google Apps Script ウェブアプリ)。
 *
 * やることは「合言葉を確かめて、YouTube の区間を Gemini に渡して、結果を返す」だけ。
 * プロンプト・responseSchema・検証はアプリ側 (web/video.js) が持つ。
 * GAS の再デプロイは手作業なので、教材の作り方を変えてもここを触らずに済むようにしている。
 *
 * スクリプト プロパティ (プロジェクトの設定 → スクリプト プロパティ):
 *   GEMINI_API_KEY  https://aistudio.google.com/apikey で取得したキー
 *   APP_TOKEN       アプリの「接続設定」に入れる合言葉 (長めのランダム文字列)
 *
 * セットアップ手順は gas/README.md。
 */

var GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
var DEFAULT_MODEL = 'gemini-flash-latest';
// GAS の1実行は6分まで。長い区間は Gemini の処理がそこに収まらない。
var MAX_SECONDS = 600;
var MAX_PROMPT_CHARS = 20000;
var YOUTUBE_RE = /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/;
var MODEL_RE = /^[a-z0-9][a-z0-9.\-]{0,63}$/;

/** 疎通確認用。ブラウザでウェブアプリの URL を開くとこれが返る。 */
function doGet() {
  return json_({ ok: true, service: 'english-training-video' });
}

function doPost(e) {
  try {
    var req = parseRequest_(e);
    var props = PropertiesService.getScriptProperties();
    var token = props.getProperty('APP_TOKEN');
    var apiKey = props.getProperty('GEMINI_API_KEY');
    if (!token || !apiKey) {
      return fail_('GAS のスクリプト プロパティに APP_TOKEN と GEMINI_API_KEY を設定してください');
    }
    if (req.token !== token) return fail_('合言葉が一致しません');

    var error = checkRequest_(req);
    if (error) return fail_(error);

    var text = callGemini_(apiKey, req);
    return json_({ ok: true, text: text });
  } catch (err) {
    return fail_(String((err && err.message) || err), Boolean(err && err.retriable));
  }
}

function parseRequest_(e) {
  var raw = e && e.postData && e.postData.contents;
  if (!raw) throw new Error('リクエスト本文が空です');
  try {
    return JSON.parse(raw);
  } catch (_) {
    throw new Error('リクエスト本文が JSON ではありません');
  }
}

/** 中継の範囲をこの1種類の呼び出しに絞る (合言葉が漏れても汎用プロキシにならないように)。 */
function checkRequest_(req) {
  if (!YOUTUBE_RE.test(String(req.videoUrl))) return 'videoUrl が YouTube の動画 URL ではありません';
  var start = Number(req.start);
  var end = Number(req.end);
  if (!isFinite(start) || !isFinite(end) || start < 0 || end <= start) return '区間が不正です';
  if (end - start > MAX_SECONDS) return '区間が長すぎます (' + MAX_SECONDS + '秒まで)';
  if (typeof req.prompt !== 'string' || !req.prompt) return 'prompt がありません';
  if (req.prompt.length > MAX_PROMPT_CHARS) return 'prompt が長すぎます';
  if (req.model && !MODEL_RE.test(String(req.model))) return 'model の名前が不正です';
  if (!req.schema || typeof req.schema !== 'object') return 'schema がありません';
  return null;
}

function callGemini_(apiKey, req) {
  var model = req.model || DEFAULT_MODEL;
  var body = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            fileData: { fileUri: req.videoUrl },
            videoMetadata: {
              startOffset: Math.floor(Number(req.start)) + 's',
              endOffset: Math.ceil(Number(req.end)) + 's',
            },
          },
          { text: req.prompt },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 16384,
      responseMimeType: 'application/json',
      responseSchema: req.schema,
      // 欲しいのは音声の書き起こしなので、映像は低解像度で足りる (トークン節約)。
      mediaResolution: 'MEDIA_RESOLUTION_LOW',
    },
  };

  var url = GEMINI_BASE + '/models/' + model + ':generateContent';
  var lastError;
  for (var attempt = 1; attempt <= 3; attempt++) {
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': apiKey },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    var status = res.getResponseCode();
    var content = res.getContentText();
    if (status === 200) return textOf_(JSON.parse(content));

    // 429 = 無料枠のレート上限、5xx = 一時障害。400 系はリクエストの誤りなので即失敗。
    var retriable = status === 429 || status >= 500;
    lastError = new Error('Gemini API ' + status + ': ' + content.slice(0, 500));
    lastError.retriable = retriable;
    if (!retriable || attempt === 3) break;
    Utilities.sleep(3000 * attempt);
  }
  throw lastError;
}

function textOf_(response) {
  var candidate = response.candidates && response.candidates[0];
  var reason = candidate && candidate.finishReason;
  if (reason && reason !== 'STOP') {
    var err = new Error('生成が完了しませんでした (finishReason: ' + reason + ')');
    err.retriable = reason === 'MAX_TOKENS';
    throw err;
  }
  var parts = (candidate && candidate.content && candidate.content.parts) || [];
  var text = parts
    .map(function (p) {
      return p.text || '';
    })
    .join('')
    .trim();
  if (!text) {
    var empty = new Error('Gemini が空の応答を返しました');
    empty.retriable = true;
    throw empty;
  }
  return text;
}

function fail_(message, retriable) {
  return json_({ ok: false, error: message, retriable: Boolean(retriable) });
}

// ContentService は常に HTTP 200 を返す。成否は本文の ok で伝える。
function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
