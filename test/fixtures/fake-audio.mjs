// A stand-in for Web Audio, for the tests that drive the music engine (src/ui/lib/adaptive-music.js) in Node: every
// node and parameter takes any call and the clock is the test's. No sound is rendered: only that it runs, reacts and
// lets go is checked.
export function fakeContext({ sampleRate = 8000 } = {}) {
  const calls = { nodes: 0, suspend: 0, resume: 0, close: 0 };
  const param = () => { const p = { value: 0 }; for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'setValueCurveAtTime', 'cancelScheduledValues', 'cancelAndHoldAtTime']) p[m] = () => p; return p; };
  const METHODS = new Set(['connect', 'disconnect', 'start', 'stop', 'setPeriodicWave', 'getFloatTimeDomainData', 'addEventListener', 'removeEventListener']);
  const node = () => new Proxy({}, {
    get(t, k) { if (k in t || typeof k === 'symbol' || k === 'then') return t[k]; t[k] = METHODS.has(k) ? () => {} : param(); return t[k]; },
    set(t, k, v) { t[k] = v; return true; }
  });
  const ctx = {
    currentTime: 0, sampleRate, state: 'running', destination: node(),
    createBuffer: (channels, length, rate) => { const data = Array.from({ length: channels }, () => new Float32Array(length)); return { length, sampleRate: rate, duration: length / rate, numberOfChannels: channels, getChannelData: (ch) => data[ch] }; },
    createPeriodicWave: () => ({}),
    resume() { calls.resume++; ctx.state = 'running'; return Promise.resolve(); },
    suspend() { calls.suspend++; ctx.state = 'suspended'; return Promise.resolve(); },
    close() { calls.close++; ctx.state = 'closed'; return Promise.resolve(); }
  };
  return { calls, ctx: new Proxy(ctx, { get(t, k) { if (k in t) return t[k]; if (typeof k === 'string' && k.startsWith('create')) return () => { calls.nodes++; return node(); }; return undefined; }, set(t, k, v) { t[k] = v; return true; } }) };
}
// Runs the engine's scheduler for `seconds` of the audio clock, as its own timer does (every 50 ms).
export function run(music, ctx, seconds, each = () => {}) {
  const end = ctx.currentTime + seconds;
  while (ctx.currentTime < end) { ctx.currentTime += 0.05; each(ctx.currentTime); music._tick(ctx.currentTime); }
}
