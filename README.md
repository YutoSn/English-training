# English Training

毎日1セットの英語問題(リスニング / ディクテーション / リーディング / 英作文)を
Claude が生成し、スマホでも PC でも開いて解ける静的サイト。採点・添削も Claude が行う。

- **問題**: 毎朝 6:00 (JST) に GitHub Actions が翌日分を生成してコミットする
- **テーマ**: `data/topics.json` に貯めた「興味のあるワード」からランダムに選ばれる
- **レベル**: `data/config.json` の `level.toeic` を変えるだけで難易度が変わる
- **音声**: ブラウザの音声合成 (Web Speech API) で読み上げる。音声ファイルは持たない

## 使い方

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

- **解答をコピー** → Claude アプリや claude.ai に貼り付ける
- **GitHub Issue で提出** → `grade` ラベル付き Issue が作られ、Actions が採点結果をコメントする

ローカルの Claude Code からは `/grade --file=解答.md` でも採点できる。

### テーマを増やす

```sh
node --run topic -- "深海探査:deep-sea exploration" "発酵食品:fermented food"
```

Claude Code なら `/add-topic 深海探査 発酵食品` でもよい(英語フレーズは Claude が補う)。
一度使ったテーマは 14 日間は再登場しない (`recentTopicWindow`)。

### レベルを変える

`data/config.json` の `level.toeic` を書き換える。翌日の生成分から反映される。
バンドごとの語彙・文長・話速の指示は `scripts/lib/level.mjs` にある。

### 手動で問題を作る

```sh
node --run new                       # 今日 (JST) の分
node --run new -- --date=2026-09-01  # 日付指定
```

生成用プロンプトが標準出力に出るので、Claude Code なら `/new-day` を使うのが早い。

## セットアップ

1. リポジトリの Settings → Secrets に `ANTHROPIC_API_KEY` を登録する
2. Settings → Pages で Source を **GitHub Actions** にする
3. `data/config.json` の `repo` を自分のリポジトリ名にする

## 開発

```sh
node --run test        # ユニットテスト + 全問題セットの検証
node --run validate    # data/days/*.json の検証のみ
```

依存パッケージはなし。Node.js 20 以上と、音声合成に対応したブラウザだけあればよい。
