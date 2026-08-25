# English Training

毎日1セットの英語問題(リスニング / ディクテーション / リーディング / 英作文)を
Gemini が生成し、スマホでも PC でも開いて解ける静的サイト。採点・添削も Gemini が行う。

- **問題**: アプリの「作成」タブでテーマを入れて押すと、その場で作られる (目安1〜2分)
- **テーマ**: 入力したワードはネタ帳に貯まり、空のまま押せばそこからランダムに選ばれる
- **レベル**: `data/config.json` の `level.toeic` を変えるだけで難易度が変わる
- **音声**: ブラウザの音声合成 (Web Speech API) で読み上げる。音声ファイルは持たない

## セットアップ

1. **Gemini API キーを取る** — <https://aistudio.google.com/apikey> で無料で作れる。
   Google AI Pro のサブスクリプションとは別枠で、API には独自の無料枠がある
   (1日1回の生成 + 採点なら無料枠に収まる)。
2. リポジトリの Settings → Secrets and variables → Actions に
   `GEMINI_API_KEY` を登録する
3. Settings → Pages で Source を **GitHub Actions** にする
4. `data/config.json` の `repo` を自分のリポジトリ名にする

ローカルで動かすときは `export GEMINI_API_KEY=...` しておく。

```sh
node --run models    # API キーが通っているか & 使えるモデルの確認
```

## 使い方

### 問題を作る

「作成」タブでテーマを1つ入れて「作成する」を押すと GitHub の Issue が開く。
そのまま送信すれば生成が始まり、**完成するとページが自動でその問題に切り替わる**
(目安1〜2分)。テーマを空にすればネタ帳からランダムに選ばれる。

送信後に GitHub アプリへ移動して戻ってきても、待機は再開される。
同じ日に何度でも作れる (2本目以降のセット id は `YYYY-MM-DD-2`, `-3`)。

手元から作るなら:

```sh
node --run new -- --topic-text=深海探査   # テーマ指定 (日本語可・新規可)
node --run new                            # ネタ帳から自動で選ぶ
```

### 解く

GitHub Pages に公開されたページを開く (`https://<user>.github.io/English-training/`)。
スマホのホーム画面に追加しておくと毎日開きやすい。

ローカルで動かす場合:

```sh
node --run serve      # http://localhost:8000
```

同じ Wi-Fi のスマホからは `http://<PCのIP>:8000` で開ける。
解答は端末の localStorage に保存されるので、途中でページを閉じても消えない。

### 採点してもらう

「採点」タブで解答をまとめ、

- **GitHub Issue で提出** → `grade` ラベル付き Issue が作られ、Actions が採点結果をコメントする
- **解答をコピー** → 好きな AI に貼り付ける

手元で採点するなら:

```sh
node --run grade -- --file=解答.md
```

Claude Code からは `/grade --file=解答.md`。

### テーマを増やす・レベルを変える (アプリから)

「設定」タブでどちらも変えられる。

- **レベル**: スライダーで目標 TOEIC スコアを動かす。CEFR や語彙・文長の目安が
  その場で表示される
- **テーマ**: 日本語で入力して「追加」。英語フレーズは省略してよく、
  その場合は反映時に Gemini が訳す

変更したら「GitHub Issue で送信」を押す。`settings` ラベル付きの Issue が作られ、
Actions が `data/config.json` と `data/topics.json` に書き戻してコメントを返す。
**反映は次回の生成分から** — 既にある問題は作り直さない。

サイトは静的配信で、問題を作るのは Actions 側にある。ブラウザの localStorage は
Actions から読めないので、この Issue 経由の一往復がリポジトリに書き戻す唯一の経路になる。
送信済みでまだ反映されていない変更は「設定」タブに表示され、反映されると自動で消える。

### テーマを増やす・レベルを変える (手元から)

```sh
node --run topic -- "深海探査:deep-sea exploration" "発酵食品:fermented food"
```

`data/config.json` の `level.toeic` を直接書き換えてもよい。
Claude Code なら `/add-topic 深海探査 発酵食品` でも足せる(英語フレーズは補ってくれる)。

一度使ったテーマは 14 日間は再登場しない (`recentTopicWindow`)。
バンドごとの語彙・文長・話速の指示は `scripts/lib/level.mjs` にある。

### モデルを変える

`data/config.json` の `generator.model` (生成) と `generator.gradeModel` (採点)。
既定は `gemini-pro-latest` / `gemini-flash-latest` — モデルは引退すると 404 になるので、
最新版を指すエイリアスにしてある。

固定名にしたいときは、先に疎通を確かめること。**一覧に載っていても呼べないモデルがある**
(旧モデルは新規ユーザーに公開されない):

```sh
node --run models -- --check=gemini-3.1-pro-preview,gemini-3.7-flash
```

手元にキーが無い場合は Actions の "List Gemini models" を手動実行しても同じ確認ができる。

### API を使わずに問題を作る

`node --run prompt` でプロンプトだけ出し、できた JSON を
`node --run new -- --from-file=content.json` に渡す。
Claude Code からは `/new-day` がこの流れをまとめてやる。

## 開発

```sh
node --run test        # ユニットテスト + 全問題セットの検証
node --run validate    # data/days/*.json の検証のみ
```

依存パッケージはなし。Node.js 20 以上と、音声合成に対応したブラウザだけあればよい。
