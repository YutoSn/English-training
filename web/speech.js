/**
 * Thin wrapper over the Web Speech API. Listening and dictation audio is
 * synthesised on the device, so the app stays a static site with no audio files
 * to generate, host or download.
 */
const synth = window.speechSynthesis;
let voice = null;

/** Voices load asynchronously in some browsers; resolve once the list is non-empty. */
function voicesReady() {
  return new Promise((resolve) => {
    const list = synth?.getVoices() ?? [];
    if (list.length) return resolve(list);
    synth?.addEventListener('voiceschanged', () => resolve(synth.getVoices()), { once: true });
    setTimeout(() => resolve(synth?.getVoices() ?? []), 1000);
  });
}

export async function initSpeech(lang = 'en-US') {
  if (!synth) return false;
  const voices = await voicesReady();
  voice =
    voices.find((v) => v.lang === lang && v.localService) ??
    voices.find((v) => v.lang === lang) ??
    voices.find((v) => v.lang?.startsWith('en')) ??
    null;
  return voices.length > 0;
}

export function isSupported() {
  return Boolean(synth);
}

export function stop() {
  synth?.cancel();
}

/**
 * Speak `text`, resolving when it finishes. Always cancels any pending
 * utterance first — overlapping speech is never what the learner wants.
 */
export function speak(text, { rate = 1, lang = 'en-US', onEnd } = {}) {
  if (!synth) return Promise.reject(new Error('この端末は音声合成に対応していません'));
  synth.cancel();
  return new Promise((resolve, reject) => {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang;
    utter.rate = rate;
    if (voice) utter.voice = voice;
    utter.onend = () => {
      onEnd?.();
      resolve();
    };
    utter.onerror = (e) => (e.error === 'interrupted' || e.error === 'canceled' ? resolve() : reject(e));
    synth.speak(utter);
  });
}
