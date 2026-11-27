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

node scripts/generate-day.mjs                       # Gemini で生成 → 検証 → index 更新まで
node scripts/generate-day.mjs --topic-text=深海探査  # テーマ指定 (日本語可・新規可)
node scripts/generate-day.mjs --from-file=x.json    # API を使わず手元の JSON を採用
node scripts/new-day.mjs --date=...                 # プロンプトだけ stdout に出す
node scripts/grade.mjs --file=解答.md [--prompt-only]
node scripts/add-topic.mjs "深海探査:deep-sea exploration"
node scripts/apply-settings.mjs --file=issue.md [--dry-run]   # 設定 Issue を data/ に反映
```

ビルドステップと外部依存はない (Gemini も SDK ではなく素の fetch で叩いている)。
リンタもない — Prettier 相当の整形は手で揃える: 2スペース、シングルクォート、行幅100。

`GEMINI_API_KEY` が要るのは `generate-day.mjs` / `grade.mjs` / `gemini.mjs` の3つだけ。
テストは fetch をスタブするのでキー無しで通る。

## アーキテクチャ

**静的サイト + 生成済み JSON + LLM** の3層。サーバもデータベースもない。

```
                アプリ「作成」タブ ──▶ GitHub Issue (generate)
                                                        │
scripts/lib/plan.mjs ──プロンプト+responseSchema──▶ Gemini API
                                                        │
                       generate-day.mjs (検証して落ちたら再生成)
                                                        ▼
                                            data/days/<setId>.json
                                                        │
                                        finalize-day.mjs ├─▶ data/index.json
                                                        │   data/topics.json (usedCount 更新)
                                                        ▼
                                     index.html + web/*.js が fetch して描画
                                                    │        │
                                    解答 (localStorage)      設定タブ
                                                    ▼        ▼
                        buildSubmission() ──▶ grade.mjs   renderSettingsBody()
                                    │                          │
                                    ▼                     GitHub Issue (settings)
                                 Gemini                        │
                                                     apply-settings.mjs
                                                               ▼
                                            data/config.json / data/topics.json
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
- **ファイル名はセット id で、日付そのものではない**。`YYYY-MM-DD`、同じ日の2本目以降は
  `YYYY-MM-DD-2`, `-3` (`nextSetId`)。オンデマンド生成で1日に何セットでも作れるため。
  `day.date` は id の日付部分と一致していることを `validateDay` が確かめる。
  解答の localStorage キーも採点の `<!-- set:... -->` もこの id。
- **日付ファイルを書いたら必ず `finalizeDay()` を通す**。飛ばすとトピックが
  「未使用」のまま残り、`index.json` も更新されない。
- **テーマの決め方は3通り** (`resolveTopic`): id 指定 / 自由入力 / 未指定。
  自由入力は既存テーマと照合し、新しければ英語フレーズを訳して新規テーマにする
  (日本語だけで入力できるように)。未指定のときだけ日付シードで決定的に選ぶ
  (`seededRandom`)。新しいテーマは `finalizeDay` がネタ帳に足す。
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

`web/diff.js` `web/store.js` `web/settings.js` `web/video.js` は DOM も browser API も触らない。
`test/` から Node でそのまま import してテストするため。DOM 操作は `web/app.js`、
音声は `web/speech.js`、YouTube プレーヤーは `web/youtube.js` に閉じる。この境界を越えると該当ロジックがテスト不能になる。

**両側で使う純粋モジュールの実体は `web/` 側に `.js` で置き、`scripts/lib/` から
再 export する**。二重管理を避けつつ、配信環境の MIME 型に依存しないため:

- `scripts/lib/settings.mjs` → `web/settings.js` (設定ペイロードの形式)
- `scripts/lib/level.mjs` → `web/level.js` (TOEIC バンドの説明文)

**ブラウザから `.mjs` を import しない**。JavaScript の MIME 型で返らない配信環境が
あり、その場合 app.js ごと読み込みに失敗してアプリが丸ごと動かなくなる。
条件は `node:*` と DOM のどちらも持ち込まないこと。持ち込むと片側が壊れる。

音声はすべて Web Speech API による端末側の合成。音声ファイルを生成・配布する経路は
存在しないので、リスニング教材は「読み上げやすい地の文」で書く必要がある
(記号・箇条書き・URL などを入れない)。

### 生成完了をアプリが検知する仕組み

生成は Actions 側で走るので、アプリは Issue を出したあと
`web/github.js` の `fetchFromGitHub()` で `data/index.json` を繰り返し読み、
知らないセット id が増えたら開く (`pollForNewSet`)。

**Pages のコピーではなく GitHub API を見るのが要点**。Pages は CDN 越しで、
コミット直後の index.json がしばらく古いまま返る。未認証 API の上限は
1時間60回なので、間隔は8秒・最大20回に抑えてある。待機状態は localStorage に
置き、GitHub アプリへ移動して戻っても再開できる。

### 設定変更の経路

アプリの「設定」タブは `data/*.json` を直接書けない (静的配信 + localStorage は
Actions から読めない)。そこで採点と同じ Issue 経由にしてある:

`web/settings.js` の `renderSettingsBody()` が `<!-- settings ... -->` に JSON を埋め、
`settings.yml` → `apply-settings.mjs` → `extractPayload()` → `applyPayload()` が
config と topics に書き戻す。`applyPayload` は純粋関数で、書き込みは CLI 側の担当。

- **`clampToeic` は null / '' / boolean を弾く**。下書きの「変更なし」は `toeic: null`
  で表すが、`Number(null)` は 0 なので、素直に丸めると最低スコア 350 が送信されてしまう。
- **`data/config.json` は `writeJson` の整形に揃えてある**。手で書き直すと設定変更の
  たびに巨大な差分が出る。
- テーマの `en` は任意。省略時は `apply-settings.mjs` が Gemini に訳させてから
  `slugify` で id にする。
- `settings.yml` と `grade.yml` は発行者がリポジトリ所有者の Issue しか処理しない。
- **Issue 起動は `types: [labeled]` だけを見る**。ラベル付きで Issue を作ると
  `opened` と `labeled` が両方発火するので、両方拾うと同じ処理が二重に走り、
  2つの実行が同じコミットを push しようとして競合する。判定も
  `github.event.label.name` (今回付いたラベル) で行う — `issue.labels.*.name` を
  見ると複数ラベル同時付与で再び多重起動する。
- Issue 起動のワークフローは**既定ブランチのファイル**が使われる。設定タブの経路を
  試すときは、既定ブランチにも変更が入っているか確かめること。

### 採点の経路

自動採点できるのは選択肢問題だけで、`web/app.js` が即時に丸付けする。
ディクテーションは `diffWords` の語単位 LCS 差分までがクライアントの担当
(句読点と大文字小文字は `normalize` が無視する)。英作文は LLM のみ。

`buildSubmission()` が作る Markdown が採点の入力。末尾に `<!-- set:<setId> -->` を
埋め込んでおり、`resolveSetId()` はこれで問題ファイルを特定する (`date:` は旧形式で、
既存の Issue のために読めるようにしてある)。この印を消すと採点が別のセットを見る。採点プロンプトには問題 JSON 全文を埋め込むので
(`buildGradePrompt`)、モデルにファイル読み取り能力は要らない。

### 動画タブ (YouTube + GAS)

Actions を通らない唯一の生成経路。その場で結果が欲しいので、Gemini を呼ぶ中継役に
Google Apps Script のウェブアプリ (`gas/Code.gs`) を使う。キーは GAS の
スクリプト プロパティにあり、ブラウザにもリポジトリにも出ない。

```
web/app.js videoPanel ──POST (text/plain)──▶ GAS doPost ──▶ Gemini (fileData=YouTube URL + videoMetadata)
        ▲                                                              │
        └── validateVideoSet に落ちたらエラーを添えて再要求 ◀── JSON ──┘
                  │
            localStorage (教材・解答・GAS の URL と合言葉)
```

- **GAS は「合言葉の照合 + 中継」だけ**。プロンプト・スキーマ・検証は `web/video.js` と
  `web/captions.js` にある。GAS の再デプロイは手作業なので、教材の形を変えても
  GAS を触らずに済むようにしている。受け付けるのは「JSON で答える依頼 (schema 必須)」で、
  動画を付けるなら YouTube 1本 + 区間だけ (`checkRequest_`)。
- **fetch に Content-Type を付けない**。GAS は CORS のプリフライトに答えられないので、
  text/plain の単純リクエストでしか呼べない。
- `gas/Code.gs` は `test/gas.test.mjs` が `node:vm` で Apps Script のサービスを
  スタブして動かす。デプロイ手順は `gas/README.md`。
- transcript の秒数は**動画の先頭から**。区間の先頭から数えるモデルの癖があるので、
  `validateVideoSet` はそれを見分けられる文言で弾く。
- 動画の教材は `data/` に残さない (端末の localStorage だけ)。`data/config.json` の
  `video` は生成の設定 (モデル・穴の数・設問数・区間の上限) だけを持つ。
  `maxSeconds` は GAS 側の上限 600 を超えないこと。
- **動画タブがメイン**。`MAIN_PANELS` で先頭に置き、起動時はここを開く。日次セットを
  新しく作ったときだけ、`OPEN_DAY` でそのセットの最初のタブを開く。
- **動画タブは字幕を見るだけで、問題は出さない** (穴埋めとクイズはやめた)。生成するのは
  `title` と `transcript` (英文 `text` + 日本語訳 `ja`) だけ。表示は `SUBTITLE_MODES` の
  「字幕なし / 英文のみ / 日本語訳あり」で切り替え、選んだモードは動画をまたいで引き継ぐ。
  `ja` の無い古い保存データでは `resolveSubtitleMode` が「日本語訳あり」を英文のみに落とす。
- **再生区間は字幕を作った区間とは別に持つ** (`entry.play`)。字幕のある範囲の内側なら
  API を呼ばずに切り替え、1秒から受け付ける (1文だけのくり返し用)。外側にはみ出したら
  その区間の字幕を新しく作り、別の保存データにする。
- **字幕1行 (▶ で再生する単位) は原則1文**。プロンプトで「原則1文、8〜25語、2文以上を
  まとめない」と頼み、`overlongReason` (40語超、または長い文を3つ以上まとめた行) に当たれば
  作り直させる (最後の試行では受け入れる — まとめすぎだけで作成を失敗させない)。
  そのうえで `groupTranscript` が表示時に "Hi." のような短すぎる行だけを次とつなぐ
  (`segment.minWords` 語以上か `minSeconds` 秒以上、かつ文末まで。文末が来なければ
  `maxSeconds` で切る)。保存データは書き換えないので、`data/config.json` の `video.segment` を
  変えれば作り直さずに区切りが変わる。以前は1行15〜40語にしていたが、6文まとまる行が出て
  長すぎたので細かくした。
- **字幕の ▶ の動きは「▶ 続けて再生 / 🔂 1文くり返し」から選ぶ** (`loadRowPlayMode`、保存する)。
  続けて再生はその文から再生区間の終わりまで (`playFrom`)、1文くり返しはその文だけをループ
  (`playLine(line, true)`)。区間全体の「くり返す / 1回 / 停止」ボタンは使われなかったので外した
  (止めるときは動画をタップして YouTube の一時停止を使う)。
- **動画・再生のしかた・速度・字幕の表示切り替え (`.player-stage`) は `position: sticky` で上に固定**し、字幕だけが
  スクロールする。top はヘッダの高さで、`trackHeaderHeight()` が `--header-h` に入れる。
  固定は親のビューアの中でしか効かないので、stage・字幕カードを同じ親に置くこと。
  並びは「動画を追加 (畳んだ `details`) → stage → 字幕 (見出しは動画のタイトル) →
  再生区間の変更 → 保存した動画」。動画より上に置くものを増やさないこと。
  「動画を追加」は保存した動画が無いときだけ最初から開き、作成できたら畳む。
  動画タブではヘッダの日付選択を隠す (`body[data-tab="video"]`)。
- **字幕の作り方は2通り**。「動画を追加」の切り替えで選ぶ (`loadVideoSource`、既定は字幕ファイル)。
  - **字幕ファイル・コピー (`web/captions.js`)**: 時刻が正確なので推奨。`parseCaptions` が SRT /
    WebVTT / YouTube の「文字起こしを表示」のコピーを読む。YouTube の自動生成 VTT は
    「前の行 + 新しい行」が流れる形なので `dedupeRolling` で新しく出た部分だけにし、字幕行の中の
    空白だけの行が空行になって時刻と文が割れたファイルも読めるようにしてある。Gemini には
    **文の区切りと日本語訳だけ**を頼み、各文が何番目の字幕行から何番目までか (`from` / `to`) を
    答えさせる。時刻は `toTranscript` が字幕行から付けるので、Gemini に時刻を書かせない。
    `validateCaptionSet` は「全行を順に1回ずつ使っているか」を見て、外れたら作り直す。
    字幕行は `CUES_PER_REQUEST` 行ずつに分けて頼む。GAS には動画を付けない文章だけの依頼で送る
    (`buildCaptionRequest`、videoUrl なし)。読み込んだ**字幕ファイル全体**は動画ごとに
    `saveCaptionFile` で残し (`english-training:captions`、新しい10本)、`entry.source = 'captions'`
    の動画の再生区間を字幕の外へ広げると、`cuesToExtend` で足りない前後の字幕行だけを訳して
    今の字幕の前後につなぐ (`extendCaptionEntry`。作り直さない。AI では作らない — 時刻の
    正確さが混ざるため)。前と後ろは間が空くので、`translateCueGroups` が別々のまとまりとして訳す。
  - **AI が書き起こす**: 字幕の無い動画向け。Gemini が動画を聞いて時刻を見積もるので、
    区間の後ろほどずれることがある。以前は手で直す補正機能を置いていたが、使いにくかったので
    外し、正確な時刻が要るときは字幕ファイルを使う方針にした。
- **(AI のとき) 長い区間は `splitRange` で約1分 (`video.chunkSeconds`) ずつに分けて作り、`mergeParts` で
  つなぐ**。Gemini の時刻は後ろほどずれ、3分の区間だと字幕全体が2分半ぶんにしか見えない
  ことがあるため、区間ごとに正しい開始位置 (`videoMetadata`) から数え直させる。境目の文は
  前の区間が言い切るまで書いてよく (`PART_OVERRUN` 秒まではみ出し可)、次の区間は話し途中の
  文を含めない。それでも重なった行は、時刻か文章の一致で落とす (時刻はずれうるので文章も見る)。
  分けた区間・字幕行のまとまりは `mapPool` で同時に `video.concurrency` (3) 件まで送る
  (1件ずつ順番だと5分の字幕で20分ほどかかった。無料枠の回数制限 1分10〜15回に収まる数)。
  結果は元の順に並ぶ。GAS は区間ごとに同じ形の依頼を受けるだけなので変更不要。
- **字幕ファイル方式は速いモデル (`video.captionModel` = `gemini-flash-lite-latest`) を使う**。
  区切りと翻訳だけの軽い仕事で、flash の「考える」時間は要らず、考える分で答えが切れる
  (MAX_TOKENS) ことも減る。404 なら `callCaptionGas` が `video.model` に戻す。
- **答えが長すぎて切れた (`finishReason: MAX_TOKENS`) ら、依頼を半分に分けて頼み直す**
  (`runHalving`。字幕ファイルは字幕行を半分ずつ、AI は区間を `halveRange` で半分ずつ)。
  Gemini は「考える」分も maxOutputTokens に数えるので、どの大きさで切れるかは前もって
  分からない。同じ大きさで再試行しても切れるだけなので、`retriable` は切れたものを除く。
  字幕行の1回分 (`CUES_PER_REQUEST`) は、120 行で5分の字幕が切れたので 60 行にした。
  分けた区間の先頭・末尾は `part.first` / `part.last` で表す (半分に分けても外側が受け継ぐ)。
- **作成は `runCreation` が共通で包む**: 二重起動の防止、作成中は画面を消さない
  (`keepScreenOn` = Wake Lock。別アプリから戻ったらかけ直す)、進み具合、途中経過の保存。
  作成はスマホのブラウザの中で動くので、画面オフや切り替えで止まったり、アプリごと
  閉じられたりする。そこで分けた依頼1回分ごとの結果を `cachedRun` で `job.pieces` に保存し
  (切れた部分は `{ split: true }` と覚えて、再開時は頼まずにすぐ分ける)、作成の入力
  (字幕行・区間) も `job` に残す。「動画を追加」に「▶ 続きから作成」が出て、ファイルを
  選び直さずに残りだけ頼める。作成の鍵は `captionJobKey` / `aiJobKey` (同じ入力なら同じ鍵、
  分け方も同じなので終わった分をそのまま使える)。終われば `clearVideoJob`。
- **再生中の行は `currentLineIndex` で決めてハイライト (`li.current`) し、固定された動画の
  すぐ下へ自動スクロールする**。250ms ごとに再生位置を見る (`video.followTimer`、
  `destroyVideoPlayer` で止める)。自分でスクロール (touchmove / wheel) したら4秒止める。
  「↕ 自動スクロール」でオフにでき、設定は保存する。
- 再生は `web/youtube.js` (IFrame Player API) に閉じる。区間の終わりを知らせる
  イベントが無いので、再生中だけ 150ms 間隔で時刻を見張ってループさせている。

### 動画アプリ (Android 向け PWA)

`video.html` は動画タブだけのアプリ。`<body data-app="video">` を見て `web/app.js` が
`bootVideoOnly()` に分岐し、日次セットを読まずに `videoPanel()` だけを出す。
コードは index.html と共有なので、動画タブの変更はそのままアプリにも入る。

- `manifest.webmanifest` / `sw.js` / `icons/` は**リポジトリ直下に置く**。Service Worker の
  スコープは自分のディレクトリ以下なので、`web/` に置くと video.html を制御できず、
  Chrome がインストールを出さない。`test/pwa.test.mjs` が部品の揃いを見張っている。
- `sw.js` は**ネットワーク優先** (`cache: 'no-cache'` で再検証) で、キャッシュは圏外用。
  Pages の10分キャッシュで「古い画面のまま」になるのを防ぐのが主目的。キャッシュ優先に
  変えると、更新が端末に届かなくなるので変えないこと。別オリジン (YouTube・GAS・
  GitHub API) と GET 以外には触らない。
- アイコンは `icons/icon.svg` が原本。変えたら `node scripts/build-icons.cjs` で PNG を作り直す
  (Playwright の Chromium を使う。maskable は安全領域 80% に縮めて背景を全面に敷く)。
- 起動時は前回見ていた動画 (`loadLastVideoId`) を開く。
- **Android の「共有」の受け口** (`manifest` の `share_target` → `sw.js` の `receiveShare`)。
  YouTube アプリから共有すると URL、ファイルアプリから共有すると字幕ファイルが
  `./share-target` に POST で届く。sw.js が Cache (`english-training-share`) に置いて
  `video.html?shared=1` に移し、`takeSharedPayload` → `video.receiveShare` が「動画を追加」に入れる
  (1回だけ取り出す)。ブラウザからダウンロードフォルダの一覧は読めないので、ファイルを
  選ぶ手間を減らす手段はこれと、ファイル選択の `accept` を字幕の種類に絞ることだけ。
  manifest を変えたら、インストール済みのアプリに反映されるまで時間がかかる (入れ直せば即時)。

## 教材を書くときの基準

`prompts/generate.md` の「品質ルール」が唯一の基準。

いちばん崩れやすいのが**誤答の質**。放っておくとモデルは3つとも「本文に出てこない話」で
埋めてしまい、本文を読まずに消去法で解ける問題になる。ルール4に本文・設問・4選択肢を
そろえた作り方の表を置いてあるので、教材の質を上げるときはまずここを直す。
生成物を点検するときも、誤答のうち最低1つが本文の語句を含んでいるかを見る。

`data/days/2026-08-20.json` が水準の見本になっている。

## GitHub Actions

- `generate.yml` — `generate` ラベルが付いた Issue (アプリの「作成」タブが出す) と
  手動実行に反応し、`generate-day.mjs` → テスト → コミット → Issue にコメント。
  **定期実行はしない** — 作るのは利用者が押したときだけ。
  自由入力のテーマはシェルに渡さず `TOPIC_TEXT` 環境変数で受け渡す。
- `grade.yml` — `grade` ラベルが付いた Issue に反応し、`grade.mjs` の出力を
  `gh issue comment` で返す。失敗時も Issue にその旨をコメントする。
- `settings.yml` — `settings` ラベルが付いた Issue を `apply-settings.mjs` に通し、
  変更をコミットして Issue にコメント + クローズする。
- `pages.yml` — リポジトリ全体をそのまま Pages に配信する (`index.html`・`web/`・`data/` が
  すべて必要なため、サブディレクトリ配信にはできない)。**upload と deploy は別ジョブ**にしてある。
  同じジョブで続けると、アップロード直後の deploy-pages が成果物を見つけられず
  「No artifacts named "github-pages"」で落ちることがあった。

`generate.yml` `grade.yml` `settings.yml` は `GEMINI_API_KEY` シークレットに依存する。
