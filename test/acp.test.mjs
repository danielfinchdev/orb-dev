// The ACP adapter (src/agents/acp.mjs) end to end against a minimal ACP agent (test/fixtures/fake-acp.mjs): handshake,
// streamed answer, tools, plan, context meter, permission requests through the guard (allow, always, deny, read-only,
// total), cancel, resuming a session without showing its history twice, and failures (quota, refusal, crash).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fake, until } from './helpers.mjs';
import { acpAgent, ACP_SPECS } from '../src/agents/acp.mjs';

const SPEC = { label: 'ACP de prueba', pkg: 'no-existe-en-npm', bin: 'no-existe', acpArgs: [], login: [], loginArgs: ['login'], install: '', models: [] };
const agent = acpAgent('prueba', SPEC);
const exe = { cmd: process.execPath, pre: [fake('fake-acp.mjs')] };
let dir; let logFile; const lives = [];
before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-acp-')); logFile = path.join(dir, 'acp.jsonl'); });
after(() => { for (const l of lives) l.close(); try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* temp */ } });

function open(options = {}) {
  const events = [];
  const live = agent.createLive({ exe, cwd: dir, env: { FAKE_ACP_LOG: logFile }, permission: 'editar', onEvent: (ev) => events.push(ev),
    mcpServers: { orb: { command: process.execPath, args: ['server.mjs'], env: { ORB_AGENT: 'gemini', ORB_HOME: 'C:\\Orb' } } }, ...options });
  lives.push(live);
  return { live, events, items: (kind) => events.filter((e) => e.type === 'item' && (!kind || e.kind === kind)) };
}
const sent = () => fs.readFileSync(logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const approvalOf = (events) => until(() => events.find((e) => e.type === 'approval')?.request, 'petición de permiso', 10000);

test('ACP: saludo, sesión nueva, respuesta en directo, herramientas, plan y medidor de contexto', async () => {
  fs.rmSync(logFile, { force: true });
  const { live, events, items } = open({ model: 'gemini-3-pro' });
  const r = await live.send({ text: 'hola, ¿qué hay?' });
  assert.equal(r.isError, false, r.final);
  assert.equal(r.final, 'Hola. ACP recibió: hola, ¿qué hay?');
  assert.equal(r.stopReason, 'end_turn');
  assert.equal(live.sessionId, 'acp-sesion-1');
  assert.deepEqual(events.find((e) => e.type === 'session'), { type: 'session', id: 'acp-sesion-1' });
  assert.equal(events.filter((e) => e.type === 'delta').map((e) => e.text).join(''), r.final, 'el texto llega por trozos');
  assert.deepEqual(items('tool')[0].body, { id: 'tc1', name: 'Leer', input: 'Leer a.txt' });
  assert.deepEqual(items('tool_result')[0].body, { id: 'tc1', output: 'contenido de a.txt', error: false });
  assert.ok(items('reasoning').some((i) => /pensando en ello/.test(i.body)));
  assert.ok(items('reasoning').some((i) => /✓ leer\n· responder/.test(i.body)), 'el plan se ve como razonamiento');
  assert.deepEqual(events.find((e) => e.type === 'context'), { type: 'context', used: 1234, size: 100000 });
  assert.deepEqual(items('usage')[0].body, { inputTokens: 11, outputTokens: 7 });
  const msgs = sent();
  const init = msgs.find((m) => m.method === 'initialize');
  assert.equal(init.params.protocolVersion, 1);
  assert.deepEqual(init.params.clientCapabilities, { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, 'Orb no ofrece leer ni escribir archivos por el protocolo');
  const created = msgs.find((m) => m.method === 'session/new');
  assert.equal(created.params.cwd, dir);
  assert.deepEqual(created.params.mcpServers, [{ name: 'orb', command: process.execPath, args: ['server.mjs'], env: [{ name: 'ORB_AGENT', value: 'gemini' }, { name: 'ORB_HOME', value: 'C:\\Orb' }] }], 'el MCP de Orb en el formato de ACP');
  await until(() => sent().some((m) => m.method === 'session/set_config_option'), 'modelo elegido');
  assert.deepEqual(sent().find((m) => m.method === 'session/set_config_option').params, { sessionId: 'acp-sesion-1', configId: 'modelo', value: 'gemini-3-pro' });
  // A second turn goes to the same process and the same session.
  const again = await live.send({ text: 'otra cosa' });
  assert.match(again.final, /ACP recibió: otra cosa/);
  assert.equal(sent().filter((m) => m.method === 'session/new').length, 1);
  assert.equal(sent().filter((m) => m.method === 'session/prompt').length, 2);
});

test('ACP: las peticiones de permiso pasan por el guardia y la tarjeta (permitir, siempre, denegar)', async () => {
  const { live, events } = open();
  for (const [decision, option] of [['allow', 'si-una'], ['always', 'si-siempre'], ['deny', 'no']]) {
    events.length = 0;
    const turn = live.send({ text: 'PERMISO para publicar' });
    const req = await approvalOf(events);
    assert.equal(req.id, 'tc2');
    assert.equal(req.title, 'git push origin main');
    assert.match(req.reason, /git push/);
    assert.equal(live.respond('tc2', decision), true);
    assert.equal(live.respond('tc2', decision), false, 'una petición se contesta una sola vez');
    assert.match((await turn).final, new RegExp(`elegido: ${option}$`));
    assert.deepEqual(events.find((e) => e.type === 'approval_done'), { type: 'approval_done', id: 'tc2', decision });
  }
});

test('ACP: con acceso total no pregunta; en solo lectura deniega sin preguntar y usa el modo de solo lectura del agente', async () => {
  const total = open({ permission: 'total' });
  assert.match((await total.live.send({ text: 'PERMISO' })).final, /elegido: si-una$/);
  assert.equal(total.events.some((e) => e.type === 'approval'), false);
  fs.rmSync(logFile, { force: true });
  const ro = open({ permission: 'leer' });
  assert.match((await ro.live.send({ text: 'PERMISO' })).final, /elegido: no$/);
  assert.equal(ro.events.some((e) => e.type === 'approval'), false);
  await until(() => sent().some((m) => m.method === 'session/set_mode'), 'modo de solo lectura');
  assert.equal(sent().find((m) => m.method === 'session/set_mode').params.modeId, 'plan');
});

test('ACP: detener envía session/cancel y deniega lo que esperaba permiso', async () => {
  const { live, events } = open();
  const turn = live.send({ text: 'ESPERA un rato' });
  await until(() => events.some((e) => e.type === 'context'), 'turno en marcha');
  await live.interrupt();
  const r = await turn;
  assert.equal(r.stopReason, 'cancelled');
  assert.equal(r.isError, false);
  assert.ok(sent().some((m) => m.method === 'session/cancel' && m.params.sessionId === 'acp-sesion-1'));
  // A pending approval when the turn is stopped is answered "deny" (the card closes).
  events.length = 0;
  const waiting = live.send({ text: 'PERMISO' });
  await approvalOf(events);
  await live.interrupt();
  assert.match((await waiting).final, /elegido: no$/);
  assert.equal(events.find((e) => e.type === 'approval_done').decision, 'deny');
});

test('ACP: continuar una sesión la carga (session/load) sin volver a mostrar su historial', async () => {
  fs.rmSync(logFile, { force: true });
  const { live, events } = open({ resumeId: 'acp-sesion-1' });
  const r = await live.send({ text: 'sigue' });
  assert.match(r.final, /ACP recibió: sigue/);
  const msgs = sent();
  assert.ok(msgs.some((m) => m.method === 'session/load' && m.params.sessionId === 'acp-sesion-1'));
  assert.ok(!msgs.some((m) => m.method === 'session/new'), 'no empieza otra sesión');
  assert.equal(live.sessionId, 'acp-sesion-1');
  assert.ok(!JSON.stringify(events).includes('mensaje antiguo repetido'), 'el historial que repite el agente al cargar no se muestra');
});

test('ACP: cupo agotado, rechazo y caída del agente se ven como error claro', async () => {
  const { live } = open();
  const quota = await live.send({ text: 'CUOTA' });
  assert.equal(quota.isError, true);
  assert.deepEqual(quota.limit, { resetAt: null }, 'un error de cuota cuenta como límite de uso');
  assert.match(quota.final, /ACP de prueba: Quota exhausted/);
  const refusal = await live.send({ text: 'NIEGA' });
  assert.equal(refusal.isError, true); assert.equal(refusal.stopReason, 'refusal');
  const { live: dying, events } = open();
  const dead = await dying.send({ text: 'MUERE' });
  assert.equal(dead.isError, true);
  assert.match(dead.final, /ACP de prueba se cerró \(código 3\)/);
  assert.ok(events.some((e) => e.type === 'exit' && e.code === 3 && /se cayó/.test(e.stderr)));
  assert.equal(dying.isClosed(), true);
  await assert.rejects(dying.send({ text: 'hola' }), /se ha cerrado/);
});

test('ACP: cerrar termina el proceso; detección por ruta y la lista de agentes ACP', async () => {
  const { live } = open();
  await live.send({ text: 'hola' });
  const pid = live.pid;
  live.close();
  assert.equal(live.isClosed(), true);
  await until(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, 'proceso terminado', 10000);
  // A hand-set path to a script runs with Node (never the script as a program).
  assert.deepEqual(agent.detect({ path: fake('fake-acp.mjs') }).pre, [fake('fake-acp.mjs')]);
  assert.equal(agent.detect({}), null, 'sin el programa instalado no se detecta');
  assert.deepEqual(agent.loginCommand(exe), { cmd: exe.cmd, args: [...exe.pre, 'login'] });
  assert.deepEqual(Object.keys(ACP_SPECS), ['gemini', 'opencode', 'qwen', 'copilot']);
  assert.deepEqual(agent.caps, { images: false, steer: false, fork: false, approvals: true, models: false, context: true });
  assert.equal(live.steer({ text: 'x' }), false, 'ACP no corrige en marcha: los mensajes esperan en la cola');
});
