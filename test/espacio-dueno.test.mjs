// 3.8 (F3a-fix): the owner's real C:\Orb as it is today (android\{adb-tools, family365}, ios\, web\, windows\,
// bitacora\ with files that are not Orb's, mcp-servers\gmail-multi-mcp\ — a server he writes — and personal\, no .orb)
// and what Orb does with it: nothing moves without the user's choice, a kept bitacora is used where it is, his MCP server
// goes into core\mcp by default (3.8.1; he may still make it a project), personal\ is left alone and unlisted. Then the backups: only core comes back,
// from the newest copy of this workspace that opens; what Orb keeps outside the workspace is kept from the agents.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startEngine, until } from './helpers.mjs';
import { createHome } from '../src/domain/workspace/home.mjs';
import { paths, writeJson, homeKey, isHome } from '../src/platform/paths.mjs';
import { loadConfig, merge } from '../src/platform/config-file.mjs';
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
  // that his rules for agents may read the old path), adb into core, and (3.8.1: every MCP server lives in core) his MCP
  // server into core\mcp too; a category is still a choice.
  const plan = planWorkspace(home);
  assert.deepEqual(plan.items.map((it) => [it.id, it.choice, it.project]), [['bitacora', 'move', false], ['adb', 'move', false], ['mcp:gmail-multi-mcp', 'mcp', true]]);
  const gmailItem = plan.items[2];
  assert.deepEqual(layoutOptions(gmailItem).map((o) => o.value), ['mcp', 'windows', 'linux', 'ios', 'android', 'web', 'multi', 'keep']);

  const e = await startEngine(home, { secret: SECRET });
  try {
    const lp = await e.call('app.layoutPlan');
    assert.equal(lp.pending, true);
    const names = (await e.call('projects.list')).map((x) => x.name).sort();
    assert.deepEqual(names, ['borrado', 'family365', 'open-control-edge', 'tienda'], 'ni personal, ni adb-tools, ni el servidor aún, ni archivos sueltos');
    // He keeps his bitacora where it is (his global rules read it there) and makes his server a project (as 3.8.0 did).
    const after = await e.call('app.layoutApply', { choices: { bitacora: 'keep', adb: 'move', 'mcp:gmail-multi-mcp': 'windows' } });
    assert.equal(after.pending, false);
    assert.deepEqual(after.serversMoved, [{ from: at('mcp-servers', 'gmail-multi-mcp'), to: at('windows', 'gmail-multi-mcp') }], 'Orb dice la ruta nueva del servidor (H1c M8)');
    assert.ok(fs.existsSync(at('bitacora', 'bitacora_project.md')) && !fs.existsSync(at('core', 'bitacora', 'bitacora_project.md')));
    assert.throws(() => fs.writeFileSync(at('bitacora', 'bitacora_project.md'), 'x'), 'sigue siendo de solo lectura');
    assert.equal(read(at('core', 'herramientas', 'adb', 'adb.exe')), 'adb');
    assert.equal(read(at('windows', 'gmail-multi-mcp', 'tokens', 'cuenta.json')), '{"token":1}');
    assert.ok(!fs.existsSync(at('mcp-servers')) && !fs.existsSync(at('core', 'mcp', 'gmail-multi-mcp')));
    assert.equal(read(at('personal', 'diario.md')), 'mío');
    await until(async () => (await e.call('projects.list')).some((x) => x.name === 'gmail-multi-mcp'), 'el servidor, como proyecto');
    assert.ok(!(await e.call('projects.list')).some((x) => x.name === 'personal'));
    // Ajustes › Skills y MCP offers it from its project folder (to use it there, or move it into core).
    const folder = await e.call('extensions.list');
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
    assert.deepEqual(r.logsMoved, { dir: at('core', 'bitacora'), files: ['anexos.md', 'bitacora_project.md'].map((n) => at('core', 'bitacora', n)), readOnly: [at('core', 'bitacora', 'bitacora_project.md')] }, 'la ruta exacta de sus archivos, para AGENTS.md, y cuáles son de solo lectura');
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

// 3.8.1 (H1c): every MCP server lives in core\mcp. The owner's 3.8.0 made his gmail-multi-mcp a project in windows\
// (and Ajustes › MCP used it from there): Orb 3.8.1 offers it once to move into core\mcp (by default), it keeps working
// (its connector points to the new place, its tokens go with it) and is no longer a project; the answer is final.
test('3.8.1: el servidor MCP que 3.8.0 dejó como proyecto en windows se ofrece una vez para moverlo a core\\mcp', async () => {
  const { base, home, at } = ownersOrb();
  createHome(base, { userName: 'Dani' });
  quiet(home);
  applyLayout(home, { bitacora: 'move', adb: 'move', 'mcp:gmail-multi-mcp': 'windows' });
  // What 3.8.0 left: carpetas.json without mcpAsked, and the server used from its project.
  const file = path.join(home, 'core', LAYOUT_FILE);
  const saved = JSON.parse(read(file)); delete saved.mcpAsked; writeJson(file, saved);
  writeJson(paths(home).config, merge(loadConfig(home), { mcpServers: [{ name: 'gmail', command: 'node', args: [at('windows', 'gmail-multi-mcp', 'src', 'index.js')], enabled: true }] }));
  put(at('windows', 'tienda-web', 'package.json'), JSON.stringify({ name: 'tienda', main: 'index.js' })); put(at('windows', 'tienda-web', 'index.js'));
  const plan = planWorkspace(home);
  assert.equal(plan.pending, true);
  assert.deepEqual(plan.items.filter((it) => !it.kept).map((it) => [it.id, it.choice, it.choices]), [['mcpProject:windows/gmail-multi-mcp', 'mcp', ['mcp', 'keep']]], 'solo su servidor (no cualquier proyecto con package.json)');
  const e = await startEngine(home, { secret: SECRET });
  try {
    await until(async () => (await e.call('projects.list')).some((x) => x.name === 'gmail-multi-mcp'), 'aún es un proyecto');
    const r = await e.call('app.layoutApply', { choices: { 'mcpProject:windows/gmail-multi-mcp': 'mcp' } });
    assert.equal(r.pending, false);
    assert.equal(read(at('core', 'mcp', 'gmail-multi-mcp', 'tokens', 'cuenta.json')), '{"token":1}');
    assert.ok(!fs.existsSync(at('windows', 'gmail-multi-mcp')));
    const cfg = loadConfig(home);
    assert.deepEqual(cfg.mcpServers.find((s) => s.name === 'gmail').args, [at('core', 'mcp', 'gmail-multi-mcp', 'src', 'index.js')], 'sigue funcionando: su conector apunta a core');
    const l = await e.call('extensions.list');
    assert.deepEqual(l.mcp.map((s) => [s.name, s.connector, s.enabled]), [['gmail-multi-mcp', 'gmail', true]]);
    await until(async () => !(await e.call('projects.list')).some((x) => x.name === 'gmail-multi-mcp'), 'deja de ser un proyecto');
  } finally { await e.stop(); }
  assert.equal(planWorkspace(home).pending, false, 'no se vuelve a preguntar');
  // «Dejar donde está» is final too, and a workspace set up by 3.8.1 is never asked about its projects.
  const other = ownersOrb();
  createHome(other.base, { userName: 'Dani' });
  applyLayout(other.home, { bitacora: 'move', adb: 'move', 'mcp:gmail-multi-mcp': 'windows' });
  assert.equal(planWorkspace(other.home).pending, false, 'hecho por 3.8.1: ya está decidido');
  const f2 = path.join(other.home, 'core', LAYOUT_FILE); const s2 = JSON.parse(read(f2)); delete s2.mcpAsked; writeJson(f2, s2);
  applyLayout(other.home, { 'mcpProject:windows/gmail-multi-mcp': 'keep' });
  assert.equal(planWorkspace(other.home).pending, false);
  assert.ok(fs.existsSync(other.at('windows', 'gmail-multi-mcp', 'src', 'index.js')));
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
  const win = process.platform === 'win32'; const abs = (...parts) => (win ? 'C:\\' : '/') + parts.join(path.sep);
  assert.notEqual(homeKey(abs('a-b', 'Orb')), homeKey(abs('a', 'b', 'Orb')));
  if (win) assert.equal(homeKey('C:\\Orb'), homeKey('c:\\orb')); // Windows' paths: any case
  assert.match(homeKey(abs(...Array(30).fill('carpeta-larga'), 'Orb')), /^orb-[0-9a-f]{8}$/);
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
    // 3.8.2 (review A2): Orb's adb runs in the engine: readable, closed to everything else.
    assert.ok(isOrbData(path.join(internal, 'herramientas', 'adb', 'adb.exe'), internal, os.tmpdir()), 'adb por su ruta completa');
    assert.ok(!isOrbData(path.join(internal, 'herramientas', 'adb', 'adb.exe'), internal, os.tmpdir(), { read: true }), 'leerlo sí');
    assert.ok(!isOrbData(path.join(internal, 'copias', 'aisladas', 'x', 'a.txt'), internal, os.tmpdir()));
    const v = decide({ permission: 'editar', tool: 'Bash', command: `del /q "${path.join(copies, 'Orb-1234abcd')}\\*.orbbak"`, paths: [], patterns: [], internalDir: internal, cwd: os.tmpdir() });
    assert.equal(v.decision, 'deny');
    // 3.8.2 (review A2): Orb's own adb is never run by an agent, whatever the permission (agents use orb_android_*).
    const adbRun = { tool: 'Bash', command: `"${path.join(internal, 'herramientas', 'adb', 'adb.exe')}" devices`, paths: [], patterns: [], internalDir: internal, cwd: os.tmpdir() };
    assert.equal(decide({ ...adbRun, permission: 'editar' }).decision, 'deny');
    assert.equal(decide({ ...adbRun, permission: 'total', android: true }).decision, 'deny');
    const rules = cursorRules('editar', internal);
    assert.ok(rules.includes(`Read(${copies}/**)`) && rules.includes(`Write(${keys}/**)`));
  } finally { setGuardedRoots([]); }
});

