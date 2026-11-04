// The engine: a process of its own (Electron utility process, or a plain Node child in tests) that owns the database, the
// agents' processes and the scheduler. The window talks to it only through messages relayed by the main process:
// { type: 'call', id, method, params } → { type: 'reply', id, ok, result | error }, and { type: 'event', event, payload }.
// There is no HTTP server: nothing on the network or in a browser can reach it.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { useHome, ctx, tr, role, isHeadless } from '../core/context.mjs';
import { isHome, ensureLayout, hostsBots } from '../core/home.mjs';
import { rotateIfBig, oneLine } from '../core/safety.mjs';
import { PRODUCT } from '../core/product.mjs';

const transport = (() => {
  if (process.parentPort) return { send: (m) => process.parentPort.postMessage(m), on: (fn) => process.parentPort.on('message', (e) => fn(e.data)) };
  if (process.send) return { send: (m) => process.send(m), on: (fn) => process.on('message', fn) };
  throw new Error('el motor debe arrancarse desde la app');
})();
let remote = null; // phone access (src/engine/remote.mjs), when turned on
let link = null; // 3.5: Magic Link to other Orbs (src/core/link.mjs)
let replica = null; // 3.7 (WS3): the bots' homes and live copies between linked Orbs (src/engine/replica.mjs)
let devControl = null; // 3.1: the developer's control line (src/engine/dev-control.mjs), only in Orb.dev
// 3.6 «Personas»: every event goes through the router (src/engine/router.mjs), which works out once who it is for and
// gives each sink only what its person may see: this PC's window (whoever sits at it), the phones and browsers, the
// centre a workshop reports to, and the developer's control line (the owner's). Before the engine has started (no
// router yet), straight to the window.
let router = null;
const toWindow = (event, payload) => { try { transport.send({ type: 'event', event, payload }); } catch { /* window gone */ } };
const emit = (event, payload, hint = null) => { if (router) router.route(event, payload, hint); else toWindow(event, payload); };
// What the app itself (the main process) needs whoever sits at the window: the settings (menu language) and the agents'
// browser; while the window is locked, only the lock's own events.
const APP_EVENTS = new Set(['config:changed', 'agentBrowser:closeTask']);
const LOCK_EVENTS = /^(persons:|app:lock)/;
// While locked, this PC's window may only unlock (and see who may unlock it).
const LOCKED_OK = new Set(['persons.unlock', 'app.lockState', 'app.state']);

