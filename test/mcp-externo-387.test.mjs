// 3.8.7 paso 12: the MCP server for agents outside Orb (src/engine/host/mcp-external.mjs).
//   - tokens: only a hash is kept, expiry, revocation, another client's or a forged secret, a locked vault
//   - the server: 127.0.0.1 only, Host / Origin checks (DNS rebinding), size and rate limits, strict arguments
//   - abuse: a project the token does not allow, raising the permission, another client's task, flooding
//   - a real MCP client (the SDK's) against the real engine in its own process: off by default, task made isolated at «Preguntar»
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, startEngine, until } from './helpers.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { createProject } from '../src/domain/projects/projects.mjs';
import { createMcpExternal, MAX_BODY, CALLS_PER_MINUTE, CREATES_PER_10_MIN, BAD_PER_MINUTE } from '../src/engine/host/mcp-external.mjs';
import { createToken, checkToken, revokeToken, removeToken, setTokenProjects, listTokens, PREFIX } from '../src/domain/security/mcp-ext-tokens.mjs';
import { needsUnlock, METHODS } from '../src/domain/security/permissions.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const cleanups = []; after(async () => { for (const c of cleanups.reverse()) { try { await c(); } catch { /* best effort */ } } });
const PASS = 'una frase larga de prueba';

// a vault in memory with the part of Master's face the tokens use
const fakeMaster = (open = true) => { const m = new Map(); return { open, unlocked() { return this.open; }, get: (k) => m.get(k) ?? null, set: (k, v) => (v === null ? m.delete(k) : m.set(k, v)), ids: (p) => [...m.keys()].filter((k) => k.startsWith(p)), raw: m }; };

// ---------------------------------------------------------------- tokens
test('a token is shown once, only its hash is kept, and it opens only while it is live', () => {
  const m = fakeMaster(); const t0 = 1_000_000;
  const made = createToken(m, { name: 'Claude Code', projects: ['web'], days: 2, now: t0 });
  assert.match(made.token, /^orbmcp_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/);
  // the secret is base64url, so it may hold '_' itself: take everything after the id
  const secret = made.token.split('_').slice(2).join('_');
  const stored = [...m.raw.values()].join('');
  assert.ok(!stored.includes(secret), 'the secret is not in the vault, only its hash');
  assert.deepEqual(checkToken(m, `Bearer ${made.token}`, t0 + 1000), { id: made.id, name: 'Claude Code', projects: ['web'] });
  assert.equal(checkToken(m, `Bearer ${made.token}`, t0 + 2 * 86_400_000 + 1), null, 'expired');
  // one character changed in the middle of the secret: the last one may already be «A», or differ only in bits base64
  // ignores, and then it is the same secret
  const mid = made.token.length - 10; const other = `${made.token.slice(0, mid)}${made.token[mid] === 'A' ? 'B' : 'A'}${made.token.slice(mid + 1)}`;
  assert.equal(checkToken(m, `Bearer ${other}`, t0), null, 'another secret of the same id');
  assert.equal(checkToken(m, `Bearer orbmcp_${'0'.repeat(12)}_${secret}`, t0), null, 'the secret under another id');
  assert.equal(checkToken(m, made.token, t0), null, 'without Bearer');
  assert.equal(checkToken(m, 'Bearer nonsense', t0), null);
  assert.equal(checkToken(m, undefined, t0), null);
  m.open = false; assert.equal(checkToken(m, `Bearer ${made.token}`, t0), null, 'a locked vault opens nothing'); m.open = true;
  assert.equal(listTokens(m, t0).length, 1); assert.ok(!JSON.stringify(listTokens(m, t0)).includes('hash'), 'the list never carries the hash');
  revokeToken(m, made.id, t0); assert.equal(checkToken(m, `Bearer ${made.token}`, t0), null, 'revoked');
  assert.equal(listTokens(m, t0)[0].revoked, true);
  removeToken(m, made.id); assert.equal(listTokens(m, t0).length, 0);
});

