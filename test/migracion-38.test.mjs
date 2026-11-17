// 3.8 migration, part 1: the base case, the phone access and the backups (see migracion-38-lib.mjs).
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

test('una base 3.7 de dos usuarios: copia y archivo primero, luego fuera bots, réplicas, enlaces y el otro usuario', () => {
  const t = tempHome(); homes.push(t);
  const { ids } = build37(path.join(t.home, 'core', 'datos', 'orb.db'), C.newKeyPair(), { home: t.home });
  const local = files37(t, ids);
  const before = fs.readFileSync(path.join(t.home, 'core', 'orb.json'), 'utf8');
  useHome(t.home);
  let board = new Board();
  assert.equal(migrationFailure(), null);
  // The copy and the archive.
  assert.ok(fs.existsSync(path.join(t.home, 'core', 'datos', PRE_COPY)), 'copia de la base de antes');
  const old = new DatabaseSync(path.join(t.home, 'core', 'datos', PRE_COPY), { readOnly: true });
  assert.equal(old.prepare('SELECT COUNT(*) AS n FROM bots').get().n, 2, 'la copia tiene la base tal cual');
  old.close();
  assert.ok(fs.existsSync(archived(t, 'LEEME.txt')));
  // orb.json as it was, but without Ana's keys (it goes into every backup); the original is gone once the new one is written.
  const kept = JSON.parse(before);
  const archivedConfig = readJson(archived(t, ORIGINAL_CONFIG));
  assert.deepEqual(archivedConfig.bots, kept.bots, 'orb.json tal como estaba');
  assert.deepEqual(archivedConfig.mcpServers.find((m) => m.name === 'de-ana'), { name: 'de-ana', command: 'x', args: ['(oculto)'], ocultos: ['env.API_KEY'], person: ANA });
  assert.ok(!JSON.stringify(archivedConfig).includes('secreto-de-ana'));
  assert.ok(!fs.existsSync(path.join(t.home, 'core', 'datos', WORK_DIR)), 'el orb.json original ya no está');
  assert.ok(!fs.existsSync(path.join(t.home, 'core', 'datos', 'migracion-3.8.json')));
  assert.equal(fs.existsSync(path.join(t.home, 'core', 'datos', LOCK_FILE)), process.platform !== 'win32', 'el bloqueo: quitado en Windows; fuera, se queda');
  assert.deepEqual(readJson(archived(t, 'bots', 'bots.json')).map((b) => b.name), ['Casa', 'Bot de Ana']);
  assert.equal(readJson(archived(t, 'bots', 'grupos.json'))[0].members.length, 2);
  assert.equal(readJson(archived(t, 'bots', 'recordatorios.json'))[0].text, 'Sacar la basura');
  assert.equal(readJson(archived(t, 'bots', 'memorias-historial.json')).length, 1);
  assert.deepEqual(readJson(archived(t, 'bots', 'conversaciones', `${ids.cBot}.json`)).chat.map((l) => l.body), ['enciende la luz', 'hecho']);
  assert.equal(fs.readFileSync(archived(t, 'bots', 'carpeta', 'personas', OWNER, 'memoria-global.md'), 'utf8'), 'memoria del dueño');
  assert.ok(fs.existsSync(archived(t, 'bots', 'borrados', 'viejo', 'memoria.md')));
  assert.ok(!fs.existsSync(path.join(t.home, 'bots')) && !fs.existsSync(path.join(t.home, 'core', 'bots-borrados')));
  assert.ok(fs.existsSync(archived(t, 'enlaces.json')) && !fs.existsSync(path.join(t.home, 'core', 'datos', 'enlaces.json')));
  assert.ok(fs.existsSync(archived(t, 'orb-puente.json')) && !fs.existsSync(path.join(local, 'OrbPuente', 'orb.json')));
  assert.ok(fs.existsSync(path.join(local, 'OrbPuente', 'oce.json')), 'el oce.json de Open Control Edge no se toca');
  // Ana's export, then her data gone.
  const ana = archived(t, 'usuarios', `Ana-${ANA}`);
  assert.equal(readJson(path.join(ana, 'usuario.json')).name, 'Ana');
  assert.equal(readJson(path.join(ana, 'usuario.json')).pin_hash, undefined);
  assert.deepEqual(readJson(path.join(ana, 'conversaciones', `${ids.cAna}.json`)).chat.map((l) => l.body), ['mi secreto']);
  assert.deepEqual(readJson(path.join(ana, 'tareas.json')).map((x) => x.title), ['Tarea de Ana']);
  assert.deepEqual(readJson(path.join(ana, 'proyectos.json')).map((x) => x.name), ['web-ana']);
  // Her accounts: only their names (no keys); her sign-in folders are deleted, not archived.
  const cuentas = readJson(path.join(ana, 'cuentas.json'));
  assert.deepEqual(cuentas.accounts.map((a) => a.id), ['claude-ana']);
  assert.deepEqual(cuentas.mcpServers, [{ name: 'de-ana', command: 'x', args: ['(oculto)'], ocultos: ['env.API_KEY'] }]);
  assert.ok(!JSON.stringify(cuentas).includes('secreto-de-ana'));
  assert.ok(!fs.existsSync(path.join(ana, 'cuentas')) && !fs.existsSync(path.join(t.home, 'core', 'cuentas', ANA)) && !fs.existsSync(path.join(t.home, 'core', 'cuentas', 'claude-ana')));
  assert.match(fs.readFileSync(archived(t, 'LEEME.txt'), 'utf8'), /Ana tendrá que volver a iniciar sesión en su propio Orb/);
  // An account of a person nobody knows: not given to the owner, archived apart.
  assert.deepEqual(readJson(archived(t, 'usuarios', 'desconocido', 'cuentas.json')).accounts.map((a) => [a.id, a.person]), [['claude-gone', 'p-gone']]);
  assert.equal(readJson(path.join(ana, 'ajustes.json')).preview, 'all');
  assert.ok(fs.existsSync(path.join(ana, 'imagenes', 'a.png')) && fs.existsSync(path.join(ana, 'bitacora-general.md')));
  // Her lines outside her conversations, her spending, her task's settings and run log.
  assert.deepEqual(readJson(path.join(ana, 'chat-suelto.json')).map((l) => l.body), ['aviso de Ana', 'Ana escribe aquí', 'hola familia'], 'también su línea en el grupo de bots');
  assert.deepEqual(readJson(path.join(ana, 'uso.json')).map((u) => u.usd), [0.25]);
  assert.deepEqual(readJson(path.join(ana, 'tareas.json'))[0].settings, { accepted: 1, checkpoint: { before: 'x' } });
  assert.equal(fs.readFileSync(path.join(ana, 'ejecuciones', 'tareas', String(ids.tAna), 'registro.jsonl'), 'utf8'), '{"fake":1}\n');
  assert.ok(!fs.existsSync(path.join(ana, 'ejecuciones', 'tareas', String(ids.tAna), 'mcp.json')), 'nada más de su ejecución');
  const runs = path.join(t.home, 'core', 'ejecuciones');
  assert.ok(!fs.existsSync(path.join(runs, String(ids.tAna))) && !fs.existsSync(path.join(runs, 'personas', ANA)) && !fs.existsSync(path.join(runs, 'personas', OWNER)));
  assert.ok(fs.existsSync(path.join(runs, String(ids.tDani), 'registro.jsonl')), 'las ejecuciones del dueño se quedan');
  assert.equal(readJson(archived(t, 'tablas', 'prestamos.json')).length, 1);
  assert.equal(readJson(archived(t, 'orb-json-retirado.json')).role, 'centro');

  // The database: no table, index or trigger of 3.5–3.7.
  for (const gone of DROPPED_TABLES) assert.ok(!names(board, 'table').includes(gone), gone);
  assert.deepEqual(names(board, 'trigger'), []);
  for (const gone of ['chat_uid', 'conversations_bot', 'conversations_person', 'tasks_person', 'devices_person', 'link_queue_request', 'bots_person']) assert.ok(!names(board, 'index').includes(gone), gone);
  const devCols = board.all('PRAGMA table_info(devices)').map((c) => c.name);
  for (const gone of ['role', 'admin', 'kind_ok', 'approve', 'dev_ok']) assert.ok(!devCols.includes(gone), gone);
  // The owner's data, intact and without a person.
  assert.deepEqual(board.all('SELECT title FROM conversations ORDER BY id').map((r) => r.title), ['Plan de Dani']);
  assert.deepEqual(board.chat(ids.cDani).map((l) => l.body), ['hola Orb', 'hola Dani', '(mensaje de otro usuario de Orb 3.7)'], 'la línea del otro usuario sigue en su sitio, sin su texto');
  assert.deepEqual(board.all('SELECT title FROM tasks').map((r) => r.title), ['Tarea de Dani']);
  assert.deepEqual(board.all('SELECT name FROM projects').map((r) => r.name), ['web-dani']);
  assert.deepEqual(board.all('SELECT title FROM schedules').map((r) => r.title), ['Revisar']);
  assert.deepEqual(board.all('SELECT id FROM sessions').map((r) => r.id), ['s-dani']);
  assert.equal(board.one('SELECT COUNT(*) AS n FROM session_items').n, 1);
  assert.equal(board.one('SELECT COUNT(*) AS n FROM messages').n, 1);
  assert.deepEqual(board.all('SELECT name FROM devices').map((r) => r.name), ['Móvil de Dani'], 'sin el móvil de Ana, el Orb enlazado ni la terminal');
  for (const tb of ['conversations', 'chat', 'tasks', 'sessions', 'schedules', 'projects', 'events', 'devices', 'messages', 'usage_ledger']) assert.equal(board.one(`SELECT COUNT(*) AS n FROM ${tb} WHERE person_id IS NOT NULL`).n, 0, tb);
  assert.equal(board.one('SELECT SUM(usd) AS s FROM usage_ledger').s, 0.5, 'el gasto de Ana no cuenta como del dueño');
  assert.equal(board.one("SELECT COUNT(*) AS n FROM chat WHERE body IN ('aviso de Ana', 'Ana escribe aquí')").n, 0);
  assert.equal(board.setting(`accepted:${ids.tDani}`), '1'); assert.equal(board.setting(`accepted:${ids.tAna}`), undefined); assert.equal(board.setting(`checkpoint:${ids.tAna}`), undefined);
  // Chat-list marks: the owner's under 'owner', without the bots' zone or Ana's.
  assert.deepEqual(board.all('SELECT person_id, kind, item_id, pinned FROM inbox_items').map((r) => ({ ...r })), [{ person_id: 'owner', kind: 'conversation', item_id: String(ids.cDani), pinned: 1 }]);
  assert.deepEqual(board.all('SELECT person_id, zone, name FROM inbox_sections').map((r) => ({ ...r })), [{ person_id: 'owner', zone: 'orb', name: 'Trabajo' }]);
  assert.equal(marks(board).get(`conversation:${ids.cDani}`).pinned, true, 'el dueño ve sus marcas');
  // Settings.
  assert.equal(board.setting('inbox_since:owner'), '1');
  assert.equal(board.setting('sidebar_completed'), '["s-dani"]');
  assert.equal(board.setting('active_project'), 'web-dani');
  for (const k of ['orb_self', 'bots_seeded', 'net_names', 'connections.adb', 'handback_pending', 'hub_handoffs', 'persons_migrated', 'home_migrated', 'bot_taint:1', 'ha_allow:light.salon', 'browser_pace:example.com', 'secret:ha_token', 'agent_id:ffff', `pending_questions:${ids.cBot}`, `inbox_since:${OWNER}`, `inbox_since:${ANA}`, `sidebar_kept:${ANA}`]) assert.equal(board.setting(k), undefined, k);
  assert.equal(board.setting(MARK), '1');
  // orb.json: the owner's settings in, what 3.8 has not out.
  const raw = readJson(path.join(t.home, 'core', 'orb.json'));
  for (const k of ['bots', 'oce', 'monitor', 'role', 'devTarget']) assert.equal(raw[k], undefined, k);
  assert.equal(raw.ui.mode, undefined); assert.equal(raw.browser.sites, undefined); assert.equal(raw.browser.enabled, true);
  assert.equal(raw.userName, 'Dani'); assert.equal(raw.tz, 'Europe/Madrid'); assert.equal(raw.mobile.preview, 'none');
  assert.equal(raw.orchestrator.model, 'claude-opus-5-5'); assert.equal(raw.orchestrator.reasoning, 'high'); assert.equal(raw.orchestrator.orchestrate, false);
  assert.ok(!raw.accounts.some((a) => a.id === 'claude-ana' || a.id === 'claude-gone' || 'person' in a));
  assert.equal(board.setting('migrated_3_8_config'), undefined, 'orb.json ya escrito');
  assert.deepEqual(raw.mcpServers, [{ name: 'mio', command: 'y' }]);
  assert.equal(ctx.config.orchestrator.model, 'claude-opus-5-5', 'la configuración en memoria también');
  // The owner's images back where 3.8 keeps them.
  assert.ok(fs.existsSync(path.join(t.home, 'core', 'imagenes', 'b.png')) && !fs.existsSync(path.join(t.home, 'core', 'imagenes', ANA)));
  // Ana's project folder stays in web/, not listed; added by hand, it is listed again.
  assert.ok(fs.existsSync(path.join(t.home, 'web', 'web-ana')));
  assert.match(fs.readFileSync(archived(t, 'LEEME.txt'), 'utf8'), /Las carpetas de Ana siguen en web[\\/]web-ana; Orb no las lista/);
  syncProjects(board);
  assert.deepEqual(board.projects().map((x) => x.name), ['web-dani']);
  board.addProject({ name: 'web-ana', path: path.join(t.home, 'web', 'web-ana') }, 'usuario', { fromUser: true });
  assert.deepEqual(board.settingJson(IGNORED_PROJECTS), [], 'añadida a mano, ya no se ignora');
  syncProjects(board);
  assert.deepEqual(board.projects().map((x) => x.name).sort(), ['web-ana', 'web-dani']);
  // Told once.
  const notice = takeNotice(board);
  assert.equal(notice.bots, 2); assert.deepEqual(notice.users, ['Ana']); assert.equal(notice.archive, archived(t));
  assert.equal(notice.haToken, true, 'había un token de Home Assistant: el aviso dice que se revoque');
  assert.equal(takeNotice(board), null);
  board.db.close();

  // Opened twice more: nothing runs again and everything keeps working.
  fs.writeFileSync(archived(t, 'LEEME.txt'), 'tocado');
  for (let i = 0; i < 2; i++) {
    board = new Board();
    assert.equal(fs.readFileSync(archived(t, 'LEEME.txt'), 'utf8'), 'tocado', 'la migración no vuelve a correr');
    const c = board.createConversation({ title: 'Nueva' });
    board.addChat('usuario', 'hola', null, c.id);
    assert.equal(board.chat(c.id).length, 1);
    assert.equal(takeNotice(board), null);
    board.db.close();
  }
});

