#!/usr/bin/env node
/**
 * 生成リクエスト Issue からテーマを取り出し、generate-day.mjs に渡す引数を出す。
 *
 *   ISSUE_BODY="$(cat issue.md)" node scripts/parse-generate-request.mjs
 *
 * テーマ未指定なら何も出力しない (ネタ帳から自動で選ばせる)。
 */
import fs from 'node:fs';
import { extractGeneratePayload } from '../web/settings.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=');
    return [k, rest.length ? rest.join('=') : true];
  }),
);

const body = args.file ? fs.readFileSync(args.file, 'utf8') : (process.env.ISSUE_BODY ?? '');
const payload = extractGeneratePayload(body);

if (!payload) {
  console.error('生成リクエストの JSON が見つかりません (<!-- generate ... --> が必要)');
  process.exit(1);
}

const topic = String(payload.topic ?? '').trim();
// 改行や引用符を含むテーマでシェルが壊れないよう、値だけを1行で出す。
if (topic) console.log(topic.replace(/\s+/g, ' ').slice(0, 80));
