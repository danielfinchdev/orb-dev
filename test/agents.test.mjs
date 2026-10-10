// Agent adapters (2.3): the registry with ORB_FAKE_AGENTS, Codex's live session against a fake "codex app-server"
// (permissions, MCP by -c, resume and fork, approvals through the guard, steer, interrupt, context and real usage),
// Cursor's streaming CLI against a fake CLI (read-only mode, resume, long prompts by file, stop) and the clean environment.
import { fake, until } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as claude from '../src/agents/claude.mjs';
import * as codex from '../src/agents/codex.mjs';
import * as cursor from '../src/agents/cursor.mjs';
import { cleanEnv } from '../src/agents/common.mjs';
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
  const args = codex.mcpArgs({ orb: { command: 'C:\\Program Files\\Orb\\Orb.exe', args: ['C:\\x\\server.mjs'], env: { ORB_HOME: 'C:\\Users\\Ana\\Orb' } }, otro: { command: 'npx', args: [] } });
  assert.ok(args.includes('mcp_servers.orb.command="C:\\\\Program Files\\\\Orb\\\\Orb.exe"'));
  assert.ok(args.includes('mcp_servers.orb.args=["C:\\\\x\\\\server.mjs"]'));
  assert.ok(args.includes('mcp_servers.orb.env={ORB_HOME="C:\\\\Users\\\\Ana\\\\Orb"}'));
  assert.ok(args.includes('mcp_servers.orb.default_tools_approval_mode="approve"'), 'las herramientas del tablero no piden permiso');
  assert.ok(!args.some((a) => a.startsWith('mcp_servers.otro.default_tools')), 'los conectores del usuario sí');
  assert.equal(args.filter((a) => a === '-c').length, args.length / 2);
});

test('Claude: modo de permisos del SDK según el permiso de Orb', () => {
  assert.equal(claude.permissionModeOf('total'), 'bypassPermissions');
  assert.equal(claude.permissionModeOf('editar'), 'acceptEdits');
  assert.equal(claude.permissionModeOf('preguntar'), 'default');
  assert.equal(claude.permissionModeOf('leer'), 'default');
  assert.ok(claude.COORDINATOR_DENIED.includes('Bash') && claude.COORDINATOR_DENIED.includes('Edit'), 'el asistente no ejecuta ni edita');
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
  assert.deepEqual(r.usage, { inputTokens: 1200, outputTokens: 80, cachedTokens: 100 });
});

test('Codex: solo lectura y acceso total cambian sandbox y aprobaciones; continuar y bifurcar usan el hilo', async () => {
  const ro = openCodex({ permission: 'leer' });
  await ro.live.send({ text: 'mira' });
  const p = ro.log().find((m) => m.method === 'thread/start').params;
  assert.deepEqual([p.approvalPolicy, p.sandbox], ['never', 'read-only']);
  const total = openCodex({ permission: 'total' });
  await total.live.send({ text: 'haz' });
  const q = total.log().find((m) => m.method === 'thread/start').params;
  assert.deepEqual([q.approvalPolicy, q.sandbox], ['never', 'danger-full-access']);
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

test('Cursor: solo lectura sin --force, encargos largos por archivo, cupo y detener', async () => {
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
  const quota = await openCursor().live.send({ text: 'CUPO' });
  assert.equal(quota.isError, true); assert.deepEqual(quota.limit, { resetAt: null });
  const { live, events } = openCursor();
  const turn = live.send({ text: 'ESPERA' });
  await until(() => events.some((e) => e.kind === 'tool'), 'turno en marcha');
  await live.interrupt();
  const r = await turn;
  assert.ok(r.final, 'termina aunque el proceso se corte');
});

test('el entorno de los agentes no lleva secretos del proceso', () => {
  process.env.GITHUB_TOKEN = 'ghp_secreto'; process.env.ANTHROPIC_API_KEY = 'sk-x'; process.env.ORB_ORCH_KEY = 'clave';
  const env = cleanEnv({ ORB_AGENT: 'codex' });
  assert.equal(env.GITHUB_TOKEN, undefined); assert.equal(env.ANTHROPIC_API_KEY, undefined); assert.equal(env.ORB_ORCH_KEY, undefined);
  assert.equal(env.ORB_AGENT, 'codex'); assert.ok(env.PATH ?? env.Path);
  delete process.env.GITHUB_TOKEN; delete process.env.ANTHROPIC_API_KEY; delete process.env.ORB_ORCH_KEY;
});