test('una base nueva de 3.8 no se toca (ni copia ni archivo)', () => {
  const t = tempHome(); homes.push(t);
  const board = new Board();
  assert.equal(board.setting(MARK), '1');
  assert.ok(!fs.existsSync(path.join(t.home, 'core', 'datos', PRE_COPY)));
  assert.ok(!fs.existsSync(archived(t)));
  assert.equal(takeNotice(board), null);
  board.db.close();
});

for (const v of ['3.6', '3.5.1']) {
  test(`una base ${v} salta a 3.8: las migraciones viejas primero, luego la de 3.8`, () => {
    const t = tempHome(); homes.push(t);
    const file = path.join(t.home, 'core', 'datos', 'orb.db');
    const db = new DatabaseSync(file);
    db.exec(schema(v));
    db.exec("INSERT INTO settings (key, value) VALUES ('notices_migrated', '1')");
    db.prepare("INSERT INTO conversations (title, titled, created_at, updated_at) VALUES ('Mía', 1, ?, ?)").run(NOW, NOW);
    db.prepare("INSERT INTO chat (role, body, at, conversation_id) VALUES ('usuario', 'hola', ?, 1)").run(NOW);
    db.prepare("INSERT INTO bots (name, created_at, updated_at) VALUES ('Viejo', ?, ?)").run(NOW, NOW);
    db.prepare("INSERT INTO conversations (title, titled, created_at, updated_at, bot_id) VALUES ('Viejo', 1, ?, ?, 1)").run(NOW, NOW);
    db.prepare("INSERT INTO devices (id, name, token_hash, created_at, kind) VALUES ('o', 'Otro Orb', 'h', ?, 'orb'), ('p', 'Móvil', 'h2', ?, 'phone')").run(NOW, NOW);
    if (v === '3.6') {
      db.prepare("INSERT INTO persons (id, name, role, created_at) VALUES ('p1', 'Dani', 'owner', ?)").run(NOW);
      db.exec("INSERT INTO settings (key, value) VALUES ('persons_migrated', '1'); UPDATE conversations SET person_id = 'p1'; UPDATE devices SET person_id = 'p1'");
    }
    db.close();
    useHome(t.home);
    const board = new Board();
    assert.deepEqual(board.all('SELECT title FROM conversations').map((r) => r.title), ['Mía']);
    assert.deepEqual(board.chat(1).map((l) => l.body), ['hola']);
    assert.deepEqual(board.all('SELECT name FROM devices').map((r) => r.name), ['Móvil']);
    for (const gone of DROPPED_TABLES) assert.ok(!names(board, 'table').includes(gone), gone);
    assert.deepEqual(readJson(archived(t, 'bots', 'bots.json')).map((b) => b.name), ['Viejo']);
    assert.ok(fs.existsSync(path.join(t.home, 'core', 'datos', PRE_COPY)));
    board.db.close();
  });
}

