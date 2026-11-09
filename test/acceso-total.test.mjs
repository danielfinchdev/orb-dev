// 3.8.2 (fase 3, decisions D1 and D2 of the owner): «Acceso total al PC» in chats without a project, «Usar mi móvil
// Android» in any chat, and the phone's tools.
//   - the guard's «total»: everything but the protected set (core, the folders kept outside it, Orb's install folder,
//     «Elementos protegidos», sudo), also through an 8.3 short path or a junction; adb by hand only with the phone too
//   - the grants: the master password every time, kept across a restart, gone when Orb locks, audited
//   - the request of Orb's MCP server for the engine (agent-auth 'call'): only Orb's own server, never a connector's
//   - the platform-tools download (a mocked network) and its pin
//   - the pairing QR and the phone's tools against a fake adb (never the real one, never a phone)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { tempHome, startEngine, until, fake } from './helpers.mjs';
import { decide, runsAdb, setGuardedRoots, setAppRoots, localPath } from '../src/core/guard.mjs';
import zlib from 'node:zlib';
import { needsUnlock, FRESH_UNLOCK, METHODS } from '../src/core/permissions.mjs';
import { useHome, ctx } from '../src/core/context.mjs';
import { AgentAuth } from '../src/engine/agent-auth.mjs';
import { redeem } from '../src/mcp/auth-client.mjs';
import { cursorRules } from '../src/agents/cursor.mjs';
import { createActions } from '../src/core/browser-protocol.mjs';
import { permissionModeOf } from '../src/agents/claude.mjs';
import { pairingQr, newPairing, parseMdns, parseDevices, pairedGuid, apkPackage, verifyAdb, fingerprints, inputText, ensureAdb, checkArchive, createAndroid, androidAllowed, shellAllowed, adbStatus } from '../src/engine/android.mjs';

const WIN = process.platform === 'win32';
const v = (args) => decide({ lang: 'es', ...args }).decision;

test('guard «total»: todo menos lo protegido (core, lo guardado fuera, la carpeta de Orb, «Elementos protegidos», sudo)', () => {
  const t = tempHome();
  try {
    const core = path.join(t.home, 'core');
    const personal = path.join(t.home, 'personal');
    const app = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-app-'));
    setGuardedRoots([personal]); setAppRoots([app]);
    const base = { permission: 'total', internalDir: core, cwd: t.home };
    // Outside the workspace: allowed (the point of «Acceso total al PC»).
    const desk = path.join(os.homedir(), 'Desktop', 'nota.txt');
    assert.equal(v({ ...base, tool: 'Write', paths: [desk] }), 'allow');
    assert.equal(v({ ...base, tool: 'Bash', command: 'git push origin main' }), 'allow', 'sin preguntas');
    // The protected set: denied, never asked.
    for (const p of [path.join(core, 'datos', 'orb.db'), path.join(core, 'secretos', 'boveda.enc'), path.join(core, 'orb.json'), path.join(personal, 'plan.md')]) {
      assert.equal(v({ ...base, tool: 'Write', paths: [p] }), 'deny', p);
      assert.equal(v({ ...base, tool: 'Bash', command: `type "${p}"` }), 'deny', p);
    }
    assert.equal(v({ ...base, tool: 'Read', paths: [path.join(core, 'datos', 'clave.bin')] }), 'deny');
    assert.equal(v({ ...base, tool: 'Write', paths: [path.join(app, 'resources', 'engine.mjs')] }), 'deny', 'la carpeta donde está instalado Orb');
    assert.equal(v({ ...base, tool: 'Read', paths: [path.join(app, 'resources', 'engine.mjs')] }), 'allow', 'leerla sí');
    assert.equal(v({ ...base, tool: 'Bash', command: 'type C:\\Users\\x\\Vaultwarden\\db.sqlite3' }), 'deny', 'Elementos protegidos');
    assert.equal(v({ ...base, tool: 'Bash', command: 'sudo rm -rf /' }), 'deny');
    assert.equal(v({ ...base, tool: 'Bash', command: `mklink /J enlace "${core}"` }), 'deny', 'un enlace hacia core');
    // Junction: a folder outside that points into core.
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-fuera-'));
    const link = path.join(out, 'enlace');
    try { fs.symlinkSync(core, link, 'junction'); } catch { /* no junctions here */ }
    if (fs.existsSync(link)) {
      assert.equal(v({ ...base, tool: 'Write', paths: [path.join(link, 'datos', 'orb.db')] }), 'deny', 'por una unión de carpetas');
      assert.equal(v({ ...base, tool: 'Bash', command: `${WIN ? 'type' : 'cat'} ${path.join('enlace', 'datos', 'orb.db')}`, cwd: out }), 'deny');
    }
    // 8.3: the short name of the workspace (Windows, when the volume makes them).
    if (WIN) {
      const short = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', `for %I in ("${t.home}") do @echo %~sI`], { windowsHide: true, windowsVerbatimArguments: true, encoding: 'utf8' }).stdout.trim();
      if (short && short.toLowerCase() !== t.home.toLowerCase()) {
        assert.equal(v({ ...base, tool: 'Write', paths: [path.join(short, 'core', 'datos', 'orb.db')] }), 'deny', `8.3: ${short}`);
        assert.equal(v({ ...base, tool: 'Bash', command: `type ${path.join(short, 'core', 'secretos', 'x')}` }), 'deny');
      }
    }
    fs.rmSync(out, { recursive: true, force: true }); fs.rmSync(app, { recursive: true, force: true });
  } finally { setGuardedRoots([]); setAppRoots([]); t.cleanup(); }
});

