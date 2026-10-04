// MCP server: who is who (the coordinator only with the secret key), which tools each one gets and strict arguments.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { tempHome, ROOT } from './helpers.mjs';
import { Board } from '../src/core/board.mjs';
import { createProject } from '../src/core/projects.mjs';

let t; let board; const KEY = 'clave-de-prueba';
before(() => {
  t = tempHome(); board = new Board();
  createProject(board, { name: 'web' }, 'usuario');
  board.setting('orchestrator_key_hash', crypto.createHash('sha256').update(KEY).digest('hex'));
});
after(() => t.cleanup());

function client(env) {
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'mcp', 'server.mjs')], { env: { ...process.env, ORB_HOME: t.home, ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
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

test('el coordinador solo se reconoce con la clave secreta', async () => {
  const boss = client({ ORB_AGENT: 'orb', ORB_ORCH_KEY: KEY });
  const fake = client({ ORB_AGENT: 'orb', ORB_ORCH_KEY: 'otra' });
  const worker = client({ ORB_AGENT: 'codex' });
  try {
    for (const c of [boss, fake, worker]) await c.rpc('initialize', {});
    assert.ok((await boss.tools()).includes('orb_create_task'));
    assert.ok(!(await fake.tools()).includes('orb_create_task'), 'sin la clave no es el coordinador');
    assert.ok(!(await worker.tools()).includes('orb_write_log'));
    const created = await boss.call('orb_create_task', { project: 'web', title: 'Portada', description: 'Haz la portada' });
    assert.equal(created.error, false, created.text);
    assert.equal(JSON.parse(created.text).status, 'queued');
    const forged = await worker.call('orb_send_message', { to: 'usuario', body: 'hola', from: 'orb' });
    assert.match(forged.text, /argumentos no permitidos: from/);
    const bad = await worker.call('orb_update_task', { id: 1, status: 'done', model: 'x' });
    assert.match(bad.text, /argumentos no permitidos/);
  } finally { boss.close(); fake.close(); worker.close(); }
});

test('el coordinador crea proyectos, escribe bitácoras y no puede leer otra cosa que bitácoras', async () => {
  const boss = client({ ORB_AGENT: 'orb', ORB_ORCH_KEY: KEY });
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
  } finally { boss.close(); }
});

test('el MCP no tiene la clave de aprobaciones: no puede firmar ni invalida las firmas buenas', async () => {
  const task = board.createTask({ project: 'web', title: 'Publicar', description: 'publica la web', agent: 'claude', launch: 'manual' }, 'orb');
  const ok = board.approve(task.id, 'approved', 'usuario', board.previewHash(task));
  assert.equal(ok.status, 'queued');
  const worker = client({ ORB_AGENT: 'claude' });
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
  const none = client({ ORB_AGENT: 'claude' });
  const nav = client({ ORB_AGENT: 'claude', ORB_BROWSER_PIPE: pipe, ORB_BROWSER_TOKEN: 'f'.repeat(48), ORB_SESSION: 'conv-1', ORB_TASK_ID: '7' });
  try {
    await none.rpc('initialize', {}); await nav.rpc('initialize', {});
    assert.ok(!(await none.tools()).some((n) => n.startsWith('orb_browser_')), 'sin la app no hay navegador');
    assert.ok((await nav.tools()).includes('orb_browser_open'));
    assert.equal((await nav.call('orb_browser_open', { url: 'localhost:3000' })).text, 'hecho open');
    assert.deepEqual(seen[0], { hello: 'f'.repeat(48), agent: 'claude', task: '7', session: 'conv-1' });
    assert.deepEqual(seen[1].args, { url: 'localhost:3000' });
    const shot = (await nav.rpc('tools/call', { name: 'orb_browser_screenshot', arguments: {} })).result;
    assert.deepEqual(shot.content[1], { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' });
    assert.equal((await nav.call('orb_browser_click', { ref: 1, selector: 'a' })).error, true, 'argumentos fuera del esquema');
  } finally { none.close(); nav.close(); server.close(); }
});
