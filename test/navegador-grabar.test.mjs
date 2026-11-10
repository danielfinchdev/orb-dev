// 3.8.2 (fase 10, T3 3.11): the pieces of «Señalar elemento» and of the recording of the agents' browser that need no
// browser (the whole flow, with a headless Edge: navegador-protocolo.test.mjs). browser_rules.rs is not touched: the
// pointing uses only DevTools methods it already allows (Runtime.evaluate in Orb's isolated world, captureScreenshot).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { jpegSize, resample, mjpegAvi, RECORD_FPS } from '../src/engine/browser/browser-record.mjs';
import { pointScript, clipOf } from '../src/engine/browser/browser-point.mjs';
import { pointLine } from '../src/ui/lib/browser-points.js';

// A tiny JPEG header: SOI, an APP0 segment and SOF0 with its size.
const jpeg = (w, h) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xd9]);

test('grabación: imágenes a ritmo fijo en un AVI Motion-JPEG con índice', () => {
  assert.deepEqual(jpegSize(jpeg(820, 512)), { width: 820, height: 512 });
  assert.equal(jpegSize(Buffer.from('no')), null);
  const a = jpeg(10, 10); const b = jpeg(11, 10);
  // A still page repeats its last picture: 1 s at 5 fps from two pictures.
  const ticks = resample([{ at: 0, data: a }, { at: 700, data: b }, { at: 1000, data: b }], RECORD_FPS);
  assert.equal(ticks.length, 6); assert.deepEqual(ticks.map((x) => (x === a ? 'a' : 'b')), ['a', 'a', 'a', 'a', 'b', 'b']);
  assert.deepEqual(resample([]), []);
  const avi = mjpegAvi(ticks);
  assert.equal(avi.toString('latin1', 0, 4), 'RIFF'); assert.equal(avi.readUInt32LE(4), avi.length - 8);
  assert.equal(avi.toString('latin1', 8, 12), 'AVI ');
  const avih = avi.indexOf('avih', 0, 'latin1') + 8;
  assert.equal(avi.readUInt32LE(avih), 200_000, '5 imágenes por segundo'); assert.equal(avi.readUInt32LE(avih + 16), 6);
  assert.equal(avi.readUInt32LE(avih + 32), 10); assert.equal(avi.readUInt32LE(avih + 36), 10);
  const idx = avi.indexOf('idx1', 0, 'latin1');
  assert.equal(avi.readUInt32LE(idx + 4), 16 * 6);
  // Each index entry points at its frame (offsets from the «movi» fourcc).
  const movi = avi.indexOf('movi', 0, 'latin1');
  for (let i = 0; i < 6; i++) { const off = avi.readUInt32LE(idx + 8 + i * 16 + 8); assert.equal(avi.toString('latin1', movi + off, movi + off + 4), '00dc'); }
  assert.throws(() => mjpegAvi([]));
});

test('señalar: el guion es JavaScript válido, el recorte cabe en la vista y la línea del mensaje es texto', () => {
  assert.doesNotThrow(() => new Function(`return ${pointScript(10, 20)}`));
  assert.match(pointScript(10, 20), /elementFromPoint\(10, 20\)/);
  assert.match(pointScript('1);alert(1', 2), /elementFromPoint\(NaN, 2\)/, 'solo números');
  assert.deepEqual(clipOf({ x: 600, y: 380, width: 120, height: 40 }, { pageX: 0, pageY: 300 }), { x: 592, y: 672, width: 136, height: 56, scale: 1 });
  const big = clipOf({ x: -50, y: -50, width: 5000, height: 5000 });
  assert.deepEqual([big.x, big.y, big.width, big.height], [0, 0, 1280, 800], 'nunca más que la vista');
  assert.equal(clipOf({ x: 'x', y: null }).width, 16);
  assert.equal(pointLine({ selector: '#a`b', text: 'Enviar', url: 'http://localhost:5173/' }), '`#ab` «Enviar» (http://localhost:5173/)');
  assert.equal(pointLine({}), '');
});

test('fase 10: lo privado nunca viaja a un móvil enlazado y browser_rules.rs no se relaja', () => {
  const remote = fs.readFileSync(new URL('../src/engine/transport/remote.mjs', import.meta.url), 'utf8');
  const events = /const EVENTS = new Set\(\[([\s\S]*?)\]\);/.exec(remote)[1];
  for (const e of ['secret:', 'browser:', 'terminal:']) assert.ok(!events.includes(e), `${e} no va al móvil`);
  const rules = fs.readFileSync(new URL('../src-tauri/src/browser_rules.rs', import.meta.url), 'utf8');
  const methods = /const CDP_METHODS: \[&str; 25\] = \[([\s\S]*?)\];/.exec(rules)?.[1];
  assert.ok(methods, 'los mismos 25 métodos de DevTools');
  assert.doesNotMatch(methods, /"(Network|Fetch|Storage|Target|Browser)\./);
});
