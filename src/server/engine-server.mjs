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
import { botRelay } from '../engine/bot-relay.mjs';

// One engine per process. send(message) takes what the engine says (the host's side of the protocol).
export function createServerEngine({ send }) {
  let api = null; let remote = null; let link = null; let router = null; let bots = null; let engines = null; let updater = null; let vault = null;
  let replica = null; let oce = null; // 3.7 (WS3, WS8): the bots' homes and copies; Open Control Edge readings and Optimus
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
      router.add('window', (event, payload, audience, to) => { if (event !== 'browser:live' && to(ownerOfBoard(board))) toHost(event, payload); });
      router.add('remote', (event, payload, audience, to) => remote?.broadcast(event, payload, audience, to));
      // 3.7 (WS2): the events of the bots run here go with their uids (never those of a copy: its home sends its own).
      router.add('link', (event, payload, audience, to) => { const p = botRelay(board, event, payload); if (p) link?.relay(event, p, (pid) => to(pid ?? ownerOfBoard(board))); });
      // 3.7 (WS5): the browser closes the pages of a task that ended.
      router.add('serverBrowser', (event, payload) => { if (event === 'agentBrowser:closeTask') ctx.serverBrowser?.closeTask(payload?.task); });
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
    // 3.7 (WS6): the password vault: its own process (keys in its memory only), sign-ins sealed with the server's key in
    // data/vault/. ctx.vaultFill is the hook of the browser's vault_fill (src/server/vault/fill.mjs; WS5's browser takes it).
    {
      const { createVaultService } = await import('./vault/worker.mjs');
      const { vaultSealKey, vaultSealKeyV2 } = await import('./vault/crypto.mjs');
      const { vaultKeyFile, loadVaultFileKey } = await import('./vault/keyfile.mjs');
      const { createVaultFillHook } = await import('./vault/fill.mjs');
      const { mayUseVault } = await import('../core/persons.mjs');
      const B = await import('../core/bots.mjs');
      const secret = ctx.secret ?? readKey(home);
      // 3.7: the seal also needs the vault's key file, outside ~/orb-server (keyfile.mjs): a copy of the data folder alone
      // does not open it. A broken key file leaves the vault off (logged), never replaced.
      let fileKey = null;
      try { fileKey = secret?.length >= 32 ? loadVaultFileKey(vaultKeyFile(home)) : null; } catch (error) { log(`bóveda: no puedo usar su clave (${error.message}); la bóveda queda apagada`); }
      if (fileKey) {
        vault = ctx.vault = createVaultService({ dir: path.join(ctx.paths.internal, 'vault'), sealKey: vaultSealKeyV2(secret, fileKey), legacyKey: vaultSealKey(secret), log });
        ctx.vaultFill = createVaultFillHook({ vault, board, addRequest: B.addRequest, allowed: (p) => mayUseVault(board, p) });
      }
    }
    const { buildServerApi } = await import('./api-server.mjs');
    api = buildServerApi({ board, emit, log, version, remoteRef, bots, engines, updater, vault });
    const { createRemote } = await import('../engine/remote.mjs');
    // 3.7 (WS2): what this Server says it can do (server, plus browser.live.v1 / vault.v1 once those are up), as the app's.
    const { capsFor, isHomeCall, isOceCall } = await import('../core/link.mjs');
    const testCaps = process.env.ORB_FAKE_AGENTS && process.env.ORB_LINK_CAPS ? process.env.ORB_LINK_CAPS.split(',').filter(Boolean) : null;
    const caps = () => testCaps ?? capsFor({ server: true, browserLive: Boolean(ctx.browserLive), vault: Boolean(ctx.vault) });
    remote = remoteRef.current = createRemote({ board, api, log, emit, version, features: caps });
    // 3.7 (WS2): who is who between the app and this Server (link_persons); the handoff of the phones is the app's side
    // (remote.mjs answers its 'handoff' op here). A mirrored line of a bot pulls its copy at once.
    const { createHub } = await import('../engine/hub.mjs');
    const hub = remoteRef.hub = createHub({ board, remote: () => remote, link: () => link, log, version });
    { let t = null; remote.onMirror = (peer, ev) => { if (ev?.e !== 'bot.message') return; clearTimeout(t); t = setTimeout(() => { replica?.syncNow?.().catch?.(() => {}); }, 500); t.unref?.(); }; }
    const notReady = () => Object.assign(new Error('este Orb aún no está listo'), { status: 503 });
    const homeCall = (peer, method, params) => {
      if (isOceCall(method)) { if (!oce) throw notReady(); return oce.serve(peer, method, params); }
      if (!replica) throw notReady();
      return replica.serve(peer, method, params);
    };
    // 3.7 (WS5): the bots' browser (src/server/browser.mjs): its pipe now, Chromium only when a bot needs it.
    if (ctx.config.browser?.enabled !== false && (process.platform === 'linux' || process.env.ORB_SERVER_BROWSER === '1')) {
      try { const { startServerBrowser } = await import('./browser.mjs'); await startServerBrowser({ board, emit, log, push: (note) => remoteRef.current?.push?.(note) }); }
      catch (error) { log(`navegador del Server: ${error.message}`); }
    }
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
        features: caps, mapped: (p) => hub.mapped(p),
        onRequest: async (method, params, peer, { principal = null, requestId = null } = {}) => {
          // 3.7 (WS3, WS8): the bots' homes and copies, and the Open Control Edge readings: replica.mjs / oce.mjs decide.
          if (isHomeCall(method)) return homeCall(peer, method, params);
          const who = whoAsks(board, peer, principal);
          const why = guardCall(board, method, params);
          if (why) { audit(board, who, method, { type: 'link', id: peer?.id ?? '' }, 'deny', 'guard'); throw Object.assign(new Error(why), { status: 403 }); }
          audit(board, who, method, { type: 'link', id: peer?.id ?? '' }, 'allow', 'forward');
          return once(board, requestId, peer?.id, async () => shapeResult(method, (await api.call(method, params, who)) ?? null));
        },
        onChange: (peers) => emit('link:peers', peers)
      });
      if (!ctx.moved) link.start();
      // 3.7 (WS3): one home per bot, a live copy on the other linked Orbs (as in src/engine/engine.mjs).
      {
        const { createReplica } = await import('../engine/replica.mjs');
        replica = remoteRef.replica = createReplica({ board, bots, emit, log, link: () => link, remote: () => remote, api });
        remote.onHomeCall = (peer, method, params) => {
          if (!isHomeCall(method)) throw Object.assign(new Error('operación desconocida'), { status: 404 });
          return homeCall(peer, method, params);
        };
        remote.onOrbGone = (peer) => replica.onOrbGone(peer);
        if (!ctx.moved) replica.start();
      }
      // 3.7 (WS8): Open Control Edge on the owner's linked Orbs (read-only) and its bot Optimus, made once.
      {
        const { createOce } = await import('../engine/oce.mjs');
        oce = createOce({ board, bots, log, link: () => link, remote: () => remote, replica: () => replica });
        if (!ctx.moved) oce.start();
      }
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
    try { await Promise.race([ctx.serverBrowser?.shutdown(), new Promise((r) => setTimeout(r, 3000))]); } catch { /* closing anyway */ }
    try { vault?.close(); } catch { /* closing anyway */ }
    try { oce?.stop(); } catch { /* closing anyway */ }
    try { replica?.stop(); } catch { /* closing anyway */ }
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
