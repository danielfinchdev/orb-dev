// 3.5, Orb en la terminal: the «orb» client (src/terminal) against a real engine on loopback with the fake agents:
// linking with the short code (kind «terminal»), a one-shot message with Orbe's answer, «orb estado» and «dispositivos»,
// the interactive mode fed through a pipe, revoking from the engine, «orb-nucleo enlazar» (QR, code and address on a
// server without a screen), the local control socket, the QR encoder and the command parsers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { tempHome, startEngine, until, ROOT } from './helpers.mjs';
import { parseLine, findBot } from '../src/terminal/tui.mjs';
import { parseArgs, looksLikeCode, linkRequest } from '../src/terminal/orb-cli.mjs';
import { pickPeer } from '../src/terminal/store.mjs';
import { answerText } from '../src/terminal/client.mjs';
import { wrap } from '../src/terminal/render.mjs';
import { qrMatrix, qrTerminal } from '../src/core/qr.mjs';
import { serveControl, controlCall } from '../src/server/control.mjs';
import { terminalEntries, writeZip } from '../scripts/dist-terminal.mjs';
import { manifest, writeTarGz, readTarGz, appFiles } from '../scripts/dist-servidor.mjs';

const CLI = path.join(ROOT, 'src', 'terminal', 'orb-cli.mjs');
const NUCLEO = path.join(ROOT, 'src', 'server', 'orb-nucleo.mjs');
let engine; let t; let port; let termDir;

// Runs a command; input (optional) goes to its stdin. → { code, out, err }
function run(file, args, { env = {}, input = null, timeout = 60_000, onOut = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], { env: { ...process.env, ORB_TERMINAL_HOME: termDir, ORB_LANG: 'es', NO_COLOR: '1', ...env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d; onOut?.(out, child); });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`tiempo agotado: ${args.join(' ')}\n${out}\n${err}`)); }, timeout);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    if (input != null) child.stdin.end(input); else child.stdin.end();
  });
}
const orb = (args, opts) => run(CLI, args, opts);

before(async () => {
  if (!fs.existsSync(path.join(ROOT, 'src', 'renderer', 'index.html'))) throw new Error('compila antes la interfaz (npm run build)');
  port = 20000 + Math.floor(Math.random() * 20000);
  t = tempHome({ mobile: { enabled: true, port, name: 'Portátil' } });
  engine = await startEngine(t.home, { env: { ORB_REMOTE_BIND: '127.0.0.1' } });
  await until(async () => (await engine.call('remote.status')).running, 'acceso del Orb');
  termDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-terminal-'));
});
after(async () => {
  await engine?.stop();
  t?.cleanup();
  try { fs.rmSync(termDir, { recursive: true, force: true }); } catch { /* temp */ }
});

