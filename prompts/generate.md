あなたは日本人学習者向けの英語教材を作るプロの教材作成者です。
以下の条件で **1日分の学習セット** を JSON で出力してください。

## 条件
- 日付: `{{DATE}}`
- テーマ: **{{TOPIC_LABEL}}** ({{TOPIC_EN}})
- 目標レベル: TOEIC {{TOEIC}} 相当 / CEFR {{CEFR}}
  - 語彙: {{VOCABULARY}}
  - 文長・構文: {{SENTENCE}}
  - 音声を想定した話速: {{SPEECH}}

## セクション仕様
{{SECTION_SPEC}}

## 品質ルール
1. `listening.script` は 1 人語り、または話者名付きの対話 (`Ken: ...` 形式)。
   ブラウザの音声合成で読み上げるため、記号や箇条書きは使わず地の文で書く。
2. `dictation.sentences[].text` は listening.script と**重複させない**。
   同じテーマの別の文を新規に書く。各文は10〜20語で、
   その回で狙う音声現象 (連結・脱落・弱形など) を `hint` に日本語で書く。
3. 正解の選択肢は本文の語句をそのまま使わず、必ず言い換える。
   逐語一致で正解が見つかると読解力を測れない。
4. 不正解の選択肢は「部分的に正しい」「言い換えの罠」「本文にない情報」を必ず混ぜる。
   **3つとも本文と無関係な話で埋めない** — 本文を読まずに消去法で解けてしまい、
   難易度が上がらない。以下の作り方に沿うこと。

   > 本文: Reusable boosters have cut the price of a kilogram in low orbit by roughly
   > an order of magnitude since 2015, and that single change has made refuelling practical.
   >
   > 設問: What made refuelling practical?

   | 種別 | 例 | 作り方 |
   | --- | --- | --- |
   | ✅ 正解 | A roughly tenfold fall in the cost of launching mass to low orbit | `an order of magnitude` を `tenfold` に言い換える |
   | ❌ 部分的に正しい | The reusability of booster rockets | 本文にある要素だが、practical にしたのは「価格の低下」。因果を一段ずらす |
   | ❌ 言い換えの罠 | A tenfold increase in the number of orbital launches | 本文の数字を借りつつ、かかる対象を price から number にすり替える |
   | ❌ 本文にない情報 | New international treaties on orbital debris | テーマとしては自然だが本文に根拠がない |

   悪い例: 出社方針についての会話に対して「通信ソフトの導入」「自宅の回線改善」「昇進」を
   並べる。どれも本文に一切出てこないので、聞き取れなくても消去できてしまう。
   最低でも1つは本文の語句を含んだ選択肢にすること。
5. 正解位置 (`answer`) は問題ごとに散らし、同じ値が3問続かないようにする。
6. `explanation` は日本語。根拠となる英文の該当箇所を引用して示す。
7. `writing.prompt` は意見・比較・提案のいずれかを求める形式にし、
   `keyPoints` に採点で見るべき観点を日本語で挙げる。
   `modelAnswer` は {{WRITING_MIN}}〜{{WRITING_MAX}}語に収まる模範解答を英語で書く。
8. `reading.glossary` にはテーマ固有語を5〜8語、`word` と日本語の `meaning` で入れる。
9. 設問の `id` は `l1`,`l2`,... / `d1`,`d2`,... / `r1`,`r2`,... と連番にする。

## 出力形式
説明文やコードフェンスを付けず、**JSON オブジェクトだけ**を出力する。
トップレベルのキーは以下のみ。`date` / `topic` / `level` は呼び出し側が付けるので含めない。

```json
{
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
