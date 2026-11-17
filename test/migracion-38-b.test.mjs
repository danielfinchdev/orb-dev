// 3.8 migration, part 2: failures, retries and the lock (see migracion-38-lib.mjs).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { tempHome, ROOT, startEngine, until, wait } from './helpers.mjs';
import { useHome, ctx } from '../src/platform/context.mjs';
import { writeJson } from '../src/platform/paths.mjs';
import { openDb } from '../src/domain/data/db.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { marks } from '../src/domain/conversations/inbox.mjs';
import { ARCHIVE_DIR, PRE_COPY, MARK, DROPPED_TABLES, ORIGINAL_CONFIG, LOCK_FILE, WORK_DIR, SCRUB_AFTER_MS, takeNotice, migrationFailure, isLegacy, unfinished, insideData, bridgeDir, scrub, scrubPreCopies, legacyData, deleteLegacyData } from '../src/domain/data/legacy/migrate-38.mjs';
import { syncProjects } from '../src/domain/projects/projects.mjs';
import { IGNORED_PROJECTS } from '../src/platform/state.mjs';
import { migrationView, folderOf } from '../src/ui/lib/migration.js';
import { startupPhase } from '../src/ui/lib/startup.js';
import * as C from '../src/shared/mobile-crypto.mjs';
import { newVapidKeys } from '../src/engine/transport/webpush.mjs';
import { createBackup, restoreInto } from '../src/domain/data/backup.mjs';
import { createRemote } from '../src/engine/transport/remote.mjs';

import { homes, schema, NOW, OWNER, ANA, build37, files37, names, archived, readJson, asOrb37, dbFile, datosOf, raw37, setup37, own, breakTransaction, fixTransaction, files37Of } from './migracion-38-lib.mjs';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
after(() => { for (const h of homes) h.cleanup(); });

test('A1/A2: si la transacción falla tras la copia no se mueve ni se borra nada (BD, orb.json y ficheros), y el reintento deja el archivo completo', () => {
  const { t, ids } = setup37();
  const orbBefore = fs.readFileSync(path.join(t.home, 'core', 'orb.json'), 'utf8');
  const before = files37Of(t).map((f) => [f, fs.readFileSync(f, 'utf8')]);
  before.push([path.join(t.home, 'core', 'ejecuciones', String(ids.tAna), 'mcp.json'), fs.readFileSync(path.join(t.home, 'core', 'ejecuciones', String(ids.tAna), 'mcp.json'), 'utf8')]);
  breakTransaction(t);
  let board = new Board();
  const f = migrationFailure();
  assert.ok(f?.reason, 'dice por qué');
  assert.equal(f.backup, path.join(datosOf(t), PRE_COPY), 'y dónde está la copia');
  assert.ok(isLegacy(board.db));
  assert.deepEqual(own(board), ['Plan de Dani', 'Secreto de Ana']);
  assert.equal(board.one('SELECT COUNT(*) AS n FROM persons').n, 2);
  assert.equal(board.setting(MARK), undefined);
  assert.equal(fs.readFileSync(path.join(t.home, 'core', 'orb.json'), 'utf8'), orbBefore, 'orb.json sin tocar');
  for (const [f, text] of before) assert.equal(fs.existsSync(f) && fs.readFileSync(f, 'utf8'), text, `${path.relative(t.base, f)} sigue en su sitio`);
  assert.equal(f.committed, false, 'Orb 3.7 puede volver a abrir estos datos');
  assert.ok(fs.existsSync(path.join(datosOf(t), WORK_DIR, ORIGINAL_CONFIG)), 'el orb.json original, fuera del archivo');
  assert.ok(!fs.existsSync(archived(t, 'imagenes')) && fs.existsSync(archived(t, 'usuarios', `Ana-${ANA}`, 'imagenes', 'a.png')), 'en el archivo solo hay copias');
  const copyAt = fs.statSync(path.join(datosOf(t), PRE_COPY)).mtimeMs;
  board.db.close();

  // The next start.
  fixTransaction(t);
  board = new Board();
  assert.equal(migrationFailure(), null);
  assert.ok(!isLegacy(board.db));
  const ana = archived(t, 'usuarios', `Ana-${ANA}`);
  assert.deepEqual(readJson(path.join(ana, 'cuentas.json')).accounts.map((a) => a.id), ['claude-ana'], 'las cuentas de Ana siguen en el archivo');
  assert.deepEqual(readJson(path.join(ana, 'cuentas.json')).mcpServers.map((m) => m.name), ['de-ana']);
  assert.equal(readJson(archived(t, 'orb-json-retirado.json')).role, 'centro', 'y los ajustes retirados');
  assert.ok(!fs.readFileSync(archived(t, ORIGINAL_CONFIG), 'utf8').includes('secreto-de-ana'));
  assert.equal(fs.statSync(path.join(datosOf(t), PRE_COPY)).mtimeMs, copyAt, 'la copia buena de antes se usa, no se rehace');
  for (const [f] of before) if (!f.includes(`${path.sep}imagenes${path.sep}${OWNER}`)) assert.ok(!fs.existsSync(f), `${path.relative(t.base, f)} ya no está`);
  assert.equal(fs.readFileSync(path.join(t.home, 'core', 'imagenes', 'b.png'), 'utf8'), 'x', 'las imágenes del dueño, en su sitio de 3.8');
  assert.ok(!fs.readdirSync(path.join(t.home, 'core')).some((n) => n.startsWith(`${ARCHIVE_DIR}-`)), 'el mismo archivo, no otro');
  assert.equal(readJson(path.join(t.home, 'core', 'orb.json')).role, undefined);
  assert.deepEqual(own(board), ['Plan de Dani']);
  board.db.close();
});

