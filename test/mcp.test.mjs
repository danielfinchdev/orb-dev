// MCP server: who is who (the coordinator only with the secret key), which tools each one gets and strict arguments.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { tempHome, ROOT } from './helpers.mjs';
import { Board } from '../src/core/board.mjs';
import { createProject } from '../src/core/projects.mjs';
import { mcpServersFor } from '../src/engine/sessions.mjs';
import { agentAuth } from '../src/engine/agent-auth.mjs';
import { ctx } from '../src/core/context.mjs';
import { browserKey } from '../src/core/browser-key.mjs';

let t; let board;
// An agent's "orb" MCP server exactly as the engine hands it (with its ticket), or one started with only what its
// environment claims (no ticket, or a made-up one).
const signed = (agent, opts = {}) => mcpServersFor(agent, opts).orb;
const claims = (env = {}, ticket = '') => ({ command: process.execPath, args: [path.join(ROOT, 'src', 'mcp', 'server.mjs'), '--ticket-env=ORB_TICKET_orb'], env: { ...env, ORB_AUTH_PIPE: agentAuth.address, ORB_TICKET_orb: ticket } });
// The coordinator of a new conversation.
const bossServer = (project = 'web') => { const conv = board.createConversation({ title: 'Coordinador', project }).id; return signed('claude', { orchestrator: true, browser: false, session: `asistente-${conv}`, conversation: conv }); };
before(() => {
  t = tempHome(); board = new Board();
  createProject(board, { name: 'web' }, 'usuario');
});
after(() => t.cleanup());

