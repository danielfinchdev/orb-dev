// Orb Server without a screen: the QR encoder of «orb-server enlazar» (src/core/qr.mjs, compared with `qrcode`), the
// local control socket and what goes in the server's package.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT } from './helpers.mjs';
import { qrMatrix, qrTerminal } from '../src/core/qr.mjs';
import { serveControl, controlCall } from '../src/server/control.mjs';
import { manifest, appFiles } from '../scripts/dist-servidor.mjs';

test('el QR de la consola es el mismo que el de la interfaz (qrcode)', () => {
  const QR = createRequire(path.join(ROOT, 'package.json'))('qrcode');
  for (const [ecl, text, mask] of [['M', 'http://100.64.1.2:3131/#vincular=x', 2], ['L', 'a'.repeat(300), 6], ['H', 'Orb ñ €', 1], ['Q', `http://192.168.1.5:3131/#vincular=${'z'.repeat(40)}&pc=${'A'.repeat(43)}&v=2&n=Servidor&r=centro`, 4]]) {
    const mine = qrMatrix(text, { ecl, mask });
    const ref = QR.create([{ data: text, mode: 'byte' }], { errorCorrectionLevel: ecl, version: mine.version, maskPattern: mask }).modules;
    assert.equal(ref.size, mine.size);
    for (let y = 0; y < ref.size; y++) for (let x = 0; x < ref.size; x++) assert.equal(Boolean(ref.get(y, x)), mine.dark(x, y), `${ecl} v${mine.version} (${x},${y})`);
  }
  const drawn = qrTerminal('http://100.64.1.2:3131/#vincular=x', { color: false }).split('\n');
  const size = qrMatrix('http://100.64.1.2:3131/#vincular=x').size;
  assert.equal(drawn.length, Math.ceil((size + 4) / 2), 'dos filas por línea');
  assert.ok(drawn.every((l) => l.length === size + 4));
});

test('el control local de Orb Server solo deja unos pocos métodos', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-control-'));
  fs.mkdirSync(path.join(home, '.orb'), { recursive: true });
  const control = serveControl({ home, call: async (m) => ({ m }) });
  try {
    assert.ok(await control.ready);
    assert.deepEqual(await controlCall(home, 'link.qr'), { m: 'link.qr' });
    await assert.rejects(controlCall(home, 'config.save'), /no permitido/);
  } finally { await control.close(); fs.rmSync(home, { recursive: true, force: true }); }
  await assert.rejects(controlCall(home, 'app.state', {}, { timeoutMs: 2000 }));
});

test('el paquete del servidor lleva su consola y no la terminal de Orb', () => {
  const names = manifest({ root: ROOT, version: '9.9.9' }).map((e) => e.name);
  assert.ok(names.includes('orb-server-9.9.9/orb-server'));
  assert.ok(!names.some((n) => n.startsWith('orb-server-9.9.9/bin/')), 'sin bin/orb');
  const files = appFiles(ROOT).map(([rel]) => rel);
  for (const must of ['src/core/qr.mjs', 'src/core/link-payload.mjs', 'src/server/control.mjs', 'src/server/console-text.mjs']) assert.ok(files.includes(must), must);
  assert.ok(!files.some((f) => f.startsWith('src/terminal/')));
});
