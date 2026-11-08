// 3.8: the workspace (C:\Orb by default) keeps Orb's own things in core (src/core/core-folder.mjs). A new one is core and
// the six categories, nothing else. Of a workspace of Orb 3.7, Orb's own data (.orb, orb.json) moves into core once,
// before the database opens, with its paths (orb.json, database, isolated copies) pointed into core; its bitacora,
// android\adb-tools and mcp-servers move only as the user chooses (planWorkspace / applyLayout). A move that stopped
// halfway is finished by the next start; a second run does nothing.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { tempHome, startEngine, wait } from './helpers.mjs';
import { coreView } from '../src/ui/lib/core-access.js';
import { createHome, isHome, paths, loadConfig } from '../src/core/home.mjs';
import { migrateWorkspace, planWorkspace, applyLayout, coreHealth, MOVE_STATE, CONFLICTS_DIR, LAYOUT_FILE } from '../src/core/core-folder.mjs';
import { git } from '../src/core/workspace.mjs';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
const bases = [];
after(() => { for (const b of bases) fs.rmSync(b, { recursive: true, force: true, maxRetries: 5 }); });
const newBase = () => { const b = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-core-')); bases.push(b); return b; };
const put = (p, text = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const read = (p) => fs.readFileSync(p, 'utf8');

test('un espacio nuevo: core (oculta, sin atributo de sistema) y las seis categorías, nada más arriba', () => {
  const { home, created } = createHome(newBase(), { userName: 'Ana' });
  assert.equal(created, true);
  assert.deepEqual(fs.readdirSync(home).sort(), ['android', 'core', 'ios', 'linux', 'multi', 'web', 'windows']);
  const p = paths(home);
  for (const f of [p.config, p.key, p.generalLog]) assert.ok(fs.statSync(f).isFile(), f);
  // 3.8.1: core\skills is back (every skill; the agents get the ones that are on: src/core/extensions.mjs).
  for (const d of [p.data, p.runs, p.worktrees, p.checkpoints, p.projectLogs, p.mcp, p.skills, p.tools, p.secrets]) assert.ok(fs.statSync(d).isDirectory(), d);
  assert.equal(p.skills, path.join(home, 'core', 'skills'));
  assert.ok(!fs.existsSync(p.staging), 'core\preparacion solo cuando un agente prepara algo');
  assert.equal(p.adb, path.join(home, 'core', 'herramientas', 'adb'));
  assert.equal(p.logs, path.join(home, 'core', 'bitacora'));
  assert.ok(isHome(home));
  assert.equal(migrateWorkspace(home), null, 'nada que mover');
  assert.deepEqual(planWorkspace(home), { items: [], pending: false });
  assert.deepEqual(coreHealth(home), { ok: false, missing: ['db'] }, 'la base aún no se ha abierto');
  if (process.platform === 'win32') {
    const out = spawnSync('attrib', [p.core], { encoding: 'latin1' }).stdout;
    const attrs = out.slice(0, out.toLowerCase().indexOf(p.core.toLowerCase()));
    assert.ok(attrs.includes('H') && !attrs.includes('S'), `core oculta, sin sistema (las copias del usuario no se la saltan): ${out}`);
  }
});

// A workspace as Orb 3.7 left it, with paths into its folders in orb.json, the database and an isolated copy.
function orb37() {
  const base = newBase();
  const home = path.join(base, 'Orb');
  const old = (...p) => path.join(home, '.orb', ...p);
  const project = path.join(home, 'web', 'tienda');
  fs.mkdirSync(project, { recursive: true });
  git(project, 'init', '-q', '-b', 'main'); put(path.join(project, 'a.txt'), 'a'); git(project, 'add', '.'); git(project, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'uno');
  const copy = old('copias', 'aisladas', 'tienda-7');
  fs.mkdirSync(path.dirname(copy), { recursive: true });
  assert.equal(git(project, 'worktree', 'add', '-q', '-b', 'orb/tarea-7', copy).status, 0);
  put(path.join(home, 'orb.json'), JSON.stringify({ version: 5, assistantName: 'Orbe', userName: 'Ana', language: 'es',
    accounts: [{ id: 'codex-2', agent: 'codex', label: 'Codex 2', home: old('cuentas', 'codex-2'), enabled: true }],
    mcpServers: [{ name: 'correo', command: 'node', args: [path.join(home, 'mcp-servers', 'correo', 'index.js')] }] }));
  put(old('cuentas', 'codex-2', 'auth.json'), '{}');
  put(old('datos', 'clave.bin'), 'k'.repeat(32));
  put(old('imagenes', 'foto.png'), 'png');
  put(old('ejecuciones', '7', 'registro.jsonl'), '{}\n');
  put(path.join(home, 'bitacora', 'GENERAL.md'), '# General\n\n### entrada de 3.7\n');
  put(path.join(home, 'bitacora', 'proyectos', 'tienda.md'), '# tienda\n');
  put(path.join(home, 'mcp-servers', 'correo', 'index.js'), '// servidor');
  put(path.join(home, 'android', 'adb-tools', 'adb.exe'), 'adb');
  put(path.join(home, 'bots', 'nota.md'), 'de un bot'); // the 3.8 migration of the database archives it, not this one
  const db = new DatabaseSync(old('datos', 'orb.db'));
  db.exec('CREATE TABLE tasks (id INTEGER PRIMARY KEY, workdir TEXT, n INTEGER); CREATE TABLE chat (id INTEGER PRIMARY KEY, role TEXT, body TEXT, meta TEXT); CREATE TABLE projects (name TEXT, path TEXT)');
  db.prepare('INSERT INTO tasks (id, workdir, n) VALUES (7, ?, 1)').run(copy);
  db.prepare("INSERT INTO chat (role, body, meta) VALUES ('orb', ?, ?)").run(`Mira ${old('imagenes', 'foto.png')}`, JSON.stringify({ images: [old('imagenes', 'foto.png')], log: path.join(home, 'bitacora', 'GENERAL.md') }));
  // What the user wrote stays as written: a path they typed is theirs; Orb's own image (in .orb) follows the move.
  db.prepare("INSERT INTO chat (role, body, meta) VALUES ('user', ?, ?)").run(`lee ${path.join(home, 'bitacora', 'GENERAL.md')} y ${old('imagenes', 'foto.png')}`, null);
  db.prepare('INSERT INTO projects (name, path) VALUES (?, ?), (?, ?)').run('tienda', project, 'bitacora-web', path.join(home, 'web', 'bitacora-web'));
  db.close();
  return { home, project, copy };
}

test('un espacio de 3.7: sus datos pasan a core solos; bitacora, adb-tools y mcp-servers, solo cuando el usuario elige', () => {
  const { home, project } = orb37();
  assert.ok(isHome(home), 'orb.json arriba también es un espacio (se mueve al arrancar)');
  const r = migrateWorkspace(home);
  assert.equal(r.moved.length, 2, '.orb y orb.json');
  const p = paths(home);
  assert.deepEqual(fs.readdirSync(home).sort(), ['android', 'bitacora', 'bots', 'core', 'mcp-servers', 'web'], 'lo demás sigue donde estaba');
  assert.equal(p.logs, path.join(home, 'bitacora'), 'la bitácora se usa donde está mientras tanto');
  assert.equal(p.adb, path.join(home, 'android', 'adb-tools'));
  assert.equal(read(path.join(p.data, 'clave.bin')), 'k'.repeat(32));
  assert.equal(read(path.join(p.core, 'imagenes', 'foto.png')), 'png');
  assert.equal(loadConfig(home).accounts.find((a) => a.id === 'codex-2').home, path.join(p.core, 'cuentas', 'codex-2'));
  // What the window shows: nothing has moved, each with its default (an Orb 3.7 bitacora with only Orb's files: into core).
  const plan = planWorkspace(home);
  assert.equal(plan.pending, true);
  assert.deepEqual(plan.items.map((it) => [it.id, it.choice, it.project]), [['bitacora', 'move', false], ['adb', 'move', false], ['mcp:correo', 'mcp', false]]);
  // The user confirms the defaults.
  applyLayout(home, Object.fromEntries(plan.items.map((it) => [it.id, it.choice])));
  const q = paths(home);
  assert.deepEqual(fs.readdirSync(home).sort(), ['android', 'bots', 'core', 'web'], 'arriba solo quedan las categorías (y lo que archiva la migración de la base)');
  assert.match(read(q.generalLog), /entrada de 3.7/);
  assert.equal(q.generalLog, path.join(home, 'core', 'bitacora', 'GENERAL.md'));
  assert.ok(fs.existsSync(path.join(q.projectLogs, 'tienda.md')));
  assert.equal(read(path.join(q.mcp, 'correo', 'index.js')), '// servidor');
  assert.equal(read(path.join(q.adb, 'adb.exe')), 'adb');
  assert.deepEqual(fs.readdirSync(path.join(home, 'android')), [], 'android queda como categoría');
  assert.deepEqual(loadConfig(home).mcpServers[0].args, [path.join(q.mcp, 'correo', 'index.js')]);
  // The database: plain text and JSON text; a project whose name only looks like an old folder is left alone.
  const db = new DatabaseSync(q.db, { readOnly: true });
  const copy = path.join(q.worktrees, 'tienda-7');
  assert.equal(db.prepare('SELECT workdir FROM tasks').get().workdir, copy);
  const chat = db.prepare("SELECT body, meta FROM chat WHERE role = 'orb'").get();
  assert.equal(chat.body, `Mira ${path.join(q.core, 'imagenes', 'foto.png')}`);
  assert.deepEqual(JSON.parse(chat.meta), { images: [path.join(q.core, 'imagenes', 'foto.png')], log: q.generalLog });
  assert.equal(db.prepare("SELECT body FROM chat WHERE role = 'user'").get().body, `lee ${path.join(home, 'bitacora', 'GENERAL.md')} y ${path.join(q.core, 'imagenes', 'foto.png')}`, 'lo que escribió el usuario no se reescribe (la imagen de Orb sí)');
  assert.equal(db.prepare("SELECT path FROM projects WHERE name = 'bitacora-web'").get().path, path.join(home, 'web', 'bitacora-web'));
  db.close();
  // The isolated copy is still a working git worktree of its project, at its new place.
  assert.equal(git(copy, 'status', '--porcelain').status, 0);
  assert.match(git(project, 'worktree', 'list', '--porcelain').stdout.replace(/\\/g, '/'), new RegExp(copy.replace(/\\/g, '/').replace(/[.*+?^${}()|[\]]/g, '\\$&'), 'i'));
  assert.ok(!fs.existsSync(path.join(q.core, MOVE_STATE)), 'terminado');
  assert.equal(migrateWorkspace(home), null, 'la segunda vez no hace nada');
  assert.equal(planWorkspace(home).pending, false);
});

test('un traslado que se cortó a medias lo termina el siguiente arranque, sin perder ni pisar nada', () => {
  const { home } = orb37();
  const p = paths(home);
  // As if Orb stopped after moving .orb (its note, of the first 3.8 builds, went with it) but before orb.json and the paths.
  fs.writeFileSync(path.join(home, '.orb', MOVE_STATE), '{"v":1}');
  fs.renameSync(path.join(home, '.orb'), p.core);
  let r = migrateWorkspace(home);
  assert.ok(r.rewritten.db >= 2, 'las rutas de la base, aunque .orb ya estuviera movida');
  assert.ok(!fs.existsSync(path.join(home, 'orb.json')));
  // The user's choice, stopped halfway: its note lists the moves; a file copied before the stop (the same) and one that
  // differs (a log only grows).
  fs.writeFileSync(path.join(p.core, MOVE_STATE), JSON.stringify({ v: 2, moves: [
    { from: path.join(home, 'bitacora'), to: path.join(p.core, 'bitacora'), logs: true },
    { from: path.join(home, 'mcp-servers', 'correo'), to: path.join(p.core, 'mcp', 'correo') }] }));
  put(path.join(p.core, 'mcp', 'correo', 'index.js'), '// servidor');
  put(path.join(p.core, 'bitacora', 'proyectos', 'tienda.md'), '# tienda\n\n### de core\n');
  r = migrateWorkspace(home);
  assert.ok(!fs.existsSync(path.join(home, 'mcp-servers')) && !fs.existsSync(path.join(home, 'bitacora')));
  assert.equal(read(path.join(paths(home).mcp, 'correo', 'index.js')), '// servidor');
  assert.match(read(path.join(paths(home).projectLogs, 'tienda.md')), /### de core/, 'una bitácora no se pisa: crece');
  assert.equal(loadConfig(home).accounts.find((a) => a.id === 'codex-2').home, path.join(p.core, 'cuentas', 'codex-2'));
  assert.deepEqual(loadConfig(home).mcpServers[0].args, [path.join(p.core, 'mcp', 'correo', 'index.js')]);
  assert.ok(!fs.existsSync(path.join(p.core, MOVE_STATE)));
  assert.equal(migrateWorkspace(home), null);
});

test('en otro disco (no se puede renombrar): copia, comprueba, cambia y borra lo viejo; archivo donde había carpeta, aparte', () => {
  const { home } = orb37();
  const p = paths(home);
  fs.mkdirSync(path.join(p.core, 'datos'), { recursive: true });
  put(path.join(p.core, 'datos', 'clave.bin'), 'otra clave distinta, ya en core');
  put(path.join(p.core, 'ejecuciones'), 'un archivo donde 3.7 tenía una carpeta');
  const rename = fs.renameSync;
  // Every rename of an old folder or file into core fails as across volumes; switching a checked copy in (*.copia) and
  // putting an old file aside still work.
  const olds = ['.orb', 'orb.json', 'bitacora', 'mcp-servers', 'android'].map((n) => path.join(home, n));
  fs.renameSync = (from, to) => { if (olds.some((o) => String(from).startsWith(o)) && !String(to).includes(CONFLICTS_DIR)) throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' }); return rename(from, to); };
  let r; try { r = migrateWorkspace(home); applyLayout(home, { bitacora: 'move', adb: 'move', 'mcp:correo': 'mcp' }); } finally { fs.renameSync = rename; }
  assert.equal(r.moved.length, 2);
  for (const n of ['.orb', 'orb.json', 'bitacora', 'mcp-servers']) assert.ok(!fs.existsSync(path.join(home, n)), n);
  assert.equal(read(path.join(p.core, 'imagenes', 'foto.png')), 'png');
  assert.equal(read(path.join(p.core, 'ejecuciones')), 'un archivo donde 3.7 tenía una carpeta', 'no se pisa');
  assert.equal(read(path.join(p.data, 'clave.bin')), 'otra clave distinta, ya en core', 'lo de core manda');
  assert.equal(read(path.join(p.core, 'herramientas', 'adb', 'adb.exe')), 'adb');
  const aside = fs.readdirSync(path.join(p.core, CONFLICTS_DIR));
  const kept = (...q) => aside.map((d) => path.join(p.core, CONFLICTS_DIR, d, ...q)).find((f) => fs.existsSync(f));
  assert.equal(read(kept('.orb', 'datos', 'clave.bin')), 'k'.repeat(32), 'lo viejo distinto queda aparte');
  assert.equal(read(kept('.orb', 'ejecuciones', '7', 'registro.jsonl')), '{}\n', 'la carpeta que chocaba con un archivo, aparte entera');
  assert.ok(!fs.readdirSync(p.data).some((n) => n.endsWith('.copia')), 'sin copias a medias');
});

test('una carpeta en uso (Windows): no se mueve nada, el aviso dice cuál cerrar y «Reintentar» termina', { skip: process.platform !== 'win32' }, async () => {
  const { home } = orb37();
  migrateWorkspace(home);
  const server = path.join(home, 'mcp-servers', 'correo');
  // A running MCP server (or a terminal) with its working folder there.
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: server, stdio: 'ignore' });
  await wait(300);
  try {
    assert.throws(() => applyLayout(home, { bitacora: 'move', 'mcp:correo': 'windows' }), (e) => e.code === 'busy' && e.userFacing && /No se puede mover .*correo.*Ciérralo y pulsa «Reintentar»\. No se ha movido nada\./.test(e.message));
    assert.ok(fs.existsSync(path.join(home, 'bitacora', 'GENERAL.md')) && fs.existsSync(path.join(server, 'index.js')), 'nada movido');
    assert.ok(!fs.existsSync(path.join(paths(home).core, MOVE_STATE)), 'ni a medias');
    assert.equal(fs.existsSync(path.join(paths(home).core, LAYOUT_FILE)), false, 'nada decidido');
  } finally { child.kill(); await new Promise((r) => child.once('exit', r)); }
  applyLayout(home, { bitacora: 'move', 'mcp:correo': 'windows' });
  assert.equal(read(path.join(home, 'windows', 'correo', 'index.js')), '// servidor');
  assert.ok(!fs.existsSync(path.join(home, 'bitacora')));
});

// ---- core gone: what is missing comes back from the newest backup (outside the workspace)
const SECRET = 'ab'.repeat(32);
const notices = (home) => { const db = new DatabaseSync(paths(home).db, { readOnly: true }); try { return db.prepare("SELECT body FROM chat WHERE role = 'notice'").all().map((r) => r.body).join(' | '); } finally { db.close(); } };

test('core borrada con Orb cerrado: al arrancar vuelve de la última copia, con aviso', async () => {
  const t = tempHome();
  try {
    let e = await startEngine(t.home, { secret: SECRET });
    await e.call('projects.create', { name: 'tienda' });
    await e.call('backup.now', {});
    await e.stop();
    fs.rmSync(paths(t.home).core, { recursive: true, force: true, maxRetries: 10 });
    assert.equal(coreHealth(t.home).missing[0], 'core');
    e = await startEngine(t.home, { secret: SECRET });
    try {
      assert.equal(await e.call('app.coreState'), null);
      assert.ok((await e.call('projects.list')).some((p) => p.name === 'tienda'), 'la base, de vuelta');
      assert.ok(coreHealth(t.home).ok);
    } finally { await e.stop(); }
    assert.match(notices(t.home), /Faltaba la carpeta core/);
  } finally { t.cleanup(); }
});

test('solo falta orb.json: vuelve de la copia y la base, más nueva que la copia, se queda', async () => {
  const t = tempHome();
  try {
    let e = await startEngine(t.home, { secret: SECRET });
    await e.call('backup.now', {});
    await e.call('projects.create', { name: 'despues' });
    await e.stop();
    fs.rmSync(paths(t.home).config);
    e = await startEngine(t.home, { secret: SECRET });
    try { assert.ok((await e.call('projects.list')).some((p) => p.name === 'despues'), 'lo hecho después de la copia sigue'); } finally { await e.stop(); }
    assert.ok(fs.existsSync(paths(t.home).config));
  } finally { t.cleanup(); }
});

test('core borrada mientras Orb trabaja: el motor se detiene (para que la app lo arranque) y vuelve restaurada', async () => {
  const t = tempHome();
  try {
    const e = await startEngine(t.home, { secret: SECRET });
    await e.call('backup.now', {});
    const exited = new Promise((r) => e.child.once('exit', (code) => r(code)));
    fs.rmSync(paths(t.home).config); // the database is open: on Windows only part of core can go
    assert.equal(await Promise.race([exited, wait(15000).then(() => 'sigue')]), 75);
    assert.ok(e.events.some((m) => m.event === 'core:lost'));
    const again = await startEngine(t.home, { secret: SECRET });
    try { assert.equal(await again.call('app.coreState'), null); } finally { await again.stop(); }
    assert.ok(fs.existsSync(paths(t.home).config));
  } finally { t.cleanup(); }
});

test('sin copia: Orb espera y la ventana ofrece seguir sin copia; una copia que este PC no abre pide el código', async () => {
  const t = tempHome();
  try {
    fs.rmSync(paths(t.home).core, { recursive: true, force: true });
    const e = await startEngine(t.home);
    try {
      const st = await e.call('app.coreState');
      assert.equal(st.missing, true); assert.equal(st.reason, 'noBackup');
      await assert.rejects(e.call('app.state'), /carpeta core/);
      assert.deepEqual(await e.call('app.coreRepair', { fresh: true }), { missing: false });
      assert.equal(await e.call('app.coreState'), null);
      assert.ok((await e.call('app.state')).config);
      const { unlock } = await e.call('master.create', { password: 'contraseña de prueba' });
      await e.call('backup.recovery', { code: 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH', unlock });
      await e.call('backup.now', {});
    } finally { await e.stop(); }
    // Another secret (another PC, or the sealed key gone): the copy needs its recovery code.
    fs.rmSync(paths(t.home).core, { recursive: true, force: true, maxRetries: 10 });
    const f = await startEngine(t.home, { secret: 'cd'.repeat(32) });
    try {
      const st = await f.call('app.coreState');
      assert.equal(st.reason, 'needsPassphrase'); assert.ok(st.backup?.file);
      assert.equal((await f.call('app.coreRepair', { passphrase: 'mal' })).reason, 'needsPassphrase');
      assert.deepEqual(await f.call('app.coreRepair', { passphrase: 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH' }), { missing: false });
      assert.ok((await f.call('app.state')).config);
    } finally { await f.stop(); }
  } finally { t.cleanup(); }
});

test('la pantalla «Falta la carpeta core»: qué dice y qué ofrece', () => {
  assert.deepEqual(coreView({ missing: true, home: 'C:/Orb', reason: 'noBackup', folder: 'X' }), { body: 'data.core.noBackup', vars: { home: 'C:/Orb' }, passphrase: false, restore: false, fresh: 'yes', folder: 'X' });
  const v = coreView({ reason: 'needsPassphrase', backup: { created: '2026-11-07T03:00:00Z' } }, { when: (d) => d.slice(0, 10) });
  assert.deepEqual([v.body, v.vars.created, v.passphrase, v.restore, v.fresh], ['data.core.needsPassphrase', '2026-11-07', true, true, 'noCode'], 'con una copia que solo pide su código, «Seguir sin copia» queda tras «No tengo el código»');
  assert.equal(coreView({ reason: 'damaged', backup: {} }).body, 'data.core.damaged');
  assert.equal(coreView({ reason: 'damaged', backup: {} }).fresh, 'yes');
});

test('3.8.1: la bitácora va a core por defecto, también con archivos del usuario (normas para agentes)', () => {
  const { home } = orb37();
  put(path.join(home, 'bitacora', 'bitacora_project.md'), 'normas que leen otras herramientas');
  migrateWorkspace(home);
  const item = planWorkspace(home).items.find((it) => it.id === 'bitacora');
  assert.equal(item.choice, 'move');
  assert.deepEqual(item.choices, ['move', 'keep'], 'dejarla sigue siendo posible');
});
