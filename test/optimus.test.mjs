// 3.7 (WS8): Open Control Edge para los bots y el bot Optimus. Con un puente de OCE inventado (ORB_OCE_FAKE=1: los
// archivos de %LOCALAPPDATA%\OrbPuente en una carpeta temporal; nunca el OCE real del PC que pasa las pruebas):
// - lecturas de este PC: instalado, abierto, compartir apagado, fuera de Windows «no disponible»;
// - Optimus se crea una vez; eliminado, no vuelve; con «Crear Optimus automáticamente» apagado, no se crea;
// - dos Orbs enlazados en loopback (Server sin OCE y PC con OCE): un solo Optimus (en el Server), que lee el OCE del PC
//   con oce_values por el enlace y avisa en su chat al pasar un límite; eliminado, ninguno de los dos lo vuelve a crear.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tempHome, startEngine, until, wait, ROOT } from './helpers.mjs';
import { orbIdOf } from '../src/core/backup.mjs';

const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-oce-'));
const dirs = { unit: path.join(fakeRoot, 'unit'), pc: path.join(fakeRoot, 'pc'), srv: path.join(fakeRoot, 'srv') };
for (const d of Object.values(dirs)) fs.mkdirSync(path.join(d, 'OrbPuente'), { recursive: true });
process.env.ORB_OCE_FAKE = '1';
process.env.LOCALAPPDATA = dirs.unit;
process.env.ORB_OCE_DIR = path.join(dirs.unit, 'OpenControlEdge');
const O = await import('../src/engine/oce.mjs');
const { Board } = await import('../src/core/board.mjs');
const B = await import('../src/core/bots.mjs');
const { saveConfig } = await import('../src/core/context.mjs');

