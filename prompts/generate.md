あなたは日本人学習者向けの英語教材を作るプロの教材作成者です。
以下の条件で **1日分の学習セット** を作り、指定パスに JSON として書き出してください。

## 条件
- 日付: `{{DATE}}`
- テーマ: **{{TOPIC_LABEL}}** ({{TOPIC_EN}})
- 目標レベル: TOEIC {{TOEIC}} 相当 / CEFR {{CEFR}}
  - 語彙: {{VOCABULARY}}
  - 文長・構文: {{SENTENCE}}
  - 音声を想定した話速: {{SPEECH}}
- 出力先: `data/days/{{DATE}}.json`
- 出力は JSON ファイルのみ。説明文は書かない。

## セクション仕様
{{SECTION_SPEC}}

## 品質ルール
1. `listening.script` は 1 人語り、または話者名付きの対話 (`Ken: ...` 形式)。
   ブラウザの音声合成で読み上げるため、記号や箇条書きは使わず地の文で書く。
2. `dictation.sentences[].text` は listening.script と**重複させない**。
   同じテーマの別の文を新規に書く。各文は10〜20語で、
   その回で狙う音声現象 (連結・脱落・弱形など) を `hint` に日本語で書く。
3. 選択肢問題の不正解選択肢は「本文にない情報」「言い換えの罠」「部分的に正しい」の
   3タイプを混ぜる。正解位置は問題ごとに散らす。
4. `explanation` は日本語。根拠となる英文の該当箇所を引用して示す。
5. `writing.prompt` は意見・比較・提案のいずれかを求める形式にし、
   `keyPoints` に採点で見るべき観点を日本語で挙げる。
   `modelAnswer` は指定語数に収まる模範解答を英語で書く。
6. `reading.glossary` にはテーマ固有語を5〜8語、`word` と日本語の `meaning` で入れる。

## JSON スキーマ
`scripts/lib/schema.mjs` の `validateDay` を必ず通ること。書き出したあとに
`node scripts/finalize-day.mjs --date={{DATE}}` を実行し、エラーが出たら直して再実行する。

```json
{
  "date": "{{DATE}}",
  "topic": { "id": "{{TOPIC_ID}}", "label": "{{TOPIC_LABEL}}", "en": "{{TOPIC_EN}}" },
  "level": { "toeic": {{TOEIC}}, "cefr": "{{CEFR}}" },
  "listening": {
    "title": "英語のタイトル",
    "script": "読み上げ用の英文スクリプト",
    "questions": [
      { "id": "l1", "prompt": "英語の設問", "choices": ["...", "...", "...", "..."], "answer": 0, "explanation": "日本語の解説" }
    ]
  },
  "dictation": {
    "sentences": [ { "id": "d1", "text": "English sentence.", "hint": "狙う音声現象の日本語説明" } ]
  },
  "reading": {
    "passage": "英文パッセージ",
    "glossary": [ { "word": "term", "meaning": "日本語訳" } ],
    "questions": [
      { "id": "r1", "prompt": "英語の設問", "choices": ["...", "...", "...", "..."], "answer": 0, "explanation": "日本語の解説" }
    ]
  },
  "writing": {
    "prompt": "英作文の課題文",
    "words": [{{WRITING_MIN}}, {{WRITING_MAX}}],
    "keyPoints": ["採点観点1", "採点観点2"],
    "modelAnswer": "模範解答の英文"
  }
}
```