test('guard: adb a mano solo con «Acceso total» y el móvil', () => {
  for (const c of ['adb devices', 'adb.exe -s x shell ls', 'C:\\Orb\\core\\herramientas\\adb\\adb.exe install a.apk', 'cmd /c "adb shell"', 'x && adb install a.apk', '& "adb" kill-server']) assert.ok(runsAdb(c), c);
  for (const c of ['npm run adbtools', 'echo badb', 'git log', 'gradlew installDebug']) assert.equal(runsAdb(c), false, c);
  for (const permission of ['leer', 'probar', 'editar', 'preguntar', 'total']) assert.equal(v({ permission, tool: 'Bash', command: 'adb shell ls' }), 'deny', permission);
  assert.equal(v({ permission: 'editar', tool: 'Bash', command: 'adb shell ls', android: true }), 'deny', 'el móvil sin acceso total: sus herramientas');
  assert.equal(v({ permission: 'total', tool: 'Bash', command: 'adb shell ls', android: true }), 'allow');
  assert.equal(v({ permission: 'editar', tool: 'mcp__orb__orb_android_tap' }), 'allow', 'las herramientas de Orb las comprueba el motor');
  // Cursor (no questions): its rules say the same.
  assert.ok(cursorRules('editar', null).includes('Shell(adb *)'));
  assert.ok(cursorRules('total', null).includes('Shell(adb *)'));
  assert.equal(cursorRules('total', null, { android: true }).some((r) => /adb/.test(r)), false);
  const core = path.join(os.tmpdir(), 'Orb', 'core');
  assert.ok(cursorRules('total', core).some((r) => r.includes(path.join(core, 'datos'))), 'Cursor con total: core sigue cerrado');
  // Claude: «total» no longer skips canUseTool (bypassPermissions); Codex keeps asking the guard.
  assert.equal(permissionModeOf('total'), 'default');
});

test('navegador de los agentes (D8): no abre direcciones de «Elementos protegidos»', async () => {
  const loaded = [];
  const { ACTIONS } = createActions({ driver: { load: async (tab, u) => { loaded.push(u); throw new Error('cargada'); } }, T: (k, vars) => `${k} ${JSON.stringify(vars ?? {})}` });
  await assert.rejects(ACTIONS.open({}, { url: 'https://casa.lan/vaultwarden/#/vault' }), /sys.browser.protected.*vaultwarden/i);
  await assert.rejects(ACTIONS.open({}, { url: 'vault.bitwarden.com' }), /protected/);
  assert.deepEqual(loaded, [], 'nada se carga');
  await assert.rejects(ACTIONS.open({}, { url: 'example.com' }), /cargada/);
  assert.deepEqual(loaded, ['https://example.com/']);
  // No Claude in Chrome (the user's own Chrome): Claude Code starts without --chrome.
  assert.doesNotMatch(fs.readFileSync(new URL('../src/agents/claude.mjs', import.meta.url), 'utf8'), /chrome: null/);
});

test('permisos: dar acceso total o el móvil pide la contraseña cada vez, solo desde este PC', () => {
  for (const m of ['sessions.grantTotal', 'sessions.grantAndroid', 'sessions.revokeGrant', 'android.pairStart', 'android.pairCode', 'android.devices']) assert.equal(METHODS[m], 'pc', m);
  assert.equal(FRESH_UNLOCK['sessions.grantTotal'], 'fullAccess');
  assert.equal(FRESH_UNLOCK['sessions.grantAndroid'], 'android');
  assert.ok(needsUnlock('android.pairStart', {}) && needsUnlock('android.pairCode', {}));
  assert.equal(needsUnlock('sessions.revokeGrant', {}), false, 'retirarlo no pide nada');
  assert.ok(androidAllowed({ kind: 'chat', android: true, permission: 'editar', project: 'web' }));
  assert.ok(androidAllowed({ kind: 'chat', android: false, permission: 'total', project: null }), 'el acceso total al PC lo incluye');
  assert.equal(androidAllowed({ kind: 'chat', android: false, permission: 'total', project: 'web' }), false, 'el «total» de un proyecto no');
  assert.equal(androidAllowed({ kind: 'task', android: true, permission: 'editar' }), false);
  assert.equal(shellAllowed({ kind: 'chat', android: true, permission: 'editar', project: 'web' }), false);
  assert.ok(shellAllowed({ kind: 'chat', android: true, permission: 'total', project: 'web' }));
});

