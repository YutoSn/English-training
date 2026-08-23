# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## コマンド

```sh
node --run test                          # ユニットテスト + 全問題セットの検証 (CI と同じ)
node --test "test/*.test.mjs"            # ユニットテストのみ (ディレクトリ指定は動かない。glob 必須)
node --test --test-name-pattern="聞き落"  # テスト1件だけ実行
node --run validate                      # data/days/*.json をスキーマ検証
node --run serve                         # http://localhost:8000 で静的配信
node --run models                        # Gemini の疎通確認 + 利用可能モデル一覧

node scripts/generate-day.mjs --date=2026-09-01     # Gemini で生成 → 検証 → index 更新まで
node scripts/generate-day.mjs --from-file=x.json    # API を使わず手元の JSON を採用
node scripts/new-day.mjs --date=...                 # プロンプトだけ stdout に出す
node scripts/grade.mjs --file=解答.md [--prompt-only]
node scripts/add-topic.mjs "深海探査:deep-sea exploration"
```

ビルドステップと外部依存はない (Gemini も SDK ではなく素の fetch で叩いている)。
リンタもない — Prettier 相当の整形は手で揃える: 2スペース、シングルクォート、行幅100。

`GEMINI_API_KEY` が要るのは `generate-day.mjs` / `grade.mjs` / `gemini.mjs` の3つだけ。
テストは fetch をスタブするのでキー無しで通る。

## アーキテクチャ

**静的サイト + 生成済み JSON + LLM** の3層。サーバもデータベースもない。

```
scripts/lib/plan.mjs ──プロンプト+responseSchema──▶ Gemini API
                                                        │
                       generate-day.mjs (検証して落ちたら再生成)
                                                        ▼
                                            data/days/YYYY-MM-DD.json
                                                        │
                                        finalize-day.mjs ├─▶ data/index.json
                                                        │   data/topics.json (usedCount 更新)
                                                        ▼
                                     index.html + web/*.js が fetch して描画
                                                        │
                                          解答 (localStorage)
                                                        ▼
                              buildSubmission() ──▶ grade.mjs ──▶ Gemini
```

### 押さえるべき不変条件

- **`scripts/lib/schema.mjs` が日次セットの契約**。同じファイルに2つの表現があり、
  **必ず両方を揃える**: `validateDay` (検証) と `daySchema` (Gemini の responseSchema)。
  片方だけ変えると生成が検証に落ち続ける。web アプリと採点プロンプトも
  「検証を通った JSON」を前提にしている。形を変えるときは
  schema.mjs → `prompts/generate.md` の JSON 例 → `web/app.js` の描画、の順。
- **`date` / `topic` / `level` はモデルに書かせない**。既知の事実なので
  `assembleDay()` がスクリプト側で付ける。モデルに渡す responseSchema には
  4セクションのキーしか無い。
- **生成は「検証に落ちたらエラーを添えて再生成」ループ**
  (`generate-day.mjs` の `generateContent`)。構造化出力でも
  「ディクテーション文がスクリプトと重複」「answer が範囲外」までは防げないため。
  試行回数は `data/config.json` の `generator.maxAttempts`。
- **`data/index.json` は生成物**。手で編集しない。`buildIndex()` だけが書く。
- **日付ファイルを書いたら必ず `finalizeDay()` を通す**。飛ばすとトピックが
  「未使用」のまま残り、`index.json` も更新されない。
- **トピック選択は日付シードで決定的** (`seededRandom`)。同じ日付なら何度実行しても同じ
  トピックが選ばれるので、生成をやり直しても内容の一貫性が保てる。
- **日付境界は JST** (`todayJst`)。UTC で動く Actions ランナーの「今日」とはずれる。

### Gemini クライアント

`scripts/lib/gemini.mjs` が唯一の API 接点。`generateWithRetry` が再試行するのは
`GeminiError.retriable` が立つものだけ — 429 (無料枠のレート上限)、5xx、
`finishReason: MAX_TOKENS`。400 系はプロンプトかスキーマの誤りなので即座に失敗させる。

モデル名は `data/config.json` の `generator.model` / `generator.gradeModel`。
**ListModels に載っていても generateContent が 404 を返すモデルがある**
(旧モデルは新規ユーザーに公開されない)。名前を変えるときは一覧ではなく
`node --run models -- --check=<名前>` の実測を信じること。既定を `-latest`
エイリアスにしてあるのは、モデル引退で日次生成が止まるのを避けるため。

採点は `temperature: 0.3` で呼ぶ (同じ解答で点が揺れないように)。生成は 0.9。

### レベル調整の仕組み

`data/config.json` の `level.toeic` (350〜990) が `scripts/lib/level.mjs` の
バンド定義に写像され、語彙・文長・話速の指示文として生成プロンプトに埋め込まれる。
難易度を変えたいときはバンドの説明文を編集する。ロジックは他にない。

### web/ の分割理由

`web/diff.js` と `web/store.js` は DOM も browser API も触らない。`test/` から Node で
そのまま import してテストするため。DOM 操作は `web/app.js`、音声は `web/speech.js` に閉じる。
この境界を越えると該当ロジックがテスト不能になる。

音声はすべて Web Speech API による端末側の合成。音声ファイルを生成・配布する経路は
存在しないので、リスニング教材は「読み上げやすい地の文」で書く必要がある
(記号・箇条書き・URL などを入れない)。

### 採点の経路

自動採点できるのは選択肢問題だけで、`web/app.js` が即時に丸付けする。
ディクテーションは `diffWords` の語単位 LCS 差分までがクライアントの担当
(句読点と大文字小文字は `normalize` が無視する)。英作文は LLM のみ。

`buildSubmission()` が作る Markdown が採点の入力。末尾に `<!-- date:YYYY-MM-DD -->` を
埋め込んでおり、`resolveDate()` はこれで問題ファイルを特定する。この印を消すと
Issue 経由の採点が日付を取り違える。採点プロンプトには問題 JSON 全文を埋め込むので
(`buildGradePrompt`)、モデルにファイル読み取り能力は要らない。

## 教材を書くときの基準

`prompts/generate.md` の「品質ルール」が唯一の基準。

いちばん崩れやすいのが**誤答の質**。放っておくとモデルは3つとも「本文に出てこない話」で
埋めてしまい、本文を読まずに消去法で解ける問題になる。ルール4に本文・設問・4選択肢を
そろえた作り方の表を置いてあるので、教材の質を上げるときはまずここを直す。
生成物を点検するときも、誤答のうち最低1つが本文の語句を含んでいるかを見る。

`data/days/2026-08-20.json` が水準の見本になっている。

## GitHub Actions

- `daily.yml` — 21:00 UTC (= 06:00 JST) に `generate-day.mjs` → テスト → コミット。
  生成済みの日は終了コード 2 を見てスキップする (失敗にしない)。
- `grade.yml` — `grade` ラベル付き Issue に反応し、`grade.mjs` の出力を
  `gh issue comment` で返す。失敗時も Issue にその旨をコメントする。
- `pages.yml` — リポジトリ全体をそのまま Pages に配信する (`index.html`・`web/`・`data/` が
  すべて必要なため、サブディレクトリ配信にはできない)。

`daily.yml` と `grade.yml` は `GEMINI_API_KEY` シークレットに依存する。