test('el acceso del móvil: no se abre sobre una base sin migrar y nunca sirve un dispositivo de otro usuario', async () => {
  // A 3.7 database that could not be migrated (opened here outside its home: nothing is migrated).
  const t = tempHome(); homes.push(t);
  const file = path.join(t.base, 'otra-3.7.db');
  build37(file, C.newKeyPair());
  const legacy = new Board(openDb(file));
  const remote = createRemote({ board: legacy, api: { call: async () => null }, log: () => {}, emit: () => {}, version: 'test' });
  await assert.rejects(remote.start(), /3\.7/);
  legacy.db.close();

  // The engine on a 3.7 home with the phone access on: migrated before the access opens; Ana's phone is gone, and Dani's
  // too (F3b-fix: a phone of before 3.8 never proved the master password; he is told to link it again), and a device
  // with another person (a database not migrated yet) is refused.
  const port = 20000 + Math.floor(Math.random() * 20000);
  const u = tempHome({ mobile: { enabled: true, port } }); homes.push(u);
  const pc = C.newKeyPair();
  const { ids, phones } = build37(path.join(u.home, 'core', 'datos', 'orb.db'), pc);
  asOrb37(u.home);
  const engine = await startEngine(u.home, { env: { ORB_REMOTE_BIND: '127.0.0.1' } });
  assert.ok(!fs.existsSync(path.join(u.home, '.orb')) && !fs.existsSync(path.join(u.home, 'orb.json')), 'la carpeta de 3.7 ya está en core');
  try {
    await until(async () => (await engine.call('remote.status')).running, 'servidor del móvil');
    const me = async (id, kp) => {
      const key = C.sessionKey(kp.priv, C.publicKeyOf(pc.priv));
      const box = C.seal(key, { t: Date.now(), m: 'me', b: { v: 3 } }, C.AAD.request(id));
      return (await fetch(`http://127.0.0.1:${port}/api/me`, { method: 'POST', headers: { 'X-Orb-Device': id, 'Content-Type': 'application/json' }, body: JSON.stringify(box) })).status;
    };
    assert.equal(await me(ids.dDani, phones.dani), 401, 'el móvil del dueño, enlazado antes de 3.8, se vuelve a enlazar');
    assert.equal(await me(ids.dAna, phones.ana), 401, 'el de Ana ya no');
    assert.match(fs.readFileSync(path.join(u.home, 'core', 'ejecuciones', 'motor.log'), 'utf8'), /3\.8: datos de 3\.7 migrados: 2 bots .*1 usuarios \(Ana\)/);
    const db = new DatabaseSync(path.join(u.home, 'core', 'datos', 'orb.db'));
    db.exec('PRAGMA busy_timeout = 5000');
    const said = db.prepare("SELECT body FROM chat WHERE role = 'notice' ORDER BY id DESC").all().map((r) => r.body).join(' | ');
    assert.match(said, /Orb 3\.8 ya no tiene bots ni usuarios\. Hemos guardado lo anterior en .*archivo-3\.7/, 'el aviso al dueño');
    assert.match(said, /Vuelve a enlazar tu móvil con Magic Link/);
    // A device of 3.8 that still has a person (a database not migrated yet) is never served.
    const other = '33333333-3333-3333-3333-333333333333';
    db.prepare("INSERT INTO devices (id, name, token_hash, created_at, last_seen, public_key, route, kind, meta, person_id) VALUES (?, 'Otro', ?, ?, ?, ?, 'wifi', 'phone', ?, 'p-otro')").run(other, `clave:${other}`, new Date().toISOString(), new Date().toISOString(), C.b64.enc(phones.dani.pub), JSON.stringify({ v: 4 }));
    db.close();
    assert.equal(await me(other, phones.dani), 401, 'un dispositivo de otra persona nunca actúa como el dueño');
  } finally { await engine.stop(); }
});

