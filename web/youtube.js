/**
 * YouTube IFrame Player API の薄いラッパー。区間ループと1行再生だけを持つ。
 * DOM と window.YT を触るのはこのファイルだけ (web/speech.js と同じ考え方)。
 */
let apiReady = null;

function loadApi() {
  if (apiReady) return apiReady;
  apiReady = new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => {
      apiReady = null;
      reject(new Error('YouTube プレーヤーを読み込めませんでした'));
    };
    document.head.append(script);
  });
  return apiReady;
}

/**
 * @param {HTMLElement} host  プレーヤーに置き換わる要素
 * @param {object} o
 * @param {string} o.videoId
 * @param {number} o.start
 * @param {number} o.end
 */
export async function createPlayer(host, { videoId, start, end }) {
  const YT = await loadApi();
  let player;
  // 「区間をくり返す」の対象。setSegment で作り直さずに変えられる。
  const segment = { start, end };
  // 再生中の範囲。区間ループなら [start, end]、1行再生ならその行。
  let range = { from: start, to: end, loop: true };
  let timer = null;

  await new Promise((resolve) => {
    player = new YT.Player(host, {
      videoId,
      playerVars: { start: Math.floor(start), playsinline: 1, rel: 0, modestbranding: 1 },
      events: { onReady: resolve },
    });
  });

  // IFrame API には「指定位置で止まる」イベントが無いので、再生中だけ時刻を見張る。
  function watch() {
    clearInterval(timer);
    timer = setInterval(() => {
      if (player.getPlayerState() !== YT.PlayerState.PLAYING) return;
      if (player.getCurrentTime() < range.to) return;
      if (range.loop) player.seekTo(range.from, true);
      else player.pauseVideo();
    }, 150);
  }

  function playRange(from, to, loop) {
    range = { from, to, loop };
    player.seekTo(from, true);
    player.playVideo();
    watch();
  }

  return {
    playSegment: (loop = true) => playRange(segment.start, segment.end, loop),
    setSegment: (from, to) => {
      segment.start = from;
      segment.end = to;
      // ループ再生中なら新しい区間で回り直す。止まっているときは勝手に再生しない。
      if (range.loop && player.getPlayerState() === YT.PlayerState.PLAYING) {
        playRange(from, to, true);
      }
    },
    playLine: (line, loop = false) => playRange(line.start, line.end + 0.3, loop),
    pause: () => player.pauseVideo(),
    setRate: (rate) => player.setPlaybackRate(rate),
    rates: () => player.getAvailablePlaybackRates?.() ?? [1],
    currentTime: () => player.getCurrentTime(),
    isPlaying: () => player.getPlayerState() === YT.PlayerState.PLAYING,
    destroy: () => {
      clearInterval(timer);
      player.destroy();
    },
  };
}
