/**
 * Word-level diff used to mark up dictation answers.
 * No DOM or browser API here — test/diff.test.mjs imports this file directly.
 */

/** Comparison key: dictation is about hearing words, not typing punctuation. */
export function normalize(word) {
  return word
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9']/g, '');
}

export function tokenize(text) {
  return text.trim().split(/\s+/).filter(Boolean);
}

/**
 * Longest common subsequence over normalized words, walked back into a list of
 * { type: 'same' | 'missing' | 'extra', word } ops. `missing` words come from
 * the expected sentence, `extra` from what the learner typed.
 */
export function diffWords(expected, actual) {
  const a = tokenize(expected);
  const b = tokenize(actual);
  const na = a.map(normalize);
  const nb = b.map(normalize);

  const table = Array.from({ length: na.length + 1 }, () => new Array(nb.length + 1).fill(0));
  for (let i = na.length - 1; i >= 0; i--) {
    for (let j = nb.length - 1; j >= 0; j--) {
      table[i][j] =
        na[i] === nb[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  while (i < na.length && j < nb.length) {
    if (na[i] === nb[j]) {
      ops.push({ type: 'same', word: b[j] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ type: 'missing', word: a[i] });
      i++;
    } else {
      ops.push({ type: 'extra', word: b[j] });
      j++;
    }
  }
  while (i < na.length) ops.push({ type: 'missing', word: a[i++] });
  while (j < nb.length) ops.push({ type: 'extra', word: b[j++] });

  const matched = ops.filter((o) => o.type === 'same').length;
  return {
    ops,
    matched,
    total: na.length,
    accuracy: na.length === 0 ? 1 : matched / na.length,
  };
}