test('acceso total y móvil: contraseña cada vez, se guardan al reiniciar, se pierden al bloquear y quedan en el registro', async () => {
  const t = tempHome();
  let e = await startEngine(t.home);
  const PASS = 'una frase larga de prueba';
  try {
    await e.call('projects.create', { name: 'web' });
    const s = await e.call('sessions.create', { agent: 'claude' });
    assert.equal(s.permission, 'leer');
    await assert.rejects(e.call('sessions.grantTotal', { id: s.id }), /contraseña maestra/);
    const { unlock } = await e.call('master.create', { password: PASS });
    await assert.rejects(e.call('sessions.grantTotal', { id: s.id, unlock }), /contraseña maestra/, 'un desbloqueo de otra acción no vale');
    await assert.rejects(e.call('sessions.update', { id: s.id, permission: 'total' }), /./, 'no por la puerta de los permisos');
    const fresh = (await e.call('master.unlock', { password: PASS, purpose: 'fullAccess' })).unlock;
    assert.equal((await e.call('sessions.grantTotal', { id: s.id, unlock: fresh })).permission, 'total');
    await assert.rejects(e.call('sessions.grantTotal', { id: s.id, unlock: fresh }), /contraseña maestra/, 'un token, una vez');
    const p = await e.call('sessions.create', { agent: 'claude', project: 'web' });
    const fresh2 = (await e.call('master.unlock', { password: PASS, purpose: 'fullAccess' })).unlock;
    // 3.8.2 (D5): a project's chat gets «Acceso total» the same way (never by sessions.update or at creation).
    await e.call('sessions.update', { id: p.id, permission: 'probar' });
    await assert.rejects(e.call('sessions.update', { id: p.id, permission: 'total' }), /contraseña maestra/);
    await assert.rejects(e.call('sessions.create', { agent: 'claude', project: 'web', permission: 'total' }), /contraseña maestra/);
    assert.equal((await e.call('sessions.grantTotal', { id: p.id, unlock: fresh2 })).permission, 'total');
    await assert.rejects(e.call('sessions.update', { id: p.id, permission: 'editar' }), /contraseña maestra/, 'salir de total, solo retirándolo');
    assert.equal((await e.call('sessions.fork', { id: p.id })).permission, 'editar', 'la copia no lo hereda');
    const fresh3 = (await e.call('master.unlock', { password: PASS, purpose: 'android' })).unlock;
    assert.equal((await e.call('sessions.grantAndroid', { id: p.id, unlock: fresh3 })).android, true, 'el móvil, en cualquier chat');
    // A copy of the chat does not take what the password gave.
    const copy = await e.call('sessions.fork', { id: s.id });
    assert.equal(copy.permission, 'leer');
    // A new start of Orb keeps them (the owner takes them back, or a lock does).
    await e.stop();
    e = await startEngine(t.home);
    const list = await e.call('sessions.list');
    assert.equal(list.find((x) => x.id === s.id).permission, 'total');
    assert.equal(list.find((x) => x.id === p.id).android, true);
    // Orb locks (minutes without use, «Bloquear ahora», Windows): every one goes.
    await e.call('master.lock', { reason: 'idle' });
    const after = await e.call('sessions.list');
    assert.equal(after.find((x) => x.id === s.id).permission, 'leer');
    assert.equal(after.find((x) => x.id === p.id).android, false);
    assert.equal(after.find((x) => x.id === p.id).permission, 'probar', 'el chat del proyecto vuelve al permiso que tenía');
    const items = await e.call('sessions.items', { id: s.id });
    assert.ok(items.some((i) => /Acceso total retirado/.test(typeof i.body === 'string' ? i.body : '')), 'se dice en el chat');
    // Taking it back by hand needs nothing, and is said too.
    const fresh4 = (await e.call('master.unlock', { password: PASS, purpose: 'android' })).unlock;
    await e.call('sessions.grantAndroid', { id: p.id, unlock: fresh4 });
    assert.equal((await e.call('sessions.revokeGrant', { id: p.id, grant: 'android' })).android, false);
    const log = fs.readFileSync(path.join(t.home, 'core', 'ejecuciones', 'motor.log'), 'utf8');
    assert.equal((log.match(/acceso: totalOff/g) ?? []).length, 2, 'los dos chats');
    for (const what of ['totalOn', 'androidOn', 'totalOff · chat', 'androidOff']) assert.match(log, new RegExp(`acceso: ${what}`), what);
    assert.match(log, /bloqueo \(sin usar\)/);
  } finally { await e.stop(); t.cleanup(); }
});

test('agent-auth: el servidor MCP de Orb pide al motor; el de un conector o el coordinador, no', async () => {
  const auth = new AgentAuth();
  const seen = [];
  auth.onCall = async (who, method, args) => { seen.push([who.session, method, args]); if (args.fail) throw Object.assign(new Error('no puedo'), { userFacing: true }); return { ok: 1 }; };
  const mine = auth.issue({ session: 's1', reply: { home: 'x', who: { agent: 'claude', boss: false, session: 's1' } } });
  const conn = auth.issue({ session: 's1', reply: () => ({ launch: { command: 'x' } }) });
  const boss = auth.issue({ session: 'asistente-1', reply: { home: 'x', who: { agent: 'orb', boss: true } } });
  const a = await redeem(auth.address, mine);
  assert.deepEqual(await a.call('android', { tool: 'devices' }), { ok: 1 });
  assert.deepEqual(seen[0], ['s1', 'android', { tool: 'devices' }]);
  await assert.rejects(a.call('android', { fail: true }), /no puedo/);
  for (const t of [conn, boss]) { const b = await redeem(auth.address, t); await assert.rejects(b.call('android', {}), /not allowed/); }
  assert.equal(seen.length, 2);
  auth.revokeSession('s1'); auth.revokeSession('asistente-1');
});

