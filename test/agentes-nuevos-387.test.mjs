// 3.8.7 paso 3: Grok Build, Devin, Factory Droid and Oh My Pi (ACP), Pi (RPC) and Antigravity (print mode), plus the
// agents' API keys in the vault. Everything runs against simulated processes (test/fixtures/fake-*.mjs): no real agent is
// started, nothing is spent.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fake, until } from './helpers.mjs';
import { acpAgent, ACP_SPECS } from '../src/agents/acp.mjs';
import { ADAPTERS } from '../src/agents/index.mjs';
import * as pi from '../src/agents/pi.mjs';
import * as agy from '../src/agents/antigravity.mjs';
import { AGENT_IDS, AGENT_LABELS, OFF_BY_DEFAULT, DEFAULT_CONFIG as DEFAULTS } from '../src/platform/config-file.mjs';
import { AGENT_KEY_NAMES, agentKeyEnv, agentKeyState, saveAgentKey, agentKeyId } from '../src/domain/security/agent-keys.mjs';
import { METHODS, UNLOCK_METHODS, needsUnlock } from '../src/domain/security/permissions.mjs';

const SECRET = 'xai-SECRETO-1234567890';
let dir; const lives = [];
before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-nuevos-')); });
after(() => { for (const l of lives) l.close(); try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* temp */ } });
const node = (script) => ({ cmd: process.execPath, pre: [fake(script)] });
const track = (live) => { lives.push(live); return live; };

// a vault in memory with the same surface as src/domain/security/master.mjs (unlocked, get, set)
function vault(unlocked = true) {
  const m = new Map();
  return { unlocked: () => unlocked, get: (id) => m.get(id) ?? null, set: (id, v) => { if (v === null) m.delete(id); else m.set(id, v); }, ids: () => [...m.keys()], m };
}

test('the new agents are registered, off by default and in the selector lists', () => {
  const ids = ['grok', 'devin', 'droid', 'omp', 'pi', 'antigravity'];
  for (const id of ids) {
    assert.ok(AGENT_IDS.includes(id), id);
    assert.ok(AGENT_LABELS[id], id);
    assert.ok(OFF_BY_DEFAULT.includes(id), id);
    assert.equal(DEFAULTS.agents[id].enabled, false, `${id} starts off`);
    assert.ok(DEFAULTS.agentOrder.includes(id), id);
    assert.ok(ADAPTERS[id], id);
    assert.equal(typeof ADAPTERS[id].createLive, 'function');
  }
  assert.deepEqual(OFF_BY_DEFAULT.filter((id) => !AGENT_IDS.includes(id)), []);
});

test('ACP specs: arguments, key names from the vault table, flagged as not verified', () => {
  assert.deepEqual(ACP_SPECS.devin.acpArgs, ['acp']);
  assert.deepEqual(ACP_SPECS.droid.acpArgs, ['exec', '--output-format', 'acp']);
  for (const id of ['grok', 'devin', 'droid', 'omp']) {
    assert.equal(ACP_SPECS[id].unverified, true, `${id} was not checked against the real program`);
    assert.equal(ACP_SPECS[id].pkg, undefined);
    assert.deepEqual([...ACP_SPECS[id].keyEnv], [...(AGENT_KEY_NAMES[id] ?? [])]);
  }
  assert.deepEqual([...AGENT_KEY_NAMES.grok], ['XAI_API_KEY']);
  assert.deepEqual([...AGENT_KEY_NAMES.devin], ['WINDSURF_API_KEY']);
  assert.deepEqual([...AGENT_KEY_NAMES.droid], ['FACTORY_API_KEY']);
  assert.equal(AGENT_KEY_NAMES.omp, undefined, 'Oh My Pi keeps its own login in ~/.omp');
});

