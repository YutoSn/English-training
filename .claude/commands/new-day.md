---
description: 学習セットを1つ生成する
argument-hint: [--topic-text=テーマ] [--topic=id] [--date=YYYY-MM-DD]
allowed-tools: Bash(node scripts/*), Read, Write
---

GEMINI_API_KEY が設定されていれば `node scripts/generate-day.mjs $ARGUMENTS` を実行するだけで
生成・検証・index 更新まで終わります。まずこれを試してください。
テーマは `--topic-text=深海探査` のように日本語で渡せます (未登録なら英語フレーズを訳して追加)。

API キーが無い、または API 側の理由で失敗する場合は手動生成に切り替えます:

1. `node scripts/new-day.mjs $ARGUMENTS` でプロンプトを取得する
2. その指示どおりの JSON (`listening` / `dictation` / `reading` / `writing` の4キーのみ) を
   一時ファイルに書き出す
3. `node scripts/generate-day.mjs $ARGUMENTS --from-file=<一時ファイル>` で
   日付・テーマ・レベルを付けて保存し、検証まで通す

検証エラーが出たら JSON を直して再実行します。成功したら変更をコミットしてください。