// 3.8.1 (Tauri D-fix, review D4 M5): the folder Orb is installed in (per user: writable by any program of the user) is
// read-only for the agents: its node.exe and engine code run with all of Orb's secrets.
test('la carpeta de instalación de Orb: los agentes pueden leerla, nunca escribir ni ejecutar lo que nombra', async () => {
  const { appInstallDir } = await import('../src/engine/workspace-layout.mjs');
  const { setAppRoots } = await import('../src/core/guard.mjs');
  const base = newBase();
  const install = path.join(base, 'Programs', 'Orb'); put(path.join(install, 'node', 'node.exe')); put(path.join(install, 'app', 'src', 'mcp', 'server.mjs'));
  assert.equal(appInstallDir({ ORB_NODE: path.join(install, 'node', 'node.exe') }), install);
  assert.equal(appInstallDir({ ORB_NODE: path.join(base, 'target', 'release', 'node', 'node.exe') }), null, 'una compilación del código');
  assert.equal(appInstallDir({ ORB_NODE: 'C:\\herramientas\\node.exe' }), null);
  const internal = path.join(base, 'Orb', 'core');
  setAppRoots([install]);
  try {
    const node = path.join(install, 'node', 'node.exe');
    assert.ok(isOrbData(node, internal, base));
    assert.ok(!isOrbData(node, internal, base, { read: true }), 'leer, sí');
    const ask = (tool, command, paths = []) => decide({ permission: 'editar', tool, command, paths, patterns: [], internalDir: internal, cwd: base }).decision;
    assert.equal(ask('Read', '', [path.join(install, 'app', 'src', 'mcp', 'server.mjs')]), 'allow');
    assert.equal(ask('Write', '', [path.join(install, 'app', 'src', 'mcp', 'server.mjs')]), 'deny');
    assert.equal(ask('Bash', `copy evil.exe "${node}"`), 'deny');
    assert.equal(ask('Bash', `del /q ${install}\\Orb.exe`), 'deny');
  } finally { setAppRoots([]); }
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
  db.prepare("INSERT INTO session_items VALUES ('user', 'text', ?), ('assistant', 'text', ?)").run(`abre ${from}${path.sep}index.js`, `abierto ${from}${path.sep}index.js`);
  db.prepare('INSERT INTO session_queue VALUES (?)').run(`y luego ${from}${path.sep}x`);
  db.close();
  rewriteDb(file, home, [{ from, to }]);
  const d = new DatabaseSync(file, { readOnly: true });
  try {
    assert.deepEqual(d.prepare('SELECT role, body FROM session_items').all().map((r) => [r.role, r.body]), [['user', `abre ${from}${path.sep}index.js`], ['assistant', `abierto ${to}${path.sep}index.js`]]);
    assert.equal(d.prepare('SELECT text FROM session_queue').get().text, `y luego ${from}${path.sep}x`);
  } finally { d.close(); }
});

// 3.8.1 (Tauri): ORB2 in its own files beside Electron's v10, typed errors, atomic writes: test/clave-compatible.test.mjs.
