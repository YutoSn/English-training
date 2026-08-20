# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## コマンド

```sh
node --run test                          # ユニットテスト + 全問題セットの検証 (CI と同じ)
node --test "test/*.test.mjs"            # ユニットテストのみ (ディレクトリ指定は動かない。glob 必須)
node --test --test-name-pattern="聞き落"  # テスト1件だけ実行
node --run validate                      # data/days/*.json をスキーマ検証
node --run serve                         # http://localhost:8000 で静的配信

node scripts/new-day.mjs --date=2026-09-01   # 生成用プロンプトを stdout に出す (JSON は書かない)
node scripts/finalize-day.mjs --date=...     # 検証 + トピック使用済み記録 + index.json 再生成
node scripts/build-grade-prompt.mjs --file=解答.md
node scripts/add-topic.mjs "深海探査:deep-sea exploration"
```

ビルドステップと外部依存はない。リンタもない (Prettier 相当の整形は手で揃える: 2スペース、
シングルクォート、行幅100)。

## アーキテクチャ

**静的サイト + 生成済み JSON + Claude** の3層。サーバもデータベースもない。

```
scripts/new-day.mjs  ──プロンプト──▶ Claude ──▶ data/days/YYYY-MM-DD.json
                                                        │
                                        finalize-day.mjs ├─▶ data/index.json
                                                        │   data/topics.json (usedCount 更新)
                                                        ▼
                                     index.html + web/*.js が fetch して描画
                                                        │
                                          解答 (localStorage)
                                                        ▼
                                   buildSubmission() ──▶ Claude が採点
```

### 押さえるべき不変条件

- **`scripts/lib/schema.mjs` の `validateDay` が日次セットの契約**。web アプリ・採点プロンプト・
  生成プロンプトはすべて「検証を通った JSON」を前提にしている。形を変えるときは
  schema.mjs → `prompts/generate.md` の JSON 例 → `web/app.js` の描画、の順で直す。
- **問題生成はスクリプトではなく Claude が行う**。`new-day.mjs` はトピックを選んでプロンプトを
  組み立てるだけで、JSON は一切書かない。生成後は必ず `finalize-day.mjs` を通す
  (これを飛ばすとトピックが「未使用」のまま残り、`index.json` も更新されない)。
- **`data/index.json` は生成物**。手で編集しない。`buildIndex()` だけが書く。
- **トピック選択は日付シードで決定的** (`seededRandom`)。同じ日付なら何度実行しても同じ
  トピックが選ばれるので、生成をやり直しても内容の一貫性が保てる。
- **日付境界は JST** (`todayJst`)。UTC で動く Actions ランナーの「今日」とはずれる。
- **ディクテーション文をリスニングのスクリプトから採らない**。同じ文が画面に出ていると
  答えが漏れるため、`validateDay` が重複を検出して落とす。

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
(句読点と大文字小文字は `normalize` が無視する)。英作文は Claude のみ。

`buildSubmission()` が作る Markdown が採点の入力。末尾に `<!-- date:YYYY-MM-DD -->` を
埋め込んでおり、`build-grade-prompt.mjs` はこれで問題ファイルを特定する。この印を消すと
Issue 経由の採点が日付を取り違える。

## 教材を書くときの基準

`prompts/generate.md` の「品質ルール」が唯一の基準。特に:
不正解選択肢は「本文にない情報 / 言い換えの罠 / 部分的に正しい」を混ぜる、
`explanation` は日本語で根拠の英文を引用する、正解位置を散らす。
`data/days/2026-08-20.json` が水準の見本になっている。

## GitHub Actions

- `daily.yml` — 21:00 UTC (= 06:00 JST) に生成 → `finalize-day.mjs` → テスト → コミット。
  生成済みの日は `new-day.mjs` の終了コード 2 を見てスキップする (失敗にしない)。
- `grade.yml` — `grade` ラベル付き Issue に反応して採点コメントを返す。
- `pages.yml` — リポジトリ全体をそのまま Pages に配信する (`index.html`・`web/`・`data/` が
  すべて必要なため、サブディレクトリ配信にはできない)。

いずれも `ANTHROPIC_API_KEY` シークレットに依存する。