test('ACP: each new agent starts its program with its own arguments and the key reaches only its environment', async () => {
  for (const id of ['grok', 'devin', 'droid', 'omp']) {
    const agent = acpAgent(id, ACP_SPECS[id]);
    const argvFile = path.join(dir, `${id}-argv.json`); const envFile = path.join(dir, `${id}-env.json`);
    const events = [];
    const live = track(agent.createLive({ exe: node('fake-acp.mjs'), cwd: dir, env: { FAKE_ACP_ARGV: argvFile, FAKE_ACP_ENVDUMP: envFile, XAI_API_KEY: SECRET }, secretValues: [SECRET], permission: 'editar', onEvent: (e) => events.push(e), mcpServers: {} }));
    const r = await live.send({ text: 'hola' });
    assert.equal(r.isError, false, `${id}: ${r.final}`);
    assert.deepEqual(JSON.parse(fs.readFileSync(argvFile, 'utf8')), ACP_SPECS[id].acpArgs, id);
    assert.equal(JSON.parse(fs.readFileSync(envFile, 'utf8')).XAI_API_KEY, SECRET, 'the program gets its key');
    assert.ok(events.some((e) => e.type === 'item' && e.kind === 'status' && e.body === ACP_SPECS[id].label));
    live.close();
  }
});

test('ACP: the key never shows in the events or the log when the program echoes it', async () => {
  const lines = []; const events = [];
  const agent = acpAgent('grok', ACP_SPECS.grok);
  const live = track(agent.createLive({ exe: node('fake-acp.mjs'), cwd: dir, env: { XAI_API_KEY: SECRET }, secretValues: [SECRET], permission: 'editar', onEvent: (e) => events.push(e), log: (l) => lines.push(l), mcpServers: {} }));
  const r = await live.send({ text: 'FUGA' });
  assert.equal(r.isError, true);
  await until(() => events.some((e) => e.type === 'exit'), 'exit event', 10000);
  const everything = JSON.stringify({ events, lines, r });
  assert.ok(!everything.includes(SECRET), 'the key is hidden everywhere');
  assert.ok(everything.includes('fallo con ***'), 'the message stays, the value goes');
});

test('ACP: the key never shows on a permission card, in the command or in its input', async () => {
  const events = [];
  const agent = acpAgent('grok', ACP_SPECS.grok);
  const live = track(agent.createLive({ exe: node('fake-acp.mjs'), cwd: dir, env: { XAI_API_KEY: SECRET }, secretValues: [SECRET], permission: 'editar', onEvent: (e) => events.push(e), log: () => {}, mcpServers: {} }));
  const turn = live.send({ text: 'PERMISO_CLAVE' });
  const req = await until(() => events.find((e) => e.type === 'approval'), 'permission card', 10000);
  assert.ok(!JSON.stringify(req).includes(SECRET), 'the card hides the key');
  assert.ok(JSON.stringify(req).includes('***'), 'and says something was hidden');
  live.respond(req.request.id, 'deny'); await turn;
  assert.ok(!JSON.stringify(events).includes(SECRET), 'no event has it');
});

test('vault: only the names of an agent\'s table are stored or handed over; values never come back from the state', () => {
  const m = vault();
  assert.equal(saveAgentKey(m, 'grok', 'XAI_API_KEY', SECRET), true);
  assert.equal(m.get(agentKeyId('grok', 'XAI_API_KEY')), SECRET);
  assert.throws(() => saveAgentKey(m, 'grok', 'PATH', 'x'), /name/);
  assert.throws(() => saveAgentKey(m, 'grok', 'NODE_OPTIONS', '--require x'), /name/);
  assert.throws(() => saveAgentKey(m, 'devin', 'XAI_API_KEY', 'x'), /name/, 'a key of another agent');
  assert.throws(() => saveAgentKey(m, 'claude', 'XAI_API_KEY', 'x'), /name/);
  assert.throws(() => saveAgentKey(m, '__proto__', 'XAI_API_KEY', 'x'), /name/);
  assert.throws(() => saveAgentKey(m, 'grok', 'XAI_API_KEY', 'a\nb'), /value/);
  assert.throws(() => saveAgentKey(m, 'grok', 'XAI_API_KEY', 'x'.repeat(9000)), /value/);
  assert.throws(() => saveAgentKey(m, 'grok', 'XAI_API_KEY', 42), /value/);
  assert.deepEqual(agentKeyEnv(m, 'grok'), { XAI_API_KEY: SECRET });
  assert.deepEqual(agentKeyEnv(m, 'devin'), {}, 'each agent gets only its own');
  assert.deepEqual(agentKeyEnv(m, 'claude'), {});
  assert.deepEqual(agentKeyEnv(m, '__proto__'), {});
  const state = agentKeyState(m);
  assert.equal(state.grok.XAI_API_KEY, true);
  assert.equal(state.devin.WINDSURF_API_KEY, false);
  assert.ok(!JSON.stringify(state).includes(SECRET));
  assert.equal(saveAgentKey(m, 'grok', 'XAI_API_KEY', ''), false, 'an empty value removes it');
  assert.deepEqual(agentKeyEnv(m, 'grok'), {});
});

