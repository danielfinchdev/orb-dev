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
import { decide, runsAdb, setGuardedRoots, setAppRoots } from '../src/core/guard.mjs';
import { needsUnlock, FRESH_UNLOCK, METHODS } from '../src/core/permissions.mjs';
import { useHome, ctx } from '../src/core/context.mjs';
import { AgentAuth } from '../src/engine/agent-auth.mjs';
import { redeem } from '../src/mcp/auth-client.mjs';
import { cursorRules } from '../src/agents/cursor.mjs';
import { permissionModeOf } from '../src/agents/claude.mjs';
import { pairingQr, newPairing, parseMdns, parseDevices, pairedGuid, parsePackages, installedBetween, inputText, ensureAdb, checkArchive, createAndroid, androidAllowed, shellAllowed, adbStatus } from '../src/engine/android.mjs';

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
    assert.equal(v({ ...base, tool: 'mcp__claude-in-chrome__navigate' }), 'allow', 'Claude in Chrome');
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
      assert.equal(v({ ...base, tool: 'Bash', command: 'type enlace\\datos\\orb.db', cwd: out }), 'deny');
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
    await assert.rejects(e.call('sessions.grantTotal', { id: p.id, unlock: fresh2 }), /sin proyecto/, 'solo sin proyecto');
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
    assert.equal(after.find((x) => x.id === p.id).permission, 'editar', 'el permiso del proyecto no cambia');
    const items = await e.call('sessions.items', { id: s.id });
    assert.ok(items.some((i) => /Acceso total al PC retirado/.test(typeof i.body === 'string' ? i.body : '')), 'se dice en el chat');
    // Taking it back by hand needs nothing, and is said too.
    const fresh4 = (await e.call('master.unlock', { password: PASS, purpose: 'android' })).unlock;
    await e.call('sessions.grantAndroid', { id: p.id, unlock: fresh4 });
    assert.equal((await e.call('sessions.revokeGrant', { id: p.id, grant: 'android' })).android, false);
    const log = fs.readFileSync(path.join(t.home, 'core', 'ejecuciones', 'motor.log'), 'utf8');
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
  const before = parsePackages('package:/data/app/~~a/x-1/base.apk=com.a\npackage:/data/app/~~b/y/base.apk=com.b');
  const after = parsePackages('package:/data/app/~~a/x-1/base.apk=com.a\npackage:/data/app/~~c/y/base.apk=com.b\npackage:/d/z.apk=com.c');
  assert.deepEqual(installedBetween(before, after), ['com.b', 'com.c'], 'reinstalada y nueva');
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
    fs.writeFileSync(path.join(work, 'mdns.txt'), `${name}\t_adb-tls-pairing._tcp\t192.168.1.20:37001\nadb-R5CT10ABCD-xyz\t_adb-tls-connect._tcp\t192.168.1.20:41000\n`);
    await until(async () => android.pairState().state === 'done', 'emparejado por QR', 5000);
    assert.ok(calls().some((c) => c[0] === 'pair' && c[1] === '192.168.1.20:37001' && c[2] === password));
    assert.equal((await android.devices()).length, 1, 'el mismo móvil, una vez');
    // The tools: only while the chat holds the phone.
    const s = { id: 'c1', kind: 'chat', project: 'web', permission: 'editar', android: false, cwd: path.join(t.home, 'web', 'app') };
    fs.mkdirSync(path.join(s.cwd, 'build'), { recursive: true });
    await assert.rejects(android.tool(s, 'devices'), /Usar mi móvil Android/);
    s.android = true;
    assert.match((await android.tool(s, 'devices')).text, /Pixel 8/);
    // install: an apk of the project, never one outside the workspace or in core.
    fs.writeFileSync(path.join(s.cwd, 'build', 'app.apk'), 'apk');
    const outside = path.join(work, 'fuera.apk'); fs.writeFileSync(outside, 'apk');
    await assert.rejects(android.tool(s, 'install', { apk: outside }), /espacio de trabajo/);
    fs.mkdirSync(path.join(t.home, 'core', 'datos'), { recursive: true }); fs.writeFileSync(path.join(t.home, 'core', 'datos', 'x.apk'), 'apk');
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