// A read-only file cannot be replaced by a rename only on Windows (elsewhere the folder's permissions decide).
const READONLY_BLOCKS = process.platform !== 'win32' && 'solo Windows: renombrar sobre un archivo de solo lectura';
test('R3: si orb.json no se puede escribir tras el COMMIT, Orb no arranca (ni con la configuración de 3.7) y el siguiente arranque lo termina', { skip: READONLY_BLOCKS }, () => {
  const { t } = setup37();
  const file = path.join(t.home, 'core', 'orb.json');
  fs.chmodSync(file, 0o444); // read-only (or held by an antivirus): the rename over it fails
  let board = new Board();
  const f = migrationFailure();
  assert.match(f?.reason ?? '', /orb\.json/);
  assert.equal(f.committed, true, 'la BD ya es de 3.8');
  assert.ok(!isLegacy(board.db) && unfinished(board.db), 'Orb no arranca sobre esto');
  assert.ok(!ctx.config.accounts.some((a) => a.id === 'claude-ana' || a.id === 'claude-gone'), 'ni en memoria las cuentas de otros');
  assert.ok(!(ctx.config.mcpServers ?? []).some((m) => m.name === 'de-ana'));
  assert.deepEqual(fs.readdirSync(t.home).filter((n) => n.endsWith('.tmp')), [], 'sin temporal huérfano');
  assert.equal(takeNotice(board) != null, true);
  board.db.close();
  // Writable again: the next start finishes (the files' plan runs again without harm).
  fs.chmodSync(file, 0o644);
  board = new Board();
  assert.equal(migrationFailure(), null);
  assert.ok(!unfinished(board.db));
  const raw = readJson(file);
  assert.equal(raw.role, undefined); assert.equal(raw.userName, 'Dani');
  assert.ok(!raw.accounts.some((a) => a.id === 'claude-ana'));
  assert.ok(!fs.existsSync(path.join(datosOf(t), WORK_DIR)) && !fs.existsSync(path.join(datosOf(t), 'migracion-3.8.json')));
  board.db.close();
});

test('R3: la configuración pendiente nunca pisa los cambios hechos después en orb.json', { skip: READONLY_BLOCKS }, () => {
  const { t } = setup37();
  const file = path.join(t.home, 'core', 'orb.json');
  fs.chmodSync(file, 0o444);
  new Board().db.close();
  assert.equal(migrationFailure()?.committed, true);
  // Meanwhile orb.json changes (by hand, or Orb 3.7 opened again): still 3.7's, with a change of the user.
  fs.chmodSync(file, 0o644);
  const changed = readJson(file); changed.assistantName = 'Mi Orb'; writeJson(file, changed);
  const board = new Board();
  assert.equal(migrationFailure(), null);
  const raw = readJson(file);
  assert.equal(raw.assistantName, 'Mi Orb', 'el cambio se queda');
  assert.equal(raw.role, undefined, 'y lo de 3.7 se quita igual');
  assert.ok(!raw.accounts.some((a) => a.id === 'claude-ana') && !raw.mcpServers.some((m) => m.name === 'de-ana'));
  assert.equal(raw.orchestrator.model, 'claude-opus-5-5', 'con los ajustes del dueño de 3.7');
  // Already written: opened again, nothing changes.
  board.db.close();
  const text = fs.readFileSync(file, 'utf8');
  new Board().db.close();
  assert.equal(fs.readFileSync(file, 'utf8'), text);
});

