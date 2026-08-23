/**
 * TOEIC スコア → 生成指示。生成プロンプトにこの文言がそのまま埋まるので、
 * バンドの説明を書き換えれば翌日の難易度が変わる。
 *
 * ここに置いてあるのは、アプリの「設定」タブが同じ定義を表示するため。
 * .mjs は配信環境によって JavaScript の MIME 型で返らないことがあり、
 * その場合ブラウザが ES module として読まない。web/ 側に .js で置いて、
 * scripts/lib/level.mjs から再 export する。
 */
const BANDS = [
  {
    max: 450,
    cefr: 'A2',
    vocabulary: 'NGSL 上位1500語中心。専門語は使わず、使う場合は文中で言い換える。',
    sentence: '平均10〜14語。関係詞・分詞構文は避ける。',
    speech: 'ゆっくり、明瞭、ポーズ多め。',
  },
  {
    max: 600,
    cefr: 'B1',
    vocabulary: 'NGSL 2000語 + ビジネス基礎語(TOEIC頻出)。',
    sentence: '平均14〜18語。関係詞は可、分詞構文は控えめ。',
    speech: '標準よりやや遅い自然な速度。',
  },
  {
    max: 780,
    cefr: 'B2',
    vocabulary: 'NGSL 3000語 + 分野語彙を数語。イディオムを1〜2個含める。',
    sentence: '平均16〜22語。複文・分詞構文・受動態を自然に混ぜる。',
    speech: '自然な速度。軽い連結音(linking)を含む。',
  },
  {
    max: 900,
    cefr: 'C1',
    vocabulary: '抽象語・コロケーション重視。低頻度語を各セクション3〜5語。',
    sentence: '平均20〜26語。挿入句、倒置、仮定法を含む。',
    speech: 'ネイティブ速度。縮約形・弱形を含む。',
  },
  {
    max: 990,
    cefr: 'C2',
    vocabulary: 'ニュアンス差のある同義語、専門的比喩、学術的コロケーション。',
    sentence: '長短を意図的に混ぜる。修辞的構造を含む。',
    speech: '速い自然発話。省略・言い淀みを含んでよい。',
  },
];

export function levelProfile(toeic) {
  const score = Math.min(990, Math.max(350, Number(toeic) || 600));
  const band = BANDS.find((b) => score <= b.max) ?? BANDS.at(-1);
  return { toeic: score, ...band };
}
