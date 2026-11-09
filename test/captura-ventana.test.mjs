// 3.8.2: «Capturar ventana» of the composer (src/ui/lib/window-capture.js): the user picks a window in the system's
// picker, one frame is kept as a PNG and the capture stops at once. Only from the PC's composer, never for an agent (D7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { canCapture, captureFrame } from '../src/ui/lib/window-capture.js';

function fakes({ fail = null, width = 640 } = {}) {
  const stopped = []; const asked = [];
  const stream = { getTracks: () => [{ stop: () => stopped.push('video') }] };
  const nav = { mediaDevices: { getDisplayMedia: async (opts) => { asked.push(opts); if (fail) throw Object.assign(new Error(fail), { name: fail }); return stream; } } };
  const drawn = [];
  const doc = {
    createElement: (tag) => (tag === 'video'
      ? { muted: false, srcObject: null, videoWidth: width, videoHeight: 360, play: async () => {}, addEventListener: (_e, cb) => cb() }
      : { width: 0, height: 0, getContext: () => ({ drawImage: (v) => drawn.push(v.srcObject) }), toDataURL: (type) => `data:${type};base64,AAAA` })
  };
  return { nav, doc, stopped, asked, drawn, stream };
}

test('canCapture: only where the web view has getDisplayMedia', () => {
  assert.equal(canCapture({}), false);
  assert.equal(canCapture({ mediaDevices: {} }), false);
  assert.equal(canCapture(fakes().nav), true);
});

test('captureFrame: one PNG frame, no audio, and the capture stops at once', async () => {
  const f = fakes();
  assert.equal(await captureFrame({ nav: f.nav, doc: f.doc }), 'data:image/png;base64,AAAA');
  assert.deepEqual(f.asked, [{ video: { displaySurface: 'window' }, audio: false }]);
  assert.deepEqual(f.drawn, [f.stream]);
  assert.deepEqual(f.stopped, ['video']);
});

test('captureFrame: the picker closed is no error; another failure is', async () => {
  assert.equal(await captureFrame(fakes({ fail: 'NotAllowedError' })), null);
  assert.equal(await captureFrame(fakes({ fail: 'AbortError' })), null);
  await assert.rejects(captureFrame(fakes({ fail: 'NotReadableError' })), /NotReadableError/);
});

test('only the PC\'s composer offers it; agents get no way to it', () => {
  const session = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'views', 'session.jsx'), 'utf8');
  assert.match(session, /\{fullPc\(\) && canCapture\(\) \? <Tip label=\{t\('session\.capture'\)\}>/);
  assert.match(session, /call\('images\.mark', \{ dataUrl \}\)/, 'saved like a marked picture (PC only)');
  for (const dir of ['src/mcp', 'src/agents', 'src/engine']) {
    for (const file of fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.mjs'))) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, dir, file), 'utf8'), /getDisplayMedia|window-capture/, `${dir}/${file}`);
  }
});