test('las órdenes del modo interactivo y de la línea de comandos', () => {
  assert.deepEqual(parseLine('  '), { type: 'empty' });
  assert.deepEqual(parseLine('hola Orbe'), { type: 'message', text: 'hola Orbe' });
  assert.deepEqual(parseLine('//no es una orden'), { type: 'message', text: '/no es una orden' });
  assert.equal(parseLine('/Salir').name, 'salir');
  assert.equal(parseLine('/exit').name, 'salir');
  assert.deepEqual(parseLine('/bot Agenda de casa'), { type: 'command', name: 'bot', arg: 'Agenda de casa' });
  assert.deepEqual(parseLine('/patata'), { type: 'unknown', name: 'patata' });
  assert.deepEqual(parseLine('/aprobar'), { type: 'command', name: 'aprobar', arg: '', index: null, decision: null });
  assert.equal(parseLine('/aprobar 2 sí').decision, 'allow');
  assert.equal(parseLine('/aprobar 2 sí').index, 2);
  assert.equal(parseLine('/aprobar no 3').decision, 'deny');
  assert.equal(parseLine('/aprobar 1 siempre').decision, 'always');
  assert.equal(parseLine('/aprobar 1').decision, null);
  assert.equal(parseLine('/aprobar quizás').error, 'usage');
  assert.equal(parseLine('/aprobar 0 si').error, 'usage');
  const bots = [{ id: 1, name: 'Asistente' }, { id: 2, name: 'Agenda' }];
  assert.equal(findBot(bots, 'agenda').id, 2);
  assert.equal(findBot(bots, 'asis').id, 1);
  assert.equal(findBot(bots, '2').id, 2);
  assert.equal(findBot(bots, 'nadie'), null);

  assert.equal(parseArgs([]).command, 'tui');
  assert.deepEqual(parseArgs(['hola', 'mundo']), { command: 'mensaje', args: ['hola mundo'], orb: null, bot: null, json: false });
  assert.equal(parseArgs(['estado del servidor']).command, 'mensaje', 'una frase entre comillas es un mensaje');
  assert.equal(parseArgs(['--', 'estado']).command, 'mensaje');
  assert.deepEqual(parseArgs(['enlazar', 'ABCD-EFGH', '100.64.0.2', '--orb', 'casa']).args, ['ABCD-EFGH', '100.64.0.2']);
  assert.equal(parseArgs(['--orb=casa', 'estado', '--json']).orb, 'casa');
  assert.equal(parseArgs(['--bot', 'Agenda', 'qué tengo hoy']).bot, 'Agenda');
  assert.throws(() => parseArgs(['--rara']));
  assert.ok(looksLikeCode('abcd-efgh') && looksLikeCode('ABCDEFGH') && !looksLikeCode('100.64.0.2:3131'));
  assert.deepEqual(linkRequest(['100.64.0.2', 'ABCD-EFGH']), { code: 'ABCD-EFGH', address: '100.64.0.2' }, 'en cualquier orden');
  const key = 'A'.repeat(43);
  const q = linkRequest([`http://192.168.1.5:3131/#vincular=abc&pc=${key}&v=2&n=Casa&r=centro`]);
  assert.deepEqual([q.qr.code, q.qr.name, q.qr.role, q.qr.urls], ['abc', 'Casa', 'centro', ['http://192.168.1.5:3131']]);
  assert.throws(() => linkRequest(['ABCD-EFGH', '8.8.8.8']), (e) => e.key === 'app.linkInsecure', 'nada de http a internet');
  assert.throws(() => linkRequest(['ABCD-EFGH']), (e) => e.needAddress);

  const peers = [{ id: 'a', name: 'Servidor', revoked: false }, { id: 'b', name: 'Portátil', revoked: false }];
  assert.equal(pickPeer(peers, 'port').peer.id, 'b');
  assert.equal(pickPeer(peers, null).error, 'many');
  assert.equal(pickPeer(peers, null, 'a').peer.id, 'a', 'el último usado');
  assert.equal(pickPeer([], null).error, 'none');
  // What is still to print after the streamed part.
  assert.deepEqual(answerText([{ role: 'orb', body: 'Hola, Ana' }], 'Hola').map((x) => x.text), [', Ana']);
  assert.ok(wrap('una frase bastante larga que no cabe en tan poco sitio', 24).split('\n').every((l) => l.length <= 24));
});

test('el QR de la terminal es el mismo que el de la interfaz (qrcode)', () => {
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

test('orb enlazar con el código corto: queda enlazada como «terminal» y sus claves van cifradas', async () => {
  const q = await engine.call('link.qr');
  const r = await orb(['enlazar', q.code, `127.0.0.1:${port}`]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Enlazado con Portátil/);
  const dev = (await engine.call('link.devices')).find((d) => d.kind === 'terminal');
  assert.ok(dev, 'el Orb ve la terminal');
  assert.match(dev.name, /^Terminal \(/);
  const raw = fs.readFileSync(path.join(termDir, 'enlaces.json'), 'utf8');
  assert.ok(!raw.includes('priv') && !raw.includes(dev.id), 'enlaces.json va cifrado');
  assert.equal(fs.readFileSync(path.join(termDir, 'clave.bin')).length, 32);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.join(termDir, 'clave.bin')).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(termDir, 'enlaces.json')).mode & 0o777, 0o600);
  }
  const again = await orb(['enlazar', q.code, `127.0.0.1:${port}`]);
  assert.notEqual(again.code, 0, 'el código sirve una sola vez');
});

test('orb "mensaje": Orbe contesta y la respuesta sale en la terminal', async () => {
  const r = await orb(['hola desde la terminal']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Recibido/);
});

test('orb estado y orb dispositivos', async () => {
  const s = await orb(['estado']);
  assert.equal(s.code, 0, s.err);
  assert.match(s.out, /Portátil/);
  assert.match(s.out, /Dispositivos enlazados: [0-9]/);
  const j = JSON.parse((await orb(['estado', '--json'])).out);
  assert.equal(j.status.role, 'todo', 'un Orb sin papel lo hace todo');
  assert.equal(j.status.dev, 'local', 'y programa él mismo');
  assert.ok(j.status.devices.every((d) => !('ip' in d)), 'sin direcciones, como un móvil');
  const d = await orb(['dispositivos']);
  assert.equal(d.code, 0, d.err);
  assert.match(d.out, /terminal/);
  const l = await orb(['enlaces']);
  assert.match(l.out, /Portátil/);
});