test('A2: una copia previa vacía o a medias nunca se da por buena: se aparta y se hace otra comprobada', () => {
  for (const broken of ['', 'SQLite format 3 a medias']) {
    const { t } = setup37();
    const datos = datosOf(t);
    // An interrupted run whose copy was left empty or cut.
    fs.writeFileSync(path.join(datos, PRE_COPY), broken);
    fs.writeFileSync(path.join(datos, 'migracion-3.8.json'), JSON.stringify({ archive: ARCHIVE_DIR, copy: PRE_COPY }));
    const board = new Board();
    assert.equal(migrationFailure(), null);
    const copy = new DatabaseSync(path.join(datos, PRE_COPY), { readOnly: true });
    assert.equal(copy.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM persons').get().n, 2, 'la base tal como era');
    copy.close();
    const aside = fs.readdirSync(datos).filter((n) => n.startsWith(`${PRE_COPY}.roto-`));
    assert.equal(aside.length, 1, 'la mala, apartada (no borrada)');
    assert.equal(fs.readFileSync(path.join(datos, aside[0]), 'utf8'), broken);
    assert.ok(!fs.existsSync(path.join(datos, `${PRE_COPY}.tmp`)));
    board.db.close();
  }
});

test('M1: sin dueño no se borra nada; un dueño borrado sigue siendo el dueño', () => {
  const { t } = setup37();
  raw37(t, (db) => db.exec("UPDATE persons SET role = 'user'"));
  let board = new Board();
  assert.match(migrationFailure()?.reason ?? '', /No se sabe quién es el dueño/);
  assert.ok(isLegacy(board.db));
  assert.deepEqual(own(board), ['Plan de Dani', 'Secreto de Ana'], 'nada borrado');
  board.db.close();
  raw37(t, (db) => db.prepare("UPDATE persons SET role = 'owner', deleted_at = ? WHERE id = ?").run(NOW, OWNER));
  board = new Board();
  assert.equal(migrationFailure(), null);
  assert.deepEqual(own(board), ['Plan de Dani'], 'lo del dueño se queda');
  board.db.close();
});

test('B4: el proyecto de trabajo de settings manda sobre el de person_settings; el idioma del dueño en 3.7, sobre orb.json', () => {
  const { t } = setup37({ language: 'en' });
  raw37(t, (db) => db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('active_project', 'web-actual')").run());
  const board = new Board();
  assert.equal(board.setting('active_project'), 'web-actual');
  assert.equal(readJson(path.join(t.home, 'core', 'orb.json')).language, 'en');
  board.db.close();
});

test('M4: restaurar dos veces una copia de 3.7 ya migrada da cada vez un archivo y una copia nuevos, sin tocar los de antes', async () => {
  const { t } = setup37();
  const secret = crypto.randomBytes(32);
  const { file } = await createBackup({ home: t.home, secret, version: 'test' });
  new Board().db.close();
  const first = fs.readFileSync(archived(t, 'LEEME.txt'), 'utf8');
  const firstCopy = fs.readFileSync(path.join(datosOf(t), PRE_COPY));
  const copies = () => fs.readdirSync(datosOf(t)).filter((n) => /^orb-pre-3\.8.*\.db$/.test(n));
  const archives = () => fs.readdirSync(path.join(t.home, 'core')).filter((n) => n.startsWith(ARCHIVE_DIR));
  for (let i = 1; i <= 2; i++) {
    await restoreInto(t.home, file, { secret });
    useHome(t.home);
    const board = new Board();
    assert.equal(migrationFailure(), null);
    assert.ok(!isLegacy(board.db));
    assert.deepEqual(own(board), ['Plan de Dani']);
    assert.equal(archives().length, i + 1); assert.equal(copies().length, i + 1);
    const notice = takeNotice(board);
    assert.ok(path.basename(notice.archive).startsWith(`${ARCHIVE_DIR}-`), 'un archivo con fecha');
    assert.ok(path.basename(notice.backup).startsWith('orb-pre-3.8-'), 'y una copia con fecha');
    assert.ok(fs.existsSync(path.join(notice.archive, 'usuarios', `Ana-${ANA}`, 'tareas.json')));
    assert.ok(fs.readFileSync(path.join(notice.archive, 'LEEME.txt'), 'utf8').includes(notice.backup), 'el LEEME nombra su copia');
    const copy = new DatabaseSync(notice.backup, { readOnly: true });
    assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM persons').get().n, 2); copy.close();
    board.db.close();
  }
  assert.equal(fs.readFileSync(archived(t, 'LEEME.txt'), 'utf8'), first, 'el primer archivo no se toca');
  assert.ok(fs.readFileSync(path.join(datosOf(t), PRE_COPY)).equals(firstCopy), 'ni la primera copia');
});

test('B5: un proceso vivo con el bloqueo no deja migrar; al morir lo suelta; dos procesos a la vez migran una sola vez', async () => {
  const { t } = setup37();
  const lockFile = path.join(datosOf(t), LOCK_FILE);
  // Another process holds the lock (an exclusive transaction on the lock's database), then dies without letting it go.
  const holder = spawn(process.execPath, ['-e', "const d = new (process.getBuiltinModule('node:sqlite').DatabaseSync)(process.argv[1]); d.exec('BEGIN EXCLUSIVE'); process.stdout.write('ok'); setTimeout(() => {}, 60000);", lockFile], { stdio: ['ignore', 'pipe', 'inherit'] });
  await once(holder.stdout, 'data');
  process.env.ORB_MIGRATION_LOCK_MS = '300';
  try {
    const board = new Board();
    assert.match(migrationFailure()?.reason ?? '', /Otro proceso de Orb está actualizando/);
    assert.ok(isLegacy(board.db));
    assert.deepEqual(own(board), ['Plan de Dani', 'Secreto de Ana']);
    board.db.close();
  } finally { delete process.env.ORB_MIGRATION_LOCK_MS; holder.kill(); }
  await once(holder, 'exit');
  // Its process gone, the system let the lock go. Two processes open the folder at once.
  const src = (f) => JSON.stringify(pathToFileURL(path.join(ROOT, 'src', f)).href);
  const script = `import { useHome } from ${src('platform/context.mjs')}; import { Board } from ${src('domain/tasks/board.mjs')}; import { migrationFailure } from ${src('domain/data/legacy/migrate-38.mjs')};
useHome(process.env.ORB_TEST_HOME); const b = new Board(); process.stdout.write(JSON.stringify({ failure: migrationFailure() })); b.db.close();`;
  const runOne = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, ORB_TEST_HOME: t.home }, stdio: ['ignore', 'pipe', 'inherit'] });
    let out = ''; child.stdout.on('data', (d) => { out += d; });
    child.on('exit', (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`salida ${code}`))));
  });
  const results = await Promise.all([runOne(), runOne()]);
  assert.deepEqual(results, [{ failure: null }, { failure: null }]);
  assert.deepEqual(fs.readdirSync(path.join(t.home, 'core')).filter((n) => n.startsWith(ARCHIVE_DIR)), [ARCHIVE_DIR], 'un solo archivo');
  assert.equal(fs.existsSync(lockFile), process.platform !== 'win32', 'quitado en Windows; fuera, se queda');
  const board = new Board();
  assert.ok(!isLegacy(board.db));
  assert.deepEqual(own(board), ['Plan de Dani']);
  assert.ok(takeNotice(board), 'avisado una vez');
  board.db.close();
});

