// 3.8.1: Ajustes › Skills y MCP in the engine's API (this PC's window only: src/core/permissions.mjs). The work is in
// src/core/extensions.mjs; here: the list, turning one on or off, importing (a folder or a git repository), removing
// (after the master password: it deletes from core), the agents' requests (approve or discard, from the chat card or
// Ajustes), and improving a server of core in a project («Editar en un proyecto» / «Aplicar cambios»).
//   liveSkills: what the agents get (the plugin folder, the extra root and the list), made again when the skills that
//   are on change (src/engine/sessions.mjs and orchestrator.mjs hand it to each agent they start).
import fs from 'node:fs';
import path from 'node:path';
import { ctx, saveConfig, tr } from '../core/context.mjs';
import { CATEGORIES, loadConfig } from '../core/home.mjs';
import { syncProjects } from '../core/projects.mjs';
import { moveIntoCore } from '../core/core-folder.mjs';
import { sealConnectors, rebindMoved } from '../core/connector-secrets.mjs';
import { oneOf, str } from './api-common.mjs';
import {
  listExtensions, skillsWith, mcpWith, importExtension, removeExtension, exposeSkills, activateRequest, editInProject,
  applyEdit, compareTrees, isMcpProject, startCommand, ExtensionError, REQUESTS, EDITS, MCP_NAME, SKILL_NAME
} from '../core/extensions.mjs';

// ---- what the agents load (core\skills\.activas), made again when the skills that are on change
let live = null; let liveKey = null;
export function refreshSkills() {
  liveKey = JSON.stringify(ctx.config?.skills ?? []);
  try { live = exposeSkills(ctx.paths.core, ctx.config); } catch { live = { plugin: null, root: null, list: [] }; }
  return live;
}
export const liveSkills = () => (live && liveKey === JSON.stringify(ctx.config?.skills ?? []) ? live : refreshSkills());

const KINDS = ['skill', 'mcp', 'connector'];
const fail = (key, vars) => { throw new ExtensionError(key, vars, tr); };

export function extensionMethods({ board, emit, log }) {
  const requests = () => { const r = board.settingJson(REQUESTS); return Array.isArray(r) ? r : []; };
  const saveRequests = (list) => { board.settingJson(REQUESTS, list.slice(-50)); board.changed('settings'); };
  const edits = () => { const e = board.settingJson(EDITS); return e && typeof e === 'object' && !Array.isArray(e) ? e : {}; };
  const list = () => listExtensions(ctx.paths.core, ctx.config, { projects: board.projects(), requests: requests(), edits: edits() });
  // orb.json changed: its connectors' keys follow (a connector that went takes its keys with it; one Orb moved keeps
  // them), the skills the agents load are made again and the window hears it.
  const save = (patch, { moved = false } = {}) => {
    if (!patch || !Object.keys(patch).length) return ctx.config;
    const before = ctx.config.mcpServers ?? [];
    let p = patch;
    if (Array.isArray(patch.mcpServers)) {
      if (moved) rebindMoved(ctx.master, before, patch.mcpServers);
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

  return {
    'extensions.list': () => list(),
    // On or off. A server of core with no connector yet gets one (the command that starts it); a connector of the PC
    // (npx…) by its name.
    'extensions.toggle': ({ kind, name: raw, enabled }) => {
      const k = oneOf(kind, KINDS, 'tipo');
      const on = enabled === true;
      if (k === 'skill') {
        const n = name(raw, 'skill');
        if (!list().skills.some((s) => s.name === n && (s.valid || !on))) fail('ext.err.notFound', { name: n });
        save({ skills: skillsWith(ctx.config, n, { enabled: on }) });
      } else if (k === 'mcp') {
        const n = name(raw, 'mcp');
        const servers = mcpWith(ctx.config, ctx.paths.core, n, on);
        if (!servers) fail('ext.err.noStart');
        save({ mcpServers: servers });
      } else {
        const n = str(raw, 'nombre', 40);
        if (!(ctx.config.mcpServers ?? []).some((s) => s.name === n)) fail('ext.err.notFound', { name: n });
        save({ mcpServers: ctx.config.mcpServers.map((s) => (s.name === n ? { ...s, enabled: on } : s)) });
      }
      log(`extensiones: ${k} ${raw} ${on ? 'activada' : 'desactivada'}`);
      return list();
    },
    // From a folder of this PC or a git repository (https): into core, checked, off until the user turns it on.
    'extensions.import': ({ from, url }) => {
      if (!from === !url) fail('ext.err.importWhat');
      const r = importExtension(ctx.paths.core, ctx.config, { from: from ? str(from, 'carpeta', 1000) : null, url: url ? str(url, 'repositorio', 500) : null, tr });
      save(r.patch);
      log(`extensiones: importada ${r.kind} ${r.name} (${from ? 'carpeta' : url})`);
      return { kind: r.kind, name: r.name, list: list() };
    },
    // Guarded (the master password, src/core/permissions.mjs): a skill or a server leaves core, folder and all; a connector
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
      log(`extensiones: ${k} ${raw} quitada de core`);
      return list();
    },
    // An agent's request (src/mcp/server.mjs › orb_request_activation): the same files it asked with go into core, on.
    'extensions.approve': ({ id }) => {
      const r = request(id);
      const out = activateRequest(ctx.paths.core, ctx.config, r, { tr });
      save(out.patch, { moved: Boolean(r.update) });
      saveRequests(requests().filter((x) => x.id !== r.id));
      markCards(r.id, 'approved');
      board.notice(tr(r.kind === 'skill' ? 'ext.approvedSkill' : 'ext.approvedMcp', { name: r.name }), 'success');
      log(`extensiones: ${r.kind} ${r.name} aprobada (${r.update ? 'versión nueva' : 'nueva'})`);
      return list();
    },
    'extensions.reject': ({ id }) => {
      const r = request(id);
      try { fs.rmSync(r.dir, { recursive: true, force: true }); } catch { /* left in core\preparacion */ }
      saveRequests(requests().filter((x) => x.id !== r.id));
      markCards(r.id, 'rejected');
      log(`extensiones: ${r.kind} ${r.name} descartada`);
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
      rebindMoved(ctx.master, before, ctx.config.mcpServers ?? []);
      emit('config:changed', ctx.config);
      syncProjects(board);
      log(`extensiones: proyecto ${p.name} movido a ${to}`);
      return list();
    },
    // What «Aplicar cambios» would change (the window asks before).
    'extensions.applyCheck': ({ name: raw }) => {
      const n = name(raw, 'mcp');
      const from = edits()[n];
      if (!from || !fs.existsSync(from)) fail('ext.err.noEdit', { name: n });
      return { name: n, path: from, ...compareTrees(path.join(ctx.paths.mcp, n), from) };
    },
    'extensions.apply': ({ name: raw }) => {
      const n = name(raw, 'mcp');
      const from = edits()[n];
      if (!from || !fs.existsSync(from)) fail('ext.err.noEdit', { name: n });
      const out = applyEdit(ctx.paths.core, ctx.config, n, from, { tr });
      save(out.patch, { moved: true });
      log(`extensiones: cambios de ${from} aplicados a ${n}`);
      return list();
    }
  };
}
