// 3.7, Orb Server's API: the same methods as the app's for what the server does (bots, inbox, links and the phone
// access, backups, people, sharing, the agents' sign-in), its own server.* methods, and nothing of programming. It does
// not load src/engine/api.mjs (and so neither the scheduler, the whiteboard, God mode nor the PC tools).
import { ctx, saveConfig, tr, role } from '../core/context.mjs';
import { renamePerson } from '../core/persons.mjs';
import { usageReport, usageByPerson } from '../core/budget.mjs';
import { oneLine } from '../core/safety.mjs';
import { authorize, principalOf, shapeFor } from '../core/authz.mjs';
import { fail, str } from '../engine/api-common.mjs';
import { botMethods, centroApi } from '../engine/api-bots.mjs';
import { linkMethods } from '../engine/api-link.mjs';
import { accountMethods } from '../engine/api-accounts.mjs';
import { personMethods } from '../engine/api-persons.mjs';
import { gatewayMethods } from '../engine/api-gateway.mjs';
import { inboxMethods } from '../engine/api-inbox.mjs';
import { dataApi, MOVED_OK } from '../engine/api-data.mjs';
import { shareApi } from '../engine/api-shares.mjs';
import { browserMethods } from '../engine/api-browser.mjs';
import { serverAllows, serverCeiling, PRODUCT_SERVER } from './server-product.mjs';
import { adminState } from '../core/server-admin.mjs';
import { vaultMethods } from './api-vault.mjs';
import { connectionMethods } from '../engine/api-connections.mjs';