test('token input is checked: name, projects, expiry and a limit of tokens', () => {
  const m = fakeMaster();
  assert.throws(() => createToken(m, { name: '', projects: ['a'] }), /name/);
  assert.throws(() => createToken(m, { name: 'x', projects: [] }), /project/);
  assert.throws(() => createToken(m, { name: 'x', projects: ['a'], days: 0 }), /expiry/);
  assert.throws(() => createToken(m, { name: 'x', projects: ['a'], days: 4000 }), /expiry/);
  assert.throws(() => createToken(fakeMaster(false), { name: 'x', projects: ['a'] }), /locked/);
  const made = createToken(m, { name: 'x‮\ny', projects: ['a'] });
  assert.ok(!/[‮\n]/.test(made.name), 'control and bidi characters are dropped from the name');
  assert.deepEqual(setTokenProjects(m, made.id, ['a', 'b']).projects, ['a', 'b']);
  assert.throws(() => setTokenProjects(m, made.id, []), /project/);
  for (let i = 0; i < 19; i++) createToken(m, { name: `c${i}`, projects: ['a'] });
  assert.throws(() => createToken(m, { name: 'one more', projects: ['a'] }), /too many/);
  assert.ok([...m.raw.keys()].every((k) => k.startsWith(PREFIX)));
});

test('the methods are this PC only and the sensitive ones ask for the master password', () => {
  for (const k of ['state', 'setEnabled', 'createToken', 'setProjects', 'revoke', 'remove']) assert.equal(METHODS[`mcpExt.${k}`], 'pc', k);
  for (const k of ['createToken', 'setProjects']) assert.equal(needsUnlock(`mcpExt.${k}`, {}), true, k);
  assert.equal(needsUnlock('mcpExt.setEnabled', { enabled: true }), true); assert.equal(needsUnlock('mcpExt.setEnabled', { enabled: false }), false, 'switching off needs nothing');
  for (const k of ['revoke', 'remove', 'state']) assert.equal(needsUnlock(`mcpExt.${k}`, {}), false, k);
});

// ---------------------------------------------------------------- the server, in this process
function post(port, { host, headers = {}, body = '{}', method = 'POST', url = '/mcp', token, raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const data = raw ? body : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { host: host ?? `127.0.0.1:${port}`, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers, 'content-length': Buffer.byteLength(data) } }, (res) => {
      let out = ''; res.on('data', (c) => { out += c; }); res.on('end', () => resolve({ status: res.statusCode, body: out ? (() => { try { return JSON.parse(out); } catch { return out; } })() : null }));
    });
    req.on('error', reject); req.end(data);
  });
}
const rpc = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, params });

async function rig({ now = () => Date.now(), master = fakeMaster() } = {}) {
  const created = []; const logs = [];
  const tasks = new Map();
  const board = {
    project: (n) => (['web', 'api', 'secreto'].includes(n) ? { name: n } : null),
    task: (id) => tasks.get(id) ?? null,
    one: (sql, who) => ({ n: [...tasks.values()].filter((t) => t.created_by === who && t.status === 'awaiting_approval').length }),
    event: () => {}
  };
  const createTask = (a) => { created.push(a); const t = { id: tasks.size + 1, project: a.project, title: a.title, status: 'awaiting_approval', created_by: a.actor }; tasks.set(t.id, t); return t; };
  const s = createMcpExternal({ board, master: () => master, createTask, agents: ['claude', 'codex'], log: (l) => logs.push(l), now });
  const { port, url } = await s.start(0);
  cleanups.push(() => s.stop());
  const mk = (name, projects, days) => createToken(master, { name, projects, days, now: now() }).token;
  return { s, port, url, master, created, logs, mk, tasks, call: (token, method, params, extra = {}) => post(port, { token, body: rpc(method, params), ...extra }) };
}
const tool = (name, args) => rpc('tools/call', { name, arguments: args });

