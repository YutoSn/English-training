#!/usr/bin/env node
/**
 * Gemini API の疎通確認。
 *
 *   node scripts/gemini.mjs --models          # 一覧を出す
 *   node scripts/gemini.mjs --check           # 設定中のモデルに実際に投げてみる
 *   node scripts/gemini.mjs --check=a,b,c     # 候補モデルをまとめて試す
 *
 * ListModels に載っていても generateContent が 404 を返すモデルがある
 * (「新規ユーザーには公開されていない」旧モデルなど)。名前を決めるときは
 * 一覧ではなく --check の結果を信じること。
 */
import { readJson, CONFIG_PATH } from './lib/paths.mjs';
import { listModels, generate, GeminiError } from './lib/gemini.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = true] = a.replace(/^--/, '').split('=');
    return [k, v];
  }),
);

const { generator } = readJson(CONFIG_PATH);

async function check(model) {
  try {
    await generate({
      prompt: 'Reply with exactly: ok',
      model,
      temperature: 0,
      maxOutputTokens: 2048,
    });
    return '✓ 使える';
  } catch (err) {
    if (err instanceof GeminiError && err.status === 404) return '✗ 使えない (404)';
    // 404 以外は「モデルには届いている」— 出力が切れただけなら実用上は問題ない。
    return `△ 応答あり: ${err.message.split('\n')[0].slice(0, 100)}`;
  }
}

try {
  if (args.models) {
    for (const m of await listModels()) console.log(`${m.id.padEnd(40)} ${m.display ?? ''}`);
    console.log('');
  }

  if (args.check) {
    const models =
      typeof args.check === 'string'
        ? args.check.split(',').map((m) => m.trim()).filter(Boolean)
        : [generator.model, generator.gradeModel];
    for (const model of models) console.log(`${model.padEnd(32)} ${await check(model)}`);
    console.log('');
  }

  if (!args.models && !args.check) {
    console.error('使い方: node scripts/gemini.mjs --models | --check[=model1,model2]');
    process.exit(1);
  }

  console.log(`設定中: 生成=${generator.model} / 採点=${generator.gradeModel}`);
} catch (err) {
  console.error(err instanceof GeminiError ? `Gemini API: ${err.message}` : err.message);
  process.exit(1);
}