test('vault: while it is locked nothing is handed over and nothing is reported', () => {
  const m = vault(true); m.set(agentKeyId('grok', 'XAI_API_KEY'), SECRET);
  const locked = { ...m, unlocked: () => false };
  assert.deepEqual(agentKeyEnv(locked, 'grok'), {});
  assert.equal(agentKeyState(locked).grok.XAI_API_KEY, false);
  assert.deepEqual(agentKeyEnv(null, 'grok'), {});
});

test('permissions: saving a key needs the unlock and the PC; the state needs only the PC', () => {
  assert.equal(METHODS['agentKeys.state'], 'pc');
  assert.equal(METHODS['agentKeys.save'], 'pc');
  assert.ok(UNLOCK_METHODS.has('agentKeys.save'));
  assert.equal(needsUnlock('agentKeys.save', {}), true);
  assert.equal(needsUnlock('agentKeys.state', {}), false);
});

// ---- Pi (RPC) ----------------------------------------------------------------------------------------------------------
function openPi(options = {}) {
  const events = [];
  const live = track(pi.createLive({ exe: node('fake-pi.mjs'), cwd: dir, env: {}, permission: 'total', onEvent: (e) => events.push(e), mcpServers: {}, ...options }));
  return { live, events };
}

test('Pi: starts in RPC mode, streams the answer and shows tools', async () => {
  const argvFile = path.join(dir, 'pi-argv.json');
  const { live, events } = openPi({ env: { FAKE_PI_ARGV: argvFile }, model: 'modelo-x' });
  const r = await live.send({ text: 'HERRAMIENTA lee a.txt' });
  assert.equal(r.isError, false, r.final);
  assert.match(r.final, /^Hola desde Pi: HERRAMIENTA lee a\.txt/);
  assert.deepEqual(JSON.parse(fs.readFileSync(argvFile, 'utf8')), ['--mode', 'rpc', '--model', 'modelo-x']);
  assert.equal(events.filter((e) => e.type === 'delta').map((e) => e.text).join(''), r.final);
  const tools = events.filter((e) => e.role === 'tool');
  assert.equal(tools[0].kind, 'tool'); assert.equal(tools[0].body.name, 'read');
  assert.deepEqual(tools[1].body, { id: 't1', output: 'contenido', error: false });
  const second = await live.send({ text: 'otra vez' });
  assert.match(second.final, /Pi: otra vez/, 'the same process takes the next turn');
  assert.equal(typeof live.pid, 'number');
});

test('Pi: abort stops the turn, a failed command is an error, a crash does not leak the key', async () => {
  const a = openPi();
  const turn = a.live.send({ text: 'ESPERA' });
  await until(() => a.live.pid !== null, 'process', 5000);
  await new Promise((resolve) => setTimeout(resolve, 300));
  await a.live.interrupt();
  assert.equal((await turn).isError, false);
  const f = openPi();
  const failed = await f.live.send({ text: 'FALLA' });
  assert.equal(failed.isError, true); assert.equal(failed.final, 'sin modelo');
  const lines = [];
  const c = openPi({ env: { XAI_API_KEY: SECRET }, secretValues: [SECRET], log: (l) => lines.push(l) });
  const crashed = await c.live.send({ text: 'FUGA' });
  assert.equal(crashed.isError, true);
  await until(() => c.events.some((e) => e.type === 'exit'), 'exit', 10000);
  assert.ok(!JSON.stringify({ lines, events: c.events, crashed }).includes(SECRET));
});