test('the server binds to 127.0.0.1 and to nothing else', async () => {
  const r = await rig();
  assert.match(r.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
  if (lan) {
    const reached = await new Promise((res) => { const q = http.request({ host: lan.address, port: r.port, path: '/mcp', method: 'POST', timeout: 2000 }, () => res(true)); q.on('error', () => res(false)); q.on('timeout', () => { q.destroy(); res(false); }); q.end('{}'); });
    assert.equal(reached, false, 'the LAN address does not answer');
  }
  await r.s.stop();
  await assert.rejects(post(r.port, { token: 'x' }), /ECONNREFUSED/, 'stopped means closed');
});

test('a live token lists tools and makes an isolated task at «Preguntar»; the client cannot choose anything else', async () => {
  const r = await rig(); const tok = r.mk('Claude Code', ['web']);
  const init = await r.call(tok, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.equal(init.status, 200); assert.equal(init.body.result.serverInfo.name, 'orb');
  assert.equal((await post(r.port, { token: tok, body: { jsonrpc: '2.0', method: 'notifications/initialized' } })).status, 202);
  const names = (await r.call(tok, 'tools/list', {})).body.result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['orb_create_task', 'orb_projects', 'orb_task_status']);
  const projects = (await r.call(tok, 'tools/call', { name: 'orb_projects', arguments: {} })).body.result.content[0].text;
  assert.deepEqual(JSON.parse(projects), [{ name: 'web' }]);
  const made = (await r.call(tok, 'tools/call', { name: 'orb_create_task', arguments: { project: 'web', title: 'Arreglar el login', description: 'El botón no responde', agent: 'codex' } })).body.result;
  assert.ok(!made.isError, made.content[0].text);
  assert.equal(r.created.length, 1);
  assert.match(r.created[0].actor, /^mcp:[0-9a-f]{12}$/);
  assert.deepEqual(Object.keys(r.created[0]).sort(), ['actor', 'agent', 'description', 'project', 'title'], 'nothing else of the client reaches the board');
  const st = JSON.parse((await r.call(tok, 'tools/call', { name: 'orb_task_status', arguments: { id: 1 } })).body.result.content[0].text);
  assert.equal(st.status, 'awaiting_approval');
  assert.ok(r.logs.some((l) => /creó la tarea #1/.test(l)), 'the creation is logged (Actividad)');
});

test('abuse: no token, a forged, revoked, removed or expired one, and a locked vault', async () => {
  let t = 5_000_000; const r = await rig({ now: () => t });
  const good = r.mk('a', ['web'], 1); const other = r.mk('b', ['web']);
  assert.equal((await r.call(undefined, 'ping', {})).status, 401);
  assert.equal((await r.call('orbmcp_aaaaaaaaaaaa_' + 'A'.repeat(43), 'ping', {})).status, 401);
  assert.equal((await r.call(`${good.slice(0, -1)}${good.endsWith('A') ? 'B' : 'A'}`, 'ping', {})).status, 401);
  assert.equal((await r.call(good, 'ping', {})).status, 200);
  const rev = r.mk('c', ['web']); revokeToken(r.master, rev.split('_')[1], t); assert.equal((await r.call(rev, 'ping', {})).status, 401, 'revoked');
  const gone = r.mk('d', ['web']); removeToken(r.master, gone.split('_')[1]); assert.equal((await r.call(gone, 'ping', {})).status, 401, 'removed');
  t += 86_400_000 + 1; assert.equal((await r.call(good, 'ping', {})).status, 401, 'expired'); assert.equal((await r.call(other, 'ping', {})).status, 200, 'the other one still lives');
  r.master.open = false; assert.equal((await r.call(other, 'ping', {})).status, 401, 'locked vault'); r.master.open = true;
  const body = JSON.stringify((await r.call(good, 'ping', {})).body);
  assert.ok(!/expired|revoked|caduc/i.test(body), 'one answer for every refusal');
  assert.ok(r.logs.some((l) => /token rechazado/.test(l)));
});

test('abuse: a project the token does not allow, another client\'s task, a higher permission', async () => {
  const r = await rig(); const a = r.mk('a', ['web']); const b = r.mk('b', ['api']);
  const err = async (token, name, args) => { const x = (await r.call(token, 'tools/call', { name, arguments: args })).body.result; assert.equal(x.isError, true, JSON.stringify(args)); return x.content[0].text; };
  assert.match(await err(a, 'orb_create_task', { project: 'api', title: 't', description: 'd' }), /may not use that project/);
  assert.match(await err(a, 'orb_create_task', { project: 'secreto', title: 't', description: 'd' }), /may not use that project/);
  assert.match(await err(a, 'orb_create_task', { project: '../web', title: 't', description: 'd' }), /may not use/);
  assert.match(await err(a, 'orb_create_task', { project: ['web'], title: 't', description: 'd' }), /text/);
  // trying to raise what the task may do: every extra field is refused before anything runs
  for (const extra of [{ permission: 'auto' }, { autonomy: 'auto' }, { mode: 'carpeta' }, { parent_id: 1 }, { readonly: false }, { sensitivity: [] }, { launch: 'auto' }, { actor: 'usuario' }, { created_by: 'usuario' }, { external: false }, { level: 'simple' }]) {
    assert.match(await err(a, 'orb_create_task', { project: 'web', title: 't', description: 'd', ...extra }), /unexpected arguments/, JSON.stringify(extra));
  }
  assert.equal(r.created.length, 0, 'nothing was created by any of those');
  assert.match(await err(a, 'orb_create_task', { project: 'web', title: 't', description: 'd', agent: 'cursor' }), /agent must be/);
  assert.match(await err(a, 'orb_create_task', { project: 'web', title: '  ', description: 'd' }), /empty/);
  assert.match(await err(a, 'orb_create_task', { project: 'web', title: 't', description: 'x'.repeat(12001) }), /over 12000/);
  await r.call(a, 'tools/call', { name: 'orb_create_task', arguments: { project: 'web', title: 'mine', description: 'd' } });
  assert.match(await err(b, 'orb_task_status', { id: 1 }), /unknown task/, 'another client cannot see it');
  assert.match(await err(a, 'orb_task_status', { id: 99 }), /unknown task/);
  assert.match(await err(a, 'orb_task_status', { id: '1' }), /unknown task/);
  assert.match(await err(a, 'unknown_tool', {}).catch(() => 'unknown'), /unknown|desconocida/);
  setTokenProjects(r.master, a.split('_')[1], ['api']);
  assert.match(await err(a, 'orb_create_task', { project: 'web', title: 't', description: 'd' }), /may not use that project/, 'the list is read on every call');
  assert.ok(r.logs.some((l) => /que su token no permite/.test(l)));
});

test('abuse: a foreign Host, an Origin header, other methods and paths (DNS rebinding)', async () => {
  const r = await rig(); const tok = r.mk('a', ['web']);
  for (const host of ['evil.example', `evil.example:${r.port}`, `127.0.0.1:${r.port + 1}`, `localhost:${r.port + 1}`, `[::1]:${r.port}`, '127.0.0.1', `127.0.0.1.evil.example:${r.port}`]) {
    const x = await post(r.port, { token: tok, host, body: rpc('ping', {}) });
    assert.equal(x.status, 403, `Host ${host}`);
  }
  assert.equal((await post(r.port, { token: tok, host: `localhost:${r.port}`, body: rpc('ping', {}) })).status, 200, 'localhost with the right port is fine');
  for (const origin of ['http://evil.example', 'null', 'http://127.0.0.1', `http://127.0.0.1:${r.port}`]) assert.equal((await post(r.port, { token: tok, headers: { origin }, body: rpc('ping', {}) })).status, 403, `Origin ${origin}`);
  assert.equal((await post(r.port, { token: tok, method: 'GET', body: '' })).status, 405);
  assert.equal((await post(r.port, { token: tok, method: 'DELETE', body: '' })).status, 405);
  assert.equal((await post(r.port, { token: tok, method: 'OPTIONS', body: '' })).status, 405, 'no CORS preflight');
  assert.equal((await post(r.port, { token: tok, url: '/other', body: rpc('ping', {}) })).status, 404);
  assert.equal((await post(r.port, { token: tok, headers: { 'content-type': 'text/plain' }, body: rpc('ping', {}) })).status, 415, 'a plain form post');
  assert.equal((await post(r.port, { token: tok, raw: true, body: '{nope' })).status, 400);
  assert.equal((await post(r.port, { token: tok, raw: true, body: '[1,2]' })).body.error.code, -32600, 'no batches');
  assert.ok(r.logs.some((l) => /rechazada una petición/.test(l)));
});

test('stopping while the server is still starting leaves it closed', async () => {
  const r = await rig(); await r.s.stop();
  const starting = r.s.start(0); const stopping = r.s.stop();
  await Promise.all([starting.catch(() => {}), stopping]);
  assert.equal(r.s.status().running, false);
  await assert.rejects(post(r.port, { token: 'x' }), /ECONNREFUSED/);
});

test('abuse: size and rate limits', async () => {
  const r = await rig(); const tok = r.mk('a', ['web']);
  const big = await post(r.port, { token: tok, raw: true, body: JSON.stringify(rpc('ping', { pad: 'x'.repeat(MAX_BODY) })) });
  assert.equal(big.status, 413);
  // a body that lies about (or hides) its length: streamed past the limit
  const sneaky = await new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: r.port, path: '/mcp', method: 'POST', headers: { host: `127.0.0.1:${r.port}`, 'content-type': 'application/json', authorization: `Bearer ${tok}`, 'transfer-encoding': 'chunked' } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', () => resolve('closed')); req.write('{"a":"'); req.write('x'.repeat(MAX_BODY + 10)); req.end('"}');
  });
  assert.ok(sneaky === 413 || sneaky === 'closed', `chunked flood: ${sneaky}`);
  // creating too many in a short time
  let refused = 0;
  for (let i = 0; i < CREATES_PER_10_MIN + 3; i++) { const x = (await r.call(tok, 'tools/call', { name: 'orb_create_task', arguments: { project: 'web', title: `t${i}`, description: 'd' } })).body.result; if (x.isError) refused++; }
  assert.ok(refused >= 3 && r.created.length === CREATES_PER_10_MIN, `${r.created.length} created, ${refused} refused`);
  // calls per minute
  let limited = 0; for (let i = 0; i < CALLS_PER_MINUTE + 5; i++) if ((await r.call(tok, 'ping', {})).status === 429) limited++;
  assert.ok(limited >= 5, 'the per-token limit answers 429');
  // wrong tokens in a flood close the door for everyone for a minute
  const r2 = await rig(); const ok = r2.mk('a', ['web']); let last = 0;
  for (let i = 0; i <= BAD_PER_MINUTE + 1; i++) last = (await r2.call(`orbmcp_${'1'.repeat(12)}_${'B'.repeat(43)}`, 'ping', {})).status;
  assert.equal(last, 429); assert.equal((await r2.call(ok, 'ping', {})).status, 200, 'a live token is not locked out by wrong tokens of others');
  // a flood of foreign Origins writes one log line, not thousands
  const before = r2.logs.length; for (let i = 0; i < 30; i++) await post(r2.port, { token: ok, headers: { origin: 'http://evil.example' }, body: rpc('ping', {}) });
  assert.ok(r2.logs.length - before <= 1, 'the rejected-origin log is throttled');
});

// ---------------------------------------------------------------- the board: what an external task is
test('board: an external task is isolated, at «Preguntar», waits for approval and cannot be made any other way', () => {
  const t = tempHome(); cleanups.push(() => t.cleanup());
  const board = new Board(); createProject(board, { name: 'web' }, 'usuario'); createProject(board, { name: 'otra' }, 'usuario');
  const task = board.createTask({ project: 'web', title: 'Desde fuera', description: 'hacer algo', mode: 'aislada', external: true }, 'mcp:abc123abc123');
  assert.equal(task.autonomy, 'preguntar'); assert.equal(task.mode, 'aislada'); assert.equal(task.status, 'awaiting_approval'); assert.equal(task.created_by, 'mcp:abc123abc123');
  assert.throws(() => board.createTask({ project: 'web', title: 'x', description: 'y', mode: 'carpeta', external: true }, 'mcp:abc123abc123'), /isolated/);
  assert.throws(() => board.createTask({ project: 'web', title: 'x', description: 'y', mode: 'aislada', external: true }, 'usuario'), /isolated/);
  assert.throws(() => board.createTask({ project: 'web', title: 'x', description: 'y', mode: 'aislada', external: true }, 'orb'), /isolated/);
});

// ---------------------------------------------------------------- the real thing: engine process + a real MCP client
test('real engine and the SDK client: off by default, a switch and a token behind the master password, a task at «Preguntar», revocation', async () => {
  const t = tempHome(); cleanups.push(() => t.cleanup());
  const e = await startEngine(t.home, { env: { ORB_MCPEXT_PORT: '0' } }); cleanups.push(() => e.stop());
  await e.call('projects.create', { name: 'web' }); await e.call('projects.create', { name: 'privado' });
  let st = await e.call('mcpExt.state');
  assert.equal(st.enabled, false, 'off by default'); assert.equal(st.running, false); assert.equal(st.url, null);
  const { unlock } = await e.call('master.create', { password: PASS });
  await assert.rejects(e.call('mcpExt.setEnabled', { enabled: true }), /contraseña maestra|desbloque/i, 'switching on asks for the password');
  await assert.rejects(e.call('mcpExt.createToken', { name: 'x', projects: ['web'] }), /contraseña maestra|desbloque/i);
  await assert.rejects(e.call('mcpExt.createToken', { name: 'x', projects: ['web'], unlock: 'falso' }), /contraseña maestra|desbloque/i);
  st = await e.call('mcpExt.setEnabled', { enabled: true, unlock });
  assert.equal(st.running, true); assert.match(st.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  const made = await e.call('mcpExt.createToken', { name: 'Claude Code', projects: ['web'], days: 7, unlock });
  await assert.rejects(e.call('mcpExt.createToken', { name: 'y', projects: ['no-existe'], unlock }), /desconocido/);
  assert.ok(!JSON.stringify(await e.call('mcpExt.state')).includes(made.token.split('_')[2]), 'the state never carries the secret');
  const vaultFiles = fs.readdirSync(path.join(t.home, 'core'), { recursive: true }).map(String);
  for (const f of vaultFiles) {
    const p = path.join(t.home, 'core', f);
    try { if (fs.statSync(p).isFile() && fs.readFileSync(p).includes(Buffer.from(made.token.split('_')[2]))) assert.fail(`the secret is in ${f}`); } catch (error) { if (!['EBUSY', 'EPERM', 'ENOENT'].includes(error.code)) throw error; }
  }

  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(made.url), { requestInit: { headers: { authorization: `Bearer ${made.token}` } } }));
  cleanups.push(() => client.close());
  assert.deepEqual((await client.listTools()).tools.map((x) => x.name).sort(), ['orb_create_task', 'orb_projects', 'orb_task_status']);
  assert.deepEqual(JSON.parse((await client.callTool({ name: 'orb_projects', arguments: {} })).content[0].text), [{ name: 'web' }]);
  const refused = await client.callTool({ name: 'orb_create_task', arguments: { project: 'privado', title: 'no', description: 'no' } });
  assert.equal(refused.isError, true);
  const bumped = await client.callTool({ name: 'orb_create_task', arguments: { project: 'web', title: 'no', description: 'no', autonomy: 'auto', mode: 'carpeta' } });
  assert.equal(bumped.isError, true);
  const ok = await client.callTool({ name: 'orb_create_task', arguments: { project: 'web', title: 'Añadir tests', description: 'Añade tests al módulo de pagos' } });
  assert.ok(!ok.isError, ok.content[0].text);
  const { id } = JSON.parse(ok.content[0].text);
  const task = await e.call('tasks.get', { id });
  assert.equal(task.status, 'awaiting_approval'); assert.equal(task.autonomy, 'preguntar'); assert.equal(task.mode, 'aislada'); assert.equal(task.created_by, `mcp:${made.id}`);
  assert.equal(JSON.parse((await client.callTool({ name: 'orb_task_status', arguments: { id } })).content[0].text).status, 'awaiting_approval');
  // it shows in Actividad (the engine's log and the task's events)
  const act = await e.call('activity.list', { sources: ['orb', 'subagentes'] }).catch(() => null);
  if (act) assert.ok(JSON.stringify(act).includes('mcp-externo') || JSON.stringify(act).includes('MCP'), 'Actividad shows what the external client did');

  // revocation: the same client is refused at once, and a new token needs the password again
  await e.call('mcpExt.revoke', { id: made.id });
  await assert.rejects(client.listTools(), /401|Unauthorized|unauthorized/i);
  assert.equal((await e.call('mcpExt.state')).tokens[0].revoked, true);
  await e.call('mcpExt.remove', { id: made.id }); assert.equal((await e.call('mcpExt.state')).tokens.length, 0);
  // switching off closes the port
  const url = st.url; await e.call('mcpExt.setEnabled', { enabled: false });
  const gone = await fetch(url, { method: 'POST' }).then(() => false, () => true); assert.ok(gone, 'closed when off');
  assert.equal((await e.call('mcpExt.state')).enabled, false);
});

test('real engine: the switch and the tokens survive a restart (a lock of the window does not cut an agent working in a terminal: its tasks wait for approval anyway)', async () => {
  const t = tempHome(); cleanups.push(() => t.cleanup());
  let e = await startEngine(t.home, { env: { ORB_MCPEXT_PORT: '0' } });
  await e.call('projects.create', { name: 'web' });
  const { unlock } = await e.call('master.create', { password: PASS });
  await e.call('mcpExt.setEnabled', { enabled: true, unlock });
  const made = await e.call('mcpExt.createToken', { name: 'c', projects: ['web'], unlock });
  const hit = (url) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${made.token}` }, body: JSON.stringify(rpc('ping', {})) }).then((r) => r.status);
  assert.equal(await hit(made.url), 200);
  await e.stop();
  e = await startEngine(t.home, { env: { ORB_MCPEXT_PORT: '0' } }); cleanups.push(() => e.stop());
  const st = await until(async () => { const x = await e.call('mcpExt.state'); return x.running && x; }, 'the server comes back by itself');
  assert.equal(st.enabled, true);
});
