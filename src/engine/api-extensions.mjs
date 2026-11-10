// 3.8.1: Ajustes › Skills y MCP in the engine's API (this PC's window only: src/domain/security/permissions.mjs). The work is in
// src/domain/extensions/extensions.mjs; here: the list, turning one on or off, importing (a folder or a git repository), removing
// (after the master password: it deletes from core), the agents' requests (approve or discard, from the chat card or
// Ajustes), and improving a server of core in a project («Editar en un proyecto» / «Aplicar cambios»).
//   liveSkills: what the agents get (the plugin folder, the extra root and the list), made again when the skills that
//   are on change (src/engine/sessions.mjs and orchestrator.mjs hand it to each agent they start).
import fs from 'node:fs';
import path from 'node:path';
import { ctx, tr } from '../platform/context.mjs';
import { saveConfig } from '../platform/config.mjs';
import { CATEGORIES } from '../platform/paths.mjs';
import { loadConfig } from '../platform/config-file.mjs';
import { syncProjects } from '../domain/projects/projects.mjs';
import { moveIntoCore } from '../domain/workspace/core-folder.mjs';
import { sealConnectors, rebindOrWait, settleRebinds, REBINDS } from '../domain/security/connector-secrets.mjs';
import { oneOf, str } from './api-common.mjs';
import {
  listExtensions, skillsWith, mcpWith, importExtension, removeExtension, exposeSkills, activateRequest, editInProject,
  applyEdit, prepareApply, isMcpProject, startCommand, checkSkill, allowDraft, discardRequest, installFor,
  ExtensionError, REQUESTS, EDITS, MCP_NAME, SKILL_NAME, cleanExtensionLeftovers
} from '../domain/extensions/extensions.mjs';

// ---- what the agents load (core\skills\.activas), made again when the skills that are on change
let live = null; let liveKey = null;
export function refreshSkills() {
  liveKey = JSON.stringify(ctx.config?.skills ?? []);
  try { live = exposeSkills(ctx.paths.core, ctx.config); } catch { live = { plugin: null, root: null, list: [] }; }
  return live;
}
export const liveSkills = () => (live && liveKey === JSON.stringify(ctx.config?.skills ?? []) ? live : refreshSkills());

// ---- a connector Orb moved while the vault was locked: its keys are tied again when it opens (never silently lost)
const rebindStore = (board) => ({ get: () => board.settingJson(REBINDS) ?? [], set: (v) => board.settingJson(REBINDS, v) });
export function rebindMovedOrWait(board, before, after) {
  const waiting = rebindOrWait(ctx.master, before, after, rebindStore(board));
  if (waiting.length) board.notice(tr('ext.keysWaiting', { names: waiting.join(', ') }), 'warning');
  return waiting;
}
export function settleWaitingKeys(board, log = () => {}) {
  try { const done = settleRebinds(ctx.master, rebindStore(board)); if (done.length) log(`claves: atadas de nuevo ${done.join(', ')}`); return done; } catch (error) { log(`claves: ${error.message}`); return []; }
}

const KINDS = ['skill', 'mcp', 'connector'];
const fail = (key, vars) => { throw new ExtensionError(key, vars, tr); };