function client(server) {
  const child = spawn(server.command, server.args, { env: { ...process.env, ORB_HOME: t.home, ...server.env }, stdio: ['pipe', 'pipe', 'inherit'] });
  const replies = new Map(); let n = 0;
  readline.createInterface({ input: child.stdout }).on('line', (l) => { const m = JSON.parse(l); replies.get(m.id)?.(m); });
  const rpc = (method, params) => new Promise((r) => { const id = ++n; replies.set(id, r); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  return {
    rpc,
    tools: async () => (await rpc('tools/list', {})).result.tools.map((x) => x.name),
    call: async (name, args) => { const r = (await rpc('tools/call', { name, arguments: args })).result; return { error: Boolean(r.isError), text: r.content[0].text }; },
    close: () => child.stdin.end()
  };
}

test('el coordinador solo se reconoce con su ticket del motor', async () => {
  const boss = client(bossServer());
  const fake = client(claims({ ORB_AGENT: 'orb', ORB_CONVERSATION: '1' }, 'b'.repeat(64)));
  const worker = client(signed('codex', { session: 'sesion-codex' }));
  const user = client(claims({ ORB_AGENT: 'usuario' }));
  try {
    for (const c of [boss, fake, worker]) await c.rpc('initialize', {});
    assert.ok((await boss.tools()).includes('orb_create_task'));
    assert.ok(!(await fake.tools()).includes('orb_create_task'), 'sin la clave no es el coordinador');
    assert.ok(!(await worker.tools()).includes('orb_write_log'));
    // An agent that starts its own MCP process cannot pose as the user (whose tasks skip the approval of agent-made ones).
    assert.match((await user.rpc('initialize', {})).result.instructions, /Tú eres "desconocido"/);
    const created = await boss.call('orb_create_task', { project: 'web', title: 'Portada', description: 'Haz la portada' });
    assert.equal(created.error, false, created.text);
    assert.equal(JSON.parse(created.text).status, 'queued');
    const forged = await worker.call('orb_send_message', { to: 'usuario', body: 'hola', from: 'orb' });
    assert.match(forged.text, /argumentos no permitidos: from/);
    const bad = await worker.call('orb_update_task', { id: 1, status: 'done', model: 'x' });
    assert.match(bad.text, /argumentos no permitidos/);
  } finally { boss.close(); fake.close(); worker.close(); user.close(); }
});

// 3.8.3 (what Orbe itself reported): «Pedido por» always said «(coordinación de Orbe)», and reading «the last entries»
// cut by characters, bringing pieces of old ones.
test('la bitácora: el pedido sale del último mensaje del usuario, y se leen entradas enteras, las que se pidan', async () => {
  const conv = board.createConversation({ title: 'Pedido', project: 'web' }).id;
  board.addChat('usuario', 'Haz la portada con el fondo azul', null, conv);
  const boss = client(signed('claude', { orchestrator: true, browser: false, session: `asistente-${conv}`, conversation: conv }));
  try {
    await boss.rpc('initialize', {});
    for (const n of [1, 2, 3]) assert.equal((await boss.call('orb_write_log', { project: 'web', tema: `Paso ${n}`, hecho: `hecho ${n} ${'z'.repeat(400)}` })).error, false);
    assert.equal((await boss.call('orb_write_log', { project: 'web', tema: 'Con pedido', pedido: 'Lo que dijo', hecho: 'ok' })).error, false);
    const all = (await boss.call('orb_read_log', { project: 'web' })).text;
    assert.match(all, /### .* — Paso 1\n- Pedido [^:]+: Haz la portada con el fondo azul\n/, 'sin pedido: su último mensaje');
    assert.match(all, /- Pedido [^:]+: Lo que dijo\n/);
    const one = (await boss.call('orb_read_log', { project: 'web', entradas: 1 })).text;
    assert.match(one, /^\(web: la entrada más reciente de \d+\)\n/);
    assert.match(one, /### .* — Con pedido\n/);
    assert.doesNotMatch(one, /Paso 3/, 'solo la última, entera');
    const tight = (await boss.call('orb_read_log', { project: 'web', chars: 1000 })).text;
    assert.doesNotMatch(tight, /\nzzz/, 'nunca un trozo suelto de una entrada anterior');
    assert.match(tight, /— Con pedido/);
  } finally { boss.close(); }
});

test('el coordinador crea proyectos, escribe bitácoras y no puede leer otra cosa que bitácoras', async () => {
  const boss = client(bossServer(null));
  try {
    await boss.rpc('initialize', {});
    const p = await boss.call('orb_create_project', { name: 'tienda' });
    assert.equal(p.error, false, p.text);
    const w = await boss.call('orb_write_log', { project: 'tienda', tema: 'Plan', hecho: 'Decidimos usar Codex para el backend. token ghp_abcdefghijklmnopqrstuvwx' });
    assert.equal(w.error, false, w.text);
    const r = await boss.call('orb_read_log', { project: 'tienda' });
    assert.match(r.text, /Decidimos usar Codex/);
    assert.doesNotMatch(r.text, /ghp_/, 'los secretos no llegan a la bitácora');
    assert.equal((await boss.call('orb_read_log', { project: '../../datos/clave.bin' })).error, true);
    assert.equal((await boss.call('orb_read_log', { project: 'web' })).error, true, 'la bitácora de un proyecto de otra conversación');
    assert.equal((await boss.call('orb_write_log', { project: 'web', tema: 'x', hecho: 'y' })).error, true);
    assert.match((await boss.call('orb_read_log', {})).text, /^general: [\s\S]*tienda: /);
    assert.doesNotMatch((await boss.call('orb_read_log', {})).text, /^web: /m, 'ni la lista muestra las de otros proyectos');
  } finally { boss.close(); board.setActiveProject('web', 'usuario'); }
});

test('3.8.1: la bitácora general en core: el coordinador lee y anota también en los archivos del usuario junto a ella', async () => {
  const dir = path.dirname(ctx.paths.generalLog);
  assert.equal(dir, path.join(t.home, 'core', 'bitacora'));
  fs.writeFileSync(path.join(dir, 'bitacora_project.md'), '# Índice central\n');
  fs.writeFileSync(path.join(dir, 'solo.md'), '# Solo lectura\n'); fs.chmodSync(path.join(dir, 'solo.md'), 0o444);
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true }); fs.writeFileSync(path.join(dir, 'sub', 'x.md'), 'x');
  const boss = client(bossServer(null));
  try {
    await boss.rpc('initialize', {});
    const w = await boss.call('orb_write_log', { project: 'general', archivo: 'bitacora_project.md', tema: 'Prueba', hecho: 'Anotado desde Orb' });
    assert.equal(w.error, false, w.text);
    assert.match(fs.readFileSync(path.join(dir, 'bitacora_project.md'), 'utf8'), /^# Índice central\n[\s\S]*### .* — Prueba\n[\s\S]*Anotado desde Orb/);
    assert.match((await boss.call('orb_read_log', { project: 'general', archivo: 'BITACORA_PROJECT.md' })).text, /Anotado desde Orb/);
    assert.match((await boss.call('orb_read_log', {})).text, /general \(archivo "bitacora_project\.md"\)/);
    for (const archivo of ['../core/orb.json', 'sub/x.md', 'sub\\x.md', 'no-existe.md']) {
      assert.equal((await boss.call('orb_write_log', { project: 'general', archivo, tema: 'x', hecho: 'y' })).error, true, archivo);
    }
    // GENERAL.md by its name is the general log itself.
    const g = await boss.call('orb_write_log', { project: 'general', archivo: 'GENERAL.md', tema: 'La general por su nombre', hecho: 'z' });
    assert.equal(g.error, false, g.text);
    assert.match(fs.readFileSync(ctx.paths.generalLog, 'utf8'), /La general por su nombre/);
    assert.equal((await boss.call('orb_write_log', { project: 'tienda', archivo: 'bitacora_project.md', tema: 'x', hecho: 'y' })).error, true, 'solo junto a la general');
    const ro = await boss.call('orb_write_log', { project: 'general', archivo: 'solo.md', tema: 'x', hecho: 'y' });
    assert.equal(ro.error, true); assert.match(ro.text, /solo lectura/);
    assert.equal(fs.readFileSync(path.join(dir, 'solo.md'), 'utf8'), '# Solo lectura\n', 'el archivo de solo lectura sigue igual');
  } finally { boss.close(); fs.chmodSync(path.join(dir, 'solo.md'), 0o666); board.setActiveProject('web', 'usuario'); }
});

test('un agente que arranca el MCP por su cuenta no se hace pasar por otro agente ni por otra tarea', async () => {
  const task = board.createTask({ project: 'web', title: 'Texto de la portada', description: 'Escribe el texto', agent: 'claude', launch: 'manual' }, 'orb');
  assert.equal(board.claimNext('claude', 'web')?.id, task.id);
  const otherTask = task.id + 1000;
  const says = client(claims({ ORB_AGENT: 'claude', ORB_TASK_ID: String(task.id) })); // no ticket
  const borrowed = client(signed('codex', { taskId: task.id, session: 'sesion-prestada' })); // codex's ticket: it is codex
  const madeUp = client(claims({ ORB_AGENT: 'claude' }, 'a'.repeat(64)));
  const otherTaskOf = client(signed('claude', { taskId: otherTask, session: 'sesion-otra' }));
  const real = client(signed('claude', { taskId: task.id, session: 'sesion-real' }));
  try {
    for (const c of [says, borrowed, madeUp, otherTaskOf, real]) await c.rpc('initialize', {});
    for (const c of [says, madeUp]) assert.match((await c.rpc('initialize', {})).result.instructions, /Tú eres "desconocido"/);
    assert.match((await borrowed.rpc('initialize', {})).result.instructions, /Tú eres "codex"/, 'lo que diga su entorno no cambia quién es');
    for (const c of [says, borrowed, madeUp, otherTaskOf]) assert.equal((await c.call('orb_update_task', { id: task.id, status: 'done', result: 'falso' })).error, true);
    assert.equal(board.task(task.id).status, 'running');
    assert.ok((await real.tools()).includes('orb_delegate'), 'la firma buena trae su tarea');
    const ok = await real.call('orb_update_task', { id: task.id, status: 'done', result: 'hecho' });
    assert.equal(ok.error, false, ok.text);
    assert.equal(board.task(task.id).status, 'done');
  } finally { for (const c of [says, borrowed, madeUp, otherTaskOf, real]) c.close(); }
});

test('el MCP no tiene la clave de aprobaciones: no puede firmar ni invalida las firmas buenas', async () => {
  const task = board.createTask({ project: 'web', title: 'Publicar', description: 'publica la web', agent: 'claude', launch: 'manual' }, 'orb');
  const ok = board.approve(task.id, 'approved', 'usuario', board.previewHash(task));
  assert.equal(ok.status, 'queued');
  const worker = client(signed('claude', { session: 'conversacion-directa' }));
  try {
    await worker.rpc('initialize', {});
    // claim_next re-checks approvals: without the secret it must not push signed tasks back to approval…
    const r = await worker.call('orb_claim_next', {});
    assert.match(r.text, /No hay tareas manuales/, 'una tarea sensible no se reclama desde el MCP (no puede verificar su firma)');
    assert.equal(board.task(task.id).status, 'queued', '…ni la devuelve a aprobación');
  } finally { worker.close(); }
});

test('herramientas del navegador: solo si la app lo ofrece, y se presentan con su clave y su conversación', async () => {
  const net = await import('node:net'); const os = await import('node:os');
  const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\orb-navegador-prueba-${process.pid}` : path.join(os.tmpdir(), `orb-navegador-prueba-${process.pid}.sock`);
  const seen = [];
  const server = net.createServer((s) => {
    let buf = '';
    s.on('data', (c) => { buf += c; let nl; while ((nl = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1); seen.push(m); s.write(`${JSON.stringify(m.hello ? { ok: true } : m.action === 'screenshot' ? { id: m.id, ok: true, result: { text: 'captura', image: 'AAAA' } } : { id: m.id, ok: true, result: `hecho ${m.action}` })}\n`); } });
  });
  await new Promise((r) => server.listen(pipe, r));
  const none = client(signed('claude', { taskId: 7, session: 'conv-0' }));
  ctx.browser = { pipe, token: 'f'.repeat(48) };
  const nav = client(signed('claude', { taskId: 7, session: 'conv-1' }));
  // An agent's own claims (env) give no browser: its pipe and key come from the engine.
  const posing = client(claims({ ORB_AGENT: 'claude', ORB_BROWSER_PIPE: pipe, ORB_BROWSER_TOKEN: 'f'.repeat(48), ORB_SESSION: 'conv-1' }));
  delete ctx.browser;
  try {
    await posing.rpc('initialize', {});
    assert.ok(!(await posing.tools()).some((n) => n.startsWith('orb_browser_')));
    await none.rpc('initialize', {}); await nav.rpc('initialize', {});
    assert.ok(!(await none.tools()).some((n) => n.startsWith('orb_browser_')), 'sin la app no hay navegador');
    assert.ok((await nav.tools()).includes('orb_browser_open'));
    assert.equal((await nav.call('orb_browser_open', { url: 'localhost:3000' })).text, 'hecho open');
    assert.deepEqual(seen[0], { hello: browserKey('f'.repeat(48), { agent: 'claude', session: 'conv-1', task: '7' }), agent: 'claude', task: '7', session: 'conv-1' });
    assert.deepEqual(seen[1].args, { url: 'localhost:3000' });
    const shot = (await nav.rpc('tools/call', { name: 'orb_browser_screenshot', arguments: {} })).result;
    assert.deepEqual(shot.content[1], { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' });
    assert.equal((await nav.call('orb_browser_click', { ref: 1, selector: 'a' })).error, true, 'argumentos fuera del esquema');
    // 3.2.1: the page's dialogs (accept / cancel / text for prompt) and its console.
    assert.equal((await nav.call('orb_browser_dialog', { accept: true, text: 'sí' })).text, 'hecho dialog');
    assert.deepEqual(seen.at(-1).args, { accept: true, text: 'sí' });
    assert.equal((await nav.call('orb_browser_console', {})).text, 'hecho console');
  } finally { none.close(); nav.close(); posing.close(); server.close(); }
});

// 3.8 (N3–N5): a user's connector reaches the agent as Orb's launcher and a ticket; its command, arguments and keys come
// from the engine, so they are not in the agent's config, its environment (its shell) or a session log. It stops when
// its agent's process closes.
test('conectores: la clave y la orden reales solo llegan al conector, y se para al cerrarse su agente', async () => {
  const fs = await import('node:fs');
  const { hidingEnvValues } = await import('../src/agents/live.mjs');
  const script = path.join(t.home, 'conector-falso.mjs');
  fs.writeFileSync(script, "process.stdout.write(JSON.stringify({ key: process.env.API_KEY, args: process.argv.slice(2), orb: Object.keys(process.env).filter((k) => /^ORB_|^ELECTRON_RUN/.test(k)) }) + '\\n'); setInterval(() => {}, 1000);\n");
  const cmd = path.join(t.home, 'conector falso.cmd');
  fs.writeFileSync(cmd, `@"${process.execPath}" "${script}" %*\r\n`);
  const saved = ctx.config.mcpServers;
  ctx.config.mcpServers = [{ name: 'falso', command: process.execPath, args: [script, 'con espacios & símbolos'], env: { API_KEY: 'clave-del-conector-123' } },
    ...(process.platform === 'win32' ? [{ name: 'porcmd', command: cmd, args: ['otro "arg"'], env: { API_KEY: 'clave-cmd-456' } }] : [])];
  try {
    const servers = mcpServersFor('claude', { taskId: 5, session: 'sesion-conector' });
    const config = JSON.stringify(servers);
    assert.ok(!config.includes('clave-del-conector-123') && !config.includes(script) && !config.includes('con espacios'), 'la config del agente solo lleva el lanzador y el ticket');
    const run = (s) => new Promise((resolve) => {
      const child = spawn(s.command, s.args, { env: { ...process.env, ...s.env }, stdio: ['pipe', 'pipe', 'inherit'] });
      readline.createInterface({ input: child.stdout }).once('line', (l) => resolve({ child, seen: JSON.parse(l) }));
    });
    const one = await run(servers.falso);
    assert.deepEqual(one.seen, { key: 'clave-del-conector-123', args: ['con espacios & símbolos'], orb: [] });
    const two = servers.porcmd ? await run(servers.porcmd) : null;
    if (two) assert.deepEqual(two.seen, { key: 'clave-cmd-456', args: ['otro "arg"'], orb: [] });
    // A copy of the ticket (what the agent's shell sees) gets nothing while the launcher holds it.
    const copy = spawn(servers.falso.command, servers.falso.args, { env: { ...process.env, ...servers.falso.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; copy.stdout.on('data', (c) => { out += c; });
    assert.notEqual(await new Promise((r) => copy.on('exit', r)), 0); assert.doesNotMatch(out, /clave/);
    // Its agent's process closes: the connector stops.
    const gone = Promise.all([one, two].filter(Boolean).map(({ child }) => new Promise((r) => child.stdout.on('close', () => r(true)))));
    agentAuth.revokeSession('sesion-conector');
    assert.ok(await Promise.race([gone, new Promise((r) => setTimeout(() => r(false), 8000))]), 'el conector (y lo que lanzó) se para');
    // ACP and Codex logs hide every value handed to the servers, whatever its name.
    const lines = []; const log = hidingEnvValues((l) => lines.push(l), { falso: { env: { CONTRASENA: 'valor-secreto-1', X: '1' } } });
    log('{"name":"CONTRASENA","value":"valor-secreto-1"}');
    assert.deepEqual(lines, ['{"name":"CONTRASENA","value":"***"}']);
  } finally { ctx.config.mcpServers = saved; agentAuth.revokeSession('sesion-conector'); }
});

// F2.6c (P4): Cursor starts its servers again every turn: it gets a function giving new tickets each turn, which may be
// traded again during the turn and end with it (release); every other agent gets its servers once, single-use tickets.
test('Cursor recibe tickets nuevos en cada turno y se revocan al terminarlo', async () => {
  const { mcpServersOf } = await import('../src/engine/sessions.mjs');
  const cursorLike = mcpServersOf({ mcpServersEachTurn: true }, 'cursor', { taskId: 3, session: 'sesion-cursor' });
  assert.equal(typeof cursorLike, 'function');
  const turn1 = cursorLike(); const turn2 = cursorLike();
  const ticketOf = (s) => s.orb.env.ORB_TICKET_orb;
  assert.notEqual(ticketOf(turn1), ticketOf(turn2));
  assert.equal(agentAuth.grants.get(ticketOf(turn1)).reusable, true);
  assert.ok(!Object.keys(turn1).includes('release'), 'release no es un servidor');
  turn1.release();
  assert.equal(agentAuth.valid(ticketOf(turn1)), false); assert.equal(agentAuth.valid(ticketOf(turn2)), true);
  const once = mcpServersOf({}, 'claude', { taskId: 3, session: 'sesion-claude' });
  assert.equal(agentAuth.grants.get(once.orb.env.ORB_TICKET_orb).reusable, false);
  agentAuth.revokeSession('sesion-cursor'); agentAuth.revokeSession('sesion-claude');
});

// F2.6c (P10): two connectors whose names give the same environment variable would swap tickets: refused when saved,
// and never both handed to an agent.
test('conectores con nombres que chocan en las variables de entorno', async () => {
  const { validateConfig } = await import('../src/core/context.mjs');
  const { mcpServersFor } = await import('../src/engine/sessions.mjs');
  const base = structuredClone(ctx.config);
  for (const pair of [['git-hub', 'git_hub'], ['GitHub', 'github']]) {
    assert.throws(() => validateConfig({ ...base, mcpServers: pair.map((name) => ({ name, command: 'npx' })) }), /choca|clashes/, pair.join(' / '));
  }
  validateConfig({ ...base, mcpServers: [{ name: 'github', command: 'npx' }, { name: 'gitlab', command: 'npx' }] });
  const saved = ctx.config.mcpServers;
  ctx.config.mcpServers = [{ name: 'git-hub', command: 'a' }, { name: 'git_hub', command: 'b' }];
  try { assert.deepEqual(Object.keys(mcpServersFor('claude', { session: 'choque' })), ['orb', 'git-hub']); } finally { ctx.config.mcpServers = saved; agentAuth.revokeSession('choque'); }
});
