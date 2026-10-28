const soundUrls = [
  new URL('../assets/grade-sounds/grade-sound-01.mp3', import.meta.url).href,
  new URL('../assets/grade-sounds/grade-sound-02.mp3', import.meta.url).href,
  new URL('../assets/grade-sounds/grade-sound-03.mp3', import.meta.url).href,
  new URL('../assets/grade-sounds/grade-sound-04.mp3', import.meta.url).href,
  new URL('../assets/grade-sounds/grade-sound-05.mp3', import.meta.url).href,
  new URL('../assets/grade-sounds/grade-sound-06.mp3', import.meta.url).href,
  new URL('../assets/grade-sounds/grade-sound-07.mp3', import.meta.url).href,
  new URL('../assets/grade-sounds/grade-sound-08.mp3', import.meta.url).href,
  new URL('../assets/grade-sounds/grade-sound-09.mp3', import.meta.url).href,
  new URL('../assets/grade-sounds/grade-sound-10.mp3', import.meta.url).href,
  new URL('../assets/grade-sounds/grade-sound-11.mp3', import.meta.url).href,
];

let context;
let lastBuffer;
const buffers = new Map();
const pending = new Map();

function getContext() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!context || context.state === 'closed') context = new AudioCtx({ latencyHint: 'interactive' });
  return context;
}

// Fetch/decode on entering study, without waiting for a grading gesture or an API.
// Keep successful buffers; failed assets can be retried on the next preparation.
export function prepareGradeSounds() {
  try {
    const ctx = getContext();
    if (!ctx) return Promise.resolve();
    return Promise.all(soundUrls.map(url => {
      if (buffers.has(url)) return undefined;
      if (!pending.has(url)) {
        const load = fetch(url)
          .then(response => {
            if (!response.ok) throw new Error('Grade sound unavailable');
            return response.arrayBuffer();
          })
          .then(data => ctx.decodeAudioData(data))
          .then(buffer => buffers.set(url, buffer))
          .catch(() => {})
          .finally(() => pending.delete(url));
        pending.set(url, load);
      }
      return pending.get(url);
    }));
  } catch { return Promise.resolve(); }
}

export function playGradeSound() {
  try {
    const ctx = getContext();
    if (!ctx) return;
    // Resume inside the accepted user gesture (Android/browser autoplay policy).
    const resume = ctx.state !== 'running' ? ctx.resume() : null;
    const choices = [...buffers.values()].filter(buffer => buffer !== lastBuffer);
    const buffer = choices[Math.floor(Math.random() * choices.length)] || lastBuffer;
    // Never queue a late sound while assets are still loading.
    if (!buffer) {
      resume?.catch(() => {});
      void prepareGradeSounds();
      return;
    }
    const start = () => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => source.disconnect();
      source.start();
      lastBuffer = buffer;
    };
    if (resume) {
      const requestedAt = performance.now();
      // A blocked context must not replay an old click on a later gesture.
      resume.then(() => {
        if (ctx.state === 'running' && performance.now() - requestedAt < 150) start();
      }).catch(() => {});
    } else start();
  } catch { /* Audio failure must never block navigation or saving. */ }
}
