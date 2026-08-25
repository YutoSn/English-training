/**
 * 公開リポジトリの生ファイルを GitHub API から読む。
 *
 * なぜ Pages 上のコピーではなく API か: Pages は CDN 越しで、コミット直後の
 * data/index.json がしばらく古いまま返ることがある。生成の完了検知には
 * 「今まさに追加されたか」が要るので、キャッシュを挟まない API を使う。
 * 認証は不要 (公開リポジトリ)。未認証は 1 時間 60 リクエストの上限がある。
 */
export class RateLimitError extends Error {
  constructor() {
    super('GitHub API の回数制限に達しました。しばらく待ってからページを開き直してください。');
    this.name = 'RateLimitError';
  }
}

export async function fetchFromGitHub(repo, path) {
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    headers: { accept: 'application/vnd.github.raw+json' },
    cache: 'no-store',
  });

  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    throw new RateLimitError();
  }
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${path}`);
  return res.json();
}

/** Pages のコピーを先に見て、無ければ (=配信がまだ追いついていない) API に落とす。 */
export async function fetchSetFile(repo, setId) {
  const res = await fetch(`data/days/${setId}.json?v=${Date.now()}`, { cache: 'no-cache' });
  if (res.ok) return res.json();
  if (!repo) throw new Error(`${setId} の問題を読み込めませんでした`);
  return fetchFromGitHub(repo, `data/days/${setId}.json`);
}