test('Pi and Antigravity refuse the permission levels they cannot keep, before starting any process', () => {
  for (const mod of [pi, agy]) {
    for (const permission of ['leer', 'probar', 'preguntar', 'editar', 'auto', undefined]) {
      assert.throws(() => mod.createLive({ exe: node('fake-pi.mjs'), cwd: dir, env: {}, permission, mcpServers: {} }), (e) => e.userFacing === true && /Orb/.test(e.message), `${mod.id} ${permission}`);
    }
    for (const permission of ['total']) track(mod.createLive({ exe: node('fake-pi.mjs'), cwd: dir, env: {}, permission, mcpServers: {} })); // no throw, nothing started until send
    const live = track(mod.createLive({ exe: node('fake-pi.mjs'), cwd: dir, env: {}, permission: 'total', mcpServers: {} }));
    assert.equal(live.pid, null, 'no process before the first message');
    live.setPermission('preguntar'); // never throws (a revoke must go on), the process ends
    assert.equal(live.isClosed(), true);
    assert.equal(mod.caps.approvals, false);
    assert.equal(mod.unverified, true);
  }
});

test('Pi: detect() finds nothing without the program and takes a hand-set path', () => {
  assert.equal(pi.detect({}), null);
  assert.deepEqual(pi.detect({ path: fake('fake-pi.mjs') }), { cmd: fake('fake-pi.mjs'), pre: [] });
});

// ---- Antigravity (print mode) ------------------------------------------------------------------------------------------
function openAgy(options = {}) {
  const events = [];
  const live = track(agy.createLive({ exe: node('fake-agy.mjs'), cwd: dir, env: {}, permission: 'total', onEvent: (e) => events.push(e), mcpServers: {}, ...options }));
  return { live, events };
}

test('Antigravity: one process per turn in print mode, the prompt as the last argument', async () => {
  const argvFile = path.join(dir, 'agy-argv.json');
  const { live, events } = openAgy({ env: { FAKE_AGY_ARGV: argvFile } });
  const r = await live.send({ text: 'resume el repo' });
  assert.equal(r.isError, false, r.final);
  assert.equal(r.final, 'Antigravity dice: resume el repo');
  assert.deepEqual(JSON.parse(fs.readFileSync(argvFile, 'utf8')), ['--print', '--', 'resume el repo']);
  assert.ok(events.some((e) => e.type === 'delta'));
  assert.equal(live.sessionId, null, 'no conversation to resume');
});

test('Antigravity: a long prompt goes on stdin, not on the command line', async () => {
  const argvFile = path.join(dir, 'agy-argv2.json'); const stdinFile = path.join(dir, 'agy-stdin.txt');
  const { live } = openAgy({ env: { FAKE_AGY_ARGV: argvFile, FAKE_AGY_STDIN: stdinFile } });
  const long = 'x'.repeat(agy.PROMPT_MAX + 10);
  const r = await live.send({ text: long });
  assert.equal(r.isError, false, r.final);
  assert.deepEqual(JSON.parse(fs.readFileSync(argvFile, 'utf8')), ['--print']);
  assert.equal(fs.readFileSync(stdinFile, 'utf8'), long);
});

test('Antigravity: a failure says why, and the key never leaks', async () => {
  const failed = await openAgy().live.send({ text: 'FALLA' });
  assert.equal(failed.isError, true); assert.match(failed.final, /sin sesión iniciada/);
  const { live } = openAgy({ env: { XAI_API_KEY: SECRET }, secretValues: [SECRET] });
  const r = await live.send({ text: 'FUGA' });
  assert.equal(r.isError, true);
  assert.ok(!JSON.stringify(r).includes(SECRET)); assert.match(r.final, /fallo con \*\*\*/);
});

test('Antigravity: interrupt stops the process of the turn', async () => {
  const { live } = openAgy();
  const turn = live.send({ text: 'LENTO' });
  await until(() => live.pid !== null, 'process', 5000);
  const pid = live.pid;
  await live.interrupt();
  const r = await turn;
  assert.equal(r.isError, true);
  await until(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, 'process gone', 10000);
});

test('ACP: the key echoed by an agent in its answer or a tool never reaches the events', async () => {
  const events = [];
  const agent = acpAgent('grok', ACP_SPECS.grok);
  const live = track(agent.createLive({ exe: node('fake-acp.mjs'), cwd: dir, env: {}, secretValues: [SECRET], permission: 'editar', onEvent: (e) => events.push(e), mcpServers: {} }));
  const r = await live.send({ text: `repite ${SECRET}` });
  assert.ok(!JSON.stringify({ events, r }).includes(SECRET));
  assert.match(r.final, /\*\*\*/);
});
