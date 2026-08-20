---
description: 解答を採点してフィードバックする
argument-hint: [--file=解答ファイル] [--date=YYYY-MM-DD]
allowed-tools: Bash(node scripts/*), Read
---

`node scripts/build-grade-prompt.mjs $ARGUMENTS` を実行し、出力されたプロンプトに
従って採点してください。`--file` が指定されていない場合は、解答を貼り付けてもらうよう
利用者に依頼してから、その内容を一時ファイルに保存して同コマンドに渡します。

採点結果はファイルに書かず、チャットにそのまま表示してください。