let api = null;
let bridge = null; // 2.7: the files shared with Open Control Edge (engine/bridge.mjs)
let oce = null; // 3.7 (WS8): Open Control Edge on this and the linked Orbs, and Optimus (engine/oce.mjs)
let logFile = null;
const log = (line) => { try { if (logFile) { rotateIfBig(logFile); fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`); } } catch { /* never fatal */ } };
process.on('uncaughtException', (error) => log(`uncaughtException: ${error?.stack ?? error}`));
process.on('unhandledRejection', (error) => log(`unhandledRejection: ${error?.stack ?? error}`));

async function start(home, version, secret, browser, headless) {
  if (!home || !isHome(home)) throw new Error(tr('sys.engine.notHome', { home }));
  ensureLayout(home); // the fixed folders, and folders made by older versions put in order
  useHome(home);
  // 3.5: the role is the user's choice (orb.json «role», Ajustes › Magic Link); whoever starts the engine only says
  // whether it has a window (Orb Server, src/server/host.mjs: headless). Its children learn it from ORB_NUCLEO.
  ctx.headless = headless === true || process.env.ORB_NUCLEO === '1';
  if (ctx.headless) process.env.ORB_NUCLEO = '1';
  // The approval secret comes from the app (kept encrypted by Windows); without it, the file fallback is used.
  if (typeof secret === 'string' && /^[0-9a-f]{64}$/.test(secret)) ctx.secret = Buffer.from(secret, 'hex');
  // 3.6: a backup restored from Ajustes › Datos or «orb-server copia restaurar» replaces the data now, before the database
  // opens (what was there goes to .orb/antes-de-restaurar-<fecha>). Its secret (links, approvals) comes with it.
  const { applyPendingRestore } = await import('../core/backup.mjs');
  let restored = null;
  try { restored = applyPendingRestore(home); } catch (error) { console.error(`restaurar: ${error.message}`); }
  // 3.6: an Orb moved to another machine does not serve phones or linked Orbs (src/core/export.mjs).
  { const { movedAway } = await import('../core/export.mjs'); ctx.moved = movedAway(home); }
  if (restored) { useHome(home); if (restored.secretChanged && restored.secret?.length >= 32) ctx.secret = Buffer.from(restored.secret.subarray(0, 32)); }
  // The agents' browser lives in the app (main process): its pipe and token go to the agents' MCP servers.
  if (typeof browser?.pipe === 'string' && /^[0-9a-f]{48}$/.test(browser.token ?? '') && /orb-navegador-[0-9a-f]{16}(\.sock)?$/.test(browser.pipe)) ctx.browser = { pipe: browser.pipe, token: browser.token };
  logFile = path.join(ctx.paths.runs, 'motor.log');
  fs.mkdirSync(ctx.paths.runs, { recursive: true });
  // Android's adb: in the PATH of every agent, downloaded in the background the first time.
  const { addAdbToPath, ensureAdb } = await import('./android.mjs');
  // 3.5: not on the server (Orb Server): nothing is downloaded there unless the user asks for it (android.install).
  addAdbToPath(); if (!isHeadless()) ensureAdb({ log });
  const { Board } = await import('../core/board.mjs');
  const { Sessions } = await import('./sessions.mjs');
  const { Orchestrator } = await import('./orchestrator.mjs');
  const { Scheduler } = await import('./scheduler.mjs');
  const { buildApi } = await import('./api.mjs');
  const board = new Board();
  {
    const { createRouter } = await import('./router.mjs');
    const { ownerOfBoard } = await import('../core/authz.mjs');
    const { phoneConfig } = await import('./remote.mjs');
    router = createRouter({ board, log });
    router.add('window', (event, payload, audience, to) => {
      const d = api?.desktop ?? { person: null, locked: false };
      const person = d.person ?? ownerOfBoard(board);
      if (d.locked && !LOCK_EVENTS.test(event) && !APP_EVENTS.has(event)) return;
      if (!APP_EVENTS.has(event) && !to(person)) return;
      // Someone other than the owner at the window: the settings without secrets (as a phone gets them).
      toWindow(event, event === 'config:changed' && person !== ownerOfBoard(board) ? phoneConfig(payload) : payload);
    });
    router.add('remote', (event, payload, audience, to) => remote?.broadcast(event, payload, audience, to));
    // A workshop passes its live events on to the centre of the person each one is for.
    router.add('link', (event, payload, audience, to) => link?.relay(event, payload, (pid) => to(pid ?? ownerOfBoard(board))));
    router.add('dev', (event, payload, audience, to) => { if (devControl && to(ownerOfBoard(board))) devControl.broadcast(event, payload); });
  }
  // Only the coordinator's chat process gets this key; the MCP accepts the identity "orb" only with it.
  const orchKey = crypto.randomBytes(24).toString('hex');
  board.setting('orchestrator_key_hash', crypto.createHash('sha256').update(orchKey).digest('hex'));
  const sessions = new Sessions(board, { emit, log });
  const { plainAction, looksEnglish } = await import('../core/guard.mjs');
  const { adapter } = await import('../agents/index.mjs');
  const { recordRate } = await import('../core/budget.mjs');
  // The real usage the agents report (Claude and Codex): the budget guard uses it instead of guessing.
  sessions.onRate = (accountId, rate) => recordRate(board, accountId, rate);
  // A task waiting for a click: a line in the assistant's chat so the user sees it wherever they are (also the phone).
  sessions.onApproval = (s, item) => {
    if (s?.kind !== 'task') return;
    // 3.1: in plain words (what for, and why it asks); the command itself goes in the notice's details, one click away.
    const wait = Number(ctx.config.approvalWaitMinutes ?? 10);
    // What it does comes from the command itself; what the agent says it is for is shown as its words, not as a fact.
    const what = plainAction(item.body?.title ?? '', { lang: ctx.config.language });
    // 3.2.1: cut at a word, and not quoted when it is in English and the app is not (Claude describes its commands in
    // English: «Start Vite dev server»).
    const summary = String(item.body?.summary ?? '').trim();
    const shown = summary && !(ctx.config.language !== 'en' && looksEnglish(summary)) ? (summary.length > 160 ? `${summary.slice(0, 160).replace(/\s+\S*$/, '')}…` : summary) : '';
    const says = shown ? tr('msg.engine.agentSays', { text: shown }) : '';
    let agent = s.agent; try { agent = adapter(s.agent).label; } catch { /* id */ }
    // 3.6: the line is for the task's person (a task of no conversation is still somebody's).
    const person = board.one('SELECT person_id FROM tasks WHERE id = ?', Number(s.task_id))?.person_id ?? null;
    board.addChat('system', tr(wait > 0 ? 'msg.engine.taskNeedsPermissionWait' : 'msg.engine.taskNeedsPermission', { id: s.task_id, agent, what, reason: item.body?.reason ?? '', min: wait }) + says,
      { kind: 'task-approval', session: s.id, task: s.task_id, request: item.body?.id, detail: String(item.body?.title ?? '').slice(0, 2000) }, undefined, { person });
  };
  // 3.1: the chat line of a task's permission shows how it ended (answered here or in the task, nobody answered, the task
  // stopped), instead of staying «pending» with buttons that no longer work.
  sessions.onApprovalDone = (s, requestId, status) => {
    if (s?.kind !== 'task' || requestId == null) return;
    for (const row of board.all("SELECT id, meta FROM chat WHERE meta LIKE '%task-approval%' ORDER BY id DESC LIMIT 50")) {
      let meta; try { meta = JSON.parse(row.meta); } catch { continue; }
      if (meta?.kind === 'task-approval' && meta.session === s.id && String(meta.request) === String(requestId)) { board.patchChatMeta(row.id, { ...meta, status }); break; }
    }
  };
  sessions.onApprovalExpired = (s, item) => {
    if (s?.kind !== 'task') return;
    const person = board.one('SELECT person_id FROM tasks WHERE id = ?', Number(s.task_id))?.person_id ?? null;
    board.notice(tr('msg.engine.permissionTimedOut', { id: s.task_id, title: plainAction(item.body?.title ?? '', { lang: ctx.config.language }), min: Number(ctx.config.approvalWaitMinutes ?? 10) }), 'warning', { person });
  };
  // 3.2: a new conversation gets its title from Orb (the lightest model of its agent), once; the quick one stays if not.
  const { autoTitle } = await import('./titles.mjs');
  const title = (c, text) => {
    if (c.titled) return;
    board.updateConversation(c.id, { titled: true });
    // Not over one the user wrote meanwhile.
    autoTitle(board, { agent: c.agent, account: c.account, text }).then((t) => { if (t && board.conversation(c.id)?.title === c.title) board.updateConversation(c.id, { title: t }); }).catch(() => {});
  };
  const orchestrator = new Orchestrator(board, orchKey, { emit, log, title });
  const scheduler = new Scheduler(board, sessions, { log, orchestrator, emit });
  const { createRemote } = await import('./remote.mjs');
  const remoteRef = { current: null };
  // 3.5: the user's bots (their reminders and messages are looked at every second).
  const { Bots } = await import('./bots.mjs');
  const bots = new Bots(board, { emit, log, push: (note) => remoteRef.current?.push?.(note) }).start();
  // 3.6 (WS4): a bot or a group no longer shared with someone: their lanes stop (bots.unshared) and they reload.
  bots.onRevoke = (person) => router?.revoke([person]);
  // 3.7: Monitoreo del equipo and Opti Bot are gone: their settings and conversation are tidied once (engine/retired.mjs).
  { const { tidyRetired } = await import('./retired.mjs'); tidyRetired(board, log); }
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log, version, remoteRef, bots });
  // 3.6: a turn refused by a loan's limits (or a bot's caps): a notice and a push to the person who spends, and only them.
  const blocked = (person, why) => {
    const who = person && !board.isOwnerPerson(person) ? person : null;
    board.notice(why, 'warning', { person: who });
    try { remoteRef.current?.push?.({ title: ctx.config.assistantName, body: why, person: person ?? board.ownerId() }); } catch { /* no phones */ }
  };
  sessions.onBlocked = (s, why) => blocked(s?.person_id ?? null, why);
  orchestrator.onBlocked = (c, why) => blocked(c?.person_id ?? null, why);
  remote = remoteRef.current = createRemote({ board, api, log, emit, version });
  // 3.5 Magic Link: the links this Orb made to other Orbs (keys sealed with the app's secret). A workshop linked to a
  // centre runs the calls the centre forwards to it, with the same checks as a phone's.
  {
    const { createLink, orbIdentity, isHomeCall, isOceCall } = await import('../core/link.mjs');
    const { macAddresses } = await import('../core/wol.mjs');
    const { guardCall, shapeResult, orbNameOf } = await import('./remote.mjs');
    const { audit, ownerOfBoard } = await import('../core/authz.mjs');
    const { whoAsks, once } = await import('./forward.mjs');
    const { readKey } = await import('../core/home.mjs');
    const { orbIdOf } = await import('../core/backup.mjs');
    const { cloneVerdict } = await import('../core/export.mjs');
    let macs = { at: 0, list: [] }; // the network cards, looked at once a minute at most
    const myMacs = () => { if (Date.now() - macs.at > 60_000) macs = { at: Date.now(), list: macAddresses() }; return macs.list; };
    // Tests make an Orb of an older protocol with ORB_LINK_PROTOCOL (only with the test agents).
    const testProtocol = process.env.ORB_FAKE_AGENTS && Number(process.env.ORB_LINK_PROTOCOL) ? Number(process.env.ORB_LINK_PROTOCOL) : null;
    link = remoteRef.link = createLink({
      file: path.join(ctx.paths.data, 'enlaces.json'), secret: ctx.secret ?? readKey(home), log,
      ...(testProtocol ? { protocol: testProtocol, min: Math.min(2, testProtocol) } : {}),
      // 3.6: with this Orb's identity (orbId, incarnation): the other side tells a moved Orb from a copy of it.
      identity: () => { const id = orbIdOf(home); return { ...orbIdentity({ name: orbNameOf(ctx.config), role: role(), version, macs: myMacs() }), orb: { orbId: id.orbId, incarnation: id.incarnation, host: os.hostname().slice(0, 80) } }; },
      verdict: cloneVerdict,
      // 3.6 (A13, A12): the centre says who asked there; the call runs here as the person this link belongs to, once per
      // request_id, audited.
      onRequest: async (method, params, peer, { principal = null, requestId = null } = {}) => {
        // 3.7 (WS3): the bots' homes and copies: the other Orb's identity and this link's persons decide (replica.mjs).
        if (isHomeCall(method)) {
          // 3.7 (WS8): read-only Open Control Edge readings (oce.status / oce.values), only for the owner's Orbs.
          if (isOceCall(method)) { if (!oce) throw Object.assign(new Error('este Orb aún no está listo'), { status: 503 }); return oce.serve(peer, method, params); }
          if (!replica) throw Object.assign(new Error('este Orb aún no está listo'), { status: 503 });
          return replica.serve(peer, method, params);
        }
        const who = whoAsks(board, peer, principal);
        const why = guardCall(board, method, params);
        if (why) { audit(board, who, method, { type: 'link', id: peer?.id ?? '' }, 'deny', 'guard'); throw Object.assign(new Error(why), { status: 403 }); }
        audit(board, who, method, { type: 'link', id: peer?.id ?? '' }, 'allow', 'forward');
        return once(board, requestId, peer?.id, async () => {
          // Tests: a workshop that takes its time (only with the test agents).
          const delay = process.env.ORB_FAKE_AGENTS ? Number(params.__testDelayMs) || 0 : 0;
          if (delay) { delete params.__testDelayMs; await new Promise((r) => setTimeout(r, Math.min(delay, 10_000))); }
          return shapeResult(method, (await api.call(method, params, who)) ?? null);
        });
      },
      onChange: (peers) => emit('link:peers', peers)
    });
    if (!ctx.moved) link.start();
    // 3.7 (WS3): one home per bot, a live copy on the other linked Orbs (pulled whenever both are on).
    {
      const { createReplica } = await import('./replica.mjs');
      replica = remoteRef.replica = createReplica({ board, bots, emit, log, link: () => link, remote: () => remote, api });
      remote.onHomeCall = (peer, method, params) => {
        if (!isHomeCall(method)) throw Object.assign(new Error('operación desconocida'), { status: 404 });
        if (isOceCall(method)) { if (!oce) throw Object.assign(new Error('este Orb aún no está listo'), { status: 503 }); return oce.serve(peer, method, params); }
        return replica.serve(peer, method, params);
      };
      remote.onOrbGone = (peer) => replica.onOrbGone(peer);
      if (!ctx.moved) replica.start();
    }
    // 3.7 (WS8): Open Control Edge here and on the owner's linked Orbs (read-only), and its bot Optimus, made once.
    {
      const { createOce } = await import('./oce.mjs');
      oce = createOce({ board, bots, log, link: () => link, remote: () => remote });
      if (!ctx.moved) oce.start();
    }
    // 3.5: the bots live on the centre: what its bots say comes to this Orb's window as centro:<event>.
    // 3.6: only to the person this link belongs to here (the centre already sends only that person's bots).
    link.on('*', (event, payload, peer) => { if (hostsBots(peer?.role ?? 'taller') && /^bot\./.test(event)) emit(`centro:${event}`, payload, { person: peer?.person ?? ownerOfBoard(board) }); });
    // 3.6 (moving an Orb): a linked Orb that looks like a copy of another is not served; the person of that link is told.
    link.on('link:clone', (p, peer) => board.notice(tr('msg.link.clone', { name: p?.name ?? '' }), 'warning', { person: peer?.person ?? null }));
    link.on('link:moved', (p, peer) => board.notice(tr('msg.link.moved', { name: p?.name ?? '' }), 'info', { person: peer?.person ?? null }));
  }
  // 3.1: only an unpacked Orb.dev started with ORB_DEV_CONTROL=1 (main.mjs decides; never an installed Orb).
  if (process.env.ORB_DEV_CONTROL === '1') {
    const { startDevControl } = await import('./dev-control.mjs');
    devControl = startDevControl({ api, board, sessions, log, home, internalDir: ctx.paths.internal });
  }
  if (ctx.config.mobile?.enabled && !ctx.moved) remote.start().catch((error) => log(`móvil: ${error.message}`));

  // Changes made by this process are pushed right away; changes made by MCP processes (other connections) are found with
  // PRAGMA data_version, which only moves when another connection commits.
  // 3.6: a change that names its person ({ person } or { res }) is told only to them; any other, to everyone (the list
  // says what changed, never its content).
  const { peopleWith } = await import('../core/authz.mjs');
  let pending = new Map(); let flush = null; // what -> 'all' | Set(person)
  const changed = (what, hints = null) => {
    let who = pending.get(what);
    if (who !== 'all') {
      const named = [];
      if (hints?.person) named.push(String(hints.person));
      if (hints?.res) { try { named.push(...peopleWith(board, hints.res)); } catch { /* gone */ } }
      if (!named.length) who = 'all'; else { who ??= new Set(); for (const p of named) who.add(p); }
      pending.set(what, who);
    }
    flush ??= setTimeout(() => {
      flush = null; const batch = pending; pending = new Map();
      const all = [...batch].filter(([, w]) => w === 'all').map(([k]) => k);
      if (all.length) emit('board:changed', all);
      const byPerson = new Map();
      for (const [k, w] of batch) if (w !== 'all') for (const p of w) { if (!byPerson.has(p)) byPerson.set(p, []); byPerson.get(p).push(k); }
      for (const [p, list] of byPerson) emit('board:changed', list, { person: p });
      api.notifyNewChat();
    }, 120);
  };
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
      api.dataTick?.();
    } catch (error) { log(`tick: ${error.stack}`); } finally { ticking = false; }
  };
  setInterval(loop, 1500);
  board.onChange((what) => { if (what === 'tasks') setImmediate(loop); });
  log(`motor arrancado (versión ${version}, papel ${role()}) en ${home}`);
  if (restored) { log(`copia restaurada: ${restored.from} (lo anterior está en ${restored.aside})`); board.notice(tr('data.backup.restored', { created: String(restored.header?.created ?? '').slice(0, 16).replace('T', ' ') }), 'success'); }
  // Which agents this PC has, as the engine sees them (with the app's environment): first thing to look at if «Agentes»
  // says one is missing.
  const { ADAPTERS } = await import('../agents/index.mjs');
  log(`agentes: ${Object.keys(ADAPTERS).map((a) => { let cmd = null; try { cmd = ADAPTERS[a].detect(ctx.config.agents[a] ?? {})?.cmd ?? null; } catch { /* not found */ } return `${a}=${cmd ?? 'no'}`; }).join(' · ')}`);
  loop();
  // 2.6: the models of every installed agent, asked to the agents themselves a moment after starting (each one at most
  // once every 12 h), so the brain selector names them before any conversation.
  const { refreshAllModels } = await import('./catalog.mjs');
  setTimeout(() => { refreshAllModels(board, { log }).catch(() => {}); }, Number(process.env.ORB_MODELS_DELAY_MS ?? 3000)).unref?.();
  // 3.1: the plan of every account (Claude Pro, ChatGPT Plus, Cursor Pro…), so the usage limits fit what is paid for.
  // Not with the test agents: a fake engine must not start the real CLIs.
  if (!process.env.ORB_FAKE_AGENTS) {
    const { refreshPlans } = await import('./plans.mjs');
    setTimeout(() => { refreshPlans(board, { log }).catch(() => {}); }, Number(process.env.ORB_MODELS_DELAY_MS ?? 3000) + 2000).unref?.();
  }
  // 2.7: the bridge with Open Control Edge (engine/bridge.mjs). Only on Windows, only for the app's own engine (main.mjs
  // sets ORB_BRIDGE) and never with the test agents: made-up runs must not reach OCE as real data.
  if (process.platform === 'win32' && process.env.ORB_BRIDGE === '1' && !process.env.ORB_FAKE_AGENTS && !isHeadless()) {
    const { startBridge } = await import('./bridge.mjs');
    bridge = startBridge({ board, version, busy: () => orchestrator.busy, log });
  }
  // 2.6: the reports the assistant still owed when the app was closed come back.
  const owed = orchestrator.resume();
  if (owed) log(`asistente: ${owed} aviso(s) pendientes recuperados`);
  return { home, name: ctx.config.assistantName, role: role(), headless: ctx.headless };
}

transport.on(async (msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'start') {
    try { transport.send({ type: 'started', ok: true, result: await start(msg.home, msg.version, msg.secret, msg.browser, msg.headless) }); }
    catch (error) { transport.send({ type: 'started', ok: false, error: error.message }); }
    return;
  }
  if (msg.type === 'shutdown') {
    // The phone access may have to turn off `tailscale serve` first (a few seconds at most).
    try { api?.shutdown(); } catch { /* closing anyway */ }
    try { bridge?.stop(); } catch { /* closing anyway */ }
    try { devControl?.stop(); } catch { /* closing anyway */ }
    try { oce?.stop(); } catch { /* closing anyway */ }
    try { replica?.stop(); } catch { /* closing anyway */ }
    try { link?.stop(); } catch { /* closing anyway */ }
    // 3.2.1: if Orb started adb this session, its resident server goes too (never a server the user runs elsewhere).
    try { const { stopAdb } = await import('./android.mjs'); stopAdb(); } catch { /* not used or already gone */ }
    Promise.race([Promise.resolve(remote?.stop()).catch(() => {}), new Promise((r) => setTimeout(r, 4000))]).finally(() => setTimeout(() => process.exit(0), 300));
    return;
  }
  if (msg.type !== 'call') return;
  try {
    if (!api) throw new Error(tr('sys.engine.notStarted', { name: PRODUCT.name }));
    // 3.6: this PC's window calls as the person sitting at it (the owner until persons.switch); Orb Server's local socket
    // (as: 'control', src/server/control.mjs) as the owner. A locked window may only unlock (engine-enforced).
    const method = String(msg.method);
    let result;
    if (msg.as === 'control') result = await api.call(method, msg.params ?? {}, api.controlPrincipal());
    else if (api.desktop.locked && method === 'app.state') result = api.lockState();
    else if (api.desktop.locked && !LOCKED_OK.has(method)) throw Object.assign(new Error(tr('msg.persons.lockedWindow')), { userFacing: true });
    else result = await api.call(method, msg.params ?? {}, api.desktopPrincipal());
    transport.send({ type: 'reply', id: msg.id, ok: true, result: result === undefined ? null : result });
  } catch (error) {
    if (!error?.userFacing) log(`${msg.method}: ${error?.stack ?? error}`);
    transport.send({ type: 'reply', id: msg.id, ok: false, error: oneLine(error?.message ?? String(error), 1000) });
  }
});
