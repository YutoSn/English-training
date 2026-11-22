# 動画教材 API (Google Apps Script)

アプリの「動画」タブから呼ばれる API です。YouTube の URL と区間を Gemini に渡し、
書き起こし・穴埋め・内容クイズを JSON で返します。Gemini の API キーはここに隠すので、
ブラウザ (GitHub Pages) には出ません。

## セットアップ (初回だけ)

1. https://script.google.com/ で「新しいプロジェクト」を作る。
2. エディタの `コード.gs` の中身を、このフォルダの `Code.gs` の内容で置き換える。
3. 左の「プロジェクトの設定」(歯車) で:
   - 「`appsscript.json` マニフェスト ファイルをエディタで表示する」にチェックを入れ、
     エディタに出てきた `appsscript.json` を、このフォルダのものに置き換える。
   - 「スクリプト プロパティ」に次の2つを追加する。
     | プロパティ | 値 |
     | --- | --- |
     | `GEMINI_API_KEY` | https://aistudio.google.com/apikey で取得したキー |
     | `APP_TOKEN` | 合言葉。推測されにくい長めの文字列 (例: パスワード生成器で 32 文字) |
4. 右上の「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」:
   - 次のユーザーとして実行: **自分**
   - アクセスできるユーザー: **全員**
   - 初回は権限の確認が出るので許可する (外部サービスへの接続)。
5. 表示された「ウェブアプリの URL」(`https://script.google.com/macros/s/.../exec`) を控える。
6. アプリの「動画」タブ →「接続設定」に URL と合言葉を入れて保存する。

ブラウザで URL を直接開いて `{"ok":true,...}` が出れば疎通しています。

## clasp で反映する (おすすめ)

`.clasp.json` にスクリプト「Video Clip」の ID を書いてあるので、このフォルダで
コマンドを打つだけでコードと `appsscript.json` が反映されます。

1. 初回だけ: https://script.google.com/home/usersettings で
   「Google Apps Script API」をオンにし、`clasp login` でログインする。
2. `gas/` に移動して `clasp push` を実行する。GAS 側にあってこのフォルダに無いファイル
   (初期の `コード.gs` など) は消えて、`Code.gs` と `appsscript.json` だけになる。
3. スクリプト プロパティ (`GEMINI_API_KEY` / `APP_TOKEN`) はエディタで設定する
   (clasp では送らない。合言葉とキーをリポジトリに置かないため)。
4. 初回のデプロイ: `clasp deploy --description v1`。表示されるデプロイ ID を控えておく。
   ウェブアプリの URL は `https://script.google.com/macros/s/<デプロイID>/exec`。
5. 2回目以降: `clasp push` のあと `clasp deploy -i <デプロイID> --description v2`。
   `-i` を付けずにデプロイすると URL が変わってしまう。

## エディタで更新するとき

`Code.gs` を書き換えたら「デプロイ」→「デプロイを管理」→ 鉛筆アイコン →
バージョン「新バージョン」で更新する。「新しいデプロイ」を作ると URL が変わるので注意。

プロンプトや出力の形 (`web/video.js`) を変えるだけなら GAS の更新は要りません。

## 注意

- URL は「全員」がアクセスできる設定ですが、合言葉が合わなければ Gemini は呼ばれません。
  合言葉はリポジトリにも Issue にも書かないこと (このリポジトリは公開されています)。
- 呼べるのは「YouTube 動画1本 + 区間 + プロンプト」の形だけに絞ってあり、
  汎用の Gemini プロキシとしては使えません。
- 公開動画だけが対象です (限定公開・非公開は Gemini が読めません)。
- Gemini の無料枠では YouTube 動画の処理は1日8時間分までです。
- GAS の1回の実行は6分まで。区間は短いほど速く確実です (アプリ側の上限は5分)。
