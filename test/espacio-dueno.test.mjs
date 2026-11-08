// 3.8 (F3a-fix): the owner's real C:\Orb as it is today (android\{adb-tools, family365}, ios\, web\, windows\,
// bitacora\ with files that are not Orb's, mcp-servers\gmail-multi-mcp\ — a server he writes — and personal\, no .orb)
// and what Orb does with it: nothing moves without the user's choice, a kept bitacora is used where it is, his MCP server
// becomes a project (never part of core), personal\ is left alone and unlisted. Then the backups: only core comes back,
// from the newest copy of this workspace that opens; what Orb keeps outside the workspace is kept from the agents.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startEngine, until } from './helpers.mjs';
import { createHome, paths, loadConfig, writeJson, merge, homeKey, isHome } from '../src/core/home.mjs';
import { planWorkspace, applyLayout, rewriteDb, LAYOUT_FILE, keepBackupsOutside } from '../src/core/core-folder.mjs';
import * as K from '../src/core/backup.mjs';
import { setGuardedRoots, isOrbData, decide } from '../src/core/guard.mjs';
import { cursorRules } from '../src/agents/cursor.mjs';
import { scrubVaultedSecrets, ARCHIVE_DIR, ORIGINAL_CONFIG, PRE_COPY } from '../src/core/migrate-38.mjs';
import { refOf } from '../src/core/connector-secrets.mjs';
import { layoutOptions } from '../src/ui/lib/core-access.js';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
const bases = [];
const readOnly = [];
after(() => {
  for (const f of readOnly) { try { fs.chmodSync(f, 0o666); } catch { /* gone */ } }
  for (const b of bases) fs.rmSync(b, { recursive: true, force: true, maxRetries: 5 });
});
const newBase = () => { const b = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-dueno-')); bases.push(b); return b; };
const put = (p, text = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const read = (p) => fs.readFileSync(p, 'utf8');
const SECRET = 'ab'.repeat(32);
const OFF = Object.fromEntries(['claude', 'codex', 'cursor', 'gemini', 'opencode', 'qwen', 'copilot'].map((a) => [a, { enabled: false }]));

// The owner's C:\Orb, shape for shape.
function ownersOrb() {
  const base = newBase();
  const home = path.join(base, 'Orb');
  const at = (...p) => path.join(home, ...p);
  put(at('android', 'adb-tools', 'adb.exe'), 'adb');
  put(at('android', 'family365', 'build.gradle'), 'g');
  fs.mkdirSync(at('ios'), { recursive: true });
  put(at('web', 'tienda', 'index.html'), '<p>');
  put(at('web', 'borrado', 'index.html'), '<p>');
  put(at('web', 'notas.md'), 'suelto');
  put(at('windows', 'open-control-edge', 'README.md'), 'oce');
  put(at('windows', 'programas.txt'), 'suelto');
  put(at('bitacora', 'GENERAL.md'), '# Bitácora general\n\n### entrada del dueño\n');
  put(at('bitacora', 'anexos.md'), 'anexos');
  put(at('bitacora', 'bitacora_project.md'), 'índice central');
  fs.chmodSync(at('bitacora', 'bitacora_project.md'), 0o444); readOnly.push(at('bitacora', 'bitacora_project.md'));
  put(at('bitacora', 'archivo', 'viejo.md'), 'viejo');
  put(at('bitacora', 'proyectos', 'tienda.md'), '# tienda\n');
  const gmail = at('mcp-servers', 'gmail-multi-mcp');
  put(path.join(gmail, 'package.json'), JSON.stringify({ name: 'gmail-multi-mcp', main: 'src/index.js', dependencies: { '@modelcontextprotocol/sdk': '1.0.0' } }));
  put(path.join(gmail, 'src', 'index.js'), '// servidor');
  put(path.join(gmail, 'credentials', 'client.json'), '{"secreto":1}');
  put(path.join(gmail, 'tokens', 'cuenta.json'), '{"token":1}');
  put(path.join(gmail, 'AGENTS.md'), 'normas'); put(path.join(gmail, 'BITACORA.md'), 'bitácora');
  put(at('personal', 'diario.md'), 'mío');
  return { base, home, at, gmail };
}
const quiet = (home) => writeJson(paths(home).config, merge(loadConfig(home), { agents: OFF }));

test('la bienvenida en el C:\\Orb del dueño: no mueve nada, pregunta, y lo que elige se cumple', async () => {
  const { base, home, at } = ownersOrb();
  assert.ok(!isHome(home), 'sin .orb ni orb.json no es un espacio de 3.7');
  assert.equal(createHome(base, { userName: 'Dani' }).home, home);
  quiet(home);
  for (const f of [['bitacora', 'bitacora_project.md'], ['android', 'adb-tools', 'adb.exe'], ['mcp-servers', 'gmail-multi-mcp', 'tokens', 'cuenta.json'], ['personal', 'diario.md']]) assert.ok(fs.existsSync(at(...f)), `sigue: ${f.join('/')}`);
  assert.ok(!fs.existsSync(path.join(home, 'core', LAYOUT_FILE)), 'nada decidido');
  const p = paths(home);
  assert.equal(p.logs, at('bitacora'), 'la bitácora del dueño se usa donde está');
  assert.equal(p.adb, at('android', 'adb-tools'));
  assert.match(read(p.generalLog), /entrada del dueño/);
  // What the window lists, with its defaults: his bitacora into core (3.8.1: the owner's definition; the window warns
  // that his rules for agents may read the old path), adb into core, his MCP server is a project (in windows).
  const plan = planWorkspace(home);
  assert.deepEqual(plan.items.map((it) => [it.id, it.choice, it.project]), [['bitacora', 'move', false], ['adb', 'move', false], ['mcp:gmail-multi-mcp', 'windows', true]]);
  const gmailItem = plan.items[2];
  assert.ok(!gmailItem.choices.includes('mcp'), 'un servidor que escribe el usuario nunca va a core');
  assert.deepEqual(layoutOptions(gmailItem).map((o) => o.value), ['windows', 'linux', 'ios', 'android', 'web', 'multi', 'keep']);
  assert.throws(() => applyLayout(home, { 'mcp:gmail-multi-mcp': 'mcp' }), /no vale/);

  const e = await startEngine(home, { secret: SECRET });
  try {
    const lp = await e.call('app.layoutPlan');
    assert.equal(lp.pending, true);
    const names = (await e.call('projects.list')).map((x) => x.name).sort();
    assert.deepEqual(names, ['borrado', 'family365', 'open-control-edge', 'tienda'], 'ni personal, ni adb-tools, ni el servidor aún, ni archivos sueltos');
    // He keeps his bitacora where it is (his global rules read it there) and moves the rest.
    const after = await e.call('app.layoutApply', { choices: { bitacora: 'keep', adb: 'move', 'mcp:gmail-multi-mcp': 'windows' } });
    assert.equal(after.pending, false);
    assert.ok(fs.existsSync(at('bitacora', 'bitacora_project.md')) && !fs.existsSync(at('core', 'bitacora', 'bitacora_project.md')));
    assert.throws(() => fs.writeFileSync(at('bitacora', 'bitacora_project.md'), 'x'), 'sigue siendo de solo lectura');
    assert.equal(read(at('core', 'herramientas', 'adb', 'adb.exe')), 'adb');
    assert.equal(read(at('windows', 'gmail-multi-mcp', 'tokens', 'cuenta.json')), '{"token":1}');
    assert.ok(!fs.existsSync(at('mcp-servers')) && !fs.existsSync(at('core', 'mcp', 'gmail-multi-mcp')));
    assert.equal(read(at('personal', 'diario.md')), 'mío');
    await until(async () => (await e.call('projects.list')).some((x) => x.name === 'gmail-multi-mcp'), 'el servidor, como proyecto');
    assert.ok(!(await e.call('projects.list')).some((x) => x.name === 'personal'));
    // Ajustes › MCP offers it from its project folder.
    const folder = await e.call('mcp.folder');
    const mine = folder.projects.find((s) => s.name === 'gmail-multi-mcp');
    assert.deepEqual([mine?.command, mine?.args], ['node', [at('windows', 'gmail-multi-mcp', 'src', 'index.js')]]);
    assert.ok(!folder.projects.some((s) => s.name === 'tienda'), 'solo los proyectos que son servidores MCP');
    assert.equal(paths(home).logs, at('bitacora'));
  } finally { await e.stop(); }
  // A kept folder is not asked about again.
  assert.equal(planWorkspace(home).pending, false);
  assert.equal(planWorkspace(home).items.find((it) => it.id === 'bitacora').kept, true);

  // Backups: core gone → only core comes back; a project the user deleted stays deleted; his bitacora is not touched.
  let f = await startEngine(home, { secret: SECRET });
  try { await f.call('backup.now', {}); } finally { await f.stop(); }
  fs.rmSync(at('web', 'borrado'), { recursive: true });
  put(at('bitacora', 'GENERAL.md'), '# Bitácora general\n\n### entrada del dueño\n\n### después de la copia\n');
  fs.rmSync(at('core'), { recursive: true, force: true, maxRetries: 10 });
  f = await startEngine(home, { secret: SECRET });
  try {
    assert.equal(await f.call('app.coreState'), null);
    assert.ok(!fs.existsSync(at('web', 'borrado')), 'lo borrado por el usuario no vuelve');
    assert.match(read(at('bitacora', 'GENERAL.md')), /después de la copia/, 'su bitácora, intacta');
    assert.ok(!fs.existsSync(at('core', 'bitacora', 'GENERAL.md')), 'la bitácora que guardó arriba no se duplica en core');
    assert.ok(fs.existsSync(paths(home).config));
  } finally { await f.stop(); }
});

test('3.8.1: un «Dejar donde está» de 3.8.0 en la bitácora se pregunta una vez más (por defecto, a core) y Orb dice la ruta nueva', async () => {
  const { base, home, at } = ownersOrb();
  createHome(base, { userName: 'Dani' });
  quiet(home);
  // What 3.8.0 left: his bitacora kept at the top (no logsAsked), the rest moved.
  applyLayout(home, { bitacora: 'keep', adb: 'move', 'mcp:gmail-multi-mcp': 'windows' });
  const file = path.join(home, 'core', LAYOUT_FILE);
  const saved = JSON.parse(read(file)); delete saved.logsAsked; writeJson(file, saved);
  const plan = planWorkspace(home);
  assert.equal(plan.pending, true, 'se vuelve a preguntar');
  assert.deepEqual(plan.items.filter((it) => !it.kept).map((it) => [it.id, it.choice]), [['bitacora', 'move']], 'solo la bitácora, con «Mover a core»');
  const e = await startEngine(home, { secret: SECRET });
  try {
    const r = await e.call('app.layoutApply', { choices: { bitacora: 'move' } });
    assert.equal(r.pending, false);
    assert.deepEqual(r.logsMoved, { dir: at('core', 'bitacora'), files: ['anexos.md', 'bitacora_project.md'].map((n) => at('core', 'bitacora', n)) }, 'la ruta exacta de sus archivos, para AGENTS.md');
    assert.equal(read(at('core', 'bitacora', 'bitacora_project.md')), 'índice central');
    assert.match(read(at('core', 'bitacora', 'GENERAL.md')), /entrada del dueño/);
    assert.ok(!fs.existsSync(at('bitacora')));
    assert.equal(paths(home).generalLog, at('core', 'bitacora', 'GENERAL.md'), 'lo que escriben los agentes, en core');
    // The general log reached from Orb (logs.read: what the window and the agents' tools read).
    assert.match(await e.call('logs.read', { project: 'general' }), /entrada del dueño/);
  } finally { await e.stop(); }
  assert.equal(planWorkspace(home).pending, false, 'no se vuelve a preguntar');

  // Kept again in 3.8.1: respected for good.
  const other = ownersOrb();
  createHome(other.base, { userName: 'Dani' });
  applyLayout(other.home, { bitacora: 'keep', adb: 'move', 'mcp:gmail-multi-mcp': 'windows' });
  assert.equal(planWorkspace(other.home).pending, false);
  assert.ok(fs.existsSync(other.at('bitacora', 'bitacora_project.md')));
});

test('la copia que vuelve: la más nueva de ESTE espacio que se pueda abrir; ultima.json no lleva a otras carpetas', async () => {
  const base = newBase();
  const { home } = createHome(base);
  const other = createHome(fs.mkdtempSync(path.join(base, 'otro-'))).home;
  const A = Buffer.from(SECRET, 'hex'); const B = Buffer.from('cd'.repeat(32), 'hex');
  const day = (d) => new Date(`2026-11-0${d}T03:00:00Z`);
  const good = await K.createBackup({ home, secret: A, kind: 'daily', now: day(1) });
  await K.createBackup({ home, secret: B, kind: 'daily', now: day(2) }); // this workspace, but sealed by another PC
  await K.createBackup({ home: other, secret: A, kind: 'daily', folder: K.defaultBackupDir(home), now: day(3) }); // another workspace, same PC
  fs.rmSync(paths(home).core, { recursive: true, force: true });
  const r = await K.repairCore(home, { secret: A });
  assert.equal(r.ok, true);
  assert.equal(r.restored.from, path.basename(good.file), 'ni la de otro espacio ni la que este PC no abre');
  // With none that opens, the window asks for the code of the newest one of this workspace.
  fs.rmSync(paths(home).core, { recursive: true, force: true });
  const none = await K.repairCore(home, { secret: Buffer.from('ef'.repeat(32), 'hex') });
  assert.equal(none.reason, 'needsPassphrase'); assert.match(none.backup.file, /20261102/);
  // A note that points to a network share or another folder is not followed.
  const last = path.join(K.defaultBackupDir(home), 'ultima.json');
  writeJson(last, { ...JSON.parse(read(last)), file: '\\\\servidor\\copias\\orb.orbbak', folders: ['\\\\servidor\\copias'] });
  assert.ok(!K.knownBackupDirs(home).some((d) => d.startsWith('\\\\')));
});

test('dos espacios nunca comparten nombre fuera (ni con rutas largas); las copias de los primeros 3.8 se adoptan', () => {
  assert.notEqual(homeKey('C:\\a-b\\Orb'), homeKey('C:\\a\\b\\Orb'));
  assert.equal(homeKey('C:\\Orb'), homeKey('c:\\orb'));
  assert.match(homeKey(`C:\\${'carpeta-larga\\'.repeat(30)}Orb`), /^orb-[0-9a-f]{8}$/);
  const base = newBase();
  const { home } = createHome(base);
  const old = path.join(K.backupRoot(), path.resolve(home).replace(/[:\\/]+/g, '-').replace(/^-+|-+$/g, ''));
  put(path.join(old, 'orb-x.orbbak'), 'copia'); put(path.join(old, 'ultima.json'), JSON.stringify({ file: path.join(old, 'orb-x.orbbak'), folders: [old] }));
  fs.rmSync(K.defaultBackupDir(home), { recursive: true, force: true });
  assert.equal(K.adoptOldBackupRoot(home), true);
  assert.equal(read(path.join(K.defaultBackupDir(home), 'orb-x.orbbak')), 'copia');
  assert.equal(JSON.parse(read(path.join(K.defaultBackupDir(home), 'ultima.json'))).file, path.join(K.defaultBackupDir(home), 'orb-x.orbbak'));
});

test('copias de 3.7 en una carpeta elegida dentro de .orb: no se borran y los ajustes se pueden guardar', () => {
  const { home } = createHome(newBase());
  const p = paths(home);
  const inside = path.join(p.core, 'copias-seguridad');
  writeJson(p.config, merge(loadConfig(home), { backup: { folder: inside } }));
  put(path.join(inside, 'orb-20261101-030000Z-daily.orbbak'), 'copia de 3.7');
  const n = K.adoptOldBackups(home, loadConfig(home));
  assert.equal(n, 1);
  assert.equal(read(path.join(K.defaultBackupDir(home), 'orb-20261101-030000Z-daily.orbbak')), 'copia de 3.7', 'a la carpeta de siempre, no borrada');
  assert.equal(keepBackupsOutside(home), true);
  assert.equal(loadConfig(home).backup?.folder, undefined, 'la carpeta dentro del espacio se olvida');
  assert.equal(K.backupDir(home, { backup: { folder: path.join(home, 'web', 'copias') } }), K.defaultBackupDir(home), 'nunca dentro del espacio');
});

test('«Seguir sin copia»: las copias que había se apartan y la limpieza no las borra', async () => {
  const { home } = createHome(newBase());
  const A = Buffer.from(SECRET, 'hex');
  for (let d = 1; d <= 9; d++) await K.createBackup({ home, secret: A, kind: 'daily', now: new Date(`2026-10-0${d}T03:00:00Z`) });
  const dir = K.defaultBackupDir(home);
  assert.equal(K.setAsideBackups(home), 9);
  assert.deepEqual(await K.listBackups(dir), []);
  await K.pruneBackups(dir);
  const aside = fs.readdirSync(dir).find((n) => n.startsWith('antes-de-empezar-de-nuevo-'));
  assert.equal(fs.readdirSync(path.join(dir, aside)).filter((n) => n.endsWith('.orbbak')).length, 9);
  assert.equal(await K.latestBackup(home), null, 'ninguna vuelve sola');
});

test('lo que Orb guarda fuera del espacio (copias, claves) queda vetado a los agentes; adb por su ruta, permitido', () => {
  const internal = path.join(os.tmpdir(), 'Orb', 'core');
  const copies = path.join(os.tmpdir(), 'AppData', 'Local', 'Orb', 'copias');
  const keys = path.join(os.tmpdir(), 'AppData', 'Roaming', 'Orb.dev', 'claves');
  setGuardedRoots([copies, keys]);
  try {
    assert.ok(isOrbData(path.join(copies, 'Orb-1234abcd', 'orb-x.orbbak'), internal, os.tmpdir()));
    assert.ok(isOrbData(path.join(keys, 'Orb-1234abcd.enc'), internal, os.tmpdir()));
    assert.ok(isOrbData(path.join(internal, 'datos', 'orb.db'), internal, os.tmpdir()));
    assert.ok(!isOrbData(path.join(internal, 'herramientas', 'adb', 'adb.exe'), internal, os.tmpdir()), 'adb por su ruta completa');
    assert.ok(!isOrbData(path.join(internal, 'copias', 'aisladas', 'x', 'a.txt'), internal, os.tmpdir()));
    const v = decide({ permission: 'editar', tool: 'Bash', command: `del /q "${path.join(copies, 'Orb-1234abcd')}\\*.orbbak"`, paths: [], patterns: [], internalDir: internal, cwd: os.tmpdir() });
    assert.equal(v.decision, 'deny');
    assert.equal(decide({ permission: 'editar', tool: 'Bash', command: `"${path.join(internal, 'herramientas', 'adb', 'adb.exe')}" devices`, paths: [], patterns: [], internalDir: internal, cwd: os.tmpdir() }).decision, 'allow');
    const rules = cursorRules('editar', internal);
    assert.ok(rules.includes(`Read(${copies}/**)`) && rules.includes(`Write(${keys}/**)`));
  } finally { setGuardedRoots([]); }
});

test('los secretos que ya están en el almacén salen enseguida del archivo de 3.7 y de las copias de su base', () => {
  const { home } = createHome(newBase());
  const p = paths(home);
  const archive = path.join(p.core, ARCHIVE_DIR, ORIGINAL_CONFIG);
  put(archive, JSON.stringify({ mcpServers: [{ name: 'correo', command: 'node', env: { TOKEN: 'clave-del-dueno', OTRA: 'no-esta' } }] }));
  const copy = path.join(p.data, PRE_COPY);
  const db = new DatabaseSync(copy);
  db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); INSERT INTO settings VALUES ('remote_keys', '{\"priv\":\"CLAVE-PRIVADA-DEL-PC\"}'), ('otra', '1')");
  db.close();
  const vault = new Set(['mcp/correo/TOKEN', 'remote_keys']);
  assert.equal(scrubVaultedSecrets(home, { inVault: (id) => vault.has(id) }), 2);
  assert.deepEqual(JSON.parse(read(archive)).mcpServers[0].env, { TOKEN: refOf('correo', 'TOKEN'), OTRA: 'no-esta' }, 'lo que no está en el almacén se queda');
  const after = new DatabaseSync(copy, { readOnly: true });
  try { assert.deepEqual(after.prepare('SELECT key FROM settings').all().map((r) => r.key), ['otra']); } finally { after.close(); }
  assert.ok(!fs.readFileSync(copy).includes('CLAVE-PRIVADA-DEL-PC'), 'ni en páginas libres');
  assert.equal(scrubVaultedSecrets(home, { inVault: (id) => vault.has(id) }), 0, 'una vez');
});

test('rutas en la base: lo que escribió el usuario se queda como lo escribió', () => {
  const { home } = createHome(newBase());
  const file = path.join(newBase(), 'b.db');
  const db = new DatabaseSync(file);
  const from = path.join(home, 'mcp-servers', 'correo'); const to = path.join(home, 'windows', 'correo');
  db.exec('CREATE TABLE session_items (role TEXT, kind TEXT, body TEXT); CREATE TABLE session_queue (text TEXT)');
  db.prepare("INSERT INTO session_items VALUES ('user', 'text', ?), ('assistant', 'text', ?)").run(`abre ${from}\\index.js`, `abierto ${from}\\index.js`);
  db.prepare('INSERT INTO session_queue VALUES (?)').run(`y luego ${from}\\x`);
  db.close();
  rewriteDb(file, home, [{ from, to }]);
  const d = new DatabaseSync(file, { readOnly: true });
  try {
    assert.deepEqual(d.prepare('SELECT role, body FROM session_items').all().map((r) => [r.role, r.body]), [['user', `abre ${from}\\index.js`], ['assistant', `abierto ${to}\\index.js`]]);
    assert.equal(d.prepare('SELECT text FROM session_queue').get().text, `y luego ${from}\\x`);
  } finally { d.close(); }
});

test('la copia del secreto fuera del espacio nunca se pisa con otro; un clave.enc ilegible no gana a la copia buena', async () => {
  const { loadApprovalSecret } = await import('../src/main/approval-secret.mjs');
  const base = newBase();
  const dir = path.join(base, 'datos'); const copy = path.join(base, 'claves', 'orb-1234abcd.enc');
  const seal = (hex) => Buffer.from(`S${hex}`); const unseal = (b) => { const s = b.toString(); if (!s.startsWith('S')) throw new Error('no abre'); return s.slice(1); };
  const good = 'a1'.repeat(32); const other = 'b2'.repeat(32);
  // core lost its clave.enc, and it cannot be read (damaged, or another Windows user's): the good copy wins.
  put(copy, `S${good}`); put(path.join(dir, 'clave.enc'), 'basura');
  assert.equal(loadApprovalSecret({ dir, copy, seal, unseal }), good);
  assert.equal(read(path.join(dir, 'clave.enc')), `S${good}`);
  assert.ok(fs.readdirSync(dir).some((n) => /^clave\..*\.ilegible\.enc$/.test(n) && read(path.join(dir, n)) === 'basura'), 'el ilegible, aparte');
  // A clave.enc with another secret: the copy that had the old one is put aside, not overwritten.
  put(path.join(dir, 'clave.enc'), `S${other}`);
  assert.equal(loadApprovalSecret({ dir, copy, seal, unseal }), other);
  assert.equal(read(copy), `S${other}`);
  assert.ok(fs.readdirSync(path.dirname(copy)).some((n) => n !== path.basename(copy) && read(path.join(path.dirname(copy), n)) === `S${good}`), 'la copia vieja se conserva');
});
