// Agent adapters (2.3): the registry with ORB_FAKE_AGENTS, Codex's live session against a fake "codex app-server"
// (permissions, MCP by -c, resume and fork, approvals through the guard, steer, interrupt, context and real usage),
// Cursor's streaming CLI against a fake CLI (read-only mode, resume, long prompts by file, stop) and the clean environment.
import { fake, until, ROOT } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as claude from '../src/agents/claude.mjs';
import * as codex from '../src/agents/codex.mjs';
import * as cursor from '../src/agents/cursor.mjs';
import { cleanEnv, mcpEnvByRef, killTree } from '../src/agents/common.mjs';
import { spawn } from 'node:child_process';
import { ADAPTERS, adapter } from '../src/agents/index.mjs';
import { AGENT_IDS } from '../src/core/home.mjs';

let dir; const lives = [];
before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-agentes-')); });
after(() => { for (const l of lives) l.close(); try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* temp */ } });
const readLog = (file) => { try { return fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch { return []; } };

test('ORB_FAKE_AGENTS cambia todos los agentes del registro por el falso', () => {
  assert.deepEqual(Object.keys(ADAPTERS), AGENT_IDS, 'Claude, Codex, Cursor y los cuatro ACP');
  for (const id of AGENT_IDS) {
    const a = adapter(id);
    assert.equal(a.kind, 'fake', id);
    assert.equal(a.id, id);
    assert.ok(a.label && a.caps && typeof a.createLive === 'function' && a.detect());
  }
  assert.equal(adapter('claude').caps.steer, true, 'el falso conserva lo que sabe hacer cada agente real');
  assert.equal(adapter('cursor').caps.steer, false);
  assert.throws(() => adapter('otro'), /agente desconocido/);
});

test('Codex: el MCP de Orb va por -c con rutas de Windows escapadas para TOML', () => {
  const args = codex.mcpArgs({ orb: { command: 'C:\\Program Files\\Orb\\Orb.exe', args: ['C:\\x\\server.mjs'], env: { ORB_AUTH_PIPE: '\\\\.\\pipe\\orb-agentes-1' } }, otro: { command: 'npx', args: [] } });
  assert.ok(args.includes('mcp_servers.orb.command="C:\\\\Program Files\\\\Orb\\\\Orb.exe"'));
  assert.ok(args.includes('mcp_servers.orb.args=["C:\\\\x\\\\server.mjs"]'));
  assert.ok(args.includes('mcp_servers.orb.env={ORB_AUTH_PIPE="\\\\\\\\.\\\\pipe\\\\orb-agentes-1"}'));
  assert.ok(args.includes('mcp_servers.orb.default_tools_approval_mode="approve"'), 'las herramientas del tablero no piden permiso');
  assert.ok(!args.some((a) => a.startsWith('mcp_servers.otro.default_tools')), 'los conectores del usuario sí');
  // 3.8 (N3, N4): no value but the plainly public ones on the command line, whatever its name (PASSWORD, DATABASE_URL…):
  // each one through Codex's environment under a name of its own (two connectors' API_KEY do not clash), the ticket's
  // --ticket-env following it, and none of Orb's variables in the commands Codex runs.
  const servers = { orb: { command: 'node', args: ['server.mjs', '--ticket-env=ORB_TICKET_orb'], env: { ORB_AUTH_PIPE: 'tubo', ORB_TICKET_orb: 'ticket-secreto' } },
    uno: { command: 'npx', args: [], env: { API_KEY: 'clave-uno', DATABASE_URL: 'postgres://u:pass@h/db' } }, dos: { command: 'npx', args: [], env: { API_KEY: 'clave-dos' } } };
  const withSecrets = codex.mcpArgs(servers);
  for (const v of ['ticket-secreto', 'clave-uno', 'clave-dos', 'pass@h']) assert.ok(!withSecrets.some((a) => a.includes(v)), `${v} no está en los argumentos`);
  assert.ok(withSecrets.includes('mcp_servers.orb.args=["server.mjs","--ticket-env=ORB_MCP_orb_ORB_TICKET_orb"]'));
  assert.ok(withSecrets.includes('mcp_servers.orb.env={ORB_AUTH_PIPE="tubo"}'));
  assert.ok(withSecrets.includes('mcp_servers.uno.env_vars=["ORB_MCP_uno_API_KEY","ORB_MCP_uno_DATABASE_URL"]'));
  assert.ok(withSecrets.includes('shell_environment_policy.exclude=["ORB_*"]'));
  assert.deepEqual(codex.mcpSecrets(servers), { ORB_MCP_orb_ORB_TICKET_orb: 'ticket-secreto', ORB_MCP_uno_API_KEY: 'clave-uno', ORB_MCP_uno_DATABASE_URL: 'postgres://u:pass@h/db', ORB_MCP_dos_API_KEY: 'clave-dos' });
  assert.equal(args.filter((a) => a === '-c').length, args.length / 2);
});

test('Claude: modo de permisos del SDK según el permiso de Orb', () => {
  assert.equal(claude.permissionModeOf('total'), 'default', '3.8.2: the guard runs in «total» too (canUseTool)');
  assert.equal(claude.permissionModeOf('editar'), 'acceptEdits');
  assert.equal(claude.permissionModeOf('preguntar'), 'default');
  assert.equal(claude.permissionModeOf('leer'), 'default');
  assert.ok(claude.COORDINATOR_DENIED.includes('Bash') && claude.COORDINATOR_DENIED.includes('Edit'), 'el asistente no ejecuta ni edita');
});

// 3.8 (M3): the SDK puts mcpServers on Claude Code's command line (--mcp-config): any process of the user can read it.
test('Claude: los secretos del MCP van en su entorno y la línea de órdenes solo los nombra', async () => {
  const file = path.join(dir, 'claude-args.json');
  const live = claude.createLive({ exe: { cmd: fake('fake-claude.mjs'), pre: [] }, cwd: dir, env: { FAKE_ARGS_FILE: file },
    mcpServers: { orb: { command: 'node', args: ['server.mjs'], env: { ORB_HOME: 'C:\\o', ORB_ORCH_KEY: 'clave-secreta-1', ORB_AGENT_TOKEN: 'firma-secreta-2' } }, otro: { command: 'npx', args: ['x'], env: { API_KEY: 'clave-del-conector-3' } } } });
  lives.push(live);
  await live.send({ text: 'hola' });
  const seen = await until(() => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }, 'Claude falso arrancado');
  const line = seen.args.join(' ');
  for (const secret of ['clave-secreta-1', 'firma-secreta-2', 'clave-del-conector-3']) assert.ok(!line.includes(secret), `${secret} no está en los argumentos`);
  const config = JSON.parse(seen.args[seen.args.indexOf('--mcp-config') + 1]);
  assert.equal(config.mcpServers.orb.env.ORB_ORCH_KEY, '${ORB_MCP_orb_ORB_ORCH_KEY}');
  assert.equal(config.mcpServers.otro.env.API_KEY, '${ORB_MCP_otro_API_KEY}');
  assert.equal(seen.env.ORB_MCP_orb_ORB_ORCH_KEY, 'clave-secreta-1', 'Claude Code los expande desde su entorno');
  assert.equal(seen.env.ORB_MCP_orb_ORB_AGENT_TOKEN, 'firma-secreta-2');
  assert.equal(seen.env.ORB_MCP_otro_API_KEY, 'clave-del-conector-3');
  // N13: no hooks of the project's .claude/settings*.json (they would run with this agent's environment).
  assert.equal(JSON.parse(seen.args[seen.args.indexOf('--settings') + 1]).disableAllHooks, true);
});

