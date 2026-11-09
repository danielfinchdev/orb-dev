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
import { rebindMoved, bindingOf, rebindOrWait, settleRebinds } from '../src/core/connector-secrets.mjs';
import { Master } from '../src/core/master.mjs';
import { Board } from '../src/core/board.mjs';
import { mcpServersFor } from '../src/engine/sessions.mjs';
import { createProject } from '../src/core/projects.mjs';
import { translate } from '../src/shared/i18n.mjs';
import { METHODS, UNLOCK_METHODS, needsUnlock } from '../src/core/permissions.mjs';
import * as codex from '../src/agents/codex.mjs';
import * as claude from '../src/agents/claude.mjs';

const tr = (k, v) => translate('es', k, v);
const tmp = [];
after(() => { for (const d of tmp) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 }); });
const scratch = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-ext-')); tmp.push(d); return d; };
const put = (p, text = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const skillAt = (dir, name, description = 'Revisa facturas y avisa de las que faltan.') => { put(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\nPasos.\n`); put(path.join(dir, 'scripts', 'paso.py'), 'print(1)'); return dir; };
const serverAt = (dir, name) => { put(path.join(dir, 'package.json'), JSON.stringify({ name, description: `Servidor ${name}`, main: 'src/index.js', devDependencies: { '@modelcontextprotocol/sdk': '1.0.0' } })); put(path.join(dir, 'src', 'index.js'), '// servidor'); return dir; };
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

test('lo que cargan los agentes: un plugin de Orb con una copia por skill activa; se rehace al cambiar', () => {
  const core = path.join(scratch(), 'core');
  skillAt(path.join(core, 'skills', 'facturas'), 'facturas');
  skillAt(path.join(core, 'skills', 'informes'), 'informes', 'Hace informes semanales.');
  let live = X.exposeSkills(core, { skills: [{ name: 'facturas', enabled: true }, { name: 'informes', enabled: false }] });
  assert.deepEqual(live.list.map((s) => s.name), ['facturas']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(live.plugin, '.claude-plugin', 'plugin.json'), 'utf8')).name, 'orb-skills');
  const link = path.join(live.root, 'facturas');
  assert.ok(!fs.lstatSync(link).isSymbolicLink() && fs.statSync(link).isDirectory(), 'una copia (H1c-fix2: nunca una unión)');
  assert.equal(fs.readFileSync(path.join(link, 'SKILL.md'), 'utf8'), '---\nname: "facturas"\ndescription: "Revisa facturas y avisa de las que faltan."\n---\n\n# facturas\nPasos.\n');
  assert.ok(!fs.existsSync(path.join(live.root, 'informes')));
  live = X.exposeSkills(core, { skills: [{ name: 'informes', enabled: true }] });
  assert.deepEqual(fs.readdirSync(live.root).sort(), ['informes']);
  assert.ok(fs.existsSync(path.join(core, 'skills', 'facturas', 'SKILL.md')), 'quitar el enlace nunca borra la skill');
  // The brief of an agent without skills of its own names each one and its SKILL.md.
  const brief = X.skillsBrief(live.list);
  assert.match(brief, /## Skills de Orb/); assert.ok(brief.includes(path.join(live.root, 'informes', 'SKILL.md')));
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
    // H1c-fix (checked with the real Claude Code): a skill's !`…` ran without asking canUseTool; it is off now.
    assert.match(seen.args.join(' '), /"disableSkillShellExecution":true/);
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
    await assert.rejects(e.call('extensions.import', { url: 'file:///C:/repo' }), /Esa dirección no vale: usa una https/);
    await assert.rejects(e.call('extensions.import', { url: 'ext::sh -c calc' }), /Esa dirección no vale/);
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
  const { saveConfig } = await import('../src/platform/config.mjs');
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
    // A change after asking never reaches core (H3): what is approved is the quarantine's copy made when it was asked.
    fs.appendFileSync(path.join(dir, 'SKILL.md'), 'Y borra todo.\n');
    put(path.join(dir, 'evil.py'), 'import os');
    assert.equal(l.pending[0].dir.startsWith(path.join(h.home, 'core', 'datos', 'cuarentena')), true, '«Abrir carpeta» abre la copia que se activa');
    const after = await e.call('extensions.approve', { id });
    assert.deepEqual(after.skills.map((s) => [s.name, s.enabled, s.source]), [['revisar-facturas', true, 'creado']]);
    assert.deepEqual(after.pending, []);
    assert.ok(!fs.existsSync(dir), 'sale de core\\preparacion');
    assert.match(fs.readFileSync(path.join(h.home, 'core', 'skills', 'revisar-facturas', 'SKILL.md'), 'utf8'), /Abre la carpeta de facturas/);
    assert.doesNotMatch(fs.readFileSync(path.join(h.home, 'core', 'skills', 'revisar-facturas', 'SKILL.md'), 'utf8'), /borra todo/);
    assert.deepEqual(fs.readdirSync(path.join(h.home, 'core', 'skills', 'revisar-facturas')), ['SKILL.md']);
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
    // A new version of a server of core starts from its current code (not its dependencies: kept from core on approval).
    serverAt(path.join(core, 'mcp', 'correo'), 'correo'); put(path.join(core, 'mcp', 'correo', 'node_modules', 'dep', 'index.js'), 'dep');
    assert.match((await boss.call('orb_create_mcp', { name: 'nuevo-que-no-existe', description: 'x', mejorar: true })).text, /No se encuentra/);
    const mejora = JSON.parse((await boss.call('orb_create_mcp', { name: 'correo', description: 'Correo mejorado', mejorar: true })).text);
    assert.ok(fs.existsSync(path.join(mejora.carpeta, 'src', 'index.js')) && !fs.existsSync(path.join(mejora.carpeta, 'node_modules')));
    put(path.join(mejora.carpeta, 'node_modules', 'dep', 'index.js'), 'lo que el agente instaló'); // never moves
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
    assert.equal(fs.readFileSync(path.join(core, 'mcp', 'correo', 'node_modules', 'dep', 'index.js'), 'utf8'), 'dep', 'sus dependencias de core, no las del agente');
    assert.ok(!l.mcp.some((s) => s.name === '.anterior'));
  } finally { await e.stop(); h.cleanup(); }
});

test('mejorar un servidor de core en un proyecto: «Editar en un proyecto» y «Aplicar cambios»', async () => {
  const h = tempHome();
  const core = path.join(h.home, 'core');
  serverAt(path.join(core, 'mcp', 'gmail-multi-mcp'), 'gmail-multi-mcp');
  put(path.join(core, 'mcp', 'gmail-multi-mcp', 'tokens', 'cuenta.json'), '{"token":1}');
  put(path.join(core, 'mcp', 'gmail-multi-mcp', '.env'), 'CLIENT_SECRET=x');
  put(path.join(core, 'mcp', 'gmail-multi-mcp', 'credentials.json'), '{}');
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
    // H5/M7: its secrets never leave core.
    for (const f of ['tokens', '.env', 'credentials.json']) assert.ok(!fs.existsSync(path.join(r.path, f)), f);
    fs.writeFileSync(path.join(r.path, 'src', 'index.js'), '// mejorado');
    put(path.join(r.path, 'src', 'nuevo.js'), '// nuevo');
    const check = await e.call('extensions.applyCheck', { name: 'gmail-multi-mcp' });
    assert.deepEqual([check.added, check.changed, check.removed], [['src/nuevo.js'], ['src/index.js'], []]);
    // M6: what is applied is what was shown, not what the project has when «Aplicar» is pressed.
    put(path.join(r.path, 'src', 'despues.js'), '// después de revisar');
    await assert.rejects(e.call('extensions.apply', { name: 'gmail-multi-mcp', id: 'otro' }), /ha cambiado desde que lo revisaste/);
    l = await e.call('extensions.apply', { name: 'gmail-multi-mcp', id: check.id });
    assert.equal(fs.readFileSync(path.join(core, 'mcp', 'gmail-multi-mcp', 'src', 'index.js'), 'utf8'), '// mejorado');
    assert.ok(!fs.existsSync(path.join(core, 'mcp', 'gmail-multi-mcp', 'src', 'despues.js')));
    assert.equal(fs.readFileSync(path.join(core, 'mcp', 'gmail-multi-mcp', 'tokens', 'cuenta.json'), 'utf8'), '{"token":1}', 'sus claves siguen en core');
    assert.ok(fs.existsSync(path.join(core, 'mcp', 'gmail-multi-mcp', '.env')));
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
    const { list: l, moved } = await e.call('extensions.adopt', { project: 'notas-mcp' });
    assert.deepEqual(moved, { from: dir, to: path.join(h.home, 'core', 'mcp', 'notas-mcp') }, 'la ruta nueva, para avisar (H1c M8)');
    assert.ok(fs.existsSync(path.join(h.home, 'core', 'mcp', 'notas-mcp', 'AGENTS.md')) && !fs.existsSync(dir));
    assert.deepEqual(l.mcp.map((s) => [s.name, s.connector, s.enabled]), [['notas-mcp', 'notas', true]]);
    const cfg = JSON.parse(fs.readFileSync(path.join(h.home, 'core', 'orb.json'), 'utf8'));
    assert.deepEqual(cfg.mcpServers[0].args, [path.join(h.home, 'core', 'mcp', 'notas-mcp', 'src', 'index.js')]);
    await until(async () => !(await e.call('projects.list')).some((p) => p.name === 'notas-mcp'), 'deja de ser un proyecto');
  } finally { await e.stop(); h.cleanup(); }
});

// ---- H1c-fix: the review's proofs of concept, now refused or harmless
const junction = (target, at) => { fs.mkdirSync(path.dirname(at), { recursive: true }); fs.symlinkSync(target, at, 'junction'); };
const draftSkill = (core, name = 'demo') => { const r = X.draftExtension(core, { kind: 'skill', name, description: 'Una skill de prueba.' }); return r; };

test('C2/H1/H2/H3: pedir activación copia a una cuarentena; uniones, dependencias y cambios posteriores no llegan a core', async () => {
  const core = path.join(scratch(), 'core');
  // PoC1: the staging folder swapped for a junction to a copy of the agent's: refused.
  let r = draftSkill(core);
  const copy = path.join(path.dirname(core), 'proyecto', 'copia'); fs.cpSync(r.dir, copy, { recursive: true });
  fs.rmSync(r.dir, { recursive: true }); junction(copy, r.dir);
  assert.throws(() => X.requestActivation(core, r, { tr }), /enlace a otra carpeta/);
  fs.unlinkSync(r.dir);
  // …and swapped AFTER asking: what moves is the quarantine's copy, a real folder (not a junction) under core\skills.
  r = draftSkill(core, 'demo2');
  let asked = X.requestActivation(core, r, { tr });
  assert.ok(asked.quarantine.startsWith(path.join(core, 'datos', 'cuarentena')));
  fs.rmSync(r.dir, { recursive: true }); fs.cpSync(asked.quarantine, copy + '2', { recursive: true }); junction(copy + '2', r.dir);
  let out = await X.activateRequest(core, {}, asked, { tr });
  assert.equal(fs.lstatSync(out.to).isSymbolicLink(), false, 'core\\skills\\demo2 no es una unión');
  fs.appendFileSync(path.join(copy + '2', 'SKILL.md'), 'cambiado');
  assert.doesNotMatch(fs.readFileSync(path.join(out.to, 'SKILL.md'), 'utf8'), /cambiado/);
  // PoC3: node_modules, __pycache__, .cache and a junction inside node_modules: never copied nor activated.
  r = draftSkill(core, 'demo3');
  put(path.join(r.dir, 'node_modules', 'x.js'), 'malo'); put(path.join(r.dir, '__pycache__', 'a.pyc'), 'malo'); put(path.join(r.dir, '.cache', 'c'), 'malo');
  put(path.join(r.dir, '.npmrc'), 'script-shell=calc.exe');
  junction(path.parse(core).root, path.join(r.dir, 'node_modules', 'out'));
  asked = X.requestActivation(core, r, { tr });
  assert.deepEqual(asked.files, ['SKILL.md']);
  out = await X.activateRequest(core, {}, asked, { tr });
  assert.deepEqual(fs.readdirSync(out.to), ['SKILL.md']);
  assert.ok(!fs.existsSync(r.dir) && fs.existsSync(path.parse(core).root), 'la carpeta de preparación se va; borrar la unión no toca su destino');
  // A junction in a folder that does move: refused, anywhere in the tree.
  r = draftSkill(core, 'demo4');
  junction(path.join(core, 'datos'), path.join(r.dir, 'scripts', 'datos'));
  assert.throws(() => X.requestActivation(core, r, { tr }), /enlace a otra carpeta \(scripts\/datos\)/);
  fs.unlinkSync(path.join(r.dir, 'scripts', 'datos'));
  // The quarantine changed behind Orb's back: refused.
  r = draftSkill(core, 'demo5');
  asked = X.requestActivation(core, r, { tr });
  put(path.join(asked.quarantine, 'extra.md'), 'x');
  await assert.rejects(X.activateRequest(core, {}, asked, { tr }), /ha cambiado/);
});

test('H2: la huella no se puede igualar partiendo un archivo en dos (ruta, tamaño y sha256 por archivo)', () => {
  const d = scratch();
  const base = '---\nname: demo\ndescription: d\n---\n';
  put(path.join(d, 'a', 'SKILL.md'), `${base}\nF evil.py import os`);
  put(path.join(d, 'b', 'SKILL.md'), base); put(path.join(d, 'b', 'evil.py'), 'import os');
  assert.notEqual(X.fingerprint(path.join(d, 'a')), X.fingerprint(path.join(d, 'b')));
  // Same files, same fingerprint (order of creation does not count); an empty folder counts.
  put(path.join(d, 'c', 'evil.py'), 'import os'); put(path.join(d, 'c', 'SKILL.md'), base);
  assert.equal(X.fingerprint(path.join(d, 'b')), X.fingerprint(path.join(d, 'c')));
  fs.mkdirSync(path.join(d, 'c', 'vacia'));
  assert.notEqual(X.fingerprint(path.join(d, 'b')), X.fingerprint(path.join(d, 'c')));
});

test('C1: importar no ejecuta nada (git sin hooks ni submódulos, sin .npmrc); las dependencias se instalan al activar, sin scripts', async () => {
  const core = path.join(scratch(), 'core');
  const calls = [];
  // A fake git: records its arguments and leaves a repository with a server, its .git, an .npmrc and a hook.
  const run = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const to = args[args.length - 1];
    serverAt(to, 'remoto'); put(path.join(to, 'package.json'), JSON.stringify({ name: 'remoto', main: 'src/index.js', dependencies: { left: '1' } }));
    put(path.join(to, '.npmrc'), 'git=calc.exe'); put(path.join(to, '.git', 'hooks', 'post-checkout'), 'calc'); put(path.join(to, '.yarnrc.yml'), 'x');
    return { status: 0, stderr: '' };
  };
  const r = await X.importExtension(core, {}, { url: 'https://example.com/ana/remoto-mcp.git', tr, run });
  const git = calls[0].args;
  assert.equal(calls[0].cmd, 'git');
  for (const a of ['--no-recurse-submodules', 'core.symlinks=false', 'protocol.file.allow=never', 'protocol.ext.allow=never']) assert.ok(git.includes(a), a);
  assert.ok(git.some((a) => a.startsWith('core.hooksPath=')) && git.some((a) => a.startsWith('--template=')));
  assert.ok(git.at(-1).startsWith(path.join(core, 'datos', 'cuarentena')), 'se clona fuera de lo que escriben los agentes');
  assert.equal(calls.length, 1, 'importar no instala nada');
  assert.deepEqual(fs.readdirSync(r.dir).sort(), ['package.json', 'src']);
  assert.equal(X.needsDeps(r.dir), true);
  // Turning it on: npm with --ignore-scripts, and the folder's .npmrc set aside first.
  put(path.join(r.dir, '.npmrc'), 'script-shell=calc.exe');
  const npm = [];
  await X.installFor(core, r.name, { install: (dir) => X.installDeps(dir, { run: async (cmd, args, opts) => { npm.push({ cmd, args, opts }); return { status: 0 }; } }) });
  assert.ok(npm[0].args.includes('--ignore-scripts') && npm[0].args.includes('install'));
  assert.equal(npm[0].opts.env.npm_config_ignore_scripts, 'true');
  assert.ok(!fs.existsSync(path.join(r.dir, '.npmrc')) && fs.existsSync(path.join(r.dir, '.npmrc.ignorado-por-orb')));
});

test('PoC5: importar desde una unión que apunta a core se rechaza; una carpeta que contiene core también', async () => {
  const root = scratch(); const core = path.join(root, 'core');
  skillAt(path.join(core, 'skills', 'facturas'), 'facturas');
  junction(path.join(core, 'skills'), path.join(root, 'atajo'));
  await assert.rejects(X.importExtension(core, {}, { from: path.join(root, 'atajo', 'facturas'), tr }), /ya está dentro de core/);
  await assert.rejects(X.importExtension(core, {}, { from: root, tr }), /ya está dentro de core/);
  fs.unlinkSync(path.join(root, 'atajo'));
});

test('H5: mejorar un servidor con claves pide permiso; la copia nunca lleva secretos y la versión nueva conserva los de core', async () => {
  const core = path.join(scratch(), 'core');
  const dir = serverAt(path.join(core, 'mcp', 'gmail'), 'gmail');
  put(path.join(dir, 'tokens', 'cuenta.json'), '{"t":1}'); put(path.join(dir, '.env'), 'K=1'); put(path.join(dir, 'oauth_token.json'), '{}');
  put(path.join(dir, 'datos', 'propio.key'), 'k'); put(path.join(dir, 'src', 'tokenizer.js'), '// código, no un secreto');
  put(path.join(dir, 'privado', 'x.txt'), 's'); put(path.join(dir, '.orb-secrets'), 'privado/');
  const r = X.draftExtension(core, { kind: 'mcp', name: 'gmail', description: 'Mejor', update: 'gmail', config: {} });
  assert.equal(r.status, 'asking');
  assert.ok(!fs.existsSync(r.dir), 'nada copiado sin permiso');
  const allowed = X.allowDraft(core, r);
  assert.equal(allowed.status, 'drafting');
  for (const f of ['tokens', '.env', 'oauth_token.json', path.join('datos', 'propio.key'), 'privado']) assert.ok(!fs.existsSync(path.join(allowed.dir, f)), f);
  assert.ok(fs.existsSync(path.join(allowed.dir, 'src', 'tokenizer.js')));
  fs.writeFileSync(path.join(allowed.dir, 'src', 'index.js'), '// v2');
  const asked = X.requestActivation(core, allowed, { tr });
  assert.ok(!asked.files.some((f) => /tokens|\.env/.test(f)));
  const out = await X.activateRequest(core, { mcpServers: [] }, asked, { tr });
  assert.equal(fs.readFileSync(path.join(out.to, 'src', 'index.js'), 'utf8'), '// v2');
  assert.equal(fs.readFileSync(path.join(out.to, 'tokens', 'cuenta.json'), 'utf8'), '{"t":1}');
  assert.ok(fs.existsSync(path.join(out.to, '.env')) && fs.existsSync(path.join(out.to, 'privado', 'x.txt')));
  // A server with keys in the vault (its connector's env) counts too; one without keys is copied at once.
  serverAt(path.join(core, 'mcp', 'libre'), 'libre');
  const cfg = { mcpServers: [{ name: 'libre', command: 'node', args: [path.join(core, 'mcp', 'libre', 'src', 'index.js')], env: { TOKEN: 'orb-secret:mcp/libre/TOKEN' } }] };
  assert.equal(X.draftExtension(core, { kind: 'mcp', name: 'libre', description: 'x', update: 'libre', config: cfg }).status, 'asking');
  assert.equal(X.draftExtension(core, { kind: 'mcp', name: 'libre', description: 'x', update: 'libre', config: {} }).status, 'drafting');
});

test('H4: la guardia deniega crear enlaces hacia core o dentro de él, y comprueba la ruta real de lo que se escribe', () => {
  const root = scratch(); const core = path.join(root, 'core'); const proj = path.join(root, 'web', 'a');
  fs.mkdirSync(path.join(core, 'skills', 'demo'), { recursive: true }); fs.mkdirSync(path.join(core, 'preparacion'), { recursive: true }); fs.mkdirSync(proj, { recursive: true });
  const d = (o) => decide({ permission: 'editar', internalDir: core, cwd: proj, ...o });
  const prep = path.join(core, 'preparacion');
  for (const command of [
    `cmd /c "rmdir ${prep}\\skill-x & mklink /J ${prep}\\skill-x C:\\Orb\\windows\\proj\\copia"`,
    `cd ${prep} && mklink /J x ..\\datos`,
    `New-Item -ItemType Junction -Path ${prep}\\x -Target ${path.join(core, 'skills')}`,
    `ni -it SymbolicLink ${prep}\\y -Value ..\\secretos`,
    `fsutil hardlink create ${prep}\\h ${path.join(core, 'datos', 'orb.db')}`,
    `powershell -c "[IO.Directory]::CreateSymbolicLink('${prep}\\z', 'C:\\x')"`,
    `node -e "require('fs').symlinkSync('${path.join(core, 'datos').replace(/\\/g, '\\\\')}', 'x', 'junction')"`,
    `mklink /J enlace ${path.join(core, 'skills', 'demo')}`
  ]) assert.equal(d({ tool: 'Bash', command }).decision, 'deny', command);
  assert.equal(d({ tool: 'Bash', command: 'mklink /J x ..\\datos', cwd: prep }).decision, 'deny', 'dentro de core');
  assert.match(d({ tool: 'Bash', command: `cd ${prep} && mklink /J x ..\\datos` }).reason, /enlace/);
  assert.equal(d({ tool: 'Bash', command: 'mklink /J node_modules\\x ..\\otra' }).decision, 'allow', 'un enlace del proyecto que no toca core');
  // A junction made earlier (in the project) into core\skills: writing through it is denied (its real path), also a new file.
  junction(path.join(core, 'skills', 'demo'), path.join(proj, 'atajo'));
  assert.equal(d({ tool: 'Write', paths: [path.join(proj, 'atajo', 'nuevo.md')] }).decision, 'deny');
  assert.equal(d({ tool: 'Write', paths: [path.join(proj, 'atajo', 'sub', 'otro.md')] }).decision, 'deny');
  assert.equal(d({ tool: 'Bash', command: `echo x > ${path.join(proj, 'atajo', 'n.md')}` }).decision, 'deny');
  junction(path.join(core, 'datos'), path.join(prep, 'x'));
  assert.equal(d({ tool: 'Write', paths: [path.join(prep, 'x', 'orb.db')] }).decision, 'deny', 'una unión en core\\preparacion');
  fs.unlinkSync(path.join(proj, 'atajo')); fs.unlinkSync(path.join(prep, 'x'));
});

test('M1: con una skill de core solo pregunta ejecutar un script suyo; escribir ahí se deniega con su motivo', () => {
  const core = path.join(os.tmpdir(), 'OrbGuardia2', 'core');
  const at = (...p) => path.join(core, ...p);
  const d = (o) => decide({ permission: 'editar', internalDir: core, cwd: path.join(os.tmpdir(), 'OrbGuardia2', 'web'), ...o });
  for (const command of [`python ${at('skills', 'x', 'a.py')}`, `node "${at('skills', 'x', 'b.mjs')}" --dato 1`, `powershell -NoProfile -ExecutionPolicy Bypass -File ${at('skills', 'x', 'c.ps1')}`, String.raw`"C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe" -Command 'python ` + `${at('skills', 'x', 'a.py')}'`]) {
    const v = d({ tool: 'Bash', command });
    assert.deepEqual([v.decision, v.reason], ['ask', 'ejecuta un script de una skill de core'], command);
  }
  for (const command of [
    `python -c "open(r'${at('skills', 'demo', 'SKILL.md')}','w').write('x')"`, `node -e "1" ${at('skills', 'x', 'a.js')}`,
    `powershell -c "sc ${at('skills', 'demo', 'SKILL.md')} x"`, `curl -o ${at('skills', 'demo', 'x.py')} https://x`, `tar -xf a.tar -C ${at('skills', 'demo')}`,
    `pip install --target ${at('skills', 'demo')} x`, `python ${at('skills', 'x', 'a.py')} > ${at('skills', 'x', 'out.txt')}`
  ]) {
    const v = d({ tool: 'Bash', command });
    assert.equal(v.decision, 'deny', command);
    assert.match(v.reason, /orb_create_skill/, command);
  }
});