test('platform-tools: se descargan la primera vez, se comprueban contra su huella y lo que no coincide se tira', { skip: !WIN && 'Windows (tar de System32)' }, async () => {
  const t = tempHome();
  try {
    useHome(t.home);
    // A zip with platform-tools\adb.exe, made with Windows' own tar.
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-pt-'));
    fs.mkdirSync(path.join(src, 'platform-tools'));
    fs.writeFileSync(path.join(src, 'platform-tools', 'adb.exe'), 'no es adb');
    const zip = path.join(src, 'pt.zip');
    execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-cf', zip, '-C', src, 'platform-tools'], { windowsHide: true });
    const buf = fs.readFileSync(zip);
    const pin = { url: 'https://dl.google.com/x.zip', size: buf.length, sha1: crypto.createHash('sha1').update(buf).digest('hex'), sha256: crypto.createHash('sha256').update(buf).digest('hex') };
    const asked = [];
    const fetchImpl = async (url) => { asked.push(url); return { ok: true, status: 200, headers: new Map([['content-length', String(buf.length)]]), arrayBuffer: async () => buf }; };
    // Another file (changed by a byte): refused, nothing unpacked.
    const bad = Buffer.from(buf); bad[bad.length - 1] ^= 1;
    assert.match(checkArchive(bad, pin), /no coincide/);
    assert.match(checkArchive(buf.subarray(1), pin), /tamaño/);
    let r = await ensureAdb({ fetchImpl: async () => ({ ok: true, headers: new Map(), arrayBuffer: async () => bad }), pin });
    assert.equal(r.state, 'error'); assert.equal(r.ready, false);
    assert.ok(!fs.existsSync(path.join(ctx.paths.adb, 'adb.exe')));
    r = await ensureAdb({ fetchImpl, pin });
    assert.equal(r.state, 'ready', r.error); assert.equal(adbStatus().ready, true);
    assert.equal(fs.readFileSync(path.join(ctx.paths.adb, 'adb.exe'), 'utf8'), 'no es adb');
    assert.deepEqual(asked, [pin.url]);
    assert.ok(!fs.readdirSync(path.join(ctx.paths.internal, 'descargas')).length, 'sin restos');
    // Already there: nothing more is downloaded.
    await ensureAdb({ fetchImpl, pin }); assert.equal(asked.length, 1);
    fs.rmSync(src, { recursive: true, force: true });
  } finally { t.cleanup(); }
});

test('emparejar: el QR de Android y lo que dice adb', () => {
  assert.equal(pairingQr('orb-abc', 'Pa55word'), 'WIFI:T:ADB;S:orb-abc;P:Pa55word;;');
  assert.equal(pairingQr('a;b', 'c:d"e\\'), 'WIFI:T:ADB;S:a\\;b;P:c\\:d\\"e\\\\;;');
  const n = newPairing();
  assert.match(n.name, /^orb-[A-Za-z0-9]{8}$/); assert.match(n.password, /^[A-Za-z0-9]{12}$/);
  assert.deepEqual(parseMdns('List of discovered mdns services\norb-x\t_adb-tls-pairing._tcp\t192.168.1.20:37000\nadb-R5-x\t_adb-tls-connect._tcp.\t192.168.1.20:41000\n'),
    [{ name: 'orb-x', type: '_adb-tls-pairing._tcp', address: '192.168.1.20:37000' }, { name: 'adb-R5-x', type: '_adb-tls-connect._tcp', address: '192.168.1.20:41000' }]);
  assert.deepEqual(parseDevices('List of devices attached\nR5CT1 device product:a model:Pixel_8 device:b\nemu offline\n'),
    [{ serial: 'R5CT1', state: 'device', model: 'Pixel 8', product: 'a', device: 'b' }, { serial: 'emu', state: 'offline', model: null, product: null, device: null }]);
  assert.equal(pairedGuid('Successfully paired to 1.2.3.4:5 [guid=adb-X-y]'), 'adb-X-y');
  assert.equal(pairedGuid('Failed: Wrong password'), null);
  assert.equal(inputText("hola mundo it's"), "'hola%smundo%sit'\\''s'");
  for (const bad of ['', 'x'.repeat(501), 'línea\n', 'ñ']) assert.equal(inputText(bad), null, bad);
});