test('las copias de seguridad llevan los archivos de 3.7 (también los fechados), nunca carpetas de cuentas', async () => {
  const t = tempHome(); homes.push(t);
  new Board().db.close();
  const put = (p) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'x'); };
  const dated = `${ARCHIVE_DIR}-2026-11-07-10-00-00`;
  put(archived(t, 'LEEME.txt')); put(archived(t, 'bots', 'bots.json')); put(archived(t, 'usuarios', 'Ana-p', 'cuentas', 'claude', 'credenciales.json'));
  put(path.join(t.home, 'core', dated, 'LEEME.txt'));
  const secret = crypto.randomBytes(32);
  for (const includeAccounts of [false, true]) {
    const { file } = await createBackup({ home: t.home, secret, version: 'test', includeAccounts });
    const target = path.join(t.base, `restaurada-${includeAccounts}`);
    await restoreInto(target, file, { secret });
    const back = (...p) => path.join(target, 'core', ARCHIVE_DIR, ...p);
    assert.ok(fs.existsSync(back('LEEME.txt')) && fs.existsSync(back('bots', 'bots.json')));
    assert.ok(fs.existsSync(path.join(target, 'core', dated, 'LEEME.txt')));
    assert.equal(fs.existsSync(back('usuarios', 'Ana-p', 'cuentas', 'claude', 'credenciales.json')), false, 'ni con las cuentas');
  }
});