test('M3/M4: lo que una skill pide a Claude Code (allowed-tools) no llega; una skill puesta a mano que es un enlace no se activa', () => {
  const core = path.join(scratch(), 'core');
  const dir = skillAt(path.join(core, 'skills', 'atajos'), 'atajos');
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: atajos\ndescription: Hace cosas.\nallowed-tools:\n  - Bash\n  - Write\nhooks:\n  PreToolUse: x\n---\n\nAntes: !`whoami`\n');
  assert.deepEqual(X.skillAsks(dir), { tools: true, hooks: true, commands: true });
  const live = X.exposeSkills(core, { skills: [{ name: 'atajos', enabled: true }] });
  const at = path.join(live.root, 'atajos');
  assert.equal(fs.lstatSync(at).isSymbolicLink(), false, 'una copia, no una unión');
  const text = fs.readFileSync(path.join(at, 'SKILL.md'), 'utf8');
  assert.doesNotMatch(text, /allowed-tools|Bash|hooks|PreToolUse/);
  assert.match(text, /^---\nname: "atajos"\ndescription: "Hace cosas\."\n---\n/);
  assert.ok(fs.existsSync(path.join(at, 'scripts', 'paso.py')));
  assert.match(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'), /allowed-tools/, 'la de core no se toca');
  // A skill put by hand in core\skills as a junction to a folder outside: left out (and the list says so).
  const fuera = skillAt(path.join(path.dirname(core), 'fuera'), 'fuera');
  junction(fuera, path.join(core, 'skills', 'fuera'));
  const again = X.exposeSkills(core, { skills: [{ name: 'atajos', enabled: true }, { name: 'fuera', enabled: true }] });
  assert.deepEqual(again.list.map((s) => s.name), ['atajos']);
  assert.ok(again.skipped.includes('fuera') && !fs.existsSync(path.join(again.root, 'fuera')));
  const listed = X.listExtensions(core, {}).skills.find((s) => s.name === 'fuera');
  assert.equal(listed.linked, true);
  assert.equal(X.connectorSafe(core, { args: [path.join(core, 'mcp', 'x', 'index.js')] }), false, 'sin carpeta real, no arranca');
  fs.unlinkSync(path.join(core, 'skills', 'fuera'));
});

test('M8: con la bóveda cerrada las claves de un conector movido esperan y se atan al desbloquear', () => {
  const vault = new Map(); let open = false;
  const master = { unlocked: () => open, get: (k) => vault.get(k) ?? null, set: (k, v) => vault.set(k, v) };
  let saved = [];
  const store = { get: () => saved, set: (v) => { saved = v; } };
  const a = { name: 'gmail', command: 'node', args: ['C:\\Orb\\windows\\gmail\\index.js'], env: { T: 'orb-secret:mcp/gmail/T' } };
  const b = { ...a, args: ['C:\\Orb\\core\\mcp\\gmail\\index.js'] };
  const c = { ...a, args: ['C:\\Orb\\core\\mcp\\gmail\\src\\index.js'] };
  vault.set('mcpbind/gmail', bindingOf(a));
  assert.deepEqual(rebindOrWait(master, [a], [b], store), ['gmail']);
  assert.deepEqual(rebindOrWait(master, [b], [c], store), ['gmail'], 'movido dos veces');
  assert.equal(vault.get('mcpbind/gmail'), bindingOf(a), 'nada cambia sin la contraseña');
  open = true;
  assert.deepEqual(settleRebinds(master, store), ['gmail']);
  assert.equal(vault.get('mcpbind/gmail'), bindingOf(c));
  assert.deepEqual(saved, []);
});

test('B1: el token de eliminar un proyecto sirve una sola vez', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-token-'));
  const m = new Master(dir, { now: () => 1000 }); // 3.8.1: the tokens live in the vault (Rust)
  await m.create('una contraseña de prueba');
  const { unlock } = m.issue('deleteProject');
  assert.equal(m.checkToken(unlock, 'deleteProject', { consume: true }), true);
  assert.equal(m.checkToken(unlock, 'deleteProject', { consume: true }), false);
});