export function extensionMethods({ board, emit, log }) {
  const requests = () => { const r = board.settingJson(REQUESTS); return Array.isArray(r) ? r : []; };
  // 3.8.1 (review H1c B3): the MCP processes change this list too: read and written in one write transaction.
  const updateRequests = (fn) => { board.transaction(() => board.settingJson(REQUESTS, fn(requests()).slice(-50))); board.changed('settings'); };
  // B2: and what nothing points to any more goes, once per start.
  try { const all = requests(); const keep = cleanExtensionLeftovers(ctx.paths.core, all); if (keep.length !== all.length) updateRequests((list) => list.filter((r) => keep.some((k) => k.id === r.id))); } catch (error) { log(`extensiones: limpieza: ${error.message}`); }
  const edits = () => { const e = board.settingJson(EDITS); return e && typeof e === 'object' && !Array.isArray(e) ? e : {}; };
  const list = () => listExtensions(ctx.paths.core, ctx.config, { projects: board.projects(), requests: requests(), edits: edits() });
  // orb.json changed: its connectors' keys follow (a connector that went takes its keys with it; one Orb moved keeps
  // them), the skills the agents load are made again and the window hears it.
  const save = (patch, { moved = false } = {}) => {
    if (!patch || !Object.keys(patch).length) return ctx.config;
    const before = ctx.config.mcpServers ?? [];
    let p = patch;
    if (Array.isArray(patch.mcpServers)) {
      if (moved) rebindMovedOrWait(board, before, patch.mcpServers);
      const sealed = sealConnectors(ctx.master, patch.mcpServers, { trusted: false });
      if (sealed) p = { ...patch, mcpServers: sealed };
    }
    const c = saveConfig(p);
    emit('config:changed', c);
    refreshSkills();
    return c;
  };
  const name = (v, kind) => { const n = str(v, 'nombre', 64); if (!(kind === 'skill' ? SKILL_NAME : MCP_NAME).test(n)) fail('ext.err.notFound', { name: n }); return n; };
  // The chat card of a request shows how it ended.
  const markCards = (id, status) => {
    for (const r of board.all("SELECT id, meta FROM chat WHERE meta LIKE '%\"kind\":\"extension\"%'")) {
      let m = null; try { m = JSON.parse(r.meta); } catch { continue; }
      if (m?.extension === id) board.patchChatMeta(r.id, { ...m, status });
    }
  };
  const request = (id) => { const r = requests().find((x) => x.id === String(id ?? '')); if (!r) fail('ext.err.noRequest'); return r; };
  // One at a time per request, server or import (each may wait for git or npm without blocking the engine).
  const running = new Set();
  const once = async (key, fn) => { if (running.has(key)) fail('ext.err.inProgress'); running.add(key); try { return await fn(); } finally { running.delete(key); } };
  const busyProject = (dir) => { const p = board.projects().find((x) => path.resolve(x.path).toLowerCase() === path.resolve(dir).toLowerCase()); return p && board.one("SELECT COUNT(*) AS n FROM tasks WHERE project = ? AND status IN ('queued', 'awaiting_approval', 'running')", p.name).n ? p.name : null; };
  // What «Aplicar cambios» showed (the quarantine's copy and its fingerprint): only that is applied.
  const applies = new Map();

  return {
    'extensions.list': () => list(),
    // On or off. A server of core with no connector yet gets one (the command that starts it); a connector of the PC
    // (npx…) by its name.
    // A skill is checked as when it came in (a skill put in core by hand too); a server that needs its dependencies is
    // turned on only once the user was told (install: true): Orb installs them then, with no install scripts.
    'extensions.toggle': async ({ kind, name: raw, enabled, install }) => {
      const k = oneOf(kind, KINDS, 'tipo');
      const on = enabled === true;
      if (k === 'skill') {
        const n = name(raw, 'skill');
        const row = list().skills.find((s) => s.name === n);
        if (!row || (on && !row.valid)) fail(row?.linked ? 'ext.err.link' : 'ext.err.notFound', { name: n, file: n });
        if (on) checkSkill(row.dir, { name: n, tr });
        save({ skills: skillsWith(ctx.config, n, { enabled: on }) });
      } else if (k === 'mcp') {
        const n = name(raw, 'mcp');
        const row = list().mcp.find((s) => s.name === n);
        if (on && row?.linked) fail('ext.err.link', { file: n });
        if (on && row?.needsInstall) {
          if (install !== true) fail('ext.err.needsInstall', { name: n });
          await once(`mcp:${n}`, () => installFor(ctx.paths.core, n, { tr }));
        }
        const servers = mcpWith(ctx.config, ctx.paths.core, n, on);
        if (!servers) fail('ext.err.noStart');
        save({ mcpServers: servers });
      } else {
        const n = str(raw, 'nombre', 40);
        if (!(ctx.config.mcpServers ?? []).some((s) => s.name === n)) fail('ext.err.notFound', { name: n });
        save({ mcpServers: ctx.config.mcpServers.map((s) => (s.name === n ? { ...s, enabled: on } : s)) });
      }
      log(`extensiones: ${k} ${raw} ${on ? 'activado' : 'desactivado'}`);
      return list();
    },
    // From a folder of this PC or a git repository (https): into core, checked, off until the user turns it on.
    // Cloned or copied into the quarantine without running anything (no git hooks, no install scripts), in the background.
    'extensions.import': async ({ from, url }) => {
      if (!from === !url) fail('ext.err.importWhat');
      const r = await once('import', () => importExtension(ctx.paths.core, ctx.config, { from: from ? str(from, 'carpeta', 1000) : null, url: url ? str(url, 'repositorio', 500) : null, tr }));
      save(r.patch);
      log(`extensiones: importado ${r.kind} ${r.name} (${from ? 'carpeta' : url})`);
      return { kind: r.kind, name: r.name, list: list() };
    },
    // Guarded (the master password, src/domain/security/permissions.mjs): a skill or a server leaves core, folder and all; a connector
    // of the PC, its entry and keys.
    'extensions.remove': ({ kind, name: raw }) => {
      const k = oneOf(kind, KINDS, 'tipo');
      if (k === 'connector') {
        const n = str(raw, 'nombre', 40);
        if (!(ctx.config.mcpServers ?? []).some((s) => s.name === n)) fail('ext.err.notFound', { name: n });
        save({ mcpServers: ctx.config.mcpServers.filter((s) => s.name !== n) });
      } else {
        const n = name(raw, k);
        const e = edits();
        save(removeExtension(ctx.paths.core, ctx.config, k, n, { tr }));
        if (k === 'mcp' && e[n]) { delete e[n]; board.settingJson(EDITS, e); }
      }
      log(`extensiones: ${k} ${raw} quitado de core`);
      return list();
    },
    // An agent's request (src/mcp/server.mjs): the quarantine's copy it asked with goes into core, on. A request to improve
    // a server that holds keys ('asking'): allowed, its copy (without them) is made for the agent.
    'extensions.approve': ({ id }) => once(`req:${id}`, async () => {
      const r = request(id);
      if (r.status === 'asking') {
        const next = allowDraft(ctx.paths.core, r, { tr });
        updateRequests((list) => list.map((x) => (x.id === r.id ? next : x)));
        markCards(r.id, 'approved');
        log(`extensiones: permitido mejorar ${r.name}`);
        return list();
      }
      const out = await activateRequest(ctx.paths.core, ctx.config, r, { tr });
      save(out.patch, { moved: Boolean(r.update) });
      updateRequests((list) => list.filter((x) => x.id !== r.id));
      markCards(r.id, 'approved');
      board.notice(tr(r.kind === 'skill' ? 'ext.approvedSkill' : 'ext.approvedMcp', { name: r.name }), 'success');
      log(`extensiones: ${r.kind} ${r.name} aprobado (${r.update ? 'versión nueva' : 'nuevo'})`);
      return list();
    }),
    'extensions.reject': ({ id }) => {
      const r = request(id);
      if (running.has(`req:${r.id}`)) fail('ext.err.inProgress');
      discardRequest(ctx.paths.core, r);
      updateRequests((list) => list.filter((x) => x.id !== r.id));
      markCards(r.id, 'rejected');
      log(`extensiones: ${r.kind} ${r.name} descartado`);
      return list();
    },
    // «Editar en un proyecto»: a copy of a server of core becomes a project (work on it there with any agent).
    'extensions.edit': ({ name: raw, category }) => {
      const n = name(raw, 'mcp');
      const cat = oneOf(category ?? 'windows', CATEGORIES, 'categoría');
      const open = edits()[n];
      if (open && fs.existsSync(open)) return { path: open, project: board.projects().find((p) => path.resolve(p.path).toLowerCase() === path.resolve(open).toLowerCase())?.name ?? null };
      const to = editInProject(ctx.home, ctx.paths.core, n, cat, { tr });
      board.settingJson(EDITS, { ...edits(), [n]: to });
      syncProjects(board);
      log(`extensiones: ${n} copiado a ${to} para editarlo`);
      return { path: to, project: board.projects().find((p) => path.resolve(p.path).toLowerCase() === to.toLowerCase())?.name ?? null };
    },
    // «Mover a core»: a project that is an MCP server goes into core\mcp (its connector, if any, follows with its keys).
    'extensions.adopt': ({ project: raw }) => {
      const p = board.project(str(raw, 'proyecto', 120));
      if (!p) fail('ext.err.notFound', { name: raw });
      if (!isMcpProject(p.path) || !startCommand(p.path)) fail('ext.err.noStart');
      const open = board.one("SELECT COUNT(*) AS n FROM tasks WHERE project = ? AND status IN ('queued', 'awaiting_approval', 'running')", p.name).n;
      if (open) fail('ext.err.projectBusy', { name: p.name });
      const before = ctx.config.mcpServers ?? [];
      const to = moveIntoCore(ctx.home, p.path, { language: ctx.config.language });
      ctx.config = loadConfig(ctx.home);
      rebindMovedOrWait(board, before, ctx.config.mcpServers ?? []);
      emit('config:changed', ctx.config);
      syncProjects(board);
      log(`extensiones: proyecto ${p.name} movido a ${to}`);
      // 3.8.1 (review H1c M8): where it is now (the window says so: a program outside Orb may use the old path).
      return { list: list(), moved: { from: p.path, to } };
    },
    // What «Aplicar cambios» would change (the window asks before): the project's version is copied into the quarantine
    // now, and only that copy is applied (a change in the project after this is not).
    'extensions.applyCheck': ({ name: raw }) => {
      const n = name(raw, 'mcp');
      const from = edits()[n];
      if (!from || !fs.existsSync(from)) fail('ext.err.noEdit', { name: n });
      const busy = busyProject(from);
      if (busy) fail('ext.err.projectBusy', { name: busy });
      const prepared = prepareApply(ctx.paths.core, n, from, { tr });
      applies.set(n, prepared);
      const { id, added, changed, removed } = prepared;
      return { name: n, path: from, id, added, changed, removed };
    },
    'extensions.apply': ({ name: raw, id }) => once(`mcp:${raw}`, async () => {
      const n = name(raw, 'mcp');
      const prepared = applies.get(n);
      if (!prepared || prepared.id !== String(id ?? '')) fail('ext.err.changed', { name: n });
      const out = await applyEdit(ctx.paths.core, ctx.config, n, prepared, { tr });
      applies.delete(n);
      save(out.patch, { moved: true });
      log(`extensiones: cambios de ${edits()[n] ?? n} aplicados a ${n}`);
      return list();
    })
  };
}