test('el móvil de los agentes: un adb falso, permisos en cada llamada y límites de cada herramienta', async () => {
  const t = tempHome();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-adb-'));
  const logFile = path.join(work, 'llamadas.jsonl');
  const env = { FAKE_ADB_DIR: process.env.FAKE_ADB_DIR, FAKE_ADB_LOG: process.env.FAKE_ADB_LOG, FAKE_ADB_CODE: process.env.FAKE_ADB_CODE };
  Object.assign(process.env, { FAKE_ADB_DIR: work, FAKE_ADB_LOG: logFile, FAKE_ADB_CODE: '123456' });
  const calls = () => fs.readFileSync(logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  try {
    useHome(t.home);
    const settings = new Map();
    const board = { settingJson: (k, val) => { if (val !== undefined) { settings.set(k, val); return val; } return settings.get(k) ?? null; } };
    const android = createAndroid({ board, exe: () => fake('fake-adb.mjs'), pollMs: 20, ensure: async () => ({}) });
    // By hand: the address and the six digits are checked first.
    await assert.rejects(android.pairCode({ address: 'x', code: '123456' }), /Dirección no válida/);
    await assert.rejects(android.pairCode({ address: '192.168.1.20:37000', code: '12345' }), /6 cifras/);
    await assert.rejects(android.pairCode({ address: '192.168.1.20:37000', code: '654321' }), /No se pudo emparejar/);
    const dev = await android.pairCode({ address: '192.168.1.20:37000', code: '123456', connect: '192.168.1.20:41000' });
    assert.equal(dev.serial, '192.168.1.20:41000'); assert.equal(dev.model, 'Pixel 8'); assert.equal(dev.guid, 'adb-R5CT10ABCD-xyz');
    // By QR: the phone announces the name of the QR on the network; Orb pairs with its password.
    process.env.FAKE_ADB_CODE = '';
    const qr = await android.pairStart();
    assert.equal(qr.state, 'waiting');
    const [, name, password] = /S:([^;]+);P:([^;]+);;/.exec(qr.qr);
    // B4 (review): decoys on the network (same name elsewhere, another name at the same address) are never connected to.
    fs.writeFileSync(path.join(work, 'mdns.txt'), `${name}\t_adb-tls-pairing._tcp\t192.168.1.20:37001\nadb-R5CT10ABCD-xyz\t_adb-tls-connect._tcp\t192.168.1.66:41000\nadb-R5CT10ABCD-xyz-falso\t_adb-tls-connect._tcp\t192.168.1.20:42000\nadb-R5CT10ABCD-xyz\t_adb-tls-connect._tcp\t192.168.1.20:41000\n`);
    await until(async () => android.pairState().state === 'done', 'emparejado por QR', 5000);
    assert.ok(calls().some((c) => c[0] === 'pair' && c[1] === '192.168.1.20:37001' && c[2] === password));
    assert.deepEqual(calls().filter((c) => c[0] === 'connect').map((c) => c[1]).slice(-1), ['192.168.1.20:41000']);
    assert.ok(!calls().some((c) => c[0] === 'connect' && /\.66:|:42000/.test(c[1])));
    assert.equal((await android.devices()).length, 1, 'el mismo móvil, una vez');
    // The tools: only while the chat holds the phone.
    const s = { id: 'c1', kind: 'chat', project: 'web', permission: 'editar', android: false, cwd: path.join(t.home, 'web', 'app') };
    fs.mkdirSync(path.join(s.cwd, 'build'), { recursive: true });
    await assert.rejects(android.tool(s, 'devices'), /Usar mi móvil Android/);
    s.android = true;
    assert.match((await android.tool(s, 'devices')).text, /Pixel 8/);
    // install: an apk of the project, never one outside the workspace or in core.
    fs.writeFileSync(path.join(s.cwd, 'build', 'app.apk'), makeApk('com.ejemplo.app'));
    fs.writeFileSync(path.join(s.cwd, 'build', 'roto.apk'), 'no es un apk');
    await assert.rejects(android.tool(s, 'install', { apk: 'build/roto.apk' }), /.apk/, 'un apk que no se puede leer');
    const outside = path.join(work, 'fuera.apk'); fs.writeFileSync(outside, makeApk('com.fuera.app'));
    await assert.rejects(android.tool(s, 'install', { apk: outside }), /espacio de trabajo/);
    fs.mkdirSync(path.join(t.home, 'core', 'datos'), { recursive: true }); fs.writeFileSync(path.join(t.home, 'core', 'datos', 'x.apk'), makeApk('com.x.app'));
    await assert.rejects(android.tool(s, 'install', { apk: path.join(t.home, 'core', 'datos', 'x.apk') }), /espacio de trabajo/);
    await assert.rejects(android.tool(s, 'install', { apk: 'build/nada.apk' }), /No existe/);
    assert.match((await android.tool(s, 'install', { apk: 'build/app.apk' })).text, /com\.ejemplo\.app/);
    await assert.rejects(android.tool(s, 'uninstall', { package: 'com.otra.app' }), /No instalaste/, 'solo lo que instaló este chat');
    await assert.rejects(android.tool({ ...s, id: 'c2' }, 'uninstall', { package: 'com.ejemplo.app' }), /No instalaste/, 'otro chat, no');
    assert.match((await android.tool(s, 'uninstall', { package: 'com.ejemplo.app' })).text, /Desinstalada/);
    // The rest, with their arguments checked; nothing reaches a shell unquoted.
    const shot = await android.tool(s, 'screenshot');
    assert.equal(shot.mime, 'image/png'); assert.match(shot.text, /1080×2400/); assert.equal(Buffer.from(shot.image, 'base64').readUInt32BE(0), 0x89504e47);
    await android.tool(s, 'tap', { x: 10, y: 20 });
    await assert.rejects(android.tool(s, 'tap', { x: -1, y: 20 }), /Coordenadas/);
    await android.tool(s, 'text', { text: "a b'c; rm -rf /" });
    assert.deepEqual(calls().at(-1).slice(2), ['shell', 'input', 'text', "'a%sb'\\''c;%srm%s-rf%s/'"]);
    await android.tool(s, 'key', { key: 'back' });
    await assert.rejects(android.tool(s, 'key', { key: 'HOME; reboot' }), /Tecla no válida/);
    await android.tool(s, 'launch', { package: 'com.ejemplo.app' });
    await assert.rejects(android.tool(s, 'launch', { package: 'com.x;reboot' }), /paquete/);
    const log = await android.tool(s, 'logcat', { package: 'com.ejemplo.app', lines: 50, level: 'e', grep: 'fallo' });
    assert.match(log.text, /fallo de prueba/); assert.doesNotMatch(log.text, /arrancada/);
    assert.ok(calls().some((c) => c.includes('--pid=4321') && c.includes('*:E') && c.includes('50')));
    await assert.rejects(android.tool(s, 'logcat', { lines: 5000 }), /logcat/);
    // adb shell: only with «Acceso total».
    await assert.rejects(android.tool(s, 'shell', { command: 'ls' }), /Acceso total/);
    assert.match((await android.tool({ ...s, permission: 'total' }, 'shell', { command: 'ls /sdcard' })).text, /shell: ls \/sdcard/);
    // «Acceso total al PC» includes the phone; taken back, the next call is refused.
    assert.match((await android.tool({ ...s, project: null, android: false, permission: 'total' }, 'devices')).text, /Pixel 8/);
    s.android = false;
    await assert.rejects(android.tool(s, 'screenshot'), /Usar mi móvil Android/);
    // Orb locks: adb's server stops.
    await android.stopServer();
    assert.deepEqual(calls().at(-1), ['kill-server']);
    await android.forget({ serial: '192.168.1.20:41000' });
    assert.equal(settings.get('android_devices').length, 0);
  } finally {
    for (const [k, val] of Object.entries(env)) { if (val === undefined) delete process.env[k]; else process.env[k] = val; }
    fs.rmSync(work, { recursive: true, force: true }); t.cleanup();
  }
});

// 3.8.2 (review B2): a minimal apk: a zip with a binary AndroidManifest.xml that declares its package (UTF-16 string pool).
function makeApk(pkg, { deflate = true } = {}) {
  const strs = ['manifest', 'package', pkg];
  const enc = strs.map((x) => { const b = Buffer.alloc(2 + x.length * 2 + 2); b.writeUInt16LE(x.length, 0); b.write(x, 2, 'utf16le'); return b; });
  const offs = []; let o = 0; for (const b of enc) { offs.push(o); o += b.length; }
  const data = Buffer.concat(enc); const pad = Buffer.alloc((4 - (data.length % 4)) % 4);
  const poolHead = 28; const pool = Buffer.alloc(poolHead + offs.length * 4);
  pool.writeUInt16LE(0x0001, 0); pool.writeUInt16LE(poolHead, 2); pool.writeUInt32LE(pool.length + data.length + pad.length, 4);
  pool.writeUInt32LE(strs.length, 8); pool.writeUInt32LE(0, 12); pool.writeUInt32LE(0, 16); pool.writeUInt32LE(pool.length, 20); pool.writeUInt32LE(0, 24);
  offs.forEach((x, i) => pool.writeUInt32LE(x, poolHead + i * 4));
  const el = Buffer.alloc(36 + 20); el.writeUInt16LE(0x0102, 0); el.writeUInt16LE(16, 2); el.writeUInt32LE(el.length, 4);
  el.writeUInt32LE(0xffffffff, 12); el.writeUInt32LE(0xffffffff, 16); el.writeUInt32LE(0, 20); el.writeUInt16LE(20, 24); el.writeUInt16LE(20, 26); el.writeUInt16LE(1, 28);
  el.writeUInt32LE(0xffffffff, 36); el.writeUInt32LE(1, 40); el.writeUInt32LE(2, 44); el.writeUInt16LE(8, 48); el.writeUInt8(3, 51); el.writeUInt32LE(2, 52);
  const body = Buffer.concat([pool, data, pad, el]);
  const head = Buffer.alloc(8); head.writeUInt16LE(0x0003, 0); head.writeUInt16LE(8, 2); head.writeUInt32LE(8 + body.length, 4);
  return zipOf([['classes.dex', Buffer.from('dex')], ['AndroidManifest.xml', Buffer.concat([head, body])]], deflate);
}
function zipOf(files, deflate) {
  const locals = []; const central = []; let off = 0;
  for (const [name, raw] of files) {
    const data = deflate ? zlib.deflateRawSync(raw) : raw; const n = Buffer.from(name);
    const crc = zlib.crc32(raw);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(deflate ? 8 : 0, 8); l.writeUInt32LE(crc, 14); l.writeUInt32LE(data.length, 18); l.writeUInt32LE(raw.length, 22); l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(deflate ? 8 : 0, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    locals.push(l, n, data); central.push(c, n); off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central); const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, e]);
}

