---
description: 解答を採点してフィードバックする
argument-hint: [--file=解答ファイル] [--date=YYYY-MM-DD]
allowed-tools: Bash(node scripts/*), Read
---

解答ファイルが指定されていない場合は、まず解答を貼り付けてもらい、一時ファイルに保存します。

Gemini に採点させるなら `node scripts/grade.mjs --file=<ファイル>` を実行して、
出力をそのままチャットに表示してください。

このセッションで採点する場合は `node scripts/grade.mjs --file=<ファイル> --prompt-only` で
プロンプト (問題データ込み) を取得し、その指示に従って採点結果を出力してください。
どちらの場合も結果はファイルに書かず、チャットに表示します。
