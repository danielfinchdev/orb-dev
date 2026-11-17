// 3.8 migration, part 3: archives, backups, notices and the review rounds (see migracion-38-lib.mjs).
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

// ---- F2.5c: the review of F2.5b (orb-3.8-revision-F2.5b.md)
const walk = (dir) => { const out = []; const go = (d) => { let l = []; try { l = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of l) { const f = path.join(d, e.name); if (e.isDirectory()) go(f); else out.push(f); } }; go(dir); return out; };
const archives = (home) => fs.readdirSync(path.join(home, 'core')).filter((n) => n.startsWith(ARCHIVE_DIR)).map((n) => path.join(home, 'core', n));

test('A1/B2: ni el archivo ni las copias de seguridad llevan claves de otros usuarios (por nombre ni por valor)', async () => {
  const { t } = setup37();
  const file = path.join(t.home, 'core', 'orb.json');
  const raw = readJson(file);
  raw.mcpServers = raw.mcpServers.map((m) => (m.name === 'de-ana' ? { ...m, command: 'npx servidor sk-ant-abcdefgh123456', url: 'https://ana:clave-de-ana@host/x?sig=zzz-de-ana', args: ['--token=abc', '--api-key', 'valor-suelto-de-ana', 'ghp_abcdefghijklmnop1234'] } : m));
  writeJson(file, raw);
  new Board().db.close();
  assert.equal(migrationFailure(), null);
  const secrets = ['secreto-de-ana', 'token=abc', 'sk-ant-abcdefgh123456', 'clave-de-ana', 'zzz-de-ana', 'valor-suelto-de-ana', 'ghp_abcdefghijklmnop1234'];
  const leaks = (files) => files.flatMap((f) => { const text = fs.readFileSync(f, 'latin1'); return secrets.filter((s) => text.includes(s)).map((s) => `${path.basename(f)}: ${s}`); });
  assert.deepEqual(leaks(archives(t.home).flatMap(walk)), [], 'en el archivo');
  const kept = readJson(path.join(archived(t), 'usuarios', `Ana-${ANA}`, 'cuentas.json')).mcpServers[0];
  assert.equal(kept.url, 'https://(oculto)@host/x?sig=(oculto)'); assert.deepEqual(kept.args, ['(oculto)', '(oculto)', '(oculto)', '[secreto oculto]']);
  const secret = crypto.randomBytes(32);
  for (const includeAccounts of [false, true]) {
    const { file: copy } = await createBackup({ home: t.home, secret, version: 'test', includeAccounts });
    const target = path.join(t.base, `restaurada-${includeAccounts}`);
    await restoreInto(target, copy, { secret });
    assert.deepEqual(leaks(walk(target)), [], `en la copia de seguridad (cuentas: ${includeAccounts})`);
  }
});

test('B3: la base viva no guarda lo borrado en páginas libres (VACUUM tras migrar)', () => {
  const { t } = setup37();
  const board = new Board();
  assert.equal(board.one('PRAGMA freelist_count').freelist_count, 0);
  board.db.close();
  for (const f of ['orb.db', 'orb.db-wal']) { const p = path.join(datosOf(t), f); if (fs.existsSync(p)) assert.ok(!fs.readFileSync(p, 'latin1').includes('mi secreto'), f); }
});