test('revisión 3.8.2 (A1, M1, M2): UNC al propio PC, unidades nuevas, elevar y copiar la carpeta padre', () => {
  const t = tempHome();
  try {
    const core = path.join(t.home, 'core');
    fs.mkdirSync(path.join(core, 'datos'), { recursive: true }); fs.writeFileSync(path.join(core, 'datos', 'orb.db'), 'x');
    const android = path.join(os.homedir(), '.android');
    setGuardedRoots([path.join(t.home, 'personal'), android]);
    const db = path.join(core, 'datos', 'orb.db');
    const drive = db.slice(0, 1); const rest = db.slice(2);
    // A1: the same file through a share of this PC, in every mode (reading too). Drive shares (C$) and \\?\C:\ names
    // exist only on Windows: elsewhere the path has no drive letter to build them from.
    const uncs = !WIN ? [] : [`\\\\localhost\\${drive}$${rest}`, `\\\\${os.hostname()}\\${drive}$${rest}`, `\\\\127.0.0.1\\${drive}$${rest}`, `\\\\?\\UNC\\localhost\\${drive}$${rest}`, `//localhost/${drive}$${rest.replace(/\\/g, '/')}`, `\\\\?\\${db}`, `\\\\.\\${db}`];
    for (const u of uncs) {
      assert.equal(String(localPath(u)).toLowerCase().replace(/\//g, '\\'), db.toLowerCase(), u);
      for (const permission of ['leer', 'editar', 'total']) {
        assert.equal(v({ permission, tool: 'Read', paths: [u], internalDir: core, cwd: t.home }), 'deny', `${permission} ${u}`);
        assert.equal(v({ permission, tool: 'Bash', command: `type "${u}"`, internalDir: core, cwd: t.home }), 'deny', `${permission} cmd ${u}`);
      }
    }
    assert.equal(localPath('\\\\localhost\\compartida\\x'), false, 'un recurso del PC que no es una unidad: cerrado');
    assert.equal(v({ permission: 'total', tool: 'Read', paths: ['\\\\?\\Volume{0000}\\Orb\\core'], internalDir: core, cwd: t.home }), 'deny');
    assert.equal(localPath('\\\\otro-equipo\\C$\\x'), null, 'otro equipo: no es este PC');
    assert.equal(localPath('\\\\.\\pipe\\docker_engine'), null);
    for (const c of ['subst X: C:\\Orb', 'net use Z: \\\\localhost\\C$', 'New-PSDrive -Name O -PSProvider FileSystem -Root C:\\Orb', 'cmd /c "subst Q: ."']) {
      assert.equal(v({ permission: 'total', tool: 'Bash', command: c, internalDir: core, cwd: t.home }), 'deny', c);
    }
    // M1: raising privileges on Windows, also under «total».
    for (const c of ['runas /user:Administrator cmd', 'gsudo type x', 'Start-Process powershell -Verb RunAs', 'saps cmd -verb runas', 'psexec -s -i cmd', 'psexec64.exe -i -s cmd', '(New-Object -ComObject Shell.Application).ShellExecute("cmd", "", "", "runas")', 'nircmd elevate cmd']) {
      assert.equal(v({ permission: 'total', tool: 'Bash', command: c, internalDir: core, cwd: t.home }), 'deny', c);
    }
    assert.equal(v({ permission: 'total', tool: 'Bash', command: 'Start-Process notepad', internalDir: core, cwd: t.home }), 'allow');
    // M2: .android whole, %HOMEDRIVE%%HOMEPATH%, and copies or archives of a folder that holds a closed one.
    if (process.env.HOMEDRIVE && process.env.HOMEPATH) assert.equal(v({ permission: 'total', tool: 'Bash', command: 'type %HOMEDRIVE%%HOMEPATH%\\.android\\adbkey', internalDir: core, cwd: t.home }), 'deny');
    assert.equal(v({ permission: 'total', tool: 'Read', paths: [path.join(android, 'adb_known_hosts.pb')], internalDir: core, cwd: t.home }), 'deny');
    for (const c of ['Copy-Item -Recurse $HOME\\.android C:\\x', 'tar -C ~ -cf x.tar .android', `robocopy ${t.home} D:\\copia /E`, 'cp -r . /tmp/x', `Compress-Archive -Path ${t.home} -DestinationPath x.zip`, `7z a x.7z ${os.homedir()}`, `xcopy ${t.home} D:\\c /s /e`]) {
      assert.equal(v({ permission: 'editar', tool: 'Bash', command: c, internalDir: core, cwd: t.home }), 'deny', c);
    }
    const proj = path.join(t.home, 'web', 'app'); fs.mkdirSync(proj, { recursive: true });
    for (const c of ['cp -r src dist', 'Copy-Item -Recurse .\\src .\\copia', 'robocopy src build /E', 'tar -cf app.tar .']) {
      assert.equal(v({ permission: 'editar', tool: 'Bash', command: c, internalDir: core, cwd: proj }), 'allow', `dentro del proyecto: ${c}`);
    }
    // A2: Orb's adb: readable, never written or run by an agent (any mode).
    const adbExe = path.join(core, 'herramientas', 'adb', 'adb.exe');
    assert.equal(v({ permission: 'total', tool: 'Write', paths: [adbExe], internalDir: core, cwd: t.home }), 'deny');
    assert.equal(v({ permission: 'total', tool: 'Bash', command: `copy x.dll "${path.join(core, 'herramientas', 'adb', 'AdbWinApi.dll')}"`, internalDir: core, cwd: t.home }), 'deny');
    assert.equal(v({ permission: 'total', android: true, tool: 'Bash', command: `"${adbExe}" devices`, internalDir: core, cwd: t.home }), 'deny');
    assert.equal(v({ permission: 'leer', tool: 'Read', paths: [adbExe], internalDir: core, cwd: t.home }), 'allow');
    assert.equal(v({ permission: 'editar', tool: 'Write', paths: [path.join(core, 'herramientas', 'gradle', 'x')], internalDir: core, cwd: t.home }), 'allow', 'el resto de herramientas sigue abierto');
  } finally { setGuardedRoots([]); t.cleanup(); }
});

test('revisión 3.8.2 (A2, B2, B3, M3): huellas de adb, paquete del apk, navegación y reinicio por permiso', async () => {
  const t = tempHome();
  try {
    useHome(t.home);
    // A2: the folder must be exactly what was downloaded.
    const dir = ctx.paths.adb; fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(ctx.paths.data, { recursive: true });
    fs.writeFileSync(path.join(dir, 'adb.exe'), 'adb'); fs.writeFileSync(path.join(dir, 'AdbWinApi.dll'), 'dll');
    assert.equal(verifyAdb(), false, 'sin huellas, no se usa');
    fs.writeFileSync(path.join(ctx.paths.data, 'adb-huellas.json'), JSON.stringify({ files: fingerprints(dir) }));
    assert.equal(verifyAdb(), true);
    fs.writeFileSync(path.join(dir, 'AdbWinApi.dll'), 'otra dll'); assert.equal(verifyAdb(), false, 'cambiada');
    fs.writeFileSync(path.join(dir, 'AdbWinApi.dll'), 'dll'); fs.writeFileSync(path.join(dir, 'version.dll'), 'puesta'); assert.equal(verifyAdb(), false, 'una DLL de más');
    fs.rmSync(path.join(dir, 'version.dll')); assert.equal(verifyAdb(), true);
    let fetched = 0;
    const android = createAndroid({ board: null, exe: () => path.join(dir, 'adb.exe'), verify: () => false, ensure: async () => { fetched++; return { error: 'no' }; } });
    await assert.rejects(android.tool({ id: 'c', kind: 'chat', android: true, project: 'web', permission: 'editar', cwd: t.home }, 'devices'), /adb/);
    assert.equal(fetched, 1, 'sin coincidir, se pide otra descarga y no se ejecuta');
    // B2: the package from the apk itself (stored or deflated), nothing for another file.
    const apk = path.join(t.home, 'a.apk');
    for (const deflate of [true, false]) { fs.writeFileSync(apk, makeApk('com.ejemplo.app', { deflate })); assert.equal(apkPackage(apk), 'com.ejemplo.app'); }
    fs.writeFileSync(apk, makeApk('com.x;reboot')); assert.equal(apkPackage(apk), null);
    fs.writeFileSync(apk, 'PK no'); assert.equal(apkPackage(apk), null);
    // B3: wherever an action ends (a redirect, a click, back), a protected page is left and nothing of it is returned.
    const loads = [];
    const { run } = createActions({ T: (k, vars) => `${k} ${JSON.stringify(vars ?? {})}`, driver: { url: (x) => x.url, load: async (x, u) => { loads.push(u); x.url = u; } } });
    const tab = { url: 'https://casa.lan/vaultwarden/#/login', console: [] };
    await assert.rejects(run(tab, 'console', {}), /sys\.browser\.protected/);
    assert.deepEqual(loads, ['about:blank']);
    tab.url = 'https://example.com/';
    assert.match(await run(tab, 'console', {}), /sin errores/);
    // M3: a new permission is a new agent process at the next turn (Codex's sandbox, Claude's tools).
    const { Sessions } = await import('../src/engine/sessions.mjs');
    const key = (p) => Sessions.prototype.liveKey.call(null, { agent: 'codex', cwd: 'x', reasoning: 'medium', permission: p }, { id: 'a' });
    assert.notEqual(key('total'), key('editar'));
  } finally { t.cleanup(); }
});
