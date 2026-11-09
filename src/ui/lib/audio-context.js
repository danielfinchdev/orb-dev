// 3.8.3: a Web Audio context that never makes the window wait. Built the usual way, `new AudioContext()` asks the audio
// service for its output device synchronously: measured in the e2e build, 0.5–2 s of a frozen window when it happened
// while an answer streamed (the robot's first «voice» comes exactly then). Built with no output device it is instant,
// and the default device is attached asynchronously (setSinkId). Until then `ready` is false and callers skip their
// sound (they already skip one whenever playing it is not right). Where setSinkId does not exist, the usual way.
// → { ctx, ready: () => boolean } or null (no Web Audio)
export function quietAudioContext() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  let ready = false;
  if (typeof AC.prototype?.setSinkId === 'function') {
    try {
      const ctx = new AC({ sinkId: { type: 'none' } });
      ctx.setSinkId('').then(() => { ready = true; if (ctx.state === 'suspended') ctx.resume().catch(() => {}); }, () => { ready = true; });
      return { ctx, ready: () => ready };
    } catch { /* not this way: the usual one */ }
  }
  try { const ctx = new AC(); return { ctx, ready: () => true }; } catch { return null; }
}
