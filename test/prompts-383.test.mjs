// 3.8.3 (repaso): what Orb tells the agents agrees with what its code does, so they do not get mixed orders.
// - «Auto» lets a task push when the user asked for it with their own words (guard.mjs userAsked): the brief says so,
//   instead of forbidding every push; without that request, it says Orb will ask or deny, and not to insist.
// - A denied or held action is not to be retried another way (the loop the owner wants to avoid).
// - A worker cannot get an answer from the user mid-task: it closes «blocked» with the question instead of waiting.
// - The coordinator's persona does not promise approvals that «Auto» no longer asks for, and does not refuse a push
//   the user asked for; the browser tools are only named when the agents' browser is on.
// - The MCP server offers each role only the statuses the board accepts, and tells a delegating agent not to wait for
//   a subtask that needs a click.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { tempHome } from './helpers.mjs';
import { ctx, tr } from '../src/platform/context.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { createProject } from '../src/domain/projects/projects.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { persona } from '../src/engine/orchestrator.mjs';
import { mcpServersFor } from '../src/engine/sessions.mjs';

let h; let board;
before(() => { h = tempHome(); board = new Board(); createProject(board, { name: 'web' }, 'usuario'); });
after(() => { board.db.close(); h.cleanup(); });

const brief = (sched, task, agent = 'claude') => sched.promptFor(board.task(task.id), board.project('web'), { cwd: board.project('web').path, folder: true }, agent);
const withMode = (mode, fn) => { const was = ctx.config.permissions; ctx.config.permissions = { ...(was ?? {}), mode }; try { return fn(); } finally { ctx.config.permissions = was; } };

test('the task brief follows the Auto rules: push only when the user asked, never insist on a denied action, no waiting for an answer', () => {
  const sched = new Scheduler(board, {}, { log: () => {} });
  const plain = board.createTask({ project: 'web', title: 'Portada', description: 'Haz la portada', agent: 'claude' }, 'usuario');
  const text = brief(sched, plain);
  assert.match(text, /No publiques ni hagas push/);
  assert.doesNotMatch(text, /puedes hacer push/);
  assert.match(text, /Si Orb deniega o retiene una acción .* no la repitas de otra forma/);
  assert.match(text, /cierra con status "blocked" y la pregunta en result/);
  assert.match(text, /carpeta core de Orb, las credenciales .* están cerrados siempre/);
  assert.match(text, /Borrar más de 50 archivos \(o un cuarto del proyecto\)/);
  // The browser is off in tests: the brief must not name tools the MCP server does not offer.
  assert.doesNotMatch(text, /orb_browser_console/);
  assert.match(text, /navegador de .* está apagado/);
  // The user asked for the push with their own words (board: user_asked) → the brief allows exactly that.
  const push = board.createTask({ project: 'web', title: 'Subir', description: 'Haz push de la rama a GitHub', agent: 'claude' }, 'usuario');
  assert.deepEqual(board.task(push.id).user_asked, ['publish']);
  const allowed = brief(sched, push);
  assert.match(allowed, /ha pedido publicar con sus palabras: puedes hacer push/);
  assert.doesNotMatch(allowed, /No publiques ni hagas push/);
  // «Preguntar» (a task created under it keeps that level): the deletion rule is the stricter one.
  withMode('preguntar', () => { const ask = board.createTask({ project: 'web', title: 'Menú', description: 'Arregla el menú', agent: 'claude' }, 'usuario'); assert.match(brief(sched, ask), /Borrar 10 archivos o más/); });
});

test('the persona does not promise approvals Auto no longer asks for, and lets the user ask for a push', () => {
  const text = persona(board);
  assert.match(text, /PUBLICAR: tú nunca haces push/);
  assert.match(text, /lo pide con sus palabras/);
  assert.doesNotMatch(text, /dile que lo haga con el botón/);
  const manual = () => { const was = ctx.config.budget; ctx.config.budget = { ...(was ?? {}), autoModel: false }; try { return persona(board); } finally { ctx.config.budget = was; } };
  assert.match(manual(), /"high" solo para algo muy complicado./, 'high reasoning waits for nobody in Auto');
  assert.match(text, /core\\skills ni core\\mcp: solo en la carpeta de preparación \(core\\preparacion/);
  assert.doesNotMatch(text, /orb_browser_open/, 'the browser is off in tests');
  assert.match(text, /proponlo en una línea/);
  withMode('preguntar', () => { assert.match(manual(), /esa tarea espera la aprobación/); assert.match(persona(board), /la tarea esperará su aprobación/); });
  // The guard's reason for touching core's general log no longer sends a worker to a tool only the coordinator has.
  assert.doesNotMatch(tr('msg.guard.internalLogs'), /se escribe con orb_write_log/);
  assert.match(tr('msg.guard.internalLogs'), /No insistas/);
});

function client(server) {
  const child = spawn(server.command, server.args, { env: { ...process.env, ORB_HOME: h.home, ...server.env }, stdio: ['pipe', 'pipe', 'inherit'] });
  const replies = new Map(); let n = 0;
  readline.createInterface({ input: child.stdout }).on('line', (l) => { const m = JSON.parse(l); replies.get(m.id)?.(m); });
  const rpc = (method, params) => new Promise((r) => { const id = ++n; replies.set(id, r); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  return { rpc, close: () => child.stdin.end() };
}

test('the MCP server offers each role the statuses the board accepts and warns about subtasks that wait for a click', async () => {
  const conv = board.createConversation({ title: 'Coordinador', project: 'web' }).id;
  const boss = client(mcpServersFor('claude', { orchestrator: true, browser: false, session: `asistente-${conv}`, conversation: conv }).orb);
  const task = board.createTask({ project: 'web', title: 'Portada', description: 'Haz la portada', agent: 'codex' }, 'usuario');
  board.patch(task.id, { status: 'running', assigned_to: 'codex', session_id: 'sesion-codex' }, 'orb', 'task.launched', 'queued');
  const worker = client(mcpServersFor('codex', { session: 'sesion-codex', taskId: task.id }).orb);
  try {
    const bossInit = await boss.rpc('initialize', {});
    assert.match(bossInit.result.serverInfo.version, /^3\.8/);
    const workerInit = await worker.rpc('initialize', {});
    assert.match(workerInit.result.instructions, /no te contestará durante la tarea/);
    assert.match(workerInit.result.instructions, /salvo que tu encargo diga que .* lo pidió/);
    const bossTools = (await boss.rpc('tools/list', {})).result.tools;
    const workerTools = (await worker.rpc('tools/list', {})).result.tools;
    assert.deepEqual(bossTools.find((t) => t.name === 'orb_update_task').inputSchema.properties.status.enum, ['queued', 'cancelled']);
    assert.deepEqual(workerTools.find((t) => t.name === 'orb_update_task').inputSchema.properties.status.enum, ['done', 'failed', 'blocked']);
    assert.match(workerTools.find((t) => t.name === 'orb_delegate').description, /awaiting_approval, NO la esperes/);
    assert.match(bossTools.find((t) => t.name === 'orb_create_task').inputSchema.properties.sensitivity.description, /^Solo publicar, enviar a terceros y pagar/);
  } finally { boss.close(); worker.close(); }
});
