// The engine: a process of its own (Electron utility process, or a plain Node child in tests) that owns the database, the
// agents' processes and the scheduler. The window talks to it only through messages relayed by the main process:
// { type: 'call', id, method, params } → { type: 'reply', id, ok, result | error }, and { type: 'event', event, payload }.
// There is no HTTP server: nothing on the network or in a browser can reach it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { useHome, ctx, tr } from '../core/context.mjs';
import { isHome, ensureLayout } from '../core/home.mjs';
import { rotateIfBig, oneLine } from '../core/safety.mjs';
import { PRODUCT } from '../core/product.mjs';

const transport = (() => {
  if (process.parentPort) return { send: (m) => process.parentPort.postMessage(m), on: (fn) => process.parentPort.on('message', (e) => fn(e.data)) };
  if (process.send) return { send: (m) => process.send(m), on: (fn) => process.on('message', fn) };
  throw new Error('el motor debe arrancarse desde la app');
})();
let remote = null; // phone access (src/engine/remote.mjs), when turned on
const emit = (event, payload) => {
  try { transport.send({ type: 'event', event, payload }); } catch { /* window gone */ }
  remote?.broadcast(event, payload);
};

let api = null;
let logFile = null;
const log = (line) => { try { if (logFile) { rotateIfBig(logFile); fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`); } } catch { /* never fatal */ } };
process.on('uncaughtException', (error) => log(`uncaughtException: ${error?.stack ?? error}`));
process.on('unhandledRejection', (error) => log(`unhandledRejection: ${error?.stack ?? error}`));

async function start(home, version, secret, browser) {
  if (!home || !isHome(home)) throw new Error(tr('sys.engine.notHome', { home }));
  ensureLayout(home); // the fixed folders, and folders made by older versions put in order
  useHome(home);
  // The approval secret comes from the app (kept encrypted by Windows); without it, the file fallback is used.
  if (typeof secret === 'string' && /^[0-9a-f]{64}$/.test(secret)) ctx.secret = Buffer.from(secret, 'hex');
  // The agents' browser lives in the app (main process): its pipe and token go to the agents' MCP servers.
  if (typeof browser?.pipe === 'string' && /^[0-9a-f]{48}$/.test(browser.token ?? '') && /orb-navegador-[0-9a-f]{16}(\.sock)?$/.test(browser.pipe)) ctx.browser = { pipe: browser.pipe, token: browser.token };
  logFile = path.join(ctx.paths.runs, 'motor.log');
  fs.mkdirSync(ctx.paths.runs, { recursive: true });
  // Android's adb: in the PATH of every agent, downloaded in the background the first time.
  const { addAdbToPath, ensureAdb } = await import('./android.mjs');
  addAdbToPath(); ensureAdb({ log });
  const { Board } = await import('../core/board.mjs');
  const { Sessions } = await import('./sessions.mjs');
  const { Orchestrator } = await import('./orchestrator.mjs');
  const { Scheduler } = await import('./scheduler.mjs');
  const { buildApi } = await import('./api.mjs');
  const board = new Board();
  // Only the coordinator's chat process gets this key; the MCP accepts the identity "orb" only with it.
  const orchKey = crypto.randomBytes(24).toString('hex');
  board.setting('orchestrator_key_hash', crypto.createHash('sha256').update(orchKey).digest('hex'));
  const sessions = new Sessions(board, { emit, log });
  const { recordRate } = await import('../core/budget.mjs');
  // The real usage the agents report (Claude and Codex): the budget guard uses it instead of guessing.
  sessions.onRate = (accountId, rate) => recordRate(board, accountId, rate);
  // A task waiting for a click: a line in the assistant's chat so the user sees it wherever they are (also the phone).
  sessions.onApproval = (s, item) => {
    if (s?.kind !== 'task') return;
    board.addChat('system', tr('msg.engine.taskNeedsPermission', { id: s.task_id, title: item.body?.title ?? '', reason: item.body?.reason ?? '' }), { kind: 'task-approval', session: s.id, task: s.task_id, request: item.body?.id });
  };
  const orchestrator = new Orchestrator(board, orchKey, { emit, log });
  const scheduler = new Scheduler(board, sessions, { log, orchestrator });
  const { createRemote } = await import('./remote.mjs');
  const remoteRef = { current: null };
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log, version, remoteRef });
  remote = remoteRef.current = createRemote({ board, api, log });
  if (ctx.config.mobile?.enabled) remote.start().catch((error) => log(`móvil: ${error.message}`));

  // Changes made by this process are pushed right away; changes made by MCP processes (other connections) are found with
  // PRAGMA data_version, which only moves when another connection commits.
  let pending = new Set(); let flush = null;
  const changed = (what) => { pending.add(what); flush ??= setTimeout(() => { flush = null; const list = [...pending]; pending = new Set(); emit('board:changed', list); api.notifyNewChat(); }, 120); };
  board.onChange(changed);
  let dataVersion = board.one('PRAGMA data_version').data_version;
  const { syncProjects } = await import('../core/projects.mjs');
  syncProjects(board);
  let ticking = false; let lastSync = Date.now();
  const loop = () => {
    if (ticking) return; ticking = true;
    try {
      // Folders created or deleted by hand in the assistant's folder show up in the app within a few seconds.
      if (Date.now() - lastSync > 5000) { lastSync = Date.now(); syncProjects(board); }
      const v = board.one('PRAGMA data_version').data_version;
      if (v !== dataVersion) { dataVersion = v; changed('external'); }
      scheduler.tick();
    } catch (error) { log(`tick: ${error.stack}`); } finally { ticking = false; }
  };
  setInterval(loop, 1500);
  board.onChange((what) => { if (what === 'tasks') setImmediate(loop); });
  log(`motor arrancado (versión ${version}) en ${home}`);
  // Which agents this PC has, as the engine sees them (with the app's environment): first thing to look at if «Agentes»
  // says one is missing.
  const { ADAPTERS } = await import('../agents/index.mjs');
  log(`agentes: ${Object.keys(ADAPTERS).map((a) => { let cmd = null; try { cmd = ADAPTERS[a].detect(ctx.config.agents[a] ?? {})?.cmd ?? null; } catch { /* not found */ } return `${a}=${cmd ?? 'no'}`; }).join(' · ')}`);
  loop();
  // 2.6: the models of every installed agent, asked to the agents themselves a moment after starting (each one at most
  // once every 12 h), so the brain selector names them before any conversation.
  const { refreshAllModels } = await import('./catalog.mjs');
  setTimeout(() => { refreshAllModels(board, { log }).catch(() => {}); }, Number(process.env.ORB_MODELS_DELAY_MS ?? 3000)).unref?.();
  // 2.6: the reports the assistant still owed when the app was closed come back.
  const owed = orchestrator.resume();
  if (owed) log(`asistente: ${owed} aviso(s) pendientes recuperados`);
  return { home, name: ctx.config.assistantName };
}

transport.on(async (msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'start') {
    try { transport.send({ type: 'started', ok: true, result: await start(msg.home, msg.version, msg.secret, msg.browser) }); }
    catch (error) { transport.send({ type: 'started', ok: false, error: error.message }); }
    return;
  }
  if (msg.type === 'shutdown') {
    // The phone access may have to turn off `tailscale serve` first (a few seconds at most).
    try { api?.shutdown(); } catch { /* closing anyway */ }
    Promise.race([Promise.resolve(remote?.stop()).catch(() => {}), new Promise((r) => setTimeout(r, 4000))]).finally(() => setTimeout(() => process.exit(0), 300));
    return;
  }
  if (msg.type !== 'call') return;
  try {
    if (!api) throw new Error(tr('sys.engine.notStarted', { name: PRODUCT.name }));
    const result = await api.call(String(msg.method), msg.params ?? {});
    transport.send({ type: 'reply', id: msg.id, ok: true, result: result === undefined ? null : result });
  } catch (error) {
    if (!error?.userFacing) log(`${msg.method}: ${error?.stack ?? error}`);
    transport.send({ type: 'reply', id: msg.id, ok: false, error: oneLine(error?.message ?? String(error), 1000) });
  }
});