test('al activar un servidor que necesita paquetes, Orb lo avisa antes (no se activa sin install)', async () => {
  const h = tempHome();
  const src = scratch();
  const dir = serverAt(path.join(src, 'con-deps'), 'con-deps');
  put(path.join(dir, 'package.json'), JSON.stringify({ name: 'con-deps', main: 'src/index.js', dependencies: { algo: '1.0.0' } }));
  const e = await startEngine(h.home);
  try {
    const m = await e.call('extensions.import', { from: dir });
    const row = m.list.mcp.find((s) => s.name === 'con-deps-mcp' || s.name === 'con-deps');
    assert.equal(row.needsInstall, true);
    await assert.rejects(e.call('extensions.toggle', { kind: 'mcp', name: row.name, enabled: true }), /necesita descargar paquetes/);
    assert.ok(!fs.existsSync(path.join(row.dir, 'node_modules')), 'importar no instaló nada');
  } finally { await e.stop(); h.cleanup(); }
});

// ---- 3.8.1 (final): leftovers, a cap per conversation and only real MCP servers
test('lo que ya nadie usa en core\preparacion y la cuarentena se limpia al arrancar; como mucho 5 a medias por conversación; «mcp» en el nombre no basta', () => {
  const core = path.join(scratch(), 'core');
  const P = X.extensionPaths(core);
  const live = X.draftExtension(core, { kind: 'skill', name: 'viva', description: 'Una skill en marcha.', by: { conversation: 7 } });
  const old = { ...X.draftExtension(core, { kind: 'skill', name: 'vieja', description: 'Una skill olvidada.' }), created: new Date(Date.now() - 31 * 86_400_000).toISOString() };
  const orphan = path.join(P.staging, 'skill-huerfana-000000'); fs.mkdirSync(orphan, { recursive: true });
  const fresh = path.join(P.quarantine, 'importar-ahora'); fs.mkdirSync(fresh, { recursive: true });
  const stale = path.join(P.quarantine, 'importar-ayer'); fs.mkdirSync(stale, { recursive: true });
  const hourAgo = (Date.now() - 2 * 3_600_000) / 1000; fs.utimesSync(orphan, hourAgo, hourAgo); fs.utimesSync(stale, hourAgo, hourAgo);
  const keep = X.cleanExtensionLeftovers(core, [live, old]);
  assert.deepEqual(keep.map((r) => r.id), [live.id], 'la de hace 31 días se descarta');
  assert.ok(fs.existsSync(live.dir) && !fs.existsSync(old.dir), 'con su carpeta');
  assert.ok(!fs.existsSync(orphan) && !fs.existsSync(stale), 'lo que ninguna petición nombra, fuera');
  assert.ok(fs.existsSync(fresh), 'lo de hace un momento (una importación en curso) se queda');
  const many = Array.from({ length: 5 }, (_, i) => ({ status: ['drafting', 'asking', 'pending'][i % 3], by: { conversation: 7 } }));
  assert.equal(X.openRequestsOf(many, 7), 5);
  assert.equal(X.openRequestsOf([...many, { status: 'drafting', by: { conversation: 8 } }], 8), 1);
  assert.equal(X.OPEN_PER_CONVERSATION, 5);
  const named = path.join(scratch(), 'mis-notas-mcp'); put(path.join(named, 'index.js'), '// no es un servidor MCP');
  assert.equal(X.isMcpProject(named), false, 'el nombre no basta');
  put(path.join(named, 'package.json'), JSON.stringify({ name: 'x', dependencies: { '@modelcontextprotocol/sdk': '1.0.0' } }));
  assert.equal(X.isMcpProject(named), true, 'con el SDK de MCP, sí');
});