const reading = (extra = {}) => ({ schema: 1, app: 'OpenControlEdge', version: '2.3.0', pid: process.pid, at: new Date().toISOString(), cpu: { loadPct: 23, tempC: 61 }, gpu: { name: 'RTX 4070', loadPct: 9, tempC: 47, vramUsedMb: 2048, vramTotalMb: 8192 }, ramUsedPct: 58.2, fps: null, usage: [{ provider: 'claude', usedPct: 34, resetAt: null, plan: 'Max' }], ...extra });
const writeOce = (dir, data = reading()) => fs.writeFileSync(path.join(dir, 'OrbPuente', 'oce.json'), JSON.stringify(data));
const tmp = []; const engines = [];
after(async () => { for (const e of engines) await e.stop(); for (const t of tmp) t.cleanup(); fs.rmSync(fakeRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

test('lecturas de este PC: sin OCE, instalado, abierto y con compartir apagado; null es «sin lectura»', () => {
  const t = tempHome(); tmp.push(t);
  let s = O.localStatus();
  assert.equal(s.available, true); assert.equal(s.installed, false); assert.equal(s.open, false);
  assert.match(s.reason, /no está instalado/);
  fs.mkdirSync(O.oceInstallDir(), { recursive: true }); fs.writeFileSync(path.join(O.oceInstallDir(), 'OpenControlEdge.exe'), '');
  s = O.localStatus();
  assert.equal(s.installed, true); assert.equal(s.open, false); assert.match(s.reason, /no está abierto/);
  writeOce(dirs.unit);
  const v = O.localValues();
  assert.equal(v.open, true); assert.equal(v.version, '2.3.0'); assert.equal(v.reason, undefined);
  assert.equal(v.values.cpu.tempC, 61); assert.equal(v.values.gpu.vramUsedPct, 25); assert.equal(v.values.fps, null, 'lo que OCE no leyó sigue siendo null');
  assert.equal(O.metricOf(v.values, 'cpuTemp'), 61); assert.equal(O.metricOf(v.values, 'ai', 'claude'), 34); assert.equal(O.metricOf(v.values, 'ai', 'codex'), null);
  writeOce(dirs.unit, reading({ pid: 999999 }));
  assert.equal(O.localValues().values, null, 'de un proceso cerrado: nada');
  writeOce(dirs.unit);
  saveConfig({ oce: { share: false } });
  assert.match(O.localStatus().reason, /Compartir datos con Open Control Edge está desactivado/);
  saveConfig({ oce: { share: true } });
});

test('fuera de Windows (y sin el puente de pruebas) OCE «no está disponible en este PC»', async () => {
  const { spawnSync } = await import('node:child_process');
  const env = { ...process.env, ORB_OCE_FAKE: '0' };
  const code = "const O = await import('./src/engine/oce.mjs'); const s = O.localStatus(); console.log(JSON.stringify(s));";
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: ROOT, env, encoding: 'utf8', windowsHide: true });
  const s = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(s.available, false); assert.match(s.reason, /no está disponible en este PC/);
});

test('quién crea Optimus: el Server si lo hay; si no, la identidad más baja (todos llegan a lo mismo)', () => {
  assert.equal(O.creatorKey([{ key: 'b', server: false }, { key: 'c', server: true }, { key: 'a', server: false }]), 'c');
  assert.equal(O.creatorKey([{ key: 'b' }, { key: 'a' }]), 'a');
  assert.equal(O.creatorKey([]), null);
  assert.throws(() => O.checkThresholds([{ metric: 'disco', above: 5 }]), /no son válidos/);
  assert.deepEqual(O.checkThresholds([{ metric: 'ai', above: '80', provider: 'Claude' }]), [{ metric: 'ai', above: 80, machine: null, provider: 'claude' }]);
});

test('Optimus se crea una vez para el admin; eliminado, no vuelve; con el ajuste apagado, no se crea', async () => {
  const t = tempHome(); tmp.push(t);
  writeOce(dirs.unit);
  const board = new Board();
  const oce = O.createOce({ board });
  await oce.tick();
  const made = B.listBots(board).filter((b) => b.tools.includes('oce'));
  assert.equal(made.length, 1);
  const opt = made[0];
  assert.equal(opt.name, 'Optimus'); assert.deepEqual(opt.avatar, O.OPTIMUS_AVATAR); assert.deepEqual(opt.tools, ['oce', 'recordatorios']);
  assert.equal(B.personOf(board, opt), board.ownerId(), 'del admin');
  assert.match(opt.role_text, /oce_values/);
  const hello = board.chat(B.botConversation(board, opt), 10).find((l) => l.role === 'bot');
  assert.match(hello.body, /He encontrado Open Control Edge/);
  oce.optimusCheck(); assert.equal(B.listBots(board).filter((b) => b.tools.includes('oce')).length, 1, 'no se duplica');
  B.deleteBot(board, opt.id);
  oce.optimusCheck(); await oce.tick();
  assert.equal(B.listBots(board).filter((b) => b.tools.includes('oce')).length, 0, 'eliminado, no se vuelve a crear');
  board.db.close();

  const t2 = tempHome(); tmp.push(t2);
  saveConfig({ oce: { optimus: false } });
  const b2 = new Board();
  O.createOce({ board: b2 }).optimusCheck();
  assert.equal(B.listBots(b2).filter((b) => b.tools.includes('oce')).length, 0, '«Crear Optimus automáticamente» apagado');
  assert.equal(b2.settingJson(O.OPTIMUS_KEY), null, 'y si se vuelve a encender, se creará');
  b2.db.close();
});

test('dos Orbs enlazados: un solo Optimus (en el Server), que lee el OCE del PC y avisa al pasar un límite', async () => {
  if (!fs.existsSync(path.join(ROOT, 'src', 'renderer', 'index.html'))) throw new Error('compila antes la interfaz (npm run build)');
  const base = { ORB_REMOTE_BIND: '127.0.0.1', ORB_WOL_DRY: '1', ORB_REPLICA_MS: '400', ORB_FORWARD_MS: '8000', ORB_OCE_FAKE: '1', ORB_OCE_MS: '500', ORB_OCE_ALERT_MS: '500' };
  const port = 20000 + Math.floor(Math.random() * 20000);
  const tSrv = tempHome({ role: 'centro', mobile: { enabled: true, port, name: 'Servidor' } }); tmp.push(tSrv);
  const tPc = tempHome({ mobile: { name: 'Portátil' } }); tmp.push(tPc);
  const srv = await startEngine(tSrv.home, { env: { ...base, LOCALAPPDATA: dirs.srv, ORB_OCE_DIR: path.join(dirs.srv, 'nada') } }); engines.push(srv);
  const pc = await startEngine(tPc.home, { env: { ...base, LOCALAPPDATA: dirs.pc, ORB_OCE_DIR: path.join(dirs.pc, 'nada') } }); engines.push(pc);
  await until(async () => (await srv.call('remote.status')).running, 'acceso del servidor');
  const q = await srv.call('link.qr', { device: 'orb' });
  await pc.call('link.connect', { code: q.code, address: `127.0.0.1:${port}` });
  const seen = (e, k) => until(async () => (await e.call('bots.homes')).some((h) => h.key === k && h.online), 'el otro Orb se ve', 20000);
  await seen(pc, orbIdOf(tSrv.home).orbId); await seen(srv, orbIdOf(tPc.home).orbId);
  // Open Control Edge abre en el PC (y escribe su archivo cada 2 s, como el de verdad).
  writeOce(dirs.pc); const beat = setInterval(() => writeOce(dirs.pc), 1500);
  try {
    const optimus = (e) => e.call('bots.list').then((r) => r.bots.filter((b) => b.tools.includes('oce')));
    const onSrv = await until(async () => (await optimus(srv))[0], 'Optimus en el Server', 20000);
    assert.equal(onSrv.homeHere, true, 'su casa es el Server');
    const copy = await until(async () => (await optimus(pc)).find((b) => b.uid === onSrv.uid), 'su copia en el PC', 20000);
    assert.equal(copy.homeHere, false, 'en el PC es una copia: no hay un segundo Optimus');
    await wait(2500);
    assert.equal((await optimus(srv)).length, 1); assert.deepEqual((await optimus(pc)).map((b) => b.uid), [onSrv.uid]);

    // Lee el OCE del PC por el enlace (solo lectura) y su propio PC dice por qué no hay lectura.
    await srv.call('bots.send', { id: onSrv.id, text: 'Temperaturas del portátil\nBOT_CALL oce_values {"machine":"Portátil"}\nBOT_CALL oce_status {"machine":"este"}' });
    const reply = async (re) => (await srv.call('bots.chat', { id: onSrv.id })).lines.find((l) => l.role === 'bot' && re.test(l.body));
    const r = await until(() => reply(/oce_values:/), 'Optimus contesta', 60000);
    assert.match(r.body, /"tempC": 61/); assert.match(r.body, /"machine": "Portátil"/); assert.match(r.body, /RTX 4070/);
    assert.match(r.body, /oce_status: \{[\s\S]*"installed": false/);
    await srv.call('bots.send', { id: onSrv.id, text: 'Avísame si la CPU pasa de 50 grados\nBOT_CALL oce_alerts {"rules":[{"metric":"cpuTemp","above":50,"machine":"Portátil"}]}' });
    await until(() => reply(/"saved"/), 'guarda el límite', 60000);
    const alert = await until(async () => (await srv.call('bots.chat', { id: onSrv.id })).lines.find((l) => l.meta?.kind === 'oce_alert'), 'la notificación del límite', 20000);
    assert.match(alert.body, /La temperatura de la CPU en Portátil está en 61 °C \(tu límite: 50 °C\)/);

    // Eliminado: ni el Server ni el PC (que también tiene OCE) lo vuelven a crear.
    await srv.call('bots.delete', { id: onSrv.id });
    await wait(4000);
    assert.equal((await optimus(srv)).length, 0, 'el Server no lo vuelve a crear');
    assert.equal((await optimus(pc)).filter((b) => b.homeHere).length, 0, 'el PC no crea el suyo');
  } finally { clearInterval(beat); }
});