// N12: the real Claude Code of the SDK expands ${ORB_MCP_…} in --mcp-config from its environment (as Orb hands every MCP
// server's ticket). No network or account: its API points at a closed local port and its folder is a temporary one; the
// test ends as soon as the server has started.
const SDK_CLAUDE = path.join(ROOT, 'node_modules', '@anthropic-ai', `claude-agent-sdk-${process.platform}-${process.arch}`, process.platform === 'win32' ? 'claude.exe' : 'claude');
test('Claude Code real: expande ${ORB_MCP_…} de su entorno al arrancar un servidor MCP', { skip: !fs.existsSync(SDK_CLAUDE) && 'sin el Claude Code del SDK' }, async () => {
  const out = path.join(dir, 'mcp-visto.json');
  const server = path.join(dir, 'mcp-que-mira.mjs');
  fs.writeFileSync(server, `import fs from 'node:fs'; fs.writeFileSync(process.argv[2], JSON.stringify({ ticket: process.env.ORB_TICKET_orb ?? null })); process.stdin.resume();\n`);
  const { servers, env } = mcpEnvByRef({ orb: { command: process.execPath, args: [server, out], env: { ORB_TICKET_orb: 'ticket-de-prueba-123' } } }, (name) => `\${${name}}`);
  const config = path.join(dir, 'claude-config'); fs.mkdirSync(config, { recursive: true });
  const child = spawn(SDK_CLAUDE, ['-p', 'hola', '--mcp-config', JSON.stringify({ mcpServers: servers }), '--strict-mcp-config', '--max-turns', '1'], { cwd: dir, windowsHide: true, stdio: 'ignore',
    env: { ...cleanEnv({}), ...env, CLAUDE_CONFIG_DIR: config, ANTHROPIC_API_KEY: 'sk-ant-prueba', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1' } });
  try {
    const seen = await until(() => { try { return JSON.parse(fs.readFileSync(out, 'utf8')); } catch { return null; } }, 'el servidor MCP arrancado por Claude Code', 60000);
    assert.deepEqual(seen, { ticket: 'ticket-de-prueba-123' });
  } finally { killTree(child); }
});

// F2.6c (P1): what a task can leave in the project's .claude/settings*.json does not change later Claude agents: its
// allow rules do not skip Orb's guard, and a file that would run programs (apiKeyHelper) or change the environment is not
// loaded (its CLAUDE.md still reaches Claude). The real Claude Code of the SDK against a local stand-in of the API; the
// project is trusted in its (temporary) config, as the user's own projects are.
async function realClaudeTurn({ name, settings, tool, permission }) {
  const { fakeAnthropic } = await import('./fixtures/fake-anthropic.mjs');
  const proj = path.join(dir, name); fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
  if (settings) fs.writeFileSync(path.join(proj, '.claude', 'settings.json'), JSON.stringify(settings));
  fs.writeFileSync(path.join(proj, 'CLAUDE.md'), 'NOTA-DEL-PROYECTO-77');
  const config = path.join(dir, `${name}-config`); fs.mkdirSync(config, { recursive: true });
  fs.writeFileSync(path.join(config, '.claude.json'), JSON.stringify({ projects: { [proj.split(path.sep).join('/')]: { hasTrustDialogAccepted: true } } }));
  const api = await fakeAnthropic({ tool: JSON.parse(JSON.stringify(tool).replaceAll('PROJ', proj.split(path.sep).join('/'))) });
  const events = []; const asked = [];
  const live = claude.createLive({ exe: { cmd: SDK_CLAUDE, pre: [] }, cwd: proj, permission, internalDir: path.join(dir, '.orb'),
    env: { ...cleanEnv({}), CLAUDE_CONFIG_DIR: config, ANTHROPIC_API_KEY: 'sk-ant-prueba', ANTHROPIC_BASE_URL: api.url, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1' },
    onEvent: (e) => { events.push(e); if (e.type === 'approval') { asked.push(e.request); live.respond(e.request.id, 'deny'); } } });
  lives.push(live);
  try {
    const r = await live.send({ text: 'hola' });
    return { r, events, asked, proj, sawNotes: api.requests.some((q) => JSON.stringify([q.body.system, q.body.messages]).includes('NOTA-DEL-PROYECTO-77')) };
  } finally { live.close(); await api.close(); }
}
test('Claude Code real: las reglas «allow» del proyecto no se saltan la guardia de Orb', { skip: !fs.existsSync(SDK_CLAUDE) && 'sin el Claude Code del SDK' }, async () => {
  const bash = await realClaudeTurn({ name: 'permite-bash', permission: 'preguntar', settings: { permissions: { allow: ['Bash', 'Edit', 'Write'] } }, tool: { name: 'Bash', input: { command: 'echo x > marca.txt', description: 'marca' } } });
  assert.equal(bash.r.isError, false, bash.r.final);
  assert.deepEqual(bash.asked.map((a) => a.tool), ['Bash'], 'pregunta a Orb aunque el proyecto lo permita');
  assert.ok(!fs.existsSync(path.join(bash.proj, 'marca.txt')), 'denegado: no se ejecuta');
  assert.ok(bash.sawNotes, 'el CLAUDE.md del proyecto sigue llegando');
  // «editar» accepts edits by itself, but not to the project's agent settings: they ask first.
  const write = await realClaudeTurn({ name: 'escribe-ajustes', permission: 'editar', tool: { name: 'Write', input: { file_path: 'PROJ/.claude/settings.local.json', content: '{"permissions":{"allow":["Bash"]}}' } } });
  assert.deepEqual(write.asked.map((a) => a.tool), ['Write']);
  assert.ok(!fs.existsSync(path.join(write.proj, '.claude', 'settings.local.json')));
});
test('Claude Code real: unos ajustes del proyecto que ejecutan programas o cambian el entorno no se cargan', { skip: !fs.existsSync(SDK_CLAUDE) && 'sin el Claude Code del SDK' }, async () => {
  const helper = process.platform === 'win32' ? 'echo x> helper-ejecutado.txt & echo sk-ant-x' : 'echo x > helper-ejecutado.txt; echo sk-ant-x';
  const out = await realClaudeTurn({ name: 'ajustes-hostiles', permission: 'editar', settings: { env: { MARCA_DEL_PROYECTO: 'llega' }, apiKeyHelper: helper },
    tool: { name: 'Bash', input: { command: 'echo "v=$MARCA_DEL_PROYECTO" > entorno.txt', description: 'entorno' } } });
  assert.equal(out.r.isError, false, out.r.final);
  assert.ok(!fs.existsSync(path.join(out.proj, 'helper-ejecutado.txt')), 'apiKeyHelper del proyecto no se ejecuta');
  assert.doesNotMatch(fs.readFileSync(path.join(out.proj, 'entorno.txt'), 'utf8'), /llega/, 'su env no llega a los comandos');
  assert.ok(out.sawNotes, 'su CLAUDE.md llega por las instrucciones');
  assert.ok(out.events.some((e) => e.kind === 'status' && /settings\.json: env, settings\.json: apiKeyHelper/.test(e.body)), 'se avisa en la conversación');
  assert.deepEqual(claude.projectSettingsRisk(out.proj), ['settings.json: env', 'settings.json: apiKeyHelper']);
  fs.writeFileSync(path.join(out.proj, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash'] }, hooks: {}, model: 'opus', includeCoAuthoredBy: false }));
  assert.deepEqual(claude.projectSettingsRisk(out.proj), [], 'lo normal de un proyecto sí se carga');
});

function openCodex(options = {}) {
  const log = path.join(dir, `codex-${lives.length}.jsonl`);
  const events = [];
  const live = codex.createLive({ exe: { cmd: process.execPath, pre: [fake('fake-codex-app.mjs')] }, cwd: dir, permission: 'editar', reasoning: 'high', env: { FAKE_LOG: log, CODEX_HOME: path.join(dir, 'cuenta-2') },
    mcpServers: { orb: { command: process.execPath, args: ['server.mjs'], env: { ORB_AGENT: 'codex' } } }, onEvent: (ev) => events.push(ev), ...options });
  lives.push(live);
  return { live, events, log: () => readLog(log) };
}

test('Codex: sesión viva por app-server con hilo, permisos, herramientas, archivos, contexto y uso real', async () => {
  const { live, events, log } = openCodex({ model: 'gpt-5.5' });
  const r = await live.send({ text: 'hola Codex' });
  assert.equal(r.isError, false, r.final);
  assert.equal(r.final, 'Codex: hola Codex');
  assert.equal(live.sessionId, 'hilo-nuevo');
  assert.ok(events.some((e) => e.type === 'session' && e.id === 'hilo-nuevo'));
  const sent = log();
  assert.deepEqual(sent[0].argv.slice(0, 2), ['app-server', '-c'], 'arranca «codex app-server» con el MCP por -c');
  assert.equal(sent[0].codexHome, path.join(dir, 'cuenta-2'), 'CODEX_HOME de la cuenta');
  const start = sent.find((m) => m.method === 'thread/start').params;
  assert.equal(start.cwd, dir); assert.equal(start.approvalPolicy, 'untrusted'); assert.equal(start.sandbox, 'workspace-write');
  assert.equal(start.config.model_reasoning_effort, 'high'); assert.equal(start.model, 'gpt-5.5');
  assert.ok(sent.some((m) => m.method === 'initialized'), 'avisa de que está listo tras initialize');
  const kinds = events.filter((e) => e.type === 'item').map((e) => e.kind);
  for (const k of ['status', 'tool', 'tool_result', 'file', 'text', 'usage']) assert.ok(kinds.includes(k), `falta ${k}`);
  assert.deepEqual(events.find((e) => e.kind === 'file').body, { path: 'a.txt', change: 'add' });
  assert.ok(!JSON.stringify(events).includes('esto es de un subagente'), 'lo de otros hilos no se mezcla');
  assert.deepEqual(events.find((e) => e.type === 'context'), { type: 'context', used: 900, size: 272000 });
  assert.deepEqual(events.find((e) => e.type === 'rate'), { type: 'rate', status: 'allowed', resetAt: 2_000_000_000_000, utilization: 0.42, window: '300min' });
  // 3.2.1: per turn and without the cached part (Codex's totals are the thread's and include the cache).
  assert.deepEqual(r.usage, { inputTokens: 800, outputTokens: 80, cacheReadTokens: 100 });
});

test('Codex: solo lectura y acceso total cambian sandbox y aprobaciones; continuar y bifurcar usan el hilo', async () => {
  const ro = openCodex({ permission: 'leer' });
  await ro.live.send({ text: 'mira' });
  const p = ro.log().find((m) => m.method === 'thread/start').params;
  assert.deepEqual([p.approvalPolicy, p.sandbox], ['untrusted', 'read-only']);
  const total = openCodex({ permission: 'total' });
  await total.live.send({ text: 'haz' });
  const q = total.log().find((m) => m.method === 'thread/start').params;
  assert.deepEqual([q.approvalPolicy, q.sandbox], ['untrusted', 'danger-full-access'], '3.8.2: total still asks the guard');
  const resumed = openCodex({ resumeId: 'hilo-viejo' });
  assert.equal((await resumed.live.send({ text: 'sigue' })).final, 'Codex: sigue');
  assert.equal(resumed.log().find((m) => m.method === 'thread/resume').params.threadId, 'hilo-viejo');
  assert.equal(resumed.live.sessionId, 'hilo-viejo');
  const forked = openCodex({ resumeId: 'hilo-viejo', forkSession: true });
  await forked.live.send({ text: 'prueba otra idea' });
  assert.ok(forked.log().some((m) => m.method === 'thread/fork'));
  assert.equal(forked.live.sessionId, 'copia-de-hilo-viejo', 'la bifurcación tiene su propio hilo');
});

test('Codex: las aprobaciones pasan por el guardia; corregir en marcha y detener', async () => {
  const { live, events } = openCodex();
  for (const [decision, answer] of [['allow', 'accept'], ['always', 'acceptForSession'], ['deny', 'decline']]) {
    events.length = 0;
    const turn = live.send({ text: 'PERMISO' });
    const req = await until(() => events.find((e) => e.type === 'approval')?.request, 'tarjeta de permiso', 10000);
    assert.equal(req.id, 'c2'); assert.equal(req.title, 'git push origin main');
    live.respond(req.id, decision);
    assert.match((await turn).final, new RegExp(`decisión: ${answer}$`));
  }
  // Steer: the message reaches the running turn.
  events.length = 0;
  const steered = live.send({ text: 'ESPERA' });
  await until(() => events.some((e) => e.type === 'rate'), 'turno en marcha');
  await until(() => live.steer({ text: 'mejor en rojo' }), 'corregir en marcha');
  assert.match((await steered).final, /corrección: mejor en rojo$/);
  // Interrupt.
  events.length = 0;
  const stopped = live.send({ text: 'ESPERA' });
  await until(() => events.some((e) => e.type === 'rate'), 'turno en marcha');
  await live.interrupt();
  assert.equal((await stopped).stopReason, 'interrupted');
  assert.equal(live.steer({ text: 'tarde' }), false, 'sin turno en marcha no hay nada que corregir');
});

test('Codex: límite de uso de la cuenta y turnos fallidos', async () => {
  const { live, events } = openCodex();
  const r = await live.send({ text: 'LIMITE' });
  assert.equal(r.isError, true);
  assert.deepEqual(r.limit, { resetAt: 2_000_000_000_000 });
  assert.ok(events.some((e) => e.type === 'limit'));
  assert.ok(events.some((e) => e.type === 'rate' && e.status === 'rejected' && e.utilization === 1));
  const failed = await live.send({ text: 'FALLA' });
  assert.equal(failed.isError, true); assert.equal(failed.final, 'algo salió mal en Codex'); assert.equal(failed.limit, null);
  live.close();
  assert.equal(live.isClosed(), true);
  await assert.rejects(live.send({ text: 'hola' }), /se ha cerrado/);
});

function openCursor(options = {}) {
  const log = path.join(dir, `cursor-${lives.length}.jsonl`);
  const events = [];
  const live = cursor.createLive({ exe: { cmd: process.execPath, pre: [fake('fake-cursor.mjs')] }, cwd: dir, env: { FAKE_LOG: log }, onEvent: (ev) => events.push(ev), ...options });
  lives.push(live);
  return { live, events, log: () => readLog(log) };
}

test('Cursor: CLI en streaming, un proceso por turno que continúa el mismo chat', async () => {
  const { live, events, log } = openCursor({ model: 'gpt-5' });
  const r = await live.send({ text: 'hola Cursor' });
  assert.equal(r.isError, false, r.final);
  assert.equal(r.final, 'Cursor: hola Cursor');
  assert.equal(events.filter((e) => e.type === 'delta').map((e) => e.text).join(''), 'Miro la carpeta.');
  assert.ok(events.some((e) => e.kind === 'text' && e.body === 'Miro la carpeta.'), 'lo escrito en trozos queda como mensaje antes de la herramienta');
  assert.deepEqual(events.find((e) => e.kind === 'tool').body, { id: 'k1', name: 'read', input: 'a.txt' });
  assert.equal(live.sessionId, 'chat-cursor-1');
  const [first] = log();
  for (const flag of ['-p', '--output-format', 'stream-json', '--stream-partial-output', '--trust', '--force']) assert.ok(first.args.includes(flag), flag);
  assert.equal(first.args[first.args.indexOf('--workspace') + 1], dir);
  assert.equal(first.args[first.args.indexOf('--model') + 1], 'gpt-5');
  await live.send({ text: 'sigue' });
  const second = log()[1];
  assert.equal(second.args[second.args.indexOf('--resume') + 1], 'chat-cursor-1', 'el segundo turno continúa el chat');
  assert.equal(live.steer({ text: 'x' }), false, 'Cursor no corrige en marcha: espera en la cola');
});

test('Cursor: solo lectura sin --force, encargos largos por archivo, límite de uso y detener', async () => {
  const ro = openCursor({ permission: 'leer', model: 'auto' });
  await ro.live.send({ text: 'mira' });
  const args = ro.log()[0].args;
  assert.ok(!args.includes('--force')); assert.equal(args[args.indexOf('--mode') + 1], 'ask');
  assert.equal(args[args.indexOf('--model') + 1], 'auto', 'auto = Cursor elige el modelo en cada petición');
  const long = openCursor({ promptDir: dir });
  await long.live.send({ text: `ENCARGO\n${'x'.repeat(cursor.ARGV_PROMPT_MAX + 10)}` });
  const prompt = long.log()[0].args.at(-1);
  assert.match(prompt, /Tus instrucciones completas están en el archivo .*orb-encargo-\d+\.md/);
  assert.ok(prompt.length < 1000, 'la línea de órdenes de Windows no admite 32 000 caracteres');
  assert.ok(!fs.readdirSync(dir).some((f) => f.startsWith('orb-encargo-')), 'el archivo de instrucciones se borra al acabar el turno');
  const quota = await openCursor().live.send({ text: 'LIMITE_USO' });
  assert.equal(quota.isError, true); assert.deepEqual(quota.limit, { resetAt: null, text: 'You have reached your usage limit' });
  const { live, events } = openCursor();
  const turn = live.send({ text: 'ESPERA' });
  await until(() => events.some((e) => e.kind === 'tool'), 'turno en marcha');
  await live.interrupt();
  const r = await turn;
  assert.ok(r.final, 'termina aunque el proceso se corte');
});

test('Cursor 3.2.1: el texto completo no se repite, las herramientas MCP con nombre legible y los tokens del resultado', async () => {
  const { live, events } = openCursor({ model: 'gemini-3.8-flash-medium' });
  const r = await live.send({ text: 'FORMATO_NUEVO' });
  assert.equal(r.isError, false, r.final);
  const texts = events.filter((e) => e.kind === 'text' && e.role === 'assistant').map((e) => e.body);
  assert.deepEqual(texts, ['Voy a crear saludo.html.', 'Hecho.'], 'cada texto una sola vez, sin «texto+texto»');
  const tools = events.filter((e) => e.kind === 'tool').map((e) => e.body);
  assert.equal(tools.length, 1, 'la consulta de herramientas (getMcpTools) no se enseña');
  assert.equal(tools[0].name, 'Progreso de la tarea');
  assert.equal(tools[0].input, '20 % · Creando saludo.html');
  assert.ok(!JSON.stringify(events).includes('smartModeApprovalOnly'), 'sin los argumentos crudos');
  const usage = events.find((e) => e.kind === 'usage').body;
  assert.equal(usage.inputTokens, 13038); assert.equal(usage.cacheReadTokens, 50688); assert.equal(usage.outputTokens, 841);
});

test('Cursor 3.2.1: el límite de uso de un modelo de API es solo de ese modelo, con la fecha real y el aviso en español', async () => {
  const { live, events } = openCursor({ model: 'gemini-3.8-flash-medium' });
  const r = await live.send({ text: 'LIMITE_MODELO' });
  assert.equal(r.isError, true);
  assert.equal(r.limit?.model, 'gemini-3.8-flash-medium', 'el límite es del modelo');
  const rate = events.find((e) => e.type === 'rate');
  assert.deepEqual([rate.status, rate.model], ['rejected', 'gemini-3.8-flash-medium']);
  assert.match(rate.text, /monthly cycle ends on \d+\/\d+\/\d{4}/);
  const error = events.find((e) => e.role === 'error').body;
  assert.match(error, /^Tu plan de Cursor no tiene uso del modelo Gemini 3\.8 Flash Medium hasta las 00:00 del .+\. Elige otro modelo/, 'con el día en que vuelve el uso');
  assert.ok(!/ActionRequiredError|usage limit/.test(error), 'sin el texto en inglés del programa');
  // With Cursor's own choice (Auto) the same text is the account's limit.
  const auto = await openCursor({ model: 'auto' }).live.send({ text: 'LIMITE_MODELO' });
  assert.equal(auto.limit?.model, undefined);
  assert.ok(auto.limit);
});

test('Claude 3.2.1: un resultado que no responde a Orb (aviso de tarea en segundo plano) no cierra el turno', () => {
  assert.equal(claude.answersOrb({ type: 'result', origin: { kind: 'task-notification' } }), false);
  assert.equal(claude.answersOrb({ type: 'result', origin: { kind: 'human' } }), true);
  assert.equal(claude.answersOrb({ type: 'result' }), true, 'sin origen (versiones anteriores): sí es la respuesta');
});

test('Codex 3.2.1: el uso de cada turno es lo nuevo del turno, sin la caché', () => {
  const turn = {};
  assert.deepEqual(codex.turnUsage({ last: { inputTokens: 30_000, cachedInputTokens: 25_000, outputTokens: 500 }, total: { inputTokens: 300_000, cachedInputTokens: 250_000, outputTokens: 5_000 } }, turn), { inputTokens: 5_000, outputTokens: 500, cacheReadTokens: 25_000 });
  assert.deepEqual(codex.turnUsage({ last: { inputTokens: 40_000, cachedInputTokens: 38_000, outputTokens: 700 }, total: { inputTokens: 340_000, cachedInputTokens: 288_000, outputTokens: 5_700 } }, turn), { inputTokens: 7_000, outputTokens: 1_200, cacheReadTokens: 63_000 }, 'la segunda petición del mismo turno se suma');
});

test('el entorno de los agentes no lleva secretos del proceso', () => {
  process.env.GITHUB_TOKEN = 'ghp_secreto'; process.env.ANTHROPIC_API_KEY = 'sk-x'; process.env.ORB_ORCH_KEY = 'clave';
  const env = cleanEnv({ ORB_AGENT: 'codex' });
  assert.equal(env.GITHUB_TOKEN, undefined); assert.equal(env.ANTHROPIC_API_KEY, undefined); assert.equal(env.ORB_ORCH_KEY, undefined);
  assert.equal(env.ORB_AGENT, 'codex'); assert.ok(env.PATH ?? env.Path);
  delete process.env.GITHUB_TOKEN; delete process.env.ANTHROPIC_API_KEY; delete process.env.ORB_ORCH_KEY;
});
