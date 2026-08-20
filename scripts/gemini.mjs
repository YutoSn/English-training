#!/usr/bin/env node
/**
 * Gemini API の疎通確認。
 *
 *   node scripts/gemini.mjs --models   # 使えるモデル一覧
 *   node scripts/gemini.mjs --ping     # 設定中のモデルに1往復投げる
 */
import { readJson, CONFIG_PATH } from './lib/paths.mjs';
import { listModels, generate, GeminiError } from './lib/gemini.mjs';

const args = new Set(process.argv.slice(2).map((a) => a.replace(/^--/, '')));
const { generator } = readJson(CONFIG_PATH);

try {
  if (args.has('models') || args.size === 0) {
    for (const m of await listModels()) console.log(`${m.id.padEnd(40)} ${m.display ?? ''}`);
    console.log(`\n設定中: 生成=${generator.model} / 採点=${generator.gradeModel}`);
  }
  if (args.has('ping')) {
    const reply = await generate({
      prompt: 'Reply with exactly: ok',
      model: generator.model,
      temperature: 0,
      maxOutputTokens: 512,
    });
    console.log(`${generator.model}: ${reply}`);
  }
} catch (err) {
  console.error(err instanceof GeminiError ? `Gemini API: ${err.message}` : err.message);
  process.exit(1);
}