test('M2: una imagen del dueño con el nombre de otra se renombra (nunca se borra) y el chat que la nombra apunta a su sitio nuevo', () => {
  const { t, ids } = setup37();
  const imgs = path.join(t.home, 'core', 'imagenes');
  fs.writeFileSync(path.join(imgs, 'b.png'), 'otra');
  const old = path.join(imgs, OWNER, 'b.png');
  raw37(t, (db) => db.prepare("INSERT INTO chat (role, body, meta, at, conversation_id, person_id) VALUES ('usuario', ?, ?, ?, ?, ?)").run(`mira ${old}`, JSON.stringify({ images: [old] }), NOW, ids.cDani, OWNER));
  const board = new Board();
  assert.equal(fs.readFileSync(path.join(imgs, 'b.png'), 'utf8'), 'otra');
  const moved = path.join(imgs, 'b (3.7).png');
  assert.equal(fs.readFileSync(moved, 'utf8'), 'x', 'la del dueño, renombrada');
  assert.ok(!fs.existsSync(path.join(imgs, OWNER)));
  const line = board.one('SELECT body, meta FROM chat WHERE body LIKE ?', 'mira %');
  assert.equal(line.body, `mira ${moved}`); assert.deepEqual(JSON.parse(line.meta).images, [moved]);
  board.db.close();
});

