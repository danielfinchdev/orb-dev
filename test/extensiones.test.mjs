// 3.8.1 (H1c): skills and MCP servers live in core (src/core/extensions.mjs, src/engine/api-extensions.mjs): what Orb
// lists and checks, how the skills that are on reach the agents (a plugin for Claude, an extra root for Codex, the brief
// for the others), importing from a folder (off until turned on), removing after the master password, an agent's
// request (a folder in core\preparacion, the user's approval of exactly those files) and improving a server of core in a
// project. All in temporary folders.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { tempHome, startEngine, ROOT, fake, until } from './helpers.mjs';
import * as X from '../src/core/extensions.mjs';
import { decide } from '../src/core/guard.mjs';
import { rebindMoved, bindingOf } from '../src/core/connector-secrets.mjs';
import { Board } from '../src/core/board.mjs';
import { mcpServersFor } from '../src/engine/sessions.mjs';
import { createProject } from '../src/core/projects.mjs';
import { translate } from '../src/core/i18n.mjs';
import { METHODS, UNLOCK_METHODS, needsUnlock } from '../src/core/permissions.mjs';
import * as codex from '../src/agents/codex.mjs';
import * as claude from '../src/agents/claude.mjs';

const tr = (k, v) => translate('es', k, v);
const tmp = [];
after(() => { for (const d of tmp) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 }); });
const scratch = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-ext-')); tmp.push(d); return d; };
const put = (p, text = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const skillAt = (dir, name, description = 'Revisa facturas y avisa de las que faltan.') => { put(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\nPasos.\n`); put(path.join(dir, 'scripts', 'paso.py'), 'print(1)'); return dir; };
const serverAt = (dir, name) => { put(path.join(dir, 'package.json'), JSON.stringify({ name, description: `Servidor ${name}`, main: 'src/index.js' })); put(path.join(dir, 'src', 'index.js'), '// servidor'); return dir; };
const PASS = 'una frase larga de prueba';

test('qué es cada carpeta: SKILL.md con nombre y descripción, o un servidor que Orb sabe arrancar; sin enlaces fuera', () => {
  const d = scratch();
  const s = skillAt(path.join(d, 'facturas'), 'facturas');
  assert.deepEqual(X.checkSkill(s, { tr }), { name: 'facturas', description: 'Revisa facturas y avisa de las que faltan.' });
  assert.equal(X.kindOf(s), 'skill');
  // A description over several lines (YAML «>»), and a quoted one.
  put(path.join(d, 'larga', 'SKILL.md'), '---\nname: larga\ndescription: >\n  Primera línea\n  y segunda.\n---\n');
  assert.equal(X.skillMeta(path.join(d, 'larga')).description, 'Primera línea y segunda.');
  put(path.join(d, 'mala', 'SKILL.md'), '---\nname: Mala Skill\ndescription: x\n---\n');
  assert.throws(() => X.checkSkill(path.join(d, 'mala'), { tr }), /no vale como nombre de skill/);
  put(path.join(d, 'sin', 'SKILL.md'), '---\nname: sin\n---\n');
  assert.throws(() => X.checkSkill(path.join(d, 'sin'), { tr }), /Falta la descripción/);
  const m = serverAt(path.join(d, 'correo-mcp'), 'correo-mcp');
  assert.equal(X.kindOf(m), 'mcp');
  assert.deepEqual(X.checkMcp(m, { tr }), { command: 'node', args: [path.join(m, 'src', 'index.js')], description: 'Servidor correo-mcp' });
  put(path.join(d, 'nada', 'notas.txt'));
  assert.equal(X.kindOf(path.join(d, 'nada')), null);
  // A link (a junction on Windows) out of the folder: refused, also on import.
  const out = path.join(d, 'fuera'); put(path.join(out, 'secreto.txt'));
  fs.symlinkSync(out, path.join(s, 'enlace'), 'junction');
  assert.throws(() => X.checkSkill(s, { tr }), /enlace a otra carpeta \(enlace\)/);
  assert.equal(X.mcpNameOf('https://github.com/ana/Mi Servidor.git'.split('/').pop()), 'mi-servidor');
});

test('la guardia: las skills de core se leen; ejecutar uno de sus scripts pregunta; cambiarlas, nunca; core\\preparacion está abierta', () => {
  const core = path.join(os.tmpdir(), 'OrbGuardia', 'core');
  const at = (...p) => path.join(core, ...p);
  const d = (o) => decide({ permission: 'editar', internalDir: core, cwd: path.join(os.tmpdir(), 'OrbGuardia', 'web', 'a'), ...o });
  assert.equal(d({ tool: 'Read', paths: [at('skills', 'x', 'SKILL.md')] }).decision, 'allow');
  assert.equal(d({ tool: 'Grep', patterns: [at('skills', '**')] }).decision, 'allow');
  assert.equal(d({ tool: 'Bash', command: `python ${at('skills', 'x', 'scripts', 'a.py')}` }).decision, 'ask');
  for (const command of [`rm -rf ${at('skills', 'x')}`, `Remove-Item ${at('skills', 'x')} -Recurse`, `echo hola > ${at('skills', 'x', 'SKILL.md')}`, `python ${at('skills', 'x', 'a.py')} ${at('datos', 'orb.db')}`]) {
    assert.equal(d({ tool: 'Bash', command }).decision, 'deny', command);
  }
  assert.match(d({ tool: 'Edit', paths: [at('skills', 'x', 'SKILL.md')] }).reason, /orb_create_skill/);
  assert.equal(decide({ permission: 'leer', tool: 'Bash', command: `python ${at('skills', 'x', 'a.py')}`, internalDir: core }).decision, 'deny');
  assert.equal(d({ tool: 'Edit', paths: [at('preparacion', 'skill-a-1', 'SKILL.md')] }).decision, 'allow');
  assert.equal(d({ tool: 'Bash', command: `npm install --prefix ${at('preparacion', 'mcp-a-1')}` }).decision, 'allow');
  assert.equal(d({ tool: 'Read', paths: [at('mcp', 'x', 'tokens.json')] }).decision, 'deny', 'los servidores de core no se leen');
  assert.equal(d({ tool: 'Read', paths: [at('datos', 'orb.db')] }).decision, 'deny');
});

test('lo que cargan los agentes: un plugin de Orb con un enlace por skill activa; se rehace al cambiar', () => {
  const core = path.join(scratch(), 'core');
  skillAt(path.join(core, 'skills', 'facturas'), 'facturas');
  skillAt(path.join(core, 'skills', 'informes'), 'informes', 'Hace informes semanales.');
  let live = X.exposeSkills(core, { skills: [{ name: 'facturas', enabled: true }, { name: 'informes', enabled: false }] });
  assert.deepEqual(live.list.map((s) => s.name), ['facturas']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(live.plugin, '.claude-plugin', 'plugin.json'), 'utf8')).name, 'orb-skills');
  const link = path.join(live.root, 'facturas');
  assert.ok(fs.lstatSync(link).isSymbolicLink() || fs.statSync(link).isDirectory());
  assert.equal(fs.readFileSync(path.join(link, 'SKILL.md'), 'utf8'), fs.readFileSync(path.join(core, 'skills', 'facturas', 'SKILL.md'), 'utf8'));
  assert.ok(!fs.existsSync(path.join(live.root, 'informes')));
  live = X.exposeSkills(core, { skills: [{ name: 'informes', enabled: true }] });
  assert.deepEqual(fs.readdirSync(live.root).sort(), ['informes']);
  assert.ok(fs.existsSync(path.join(core, 'skills', 'facturas', 'SKILL.md')), 'quitar el enlace nunca borra la skill');
  // The brief of an agent without skills of its own names each one and its SKILL.md.
  const brief = X.skillsBrief(live.list);
  assert.match(brief, /## Skills de Orb/); assert.ok(brief.includes(path.join(core, 'skills', 'informes', 'SKILL.md')));
  assert.equal(X.skillsBrief([]), '');
  assert.equal(claude.nativeSkills, true); assert.equal(codex.nativeSkills, true);
});

test('Claude recibe el plugin (--plugin-dir) y Codex la carpeta extra de skills antes de empezar el hilo', async () => {
  const d = scratch();
  const core = path.join(d, 'core');
  skillAt(path.join(core, 'skills', 'facturas'), 'facturas');
  const skills = X.exposeSkills(core, { skills: [{ name: 'facturas', enabled: true }] });
  const file = path.join(d, 'claude-args.json');
  const c = claude.createLive({ exe: { cmd: fake('fake-claude.mjs'), pre: [] }, cwd: d, env: { FAKE_ARGS_FILE: file }, mcpServers: {}, skills });
  const log = path.join(d, 'codex.log');
  const x = codex.createLive({ exe: { cmd: process.execPath, pre: [fake('fake-codex-app.mjs')] }, cwd: d, permission: 'editar', env: { FAKE_LOG: log }, mcpServers: {}, skills });
  try {
    await c.send({ text: 'hola' });
    const seen = await until(() => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }, 'Claude falso');
    assert.equal(seen.args[seen.args.indexOf('--plugin-dir') + 1], skills.plugin);
    const r = await x.send({ text: 'hola' });
    assert.equal(r.isError, false, r.final);
    const sent = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const roots = sent.findIndex((m) => m.method === 'skills/extraRoots/set');
    assert.deepEqual(sent[roots].params, { extraRoots: [skills.root] });
    assert.ok(roots < sent.findIndex((m) => m.method === 'thread/start'), 'antes del hilo');
  } finally { c.close?.(); x.close?.(); }
});

test('permisos: todo en el PC; quitar pide la contraseña maestra', () => {
  for (const m of ['extensions.list', 'extensions.toggle', 'extensions.import', 'extensions.remove', 'extensions.approve', 'extensions.reject', 'extensions.edit', 'extensions.adopt', 'extensions.applyCheck', 'extensions.apply']) assert.equal(METHODS[m], 'pc', m);
  assert.ok(UNLOCK_METHODS.has('extensions.remove') && needsUnlock('extensions.remove', {}));
  assert.equal(needsUnlock('extensions.import', {}), false);
  assert.equal(METHODS['mcp.folder'], undefined, 'Ajustes › Skills y MCP lo sustituye');
});

test('Ajustes › Skills y MCP: importar (inactivo), activar, llega a los agentes y quitar con la contraseña', async () => {
  const h = tempHome();
  const src = scratch();
  skillAt(path.join(src, 'facturas'), 'facturas');
  serverAt(path.join(src, 'Correo MCP'), 'correo');
  const e = await startEngine(h.home);
  try {
    const empty = await e.call('extensions.list');
    assert.deepEqual([empty.skills, empty.mcp, empty.pending], [[], [], []]);
    assert.equal(empty.dirs.skills, path.join(h.home, 'core', 'skills'));
    const s = await e.call('extensions.import', { from: path.join(src, 'facturas') });
    assert.deepEqual([s.kind, s.name], ['skill', 'facturas']);
    const m = await e.call('extensions.import', { from: path.join(src, 'Correo MCP') });
    assert.deepEqual([m.kind, m.name], ['mcp', 'correo-mcp']);
    let l = m.list;
    assert.deepEqual(l.skills.map((x) => [x.name, x.enabled, x.source]), [['facturas', false, 'importado']], 'entra inactiva');
    assert.deepEqual(l.mcp.map((x) => [x.name, x.enabled, x.startable]), [['correo-mcp', false, true]]);
    assert.ok(fs.existsSync(path.join(h.home, 'core', 'skills', 'facturas', 'scripts', 'paso.py')));
    assert.ok(fs.existsSync(path.join(src, 'facturas', 'SKILL.md')), 'importar copia, no mueve');
    await assert.rejects(e.call('extensions.import', { from: path.join(src, 'facturas') }), /Ya hay una skill «facturas»/);
    await assert.rejects(e.call('extensions.import', { url: 'file:///C:/repo' }), /Solo se importan repositorios con dirección https/);
    await assert.rejects(e.call('extensions.import', { url: 'ext::sh -c calc' }), /Solo se importan repositorios/);
    await assert.rejects(e.call('extensions.import', { from: path.join(h.home, 'core', 'skills', 'facturas') }), /ya está dentro de core/);
    // On: the skill reaches the agents' plugin; the server gets its connector, started from its folder in core.
    l = await e.call('extensions.toggle', { kind: 'skill', name: 'facturas', enabled: true });
    assert.equal(l.skills[0].enabled, true);
    assert.ok(fs.existsSync(path.join(h.home, 'core', 'skills', '.activas', 'skills', 'facturas', 'SKILL.md')));
    l = await e.call('extensions.toggle', { kind: 'mcp', name: 'correo-mcp', enabled: true });
    const cfg = JSON.parse(fs.readFileSync(path.join(h.home, 'core', 'orb.json'), 'utf8'));
    const conn = cfg.mcpServers.find((x) => x.name === 'correo-mcp');
    assert.deepEqual([conn.command, conn.args, conn.enabled, conn.source], ['node', [path.join(h.home, 'core', 'mcp', 'correo-mcp', 'src', 'index.js')], true, 'importado']);
    assert.deepEqual(cfg.skills, [{ name: 'facturas', enabled: true, source: 'importado' }]);
    l = await e.call('extensions.toggle', { kind: 'mcp', name: 'correo-mcp', enabled: false });
    assert.equal(l.mcp[0].enabled, false);
    // Removing deletes from core: the master password first.
    await assert.rejects(e.call('extensions.remove', { kind: 'skill', name: 'facturas' }), /contraseña maestra/);
    const { unlock } = await e.call('master.create', { password: PASS });
    l = await e.call('extensions.remove', { kind: 'skill', name: 'facturas', unlock });
    assert.deepEqual(l.skills, []);
    assert.ok(!fs.existsSync(path.join(h.home, 'core', 'skills', 'facturas')));
    assert.ok(!fs.existsSync(path.join(h.home, 'core', 'skills', '.activas', 'skills', 'facturas')));
    l = await e.call('extensions.remove', { kind: 'mcp', name: 'correo-mcp', unlock });
    assert.deepEqual(l.mcp, []);
    assert.ok(!JSON.parse(fs.readFileSync(path.join(h.home, 'core', 'orb.json'), 'utf8')).mcpServers.some((x) => x.name === 'correo-mcp'));
  } finally { await e.stop(); h.cleanup(); }
});

test('una tarea de Cursor (sin skills propias) recibe la lista en su encargo', async () => {
  const h = tempHome({ agents: { cursor: { enabled: true } } });
  skillAt(path.join(h.home, 'core', 'skills', 'facturas'), 'facturas');
  const { Scheduler } = await import('../src/engine/scheduler.mjs');
  const { saveConfig } = await import('../src/core/context.mjs');
  saveConfig({ skills: [{ name: 'facturas', enabled: true }] });
  const board = new Board();
  try {
    createProject(board, { name: 'web' }, 'usuario');
    const task = board.createTask({ project: 'web', title: 'Algo', description: 'Haz algo', launch: 'manual', agent: 'cursor' }, 'usuario');
    const s = Object.create(Scheduler.prototype); s.board = board;
    const brief = (agent) => s.promptFor(task, board.project('web'), { cwd: board.project('web').path, folder: true }, agent);
    assert.match(brief('cursor'), /## Skills de Orb\n[\s\S]*- facturas: Revisa facturas/);
    assert.ok(!brief('claude').includes('## Skills de Orb'), 'Claude las carga él mismo');
  } finally { board.db.close(); h.cleanup(); }
});

// ---- made by an agent
function mcpClient(home, server) {
  const child = spawn(server.command, server.args, { env: { ...process.env, ORB_HOME: home, ...server.env }, stdio: ['pipe', 'pipe', 'inherit'] });
  const replies = new Map(); let n = 0;
  readline.createInterface({ input: child.stdout }).on('line', (l) => { const m = JSON.parse(l); replies.get(m.id)?.(m); });
  const rpc = (method, params) => new Promise((r) => { const id = ++n; replies.set(id, r); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  return {
    rpc,
    call: async (name, args) => { const r = (await rpc('tools/call', { name, arguments: args })).result; return { error: Boolean(r.isError), text: r.content[0].text }; },
    close: () => child.stdin.end()
  };
}

test('desde el chat: el agente prepara la skill en core\\preparacion, pide activarla y el usuario aprueba esos mismos archivos', async () => {
  const h = tempHome();
  const board = new Board();
  const conv = board.createConversation({ title: 'Skills', project: null }).id;
  const boss = mcpClient(h.home, mcpServersFor('claude', { orchestrator: true, browser: false, session: `asistente-${conv}`, conversation: conv }).orb);
  const other = mcpClient(h.home, mcpServersFor('codex', { session: 'otra-sesion' }).orb);
  let id; let dir;
  try {
    await boss.rpc('initialize', {}); await other.rpc('initialize', {});
    const tools = (await boss.rpc('tools/list', {})).result.tools.map((x) => x.name);
    for (const name of ['orb_create_skill', 'orb_create_mcp', 'orb_request_activation']) assert.ok(tools.includes(name), name);
    const bad = await boss.call('orb_create_skill', { name: 'Mal Nombre', description: 'x' });
    assert.equal(bad.error, true);
    const made = await boss.call('orb_create_skill', { name: 'revisar-facturas', description: 'Revisa las facturas del mes.' });
    assert.equal(made.error, false, made.text);
    ({ id, carpeta: dir } = JSON.parse(made.text));
    assert.equal(path.dirname(dir), path.join(h.home, 'core', 'preparacion'));
    assert.match(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'), /name: revisar-facturas\ndescription: Revisa las facturas del mes\./);
    // The agent writes there (the guard lets it) and asks; another agent cannot ask for it.
    assert.equal(decide({ permission: 'editar', tool: 'Write', paths: [path.join(dir, 'SKILL.md')], internalDir: path.join(h.home, 'core'), cwd: h.home }).decision, 'allow');
    fs.appendFileSync(path.join(dir, 'SKILL.md'), '1. Abre la carpeta de facturas.\n');
    assert.match((await other.call('orb_request_activation', { id })).text, /no existe o no es tuya/);
    const asked = await boss.call('orb_request_activation', { id });
    assert.equal(asked.error, false, asked.text);
    const card = board.all('SELECT body, meta, conversation_id FROM chat').map((r) => ({ ...r, meta: JSON.parse(r.meta) })).find((r) => r.meta?.kind === 'extension');
    assert.equal(card.conversation_id, conv);
    assert.deepEqual([card.meta.extension, card.meta.name, card.meta.status, card.meta.files], [id, 'revisar-facturas', 'pending', ['SKILL.md']]);
    assert.match(card.body, /ha preparado la skill «revisar-facturas»/);
  } finally { boss.close(); other.close(); board.db.close(); }
  const e = await startEngine(h.home);
  try {
    const l = await e.call('extensions.list');
    assert.deepEqual(l.pending.map((r) => [r.id, r.kind, r.name]), [[id, 'skill', 'revisar-facturas']]);
    assert.ok(!l.skills.length, 'nada en core antes de aprobar');
    // A change after asking: refused (the user approves what was asked), the card stays.
    fs.appendFileSync(path.join(dir, 'SKILL.md'), 'Y borra todo.\n');
    await assert.rejects(e.call('extensions.approve', { id }), /ha cambiado desde que se pidió/);
    // Same files again (as asked): approved, in core and on.
    const text = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8').replace('Y borra todo.\n', '');
    fs.writeFileSync(path.join(dir, 'SKILL.md'), text);
    const after = await e.call('extensions.approve', { id });
    assert.deepEqual(after.skills.map((s) => [s.name, s.enabled, s.source]), [['revisar-facturas', true, 'creado']]);
    assert.deepEqual(after.pending, []);
    assert.ok(!fs.existsSync(dir), 'sale de core\\preparacion');
    assert.match(fs.readFileSync(path.join(h.home, 'core', 'skills', 'revisar-facturas', 'SKILL.md'), 'utf8'), /Abre la carpeta de facturas/);
    const b2 = new Board();
    try { assert.equal(b2.all('SELECT meta FROM chat').map((r) => JSON.parse(r.meta)).find((m) => m?.kind === 'extension').status, 'approved', 'la tarjeta dice cómo acabó'); } finally { b2.db.close(); }
    await assert.rejects(e.call('extensions.approve', { id }), /no existe/);
  } finally { await e.stop(); h.cleanup(); }
});

test('un servidor nuevo desde el chat, uno descartado, y mejorar uno de core (versión nueva aprobada)', async () => {
  const h = tempHome();
  const core = path.join(h.home, 'core');
  const board = new Board();
  const conv = board.createConversation({ title: 'MCP', project: null }).id;
  const boss = mcpClient(h.home, mcpServersFor('claude', { orchestrator: true, browser: false, session: `asistente-${conv}`, conversation: conv }).orb);
  let nuevo; let tirar;
  try {
    await boss.rpc('initialize', {});
    nuevo = JSON.parse((await boss.call('orb_create_mcp', { name: 'tiempo', description: 'Da el tiempo.', lenguaje: 'python' })).text);
    assert.deepEqual(nuevo.archivos, ['pyproject.toml', 'server.py']);
    assert.equal((await boss.call('orb_request_activation', { id: nuevo.id })).error, false);
    tirar = JSON.parse((await boss.call('orb_create_skill', { name: 'tirar', description: 'No sirve.' })).text);
    assert.equal((await boss.call('orb_request_activation', { id: tirar.id })).error, false);
    // A new version of a server of core starts from its current copy (dependencies too).
    serverAt(path.join(core, 'mcp', 'correo'), 'correo'); put(path.join(core, 'mcp', 'correo', 'node_modules', 'dep', 'index.js'), 'dep');
    assert.match((await boss.call('orb_create_mcp', { name: 'nuevo-que-no-existe', description: 'x', mejorar: true })).text, /No se encuentra/);
    const mejora = JSON.parse((await boss.call('orb_create_mcp', { name: 'correo', description: 'Correo mejorado', mejorar: true })).text);
    assert.ok(fs.existsSync(path.join(mejora.carpeta, 'node_modules', 'dep', 'index.js')));
    fs.writeFileSync(path.join(mejora.carpeta, 'src', 'index.js'), '// versión 2');
    assert.equal((await boss.call('orb_request_activation', { id: mejora.id })).error, false);
  } finally { boss.close(); board.db.close(); }
  const e = await startEngine(h.home);
  try {
    let l = await e.call('extensions.approve', { id: nuevo.id });
    const t = l.mcp.find((s) => s.name === 'tiempo');
    assert.deepEqual([t.enabled, t.source, t.args], [true, 'creado', [path.join(core, 'mcp', 'tiempo', 'server.py')]]);
    l = await e.call('extensions.reject', { id: tirar.id });
    assert.ok(!fs.existsSync(tirar.carpeta) && !l.skills.some((s) => s.name === 'tirar'));
    const id = l.pending.find((r) => r.name === 'correo').id;
    l = await e.call('extensions.approve', { id });
    assert.equal(fs.readFileSync(path.join(core, 'mcp', 'correo', 'src', 'index.js'), 'utf8'), '// versión 2');
    assert.equal(fs.readFileSync(path.join(core, 'mcp', '.anterior', 'correo', 'src', 'index.js'), 'utf8'), '// servidor', 'la de antes se guarda');
    assert.ok(!l.mcp.some((s) => s.name === '.anterior'));
  } finally { await e.stop(); h.cleanup(); }
});

test('mejorar un servidor de core en un proyecto: «Editar en un proyecto» y «Aplicar cambios»', async () => {
  const h = tempHome();
  const core = path.join(h.home, 'core');
  serverAt(path.join(core, 'mcp', 'gmail-multi-mcp'), 'gmail-multi-mcp');
  put(path.join(core, 'mcp', 'gmail-multi-mcp', 'tokens', 'cuenta.json'), '{"token":1}');
  const e = await startEngine(h.home);
  try {
    await e.call('extensions.toggle', { kind: 'mcp', name: 'gmail-multi-mcp', enabled: true });
    await assert.rejects(e.call('extensions.applyCheck', { name: 'gmail-multi-mcp' }), /no tiene una copia en un proyecto/);
    const r = await e.call('extensions.edit', { name: 'gmail-multi-mcp', category: 'windows' });
    assert.equal(r.path, path.join(h.home, 'windows', 'gmail-multi-mcp'));
    assert.equal(r.project, 'gmail-multi-mcp');
    assert.deepEqual(await e.call('extensions.edit', { name: 'gmail-multi-mcp', category: 'web' }), r, 'una sola copia en edición');
    let l = await e.call('extensions.list');
    assert.equal(l.mcp[0].editing, r.path);
    assert.equal(l.projects.find((p) => p.dir === r.path).editOf, 'gmail-multi-mcp');
    fs.writeFileSync(path.join(r.path, 'src', 'index.js'), '// mejorado');
    put(path.join(r.path, 'src', 'nuevo.js'), '// nuevo');
    fs.rmSync(path.join(r.path, 'tokens'), { recursive: true });
    const check = await e.call('extensions.applyCheck', { name: 'gmail-multi-mcp' });
    assert.deepEqual([check.added, check.changed, check.removed], [['src/nuevo.js'], ['src/index.js'], ['tokens/cuenta.json']]);
    l = await e.call('extensions.apply', { name: 'gmail-multi-mcp' });
    assert.equal(fs.readFileSync(path.join(core, 'mcp', 'gmail-multi-mcp', 'src', 'index.js'), 'utf8'), '// mejorado');
    assert.equal(fs.readFileSync(path.join(core, 'mcp', '.anterior', 'gmail-multi-mcp', 'tokens', 'cuenta.json'), 'utf8'), '{"token":1}');
    assert.equal(l.mcp[0].enabled, true, 'sigue activo');
    assert.ok(fs.existsSync(r.path), 'el proyecto sigue para seguir mejorándolo');
  } finally { await e.stop(); h.cleanup(); }
});

test('las claves de un conector que Orb mueve siguen con él; uno cambiado por otro, no', () => {
  const store = new Map();
  const master = { unlocked: () => true, get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v) };
  const old = { name: 'gmail', command: 'node', args: ['C:\\Orb\\windows\\gmail\\src\\index.js'], env: { TOKEN: 'orb-secret:mcp/gmail/TOKEN' } };
  const moved = { ...old, args: ['C:\\Orb\\core\\mcp\\gmail\\src\\index.js'] };
  store.set('mcpbind/gmail', bindingOf(old));
  assert.equal(rebindMoved(master, [old], [moved]), 1);
  assert.equal(store.get('mcpbind/gmail'), bindingOf(moved));
  // Held already (its command had changed without the password): moving it does not free its keys.
  store.set('mcpbind/gmail', 'otra cosa');
  assert.equal(rebindMoved(master, [moved], [{ ...moved, args: ['x'] }]), 0);
  assert.equal(rebindMoved({ unlocked: () => false }, [old], [moved]), 0);
});

test('«Mover a core» desde Ajustes: un proyecto que es servidor MCP pasa a core\\mcp con su conector', async () => {
  const h = tempHome();
  const dir = serverAt(path.join(h.home, 'windows', 'notas-mcp'), 'notas-mcp');
  put(path.join(dir, 'AGENTS.md'), 'normas');
  const e = await startEngine(h.home);
  try {
    await until(async () => (await e.call('projects.list')).some((p) => p.name === 'notas-mcp'), 'el proyecto');
    const listed = (await e.call('extensions.list')).projects;
    assert.deepEqual(listed.map((p) => p.name), ['notas-mcp']);
    await e.call('config.save', { patch: { mcpServers: [{ name: 'notas', command: 'node', args: [path.join(dir, 'src', 'index.js')], enabled: true }] } });
    const l = await e.call('extensions.adopt', { project: 'notas-mcp' });
    assert.ok(fs.existsSync(path.join(h.home, 'core', 'mcp', 'notas-mcp', 'AGENTS.md')) && !fs.existsSync(dir));
    assert.deepEqual(l.mcp.map((s) => [s.name, s.connector, s.enabled]), [['notas-mcp', 'notas', true]]);
    const cfg = JSON.parse(fs.readFileSync(path.join(h.home, 'core', 'orb.json'), 'utf8'));
    assert.deepEqual(cfg.mcpServers[0].args, [path.join(h.home, 'core', 'mcp', 'notas-mcp', 'src', 'index.js')]);
    await until(async () => !(await e.call('projects.list')).some((p) => p.name === 'notas-mcp'), 'deja de ser un proyecto');
  } finally { await e.stop(); h.cleanup(); }
});
