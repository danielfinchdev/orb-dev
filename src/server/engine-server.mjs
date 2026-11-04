// 3.7, Orb Server's engine (ctx.product = 'server'): the bots and their reminders, the Magic Link with phones and Orbs
// (the phone access and the links), backups, people, the agents' sign-in, the server's administration, the agent engines
// it downloads on demand and its own updates. Nothing of programming is loaded (no src/engine/api.mjs, scheduler,
// whiteboard, God mode, Opti Bot, adb, GitHub…): test/server-product.test.mjs checks the import graph.
// The same protocol as src/engine/engine.mjs: { type: 'start' | 'call' | 'shutdown' } → { type: 'started' | 'reply' |
// 'event' }. It runs as a child of src/server/host.mjs (fork) or inside the host's own process (in-process: one Node for
// a small server, see host.mjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { useHome, ctx, tr, role } from '../core/context.mjs';
import { isHome, ensureLayout, hostsBots, readKey } from '../core/home.mjs';
import { rotateIfBig, oneLine } from '../core/safety.mjs';
import { PRODUCT } from '../core/product.mjs';
import { PRODUCT_SERVER } from './server-product.mjs';

// One engine per process. send(message) takes what the engine says (the host's side of the protocol).
export function createServerEngine({ send }) {
  let api = null; let remote = null; let link = null; let router = null; let bots = null; let engines = null; let updater = null;
  let logFile = null; let loopTimer = null;
  const toHost = (event, payload) => { try { send({ type: 'event', event, payload }); } catch { /* host gone */ } };
  const emit = (event, payload, hint = null) => { if (router) router.route(event, payload, hint); else toHost(event, payload); };
  const log = (line) => { try { if (logFile) { rotateIfBig(logFile); fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`); } } catch { /* never fatal */ } };

  async function start(home, version, secret) {
    if (!home || !isHome(home)) throw new Error(tr('sys.engine.notHome', { home }));
    ensureLayout(home);
    useHome(home);
    ctx.headless = true; ctx.product = PRODUCT_SERVER;
    // The children (the bots' MCP servers, the agents) learn it from the environment.
    process.env.ORB_NUCLEO = '1'; process.env.ORB_PRODUCT = PRODUCT_SERVER;
    process.env.ORB_ENGINES = ctx.paths.engines ?? path.join(home, 'engines');
    if (typeof secret === 'string' && /^[0-9a-f]{64}$/.test(secret)) ctx.secret = Buffer.from(secret, 'hex');
    const { applyPendingRestore } = await import('../core/backup.mjs');
    let restored = null;
    try { restored = applyPendingRestore(home); } catch (error) { console.error(`restaurar: ${error.message}`); }
    { const { movedAway } = await import('../core/export.mjs'); ctx.moved = movedAway(home); }
    if (restored) { useHome(home); if (restored.secretChanged && restored.secret?.length >= 32) ctx.secret = Buffer.from(restored.secret.subarray(0, 32)); }
    logFile = path.join(ctx.paths.runs, 'motor.log');
    fs.mkdirSync(ctx.paths.runs, { recursive: true });
    const { Board } = await import('../core/board.mjs');
    const board = new Board();
    const { ownerOfBoard } = await import('../core/authz.mjs');
    {
      const { createRouter } = await import('../engine/router.mjs');
      router = createRouter({ board, log });
      // The host (the server's console, `orb-server` commands): the owner's events.
      router.add('window', (event, payload, audience, to) => { if (to(ownerOfBoard(board))) toHost(event, payload); });
      router.add('remote', (event, payload, audience, to) => remote?.broadcast(event, payload, audience, to));
      router.add('link', (event, payload, audience, to) => link?.relay(event, payload, (pid) => to(pid ?? ownerOfBoard(board))));
    }
    const remoteRef = { current: null };
    const { Bots } = await import('../engine/bots.mjs');
    bots = new Bots(board, { emit, log, push: (note) => remoteRef.current?.push?.(note) }).start();
    bots.onRevoke = (person) => router?.revoke([person]);
    // The agent engines this server needs: its bots' brains (the sign-in of an agent downloads its own, api-server.mjs).
    const { createEngines } = await import('./engines.mjs');
    const wanted = () => board.all('SELECT DISTINCT agent FROM bots').map((r) => r.agent);
    engines = createEngines({ dir: ctx.paths.engines ?? path.join(home, 'engines'), log, wanted, offline: Boolean(process.env.ORB_FAKE_AGENTS) && !process.env.ORB_NPM_REGISTRY });
    const { createUpdater } = await import('./update.mjs');
    updater = createUpdater({ home, version, log });
    const { buildServerApi } = await import('./api-server.mjs');
    api = buildServerApi({ board, emit, log, version, remoteRef, bots, engines, updater });
    const { createRemote } = await import('../engine/remote.mjs');
    remote = remoteRef.current = createRemote({ board, api, log, emit, version });
    // Magic Link with other Orbs: as in src/engine/engine.mjs (the app's engine).
    {
      const { createLink, orbIdentity } = await import('../core/link.mjs');
      const { macAddresses } = await import('../core/wol.mjs');
      const { guardCall, shapeResult, orbNameOf } = await import('../engine/remote.mjs');
      const { audit } = await import('../core/authz.mjs');
      const { whoAsks, once } = await import('../engine/forward.mjs');
      const { orbIdOf } = await import('../core/backup.mjs');
      const { cloneVerdict } = await import('../core/export.mjs');
      let macs = { at: 0, list: [] };
      const myMacs = () => { if (Date.now() - macs.at > 60_000) macs = { at: Date.now(), list: macAddresses() }; return macs.list; };
      const testProtocol = process.env.ORB_FAKE_AGENTS && Number(process.env.ORB_LINK_PROTOCOL) ? Number(process.env.ORB_LINK_PROTOCOL) : null;
      link = remoteRef.link = createLink({
        file: path.join(ctx.paths.data, 'enlaces.json'), secret: ctx.secret ?? readKey(home), log,
        ...(testProtocol ? { protocol: testProtocol, min: Math.min(2, testProtocol) } : {}),
        identity: () => { const id = orbIdOf(home); return { ...orbIdentity({ name: orbNameOf(ctx.config), role: role(), version, macs: myMacs() }), product: PRODUCT_SERVER, orb: { orbId: id.orbId, incarnation: id.incarnation, host: os.hostname().slice(0, 80) } }; },
        verdict: cloneVerdict,
        onRequest: async (method, params, peer, { principal = null, requestId = null } = {}) => {
          const who = whoAsks(board, peer, principal);
          const why = guardCall(board, method, params);
          if (why) { audit(board, who, method, { type: 'link', id: peer?.id ?? '' }, 'deny', 'guard'); throw Object.assign(new Error(why), { status: 403 }); }
          audit(board, who, method, { type: 'link', id: peer?.id ?? '' }, 'allow', 'forward');
          return once(board, requestId, peer?.id, async () => shapeResult(method, (await api.call(method, params, who)) ?? null));
        },
        onChange: (peers) => emit('link:peers', peers)
      });
      if (!ctx.moved) link.start();
      link.on('*', (event, payload, peer) => { if (hostsBots(peer?.role ?? 'taller') && /^bot\./.test(event)) emit(`centro:${event}`, payload, { person: peer?.person ?? ownerOfBoard(board) }); });
      link.on('link:clone', (p, peer) => board.notice(tr('msg.link.clone', { name: p?.name ?? '' }), 'warning', { person: peer?.person ?? null }));
      link.on('link:moved', (p, peer) => board.notice(tr('msg.link.moved', { name: p?.name ?? '' }), 'info', { person: peer?.person ?? null }));
    }
    if (ctx.config.mobile?.enabled && !ctx.moved) remote.start().catch((error) => log(`móvil: ${error.message}`));
    // Changes made here are told at once; changes of other processes (the bots' MCP servers) through data_version.
    const { peopleWith } = await import('../core/authz.mjs');
    let pending = new Map(); let flush = null;
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
    let ticking = false;
    const loop = () => {
      if (ticking) return; ticking = true;
      try {
        const v = board.one('PRAGMA data_version').data_version;
        if (v !== dataVersion) { dataVersion = v; changed('external'); }
        api.dataTick?.();
        updater.tick?.();
      } catch (error) { log(`tick: ${error.stack}`); } finally { ticking = false; }
    };
    loopTimer = setInterval(loop, 2000);
    log(`motor de Orb Server arrancado (versión ${version}, papel ${role()}) en ${home}`);
    if (restored) { log(`copia restaurada: ${restored.from} (lo anterior está en ${restored.aside})`); board.notice(tr('data.backup.restored', { created: String(restored.header?.created ?? '').slice(0, 16).replace('T', ' ') }), 'success'); }
    // A new version that has just started: it is kept only if it stays healthy (src/server/update.mjs).
    updater.afterStart?.({ healthy: async () => Boolean(await api.call('app.state', {}).catch(() => null)) });
    // The engines in use are looked at once a day (a newer version of the same line is downloaded in the background).
    if (!process.env.ORB_FAKE_AGENTS) setTimeout(() => { for (const id of engines.wanted()) if (engines.installed(id)) engines.update(id).catch((error) => log(`motor ${id}: ${error.message}`)); }, 60_000).unref?.();
    loop();
    return { home, name: ctx.config.assistantName, role: role(), headless: true, product: PRODUCT_SERVER };
  }

  async function shutdown() {
    if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
    try { api?.shutdown(); } catch { /* closing anyway */ }
    try { link?.stop(); } catch { /* closing anyway */ }
    await Promise.race([Promise.resolve(remote?.stop()).catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
  }

  async function handle(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'start') {
      try { send({ type: 'started', ok: true, result: await start(msg.home, msg.version, msg.secret) }); }
      catch (error) { log(`no arrancó: ${error?.stack ?? error}`); send({ type: 'started', ok: false, error: error.message }); }
      return;
    }
    if (msg.type === 'shutdown') { await shutdown(); send({ type: 'stopped' }); return; }
    if (msg.type !== 'call') return;
    try {
      if (!api) throw new Error(tr('sys.engine.notStarted', { name: PRODUCT.name }));
      const method = String(msg.method);
      const who = msg.as === 'control' ? api.controlPrincipal() : api.desktopPrincipal();
      const result = await api.call(method, msg.params ?? {}, who);
      send({ type: 'reply', id: msg.id, ok: true, result: result === undefined ? null : result });
    } catch (error) {
      if (!error?.userFacing) log(`${msg.method}: ${error?.stack ?? error}`);
      send({ type: 'reply', id: msg.id, ok: false, error: oneLine(error?.message ?? String(error), 1000) });
    }
  }
  return { handle, log: (line) => log(line) };
}

// As a child process of the host (fork): the same messages through the IPC channel; it exits once it has closed.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain && process.send) {
  const engine = createServerEngine({ send: (m) => process.send(m) });
  process.on('uncaughtException', (error) => engine.log(`uncaughtException: ${error?.stack ?? error}`));
  process.on('unhandledRejection', (error) => engine.log(`unhandledRejection: ${error?.stack ?? error}`));
  process.on('message', (m) => {
    engine.handle(m).then(() => { if (m?.type === 'shutdown') setTimeout(() => process.exit(0), 300); }).catch(() => {});
  });
}
