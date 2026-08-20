---
description: 今日(または指定日)の学習セットを生成する
argument-hint: [--date=YYYY-MM-DD] [--topic=id]
allowed-tools: Bash(node scripts/*), Read, Write, Edit
---

`node scripts/new-day.mjs $ARGUMENTS` を実行し、出力されたプロンプトの指示に
そのまま従って `data/days/<date>.json` を書き出してください。

書き出したら `node scripts/finalize-day.mjs --date=<date>` を実行し、
検証エラーが出た場合は JSON を直して再実行します。成功したら変更をコミットしてください。
