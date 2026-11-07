// 3.8: the workspace (C:\Orb by default) keeps Orb's own things in core (src/core/core-folder.mjs). A new one is core and
// the six categories, nothing else; one of Orb 3.7 (.orb, orb.json, bitacora, mcp-servers, android\adb-tools at the top)
// moves into core once, before the database opens, with its paths (orb.json, database, isolated copies) pointed into
// core. A move that stopped halfway is finished by the next start; a second run does nothing.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tempHome, startEngine, wait } from './helpers.mjs';
import { coreView } from '../src/ui/lib/core-access.js';
import { createHome, isHome, paths, loadConfig } from '../src/core/home.mjs';
import { migrateWorkspace, coreHealth, MOVE_STATE, CONFLICTS_DIR } from '../src/core/core-folder.mjs';
import { git } from '../src/core/workspace.mjs';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
const bases = [];
after(() => { for (const b of bases) fs.rmSync(b, { recursive: true, force: true, maxRetries: 5 }); });
const newBase = () => { const b = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-core-')); bases.push(b); return b; };
const put = (p, text = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const read = (p) => fs.readFileSync(p, 'utf8');

test('un espacio nuevo: core (oculta en Windows) y las seis categorías, nada más arriba', () => {
  const { home, created } = createHome(newBase(), { userName: 'Ana' });
  assert.equal(created, true);
  assert.deepEqual(fs.readdirSync(home).sort(), ['android', 'core', 'ios', 'linux', 'multi', 'web', 'windows']);
  const p = paths(home);
  for (const f of [p.config, p.key, p.generalLog]) assert.ok(fs.statSync(f).isFile(), f);
  for (const d of [p.data, p.runs, p.worktrees, p.checkpoints, p.projectLogs, p.skills, p.mcp, p.tools, p.secrets]) assert.ok(fs.statSync(d).isDirectory(), d);
  assert.equal(p.adb, path.join(home, 'core', 'herramientas', 'adb'));
  assert.ok(isHome(home));
  assert.equal(migrateWorkspace(home), null, 'nada que mover');
  assert.deepEqual(coreHealth(home), { ok: false, missing: ['db'] }, 'la base aún no se ha abierto');
  if (process.platform === 'win32') {
    const out = spawnSync('attrib', [p.core], { encoding: 'latin1' }).stdout;
    const attrs = out.slice(0, out.toLowerCase().indexOf(p.core.toLowerCase()));
    assert.ok(attrs.includes('S') && attrs.includes('H'), `core oculta y de sistema: ${out}`);
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
  db.exec('CREATE TABLE tasks (id INTEGER PRIMARY KEY, workdir TEXT, n INTEGER); CREATE TABLE chat (id INTEGER PRIMARY KEY, body TEXT, meta TEXT); CREATE TABLE projects (name TEXT, path TEXT)');
  db.prepare('INSERT INTO tasks (id, workdir, n) VALUES (7, ?, 1)').run(copy);
  db.prepare('INSERT INTO chat (body, meta) VALUES (?, ?)').run(`Mira ${old('imagenes', 'foto.png')}`, JSON.stringify({ images: [old('imagenes', 'foto.png')], log: path.join(home, 'bitacora', 'GENERAL.md') }));
  db.prepare('INSERT INTO projects (name, path) VALUES (?, ?), (?, ?)').run('tienda', project, 'bitacora-web', path.join(home, 'web', 'bitacora-web'));
  db.close();
  return { home, project, copy };
}

test('un espacio de 3.7 pasa a core una vez: carpetas, rutas de orb.json y de la base, y las copias aisladas siguen funcionando', () => {
  const { home, project } = orb37();
  assert.ok(isHome(home), 'orb.json arriba también es un espacio (se mueve al arrancar)');
  const r = migrateWorkspace(home);
  assert.equal(r.moved.length, 5);
  const p = paths(home);
  assert.deepEqual(fs.readdirSync(home).sort(), ['android', 'bots', 'core', 'web'], 'arriba solo quedan las categorías (y lo que archiva la migración de la base)');
  assert.equal(read(path.join(p.data, 'clave.bin')), 'k'.repeat(32));
  assert.equal(read(path.join(p.core, 'imagenes', 'foto.png')), 'png');
  assert.match(read(p.generalLog), /entrada de 3.7/);
  assert.ok(fs.existsSync(path.join(p.projectLogs, 'tienda.md')));
  assert.equal(read(path.join(p.mcp, 'correo', 'index.js')), '// servidor');
  assert.equal(read(path.join(p.adb, 'adb.exe')), 'adb');
  assert.deepEqual(fs.readdirSync(path.join(home, 'android')), [], 'android queda como categoría');
  // orb.json: the account's folder and the connector's script, in core.
  const c = loadConfig(home);
  assert.equal(c.accounts.find((a) => a.id === 'codex-2').home, path.join(p.core, 'cuentas', 'codex-2'));
  assert.deepEqual(c.mcpServers[0].args, [path.join(p.mcp, 'correo', 'index.js')]);
  // The database: plain text and JSON text; a project whose name only looks like an old folder is left alone.
  const db = new DatabaseSync(p.db, { readOnly: true });
  const copy = path.join(p.worktrees, 'tienda-7');
  assert.equal(db.prepare('SELECT workdir FROM tasks').get().workdir, copy);
  const chat = db.prepare('SELECT body, meta FROM chat').get();
  assert.equal(chat.body, `Mira ${path.join(p.core, 'imagenes', 'foto.png')}`);
  assert.deepEqual(JSON.parse(chat.meta), { images: [path.join(p.core, 'imagenes', 'foto.png')], log: p.generalLog });
  assert.equal(db.prepare("SELECT path FROM projects WHERE name = 'bitacora-web'").get().path, path.join(home, 'web', 'bitacora-web'));
  db.close();
  // The isolated copy is still a working git worktree of its project, at its new place.
  assert.equal(git(copy, 'status', '--porcelain').status, 0);
  assert.match(git(project, 'worktree', 'list', '--porcelain').stdout.replace(/\\/g, '/'), new RegExp(copy.replace(/\\/g, '/').replace(/[.*+?^${}()|[\]]/g, '\\$&'), 'i'));
  assert.ok(!fs.existsSync(path.join(p.core, MOVE_STATE)), 'terminado');
  assert.equal(migrateWorkspace(home), null, 'la segunda vez no hace nada');
});

test('un traslado que se cortó a medias lo termina el siguiente arranque, sin perder ni pisar nada', () => {
  const { home } = orb37();
  const p = paths(home);
  // As if Orb stopped after moving .orb (its note went with it) but before orb.json, the logs and the paths.
  fs.writeFileSync(path.join(home, '.orb', MOVE_STATE), '{"v":1}');
  fs.renameSync(path.join(home, '.orb'), p.core);
  // A file copied into core before the stop (the same) and one that differs (kept aside, never lost).
  put(path.join(p.mcp, 'correo', 'index.js'), '// servidor');
  put(path.join(p.logs, 'proyectos', 'tienda.md'), '# tienda\n\n### de core\n');
  const r = migrateWorkspace(home);
  assert.ok(r.rewritten.db >= 2, 'las rutas de la base, aunque .orb ya estuviera movida');
  assert.ok(!fs.existsSync(path.join(home, 'mcp-servers')) && !fs.existsSync(path.join(home, 'bitacora')) && !fs.existsSync(path.join(home, 'orb.json')));
  assert.equal(read(path.join(p.mcp, 'correo', 'index.js')), '// servidor');
  assert.match(read(path.join(p.projectLogs, 'tienda.md')), /### de core/, 'una bitácora no se pisa: crece');
  assert.equal(loadConfig(home).accounts.find((a) => a.id === 'codex-2').home, path.join(p.core, 'cuentas', 'codex-2'));
  assert.ok(!fs.existsSync(path.join(p.core, MOVE_STATE)));
  assert.equal(migrateWorkspace(home), null);
});

test('si no se puede renombrar (archivo abierto, otro disco): copia, comprueba, cambia y borra lo viejo', () => {
  const { home } = orb37();
  const p = paths(home);
  fs.mkdirSync(path.join(p.core, 'datos'), { recursive: true });
  put(path.join(p.core, 'datos', 'clave.bin'), 'otra clave distinta, ya en core');
  const rename = fs.renameSync;
  // Every rename of an old folder or file into core fails; switching a checked copy in (*.copia) and putting an old file
  // aside still work.
  const olds = ['.orb', 'orb.json', 'bitacora', 'mcp-servers', 'android'].map((n) => path.join(home, n));
  fs.renameSync = (from, to) => { if (olds.some((o) => String(from).startsWith(o)) && !String(to).includes(CONFLICTS_DIR)) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); return rename(from, to); };
  let r; try { r = migrateWorkspace(home); } finally { fs.renameSync = rename; }
  assert.ok(r.moved.length >= 4);
  assert.ok(!fs.existsSync(path.join(home, '.orb')) && !fs.existsSync(path.join(home, 'orb.json')));
  assert.equal(read(path.join(p.core, 'imagenes', 'foto.png')), 'png');
  assert.equal(read(path.join(p.core, 'ejecuciones', '7', 'registro.jsonl')), '{}\n');
  assert.equal(read(path.join(p.data, 'clave.bin')), 'otra clave distinta, ya en core', 'lo de core manda');
  const aside = fs.readdirSync(path.join(p.core, CONFLICTS_DIR));
  assert.equal(read(path.join(p.core, CONFLICTS_DIR, aside[0], '.orb', 'datos', 'clave.bin')), 'k'.repeat(32), 'lo viejo distinto queda aparte');
  assert.ok(!fs.readdirSync(p.data).some((n) => n.endsWith('.copia')), 'sin copias a medias');
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
      await e.call('backup.recovery', { code: 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH' });
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
  assert.deepEqual(coreView({ missing: true, home: 'C:\Orb', reason: 'noBackup', folder: 'X' }), { body: 'data.core.noBackup', vars: { home: 'C:\Orb' }, passphrase: false, restore: false, folder: 'X' });
  const v = coreView({ reason: 'needsPassphrase', backup: { created: '2026-11-07T03:00:00Z' } }, { when: (d) => d.slice(0, 10) });
  assert.deepEqual([v.body, v.vars.created, v.passphrase, v.restore], ['data.core.needsPassphrase', '2026-11-07', true, true]);
  assert.equal(coreView({ reason: 'damaged', backup: {} }).body, 'data.core.damaged');
});