test('B8: la migración solo escribe en la carpeta de datos (y el fichero del puente); en pruebas sin ORB_BRIDGE_DIR no hay puente', () => {
  const t = tempHome(); homes.push(t);
  assert.equal(insideData(t.home, path.join(t.home, 'core', 'archivo-3.7', 'x.json')), true);
  assert.equal(insideData(t.home, path.join(t.base, 'fuera.json')), false);
  assert.equal(insideData(t.home, path.join(t.home, '..', 'fuera.json')), false);
  const saved = process.env.ORB_BRIDGE_DIR;
  try {
    process.env.ORB_BRIDGE_DIR = path.join(t.base, 'puente');
    assert.equal(insideData(t.home, path.join(t.base, 'puente', 'orb.json')), true);
    assert.equal(insideData(t.home, path.join(t.base, 'puente', 'oce.json')), false, 'el oce.json nunca');
    delete process.env.ORB_BRIDGE_DIR;
    assert.ok(process.env.NODE_TEST_CONTEXT, 'node --test lo pone');
    assert.equal(bridgeDir(), null, 'nunca el OrbPuente de este PC');
  } finally { if (saved === undefined) delete process.env.ORB_BRIDGE_DIR; else process.env.ORB_BRIDGE_DIR = saved; }
});

test('M2: si la migración falla, Orb no funciona sobre los datos de 3.7 (ni móvil ni tareas), dice por qué y «Reintentar» lo termina', async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const u = tempHome({ mobile: { enabled: true, port } }); homes.push(u);
  const { ids } = build37(dbFile(u), C.newKeyPair(), { home: u.home });
  breakTransaction(u);
  raw37(u, (db) => db.prepare("UPDATE tasks SET status = 'queued' WHERE id = ?").run(ids.tAna));
  const engine = await startEngine(u.home, { env: { ORB_REMOTE_BIND: '127.0.0.1' } });
  try {
    const m = await engine.call('app.migrationState');
    assert.equal(m.failed, true); assert.ok(m.reason);
    assert.equal(m.backup, path.join(datosOf(u), PRE_COPY));
    await assert.rejects(engine.call('app.state'), /Orb no funciona hasta actualizar tus datos/);
    // F5b (A2): the window's first questions, as main.jsx asks them, reach the screen «No se pudieron actualizar…».
    assert.equal(await engine.call('app.coreState'), null);
    const start = await startupPhase((method) => engine.call(method));
    assert.equal(start.phase, 'migration');
    assert.equal(start.data.failed, true);
    await assert.rejects(engine.call('remote.status'), /Orb no funciona hasta actualizar tus datos/);
    // 3.8.2 (M6): the phone access does not open, but a linked phone is told the PC needs attention (not «sin conexión»),
    // with nothing of the data: one fixed state, also readable by the Android app's origin.
    await until(async () => { try { return (await fetch(`http://127.0.0.1:${port}/api/me`, { method: 'POST' })).status === 503; } catch { return false; } }, 'el aviso de atención');
    const me = await fetch(`http://127.0.0.1:${port}/api/me`, { method: 'POST', headers: { Origin: 'http://tauri.localhost', 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(me.status, 503);
    assert.equal(me.headers.get('access-control-allow-origin'), 'http://tauri.localhost');
    const said = await me.json();
    assert.deepEqual(Object.keys(said).sort(), ['attention', 'error']);
    assert.equal(said.attention, 'migration'); assert.match(said.error, /necesita atención/);
    for (const p of ['/api/call', '/api/events', '/api/pair', '/api/hello']) assert.equal((await fetch(`http://127.0.0.1:${port}${p}`, { method: p === '/api/events' || p === '/api/hello' ? 'GET' : 'POST' })).status, 503, `${p}: solo el aviso`);
    const pageRes = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(pageRes.status, 503); assert.match(await pageRes.text(), /necesita atención/);
    const { default: http } = await import('node:http');
    const other = await new Promise((resolve, reject) => { const r = http.request({ host: '127.0.0.1', port, path: '/api/me', method: 'POST', headers: { Host: `otro:${port}` } }, (res) => { res.resume(); resolve(res.statusCode); }); r.on('error', reject); r.end(); });
    assert.equal(other, 421, 'otro host, no');
    await wait(2000);
    assert.equal(raw37(u, (db) => db.prepare('SELECT status FROM tasks WHERE id = ?').get(ids.tAna).status), 'queued', 'nada de los otros se ejecuta');
    assert.match(fs.readFileSync(path.join(u.home, 'core', 'ejecuciones', 'motor.log'), 'utf8'), /3\.8: la migración no se pudo hacer/);
    // Fixed (space freed): «Reintentar».
    fixTransaction(u);
    assert.deepEqual(await engine.call('app.migrationRetry'), { failed: false });
    assert.deepEqual(await engine.call('app.migrationState'), { failed: false });
    assert.ok(!(await engine.call('conversations.list')).some((c) => c.title === 'Secreto de Ana'));
    await until(async () => (await engine.call('remote.status')).running, 'el móvil, ya con los datos de 3.8');
  } finally { await engine.stop(); }
});