// engines: src/server/engines.mjs (createEngines), update: src/server/update.mjs (createUpdater); both optional (tests).
export function buildServerApi({ board, emit, log, version, remoteRef = { current: null }, bots = null, engines = null, updater = null, vault = null }) {
  let lastChat = board.one('SELECT MAX(id) AS id FROM chat')?.id ?? 0;
  const desktop = { person: null, locked: false }; // no window on a server: kept for the shared parts of the API
  const desktopPrincipal = () => principalOf(board, { desktop: true, person: desktop.person });
  const shares = shareApi({ board, bots, log });
  const shared = { board, sessions: null, orchestrator: null, scheduler: null, emit, log, version, remoteRef, bots, desktop, setShare: shares.setShare, removeShare: shares.removeShare,
    project: () => fail(tr('msg.api.centroOff')), conversationId: () => fail(tr('msg.api.centroOff')) };
  const data = dataApi(shared); shared.removePersonData = data.removePersonData;
  const scopeOf = (who) => (who && who.channel !== 'system' ? who : null);
  const engineList = () => (engines ? engines.list() : []);

  const all = {
    'app.state': () => ({
      version, product: PRODUCT_SERVER, home: ctx.home, role: role(), layout: ctx.paths.layout ?? 'pc', config: ctx.config, paused: board.setting('paused') === '1',
      // What a phone's interface reads from the app's state, empty: the server does no programming.
      categories: [], activeProject: null, approvals: [], counts: {}, chats: [], assistant: null, optiSession: null, completed: [], kept: [],
      agentsAvailable: board.availableAgents(), moved: ctx.moved ?? null
    }),
    'config.save': ({ patch }) => {
      const c = saveConfig(patch ?? {}); emit('config:changed', c);
      if (typeof patch?.userName === 'string' && patch.userName.trim()) { try { const o = board.ownerId(); if (o) { renamePerson(board, o, patch.userName.trim()); board.changed('persons'); } } catch { /* the settings keep it */ } }
      try { remoteRef.link?.refresh(); } catch { /* next connection */ }
      return c;
    },
    'usage.get': (p, who) => { const avail = board.availableAgents(); return usageReport(board, { person: scopeOf(who) ? who.person : null }).filter((u) => !avail || avail.includes(u.agent)); },
    'usage.byPerson': () => usageByPerson(board),
    // ---- the server itself
    'server.status': async () => ({ version, product: PRODUCT_SERVER, layout: ctx.paths.layout ?? 'pc', node: process.version, arch: process.arch, platform: process.platform,
      memory: { rss: process.memoryUsage().rss, heapUsed: process.memoryUsage().heapUsed }, uptime: Math.round(process.uptime()),
      engines: engineList(), admin: await adminState(), update: updater ? updater.status() : null }),
    'server.engines': () => engineList(),
    'server.engines.install': async ({ id }) => { if (!engines) fail(tr('msg.api.centroOff')); return engines.ensure(str(id, 'motor', 20)); },
    'server.update.status': () => (updater ? updater.status() : null),
    'server.update.check': async () => { if (!updater) fail(tr('msg.api.centroOff')); return updater.check(); },
    'server.update.apply': async () => { if (!updater) fail(tr('msg.api.centroOff')); return updater.apply(); },
    ...botMethods(shared),
    ...accountMethods(shared),
    ...linkMethods(shared),
    ...personMethods(shared),
    ...gatewayMethods(shared),
    ...inboxMethods(shared),
    ...browserMethods(shared), // 3.7: «Ver navegador del Server» (live view) on the server too
    ...data.methods,
    ...shares.methods,
    // 3.7 (WS6): the person's password vault (vault_fill types from it; nothing of it is ever returned).
    ...vaultMethods({ board, log, vault }),
    // 3.7 (WS9): «Conexiones» (the app asks this Server for its own rows: its phones, vault, live views, accounts, RAM).
    ...connectionMethods(shared)
  };
  // Only what the server does: what the shared parts also have for the PC (agents.install, data.* of projects…) is left out.
  const methods = Object.fromEntries(Object.entries(all).filter(([k]) => serverAllows(k)));
  const centroCall = centroApi(shared);
  // A bot about to answer needs its agent's engine: downloaded the first time (src/server/engines.mjs).
  const needsEngine = /^(bots\.(chat|send|groups\.send|groups\.chat|create|update)|agents\.(login|check))$/;
  const ensureFor = async (method, params) => {
    if (!engines || engines.offline || !needsEngine.test(method)) return;
    const ids = new Set();
    if (/^agents\./.test(method)) { const agent = ctx.config.accounts.find((a) => a.id === params?.account)?.agent ?? params?.account; if (['claude', 'codex'].includes(agent)) ids.add(agent); }
    if (/^bots\./.test(method)) for (const id of engines.wanted()) ids.add(id);
    for (const id of ids) { try { await engines.ensure(id); } catch (error) { log(`motor ${id}: ${error.message}`); } }
  };

  return {
    async call(method, params, principal) {
      let who = principal ?? principalOf(board, { system: true });
      // The ceilings of the server: the app's, without programming (authz takes the principal's own ceiling first).
      const ceiling = serverCeiling(who);
      if (ceiling) who = { ...who, ceiling };
      if (params === null || typeof params !== 'object' || Array.isArray(params)) fail(tr('msg.api.badParams'));
      // 3.7: phone → server → PC: the server relays programming to the workshop linked with it (it does none itself).
      if (typeof method === 'string' && method.startsWith('taller.')) {
        authorize(board, who, method, params);
        try { return await remoteRef.current.taller(method.slice(7), params, { principal: who }); } catch (error) { error.userFacing = true; throw error; }
      }
      if (typeof method === 'string' && method.startsWith('centro.')) { authorize(board, who, method, params); return centroCall(method.slice(7), params, who); }
      if (!serverAllows(method) || !Object.hasOwn(methods, method)) fail(tr(serverAllows(method) ? 'msg.api.unknownAction' : 'msg.api.centroOff', { method }));
      if (ctx.moved && !MOVED_OK.test(method)) fail(tr('data.move.movedAway'));
      authorize(board, who, method, params);
      await ensureFor(method, params);
      const out = await methods[method](params, who);
      return shapeFor(who, method, out, board);
    },
    methodNames: () => Object.keys(methods),
    desktopPrincipal,
    desktop,
    controlPrincipal: () => principalOf(board, { control: true, strongUntil: Date.now() + 60_000 }),
    lockState: () => methods['app.lockState'](),
    // The server's notices (a bot's lines go through its own events): passed on as 'notice'.
    notifyNewChat() {
      const rows = board.all('SELECT id, role, body, meta, conversation_id, person_id FROM chat WHERE id > ? ORDER BY id LIMIT 20', lastChat);
      if (!rows.length) return;
      lastChat = rows[rows.length - 1].id;
      for (const r of rows) {
        if (r.role !== 'notice') continue;
        let m = null; try { m = JSON.parse(r.meta); } catch { /* plain */ }
        emit('notice', { body: oneLine(r.body, 300), tone: m?.tone ?? 'info', ...(m?.person ? { person: m.person } : {}) });
      }
    },
    dataTick: () => data.tick(),
    shutdown() { bots?.shutdown(); try { engines?.closeAll(); } catch { /* closing anyway */ } log('motor detenido'); }
  };
}
