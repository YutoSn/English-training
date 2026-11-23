#!/usr/bin/env node
/**
 * icons/icon.svg から PWA 用の PNG を作る。アイコンを変えたときだけ手で実行する:
 *   node scripts/build-icons.cjs
 * 依存はコンテナに入っている Playwright (Chromium) だけ。生成物はコミットする。
 *
 * maskable は Android がランチャーの形 (円・角丸など) に切り抜くので、
 * 角丸をやめて背景を全面に敷き、絵柄を中央 80% (安全領域) に縮めて収める。
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const dir = path.join(__dirname, '..', 'icons');
const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
const safeZone = '<g transform="translate(51.2 51.2) scale(0.8)">';
const maskable = svg
  .replace('rx="112" fill="#2f6df6"/>', `fill="#2f6df6"/>\n  ${safeZone}`)
  .replace('</svg>', '  </g>\n</svg>');

const targets = [
  ['icon-192.png', svg, 192],
  ['icon-512.png', svg, 512],
  ['icon-maskable-512.png', maskable, 512],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [name, source, size] of targets) {
    await page.setViewportSize({ width: size, height: size });
    const style =
      'html,body{margin:0;background:transparent}' +
      `svg{display:block;width:${size}px;height:${size}px}`;
    await page.setContent(`<style>${style}</style>${source}`);
    await page.screenshot({ path: path.join(dir, name), omitBackground: true });
    console.log('wrote', name);
  }
  await browser.close();
})();