test('M3: las copias aisladas y las fotos de las tareas de otros se archivan antes de que Orb las limpie', () => {
  const { t, ids } = setup37();
  const work = path.join(t.home, 'core', 'copias', 'aisladas', 'web-ana-7');
  const put = (p, text = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
  put(path.join(work, 'cambio.txt'), 'sin commit'); put(path.join(work, 'node_modules', 'pkg', 'index.js'));
  put(path.join(t.home, 'core', 'copias', 'fotos', `t${ids.tAna}-123`, 'antes.txt'), 'foto');
  raw37(t, (db) => db.prepare("UPDATE tasks SET workdir = ?, branch = 'orb/t2-web-ana' WHERE id = ?").run(work, ids.tAna));
  new Board().db.close();
  const ana = archived(t, 'usuarios', `Ana-${ANA}`, 'copias');
  assert.equal(fs.readFileSync(path.join(ana, 'aisladas', 'web-ana-7', 'cambio.txt'), 'utf8'), 'sin commit');
  assert.ok(!fs.existsSync(path.join(ana, 'aisladas', 'web-ana-7', 'node_modules')), 'sin dependencias');
  assert.equal(fs.readFileSync(path.join(ana, 'fotos', `t${ids.tAna}-123`, 'antes.txt'), 'utf8'), 'foto');
  assert.match(fs.readFileSync(archived(t, 'LEEME.txt'), 'utf8'), /Las ramas de sus tareas siguen en sus repositorios: orb\/t2-web-ana/);
});

test('M4: los proyectos de otros compartidos con el dueño o usados por lo suyo pasan a ser del dueño (no se borran ni se ignoran)', () => {
  const { t } = setup37();
  const lib = path.join(t.home, 'web', 'lib-ana'); fs.mkdirSync(lib, { recursive: true });
  raw37(t, (db) => {
    db.prepare("INSERT INTO shares (resource_type, resource_id, person_id, right, created_at) VALUES ('project', 'web-ana', ?, 'edit', ?)").run(OWNER, NOW);
    db.prepare("INSERT INTO projects (name, path, created_at, person_id) VALUES ('lib-ana', ?, ?, ?), ('solo-ana', 'C:/x/solo-ana', ?, ?)").run(lib, NOW, ANA, NOW, ANA);
    db.prepare("INSERT INTO schedules (project, title, description, every, created_at, person_id) VALUES ('lib-ana', 'De Dani en lib', 'd', 'daily', ?, ?)").run(NOW, OWNER);
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(IGNORED_PROJECTS, JSON.stringify([path.join(t.home, 'web', 'ya-no-existe').toLowerCase()]));
  });
  const board = new Board();
  assert.deepEqual(board.all('SELECT name, person_id FROM projects ORDER BY name').map((r) => [r.name, r.person_id]), [['lib-ana', null], ['web-ana', null], ['web-dani', null]]);
  assert.ok(!(board.settingJson(IGNORED_PROJECTS) ?? []).some((k) => k.includes('web-ana') || k.includes('lib-ana')));
  assert.match(fs.readFileSync(archived(t, 'LEEME.txt'), 'utf8'), /Sus proyectos (web-ana, lib-ana|lib-ana, web-ana) ahora son tuyos/);
  syncProjects(board);
  assert.deepEqual(board.projects().map((x) => x.name).sort(), ['lib-ana', 'web-ana', 'web-dani']);
  assert.deepEqual(board.settingJson(IGNORED_PROJECTS), [], 'las carpetas que ya no existen salen de la lista');
  board.db.close();
});

test('M5: una copia previa válida pero desfasada (se volvió a usar 3.7 entre intentos) se rehace', () => {
  const { t } = setup37();
  breakTransaction(t);
  new Board().db.close();
  assert.ok(migrationFailure());
  // Orb 3.7 used again for a while.
  raw37(t, (db) => db.prepare("INSERT INTO conversations (title, titled, created_at, updated_at, person_id) VALUES ('De después', 1, ?, ?, ?)").run(NOW, NOW, OWNER));
  fixTransaction(t);
  const board = new Board();
  assert.equal(migrationFailure(), null);
  const copy = new DatabaseSync(path.join(datosOf(t), PRE_COPY), { readOnly: true });
  assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM conversations WHERE title = 'De después'").get().n, 1, 'la copia tiene lo de después');
  copy.close();
  assert.deepEqual(fs.readdirSync(datosOf(t)).filter((n) => n.includes('intento')), [], 'la vieja se borra al terminar');
  board.db.close();
});

test('M7: 30 días después, las copias de la BD de 3.7 pierden sus claves; «Borrar los datos de Orb 3.7» lo borra todo', () => {
  const { t } = setup37();
  const board = new Board();
  const now = Date.now();
  assert.equal(scrubPreCopies(board.db, { home: t.home, now: now + 86_400_000 }), null, 'aún no');
  assert.equal(scrubPreCopies(board.db, { home: t.home, now: now + SCRUB_AFTER_MS + 60_000 }), 1);
  const copy = new DatabaseSync(path.join(datosOf(t), PRE_COPY), { readOnly: true });
  assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM persons WHERE pin_hash IS NOT NULL').get().n, 0);
  assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM devices WHERE token_hash NOT LIKE 'borrado:%' OR public_key IS NOT NULL").get().n, 0);
  assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'secret:%' OR key = 'remote_keys' OR key LIKE 'agent_id:%'").get().n, 0);
  assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM bots').get().n, 2, 'el resto se queda');
  assert.equal(copy.prepare('PRAGMA freelist_count').get().freelist_count, 0);
  copy.close();
  assert.ok(!fs.readFileSync(path.join(datosOf(t), PRE_COPY), 'latin1').includes('clave:'), 'ni en páginas libres');
  assert.equal(scrubPreCopies(board.db, { home: t.home, now: now + SCRUB_AFTER_MS * 2 }), null, 'una vez');
  // «Borrar los datos de Orb 3.7»: never while a run is unfinished.
  board.run("INSERT INTO settings (key, value) VALUES ('migrated_3_8_files', '[]')");
  assert.throws(() => deleteLegacyData(board.db, t.home), /todavía/);
  board.run("DELETE FROM settings WHERE key = 'migrated_3_8_files'");
  const found = legacyData(t.home);
  assert.equal(found.archives.length, 1); assert.equal(found.copies.length, 1); assert.ok(found.bytes > 0);
  deleteLegacyData(board.db, t.home);
  assert.deepEqual(legacyData(t.home), { archives: [], copies: [], bytes: 0 });
  assert.ok(!fs.existsSync(archived(t)));
  board.db.close();
});

test('B2: scrub oculta el valor tras una opción de secreto y lo que parece una clave en cualquier texto', () => {
  assert.deepEqual(scrub({ name: 'x', command: 'run sk-abcdefghijk', args: ['--api-key', 'abc', '--port', '80', 'xai-abcdefgh1'], url: 'https://u:p@h/?token=t&a=1', env: { K: 'v' }, person: 'p' }),
    { name: 'x', command: 'run [secreto oculto]', args: ['(oculto)', '(oculto)', '--port', '80', '[secreto oculto]'], url: 'https://(oculto)@h/?token=(oculto)&a=1', ocultos: ['env.K'] });
});

test('M6: la pantalla de bloqueo dice la verdad, abre la carpeta de la copia y ofrece buscar una actualización', () => {
  const s = { failed: true, reason: 'EPERM', backup: 'C:\\Orb\\.orb\\datos\\orb-pre-3.8.db', data: 'C:\\Orb\\.orb\\datos\\orb.db', committed: false };
  assert.equal(folderOf(s.backup), 'C:\\Orb\\.orb\\datos');
  assert.equal(migrationView(s, null).body, 'data.migration38.body');
  assert.equal(migrationView({ ...s, committed: true }, null).body, 'data.migration38.bodyCommitted');
  assert.equal(migrationView(s, null).update, null, 'sin actualizador (desde el código)');
  assert.equal(migrationView(s, { state: 'off' }).update, null);
  assert.equal(migrationView(s, { state: 'idle' }).update.action, 'check');
  assert.equal(migrationView(s, { state: 'none' }).update.none, true);
  assert.equal(migrationView(s, { state: 'checking' }).update.busy, true);
  const available = migrationView(s, { state: 'available', version: '3.8.1' }).update;
  assert.deepEqual([available.action, available.version], ['update', '3.8.1']);
  assert.equal(migrationView(s, { state: 'downloading', percent: 40 }).update.percent, 40);
  assert.equal(migrationView(s, { state: 'downloaded' }).update.action, 'restart');
  assert.equal(migrationView({ ...s, backup: null }, null).folder, 'C:\\Orb\\.orb\\datos', 'sin copia: la carpeta de la base');
});

test('F3b M5: Ajustes › Datos cuenta las copias de antes de la 3.8 (guardan las claves de la 3.7)', async () => {
  const { before38 } = await import('../src/engine/api/data.mjs');
  for (const v of ['3.7.2', '3.7', '2.6.0', '3.0.1']) assert.equal(before38(v), true, v);
  for (const v of ['3.8.0', '3.8.1', '3.10.0', '4.0.0', null, undefined, '', 'x']) assert.equal(before38(v), false, String(v));
});

test('3.8.2 (M6): el móvil dice «El PC necesita atención» cuando el PC responde con ese estado, nunca «sin conexión»', () => {
  const bridge = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'lib', 'web-bridge.js'), 'utf8');
  assert.match(bridge, /res\.status === 503 && typeof data\.attention === 'string'\) throw Object\.assign\(new Error\(await tl\('app\.pcAttentionBody'\)\), \{ attention: data\.attention \}\)/);
  assert.match(bridge, /if \(e\.attention\) return \{ mobile: true, needsSetup: false, offline: true, attention: e\.attention/);
  const main = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'main.jsx'), 'utf8');
  const screen = main.slice(main.indexOf('function PcOffline'), main.indexOf('function MigrationFailed'));
  assert.match(screen, /setAttention\(r\.attention \?\? null\)/, 'sigue reintentando y pasa sola a la app cuando el PC se arregla');
  assert.match(screen, /t\('app\.pcAttentionBody'\)/);
  for (const lang of ['es', 'en']) {
    const text = fs.readFileSync(path.join(ROOT, 'src', 'shared', 'locales', lang, 'app.mjs'), 'utf8');
    for (const k of ['app.pcAttentionTitle', 'app.pcAttentionTitleNamed', 'app.pcAttentionBody']) assert.ok(text.includes(`"${k}"`), `${lang}: ${k}`);
  }
  const engine = fs.readFileSync(path.join(ROOT, 'src', 'engine', 'engine.mjs'), 'utf8');
  assert.match(engine, /await stopAttention\(\);\n {4}await run\(next, info\)/, 'el aviso se cierra antes de abrir el acceso de verdad en el mismo puerto');
});