test('el modo interactivo por una tubería: órdenes y un mensaje', async () => {
  const r = await orb([], { input: '/ayuda\n/tareas\n/aprobar\nhola modo interactivo\n/patata\n/salir\n', timeout: 90_000 });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /\/despertar/, 'la ayuda');
  assert.match(r.out, /No hay nada esperando tu respuesta/);
  assert.match(r.out, /Recibido/);
  assert.match(r.out, /No conozco «\/patata»/);
});

test('cerrar sesión desde el Orb: la terminal dice que ya no está enlazada', async () => {
  const dev = (await engine.call('link.devices')).find((d) => d.kind === 'terminal');
  await engine.call('link.revoke', { id: dev.id });
  const r = await orb(['estado']);
  assert.equal(r.code, 3, r.out + r.err);
  assert.match(r.err, /cerró el enlace/);
  const again = await orb(['hola']);
  assert.equal(again.code, 3, 'se queda guardado');
  const forget = await orb(['olvidar']);
  assert.equal(forget.code, 0, forget.err);
  assert.equal((await orb(['estado'])).code, 4, 'sin enlaces');
});

test('el control local del núcleo solo deja unos pocos métodos', async () => {
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

test('paquetes: bin/orb en el del servidor y el cliente solo (zip y tar) funciona descomprimido', async () => {
  const names = manifest({ root: ROOT, version: '9.9.9' });
  const orbBin = names.find((e) => e.name === 'orb-nucleo-9.9.9/bin/orb');
  assert.equal(orbBin?.mode, 0o755);
  assert.match(String(orbBin.data), /node\/bin\/node.*src\/terminal\/orb-cli\.mjs/);
  const files = appFiles(ROOT).map(([rel]) => rel);
  for (const must of ['src/terminal/orb-cli.mjs', 'src/core/qr.mjs', 'src/core/link-payload.mjs', 'src/server/control.mjs']) assert.ok(files.includes(must), must);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-dist-terminal-'));
  try {
    const entries = terminalEntries({ root: ROOT, version: '9.9.9' });
    assert.ok(!entries.some((e) => /src\/(engine|agents|mcp|server|ui|main|renderer)\//.test(e.name)), 'sin el motor ni la interfaz');
    const tgz = path.join(dir, 'p.tar.gz');
    await writeTarGz(tgz, entries);
    writeZip(path.join(dir, 'p.zip'), entries);
    assert.ok(fs.statSync(path.join(dir, 'p.zip')).size < 2 * 1024 * 1024, 'pequeño');
    const out = path.join(dir, 'x');
    for (const e of readTarGz(tgz)) {
      const target = path.join(out, e.name);
      if (e.type === '5') fs.mkdirSync(target, { recursive: true }); else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, e.data); }
    }
    const cli = path.join(out, 'orb-terminal-9.9.9', 'src', 'terminal', 'orb-cli.mjs');
    const v = await run(cli, ['--version'], { env: { ORB_TERMINAL_HOME: path.join(dir, 'h') } });
    assert.equal(v.out.trim(), '9.9.9');
    const s = await run(cli, ['estado'], { env: { ORB_TERMINAL_HOME: path.join(dir, 'h') } });
    assert.equal(s.code, 4, s.err);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('orb-nucleo enlazar: QR, código y dirección en la terminal; una terminal se enlaza con ellos', async () => {
  const port2 = port + 1;
  const t2 = tempHome({ mobile: { enabled: true, port: port2, name: 'Servidor' } });
  try {
    let linked = null;
    const nucleo = run(NUCLEO, ['enlazar', '--home', t2.home], {
      env: { ORB_REMOTE_BIND: '127.0.0.1' }, timeout: 120_000,
      onOut: (out) => {
        const code = out.match(/Código: ([A-Z0-9]{4}-[A-Z0-9]{4})/)?.[1]; const address = out.match(/Dirección: (\S+)/)?.[1];
        if (code && address && !linked) linked = orb(['enlazar', code, address]);
      }
    });
    const r = await nucleo;
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /█/, 'el QR dibujado');
    assert.match(r.out, /orb enlazar [A-Z0-9-]+ http:\/\/127\.0\.0\.1:/);
    assert.match(r.out, /Enlazado: Terminal/);
    const l = await linked;
    assert.equal(l.code, 0, l.err);
    assert.match(l.out, /Enlazado con Servidor \(servidor\)/);
  } finally { t2.cleanup(); }
});
