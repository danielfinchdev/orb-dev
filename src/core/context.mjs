// Process-wide context: which assistant folder this process serves and its configuration.
// The engine, the MCP server and the tests call useHome() once; every core module reads ctx.
import fs from 'node:fs';
import path from 'node:path';
import { paths, loadConfig, writeJson, merge, AGENT_IDS, relabelEmptyLogs } from './home.mjs';
import { translate } from './i18n.mjs';
import { SKINS, FONTS, CODE_FONTS, CODE_THEMES } from './appearance.mjs';

export const ctx = { home: null, paths: null, config: null, secret: null }; // secret: approval secret handed by the app (memory only)

// Message in the language of the settings (Spanish until a configuration is loaded).
export const tr = (key, vars) => translate(ctx.config?.language ?? 'es', key, vars);

export function useHome(home) {
  ctx.home = home; ctx.paths = paths(home); ctx.config = loadConfig(home);
  return ctx;
}

export function reloadConfig() { if (ctx.home) ctx.config = loadConfig(ctx.home); return ctx.config; }

// Settings saved from the app. Only known top-level keys are accepted.
const EDITABLE = ['assistantName', 'userName', 'language', 'orchestrator', 'autoRun', 'maxParallel', 'perAgent', 'timeoutMinutes', 'agentOrder', 'agents', 'budget', 'policy', 'review', 'mcpServers', 'projectRoots', 'ui', 'accounts', 'mobile', 'expert', 'browser', 'continuity', 'delegation'];
export function saveConfig(patch) {
  const unknown = Object.keys(patch ?? {}).filter((k) => !EDITABLE.includes(k));
  if (unknown.length) throw new Error(tr('msg.ctx.unknownSettings', { unknown: unknown.join(', ') }));
  const next = merge(ctx.config, patch);
  validateConfig(next);
  writeJson(ctx.paths.config, next);
  if (next.language !== ctx.config.language) relabelEmptyLogs(ctx.home, ctx.config, next);
  ctx.config = next;
  return next;
}

// An account's login folder holds that subscription's credentials: never where agents work (the assistant's folder, a
// project, the allowed roots) and never on a network share. Only the app's own .orb/cuentas is fine inside the folder.
export function checkAccountHome(home, c = ctx.config, projects = []) {
  const raw = String(home);
  if (/^(\\\\|\/\/)/.test(raw)) throw new Error(tr('msg.ctx.accountNet'));
  const norm = (p) => path.resolve(p).toLowerCase().replace(/[\\/]+$/, '');
  const target = norm(raw);
  const inside = (dir) => { const d = norm(dir); return target === d || target.startsWith(d + path.sep); };
  if (ctx.home && inside(ctx.home) && !inside(path.join(ctx.home, '.orb', 'cuentas'))) throw new Error(tr('msg.ctx.accountInHome'));
  for (const dir of [...(c?.projectRoots ?? []), ...projects]) if (dir && inside(dir)) throw new Error(tr('msg.ctx.accountInDir', { dir }));
}

export function validateConfig(c) {
  const int = (v, min, max, name) => { if (!Number.isInteger(v) || v < min || v > max) throw new Error(tr('msg.ctx.numRange', { name, min, max })); };
  int(c.maxParallel, 1, 10, 'maxParallel'); int(c.perAgent, 1, 5, 'perAgent'); int(c.timeoutMinutes, 5, 600, 'timeoutMinutes');
  if (!String(c.assistantName ?? '').trim()) throw new Error(tr('msg.ctx.needName'));
  if (!['es', 'en'].includes(c.language)) throw new Error(tr('msg.ctx.badLanguage'));
  for (const id of AGENT_IDS) {
    const a = c.agents?.[id]; if (!a) throw new Error(tr('msg.ctx.missingAgentCfg', { id }));
    if (!Array.isArray(a.models) || a.models.some((m) => typeof m !== 'string' || !/^[\w.:\-[\]=,]{1,80}$/.test(m))) throw new Error(tr('msg.ctx.badModels', { id }));
    if (a.path) {
      // A hand-set program path must be a real executable file (on Windows an .exe: .cmd/.bat would need a shell).
      if (typeof a.path !== 'string' || !path.isAbsolute(a.path)) throw new Error(tr('msg.ctx.pathAbs', { id }));
      // ACP agents installed with npm may point to their script (Orb runs it with node, never through a shell).
      const script = !['claude', 'codex', 'cursor'].includes(id) && /\.(c|m)?js$/i.test(a.path);
      if (process.platform === 'win32' && !/\.exe$/i.test(a.path) && !script) throw new Error(tr('msg.ctx.pathExe', { id }));
      let st; try { st = fs.statSync(a.path); } catch { throw new Error(tr('msg.ctx.pathMissing', { path: a.path })); }
      if (!st.isFile()) throw new Error(tr('msg.ctx.pathNotFile', { id }));
    }
  }
  const o = c.orchestrator ?? {};
  if (!Array.isArray(o.models) || !o.models.length || o.models.some((m) => !/^[\w.:-]{1,80}$/.test(m?.id ?? '') || typeof m.label !== 'string')) throw new Error(tr('msg.ctx.badAssistantModels'));
  // 2.6: the brain can be any agent. With Claude, one of the assistant's models (or an alias); with the others, any model id
  // (empty = the one configured in the agent itself).
  const brain = o.agent || 'claude';
  if (!AGENT_IDS.includes(brain)) throw new Error(tr('msg.ctx.missingAgentCfg', { id: brain }));
  if (brain === 'claude' && !o.models.some((m) => m.id === o.model) && !/^(sonnet|opus|haiku)$/.test(o.model ?? '')) throw new Error(tr('msg.ctx.assistantModelOneOf', { labels: o.models.map((m) => m.label).join(', ') }));
  if (brain !== 'claude' && o.model && !/^[\w.:\-/[\]=,@]{1,80}$/.test(o.model)) throw new Error(tr('msg.ctx.badModels', { id: brain }));
  if (!['low', 'medium', 'high'].includes(o.reasoning)) throw new Error(tr('msg.ctx.badReasoning'));
  if (typeof o.orchestrate !== 'boolean') throw new Error(tr('msg.ctx.orchestrateBool'));
  int(o.maxTurns, 2, 200, 'maxTurns');
  if (o.account && !(c.accounts ?? []).some((a) => a.id === o.account && a.agent === brain)) throw new Error(tr('msg.ctx.assistantNeedsClaude'));
  if (c.mobile) {
    if (typeof c.mobile.enabled !== 'boolean') throw new Error(tr('msg.ctx.mobileBool'));
    int(c.mobile.port, 1024, 65535, tr('msg.ctx.mobilePort'));
    for (const k of ['wifi', 'tailscale']) if (c.mobile[k] !== undefined && typeof c.mobile[k] !== 'boolean') throw new Error(tr('msg.ctx.mobileBool'));
  }
  if (!Array.isArray(c.accounts)) throw new Error(tr('msg.ctx.accountsList'));
  const ids = new Set();
  for (const a of c.accounts) {
    if (!/^[a-z0-9-]{1,40}$/.test(a?.id ?? '') || ids.has(a.id)) throw new Error(tr('msg.ctx.accountId', { id: a?.id }));
    ids.add(a.id);
    if (!AGENT_IDS.includes(a.agent)) throw new Error(tr('msg.ctx.accountAgent', { id: a.id }));
    if (typeof a.label !== 'string' || !a.label.trim() || a.label.length > 60) throw new Error(tr('msg.ctx.accountName', { id: a.id }));
    if (a.home && (typeof a.home !== 'string' || !path.isAbsolute(a.home))) throw new Error(tr('msg.ctx.accountHomeAbs', { label: a.label }));
    if (a.home) checkAccountHome(a.home, c);
    if (a.agent === 'cursor' && a.home) throw new Error(tr('msg.ctx.cursorFixed'));
  }
  if (c.accounts.filter((a) => a.agent === 'cursor').length > 1) throw new Error(tr('msg.ctx.cursorOne'));
  const homes = c.accounts.filter((a) => a.home).map((a) => path.resolve(a.home).toLowerCase());
  if (new Set(homes).size !== homes.length) throw new Error(tr('msg.ctx.sameHome'));
  if (!Array.isArray(c.mcpServers)) throw new Error(tr('msg.ctx.mcpList'));
  for (const s of c.mcpServers) {
    if (!/^[a-z0-9_-]{1,40}$/i.test(s?.name ?? '') || s.name.toLowerCase() === 'orb') throw new Error(tr('msg.ctx.connectorName', { name: s?.name }));
    if (typeof s.command !== 'string' || !s.command.trim()) throw new Error(tr('msg.ctx.connectorCommand', { name: s.name }));
    if (s.args && (!Array.isArray(s.args) || s.args.some((x) => typeof x !== 'string'))) throw new Error(tr('msg.ctx.connectorArgs', { name: s.name }));
  }
  if (!['sistema', 'claro', 'oscuro'].includes(c.ui?.theme ?? 'sistema')) throw new Error(tr('msg.ctx.badTheme'));
  // 2.4: visual theme, fonts and colours of code (src/core/appearance.mjs).
  for (const [key, list] of [['skin', SKINS], ['font', FONTS], ['codeFont', CODE_FONTS], ['codeTheme', CODE_THEMES]]) {
    if (c.ui?.[key] !== undefined && !list.includes(c.ui[key])) throw new Error(tr('msg.ctx.badAppearance', { name: `ui.${key}` }));
  }
  // 2.3: continue tasks after a restart / at the reset, and delegation between agents (orb_delegate).
  const bool = (v, name) => { if (v !== undefined && typeof v !== 'boolean') throw new Error(tr('msg.ctx.boolean', { name })); };
  bool(c.continuity?.resumeAfterRestart, 'continuity.resumeAfterRestart'); bool(c.continuity?.resumeAtReset, 'continuity.resumeAtReset');
  bool(c.delegation?.enabled, 'delegation.enabled'); bool(c.delegation?.trusted, 'delegation.trusted');
  bool(c.ui?.menuBar, 'ui.menuBar');
  if (c.delegation?.maxPerTask !== undefined) int(c.delegation.maxPerTask, 0, 20, 'delegation.maxPerTask');
  if (c.budget?.stopAt != null && !(Number(c.budget.stopAt) >= 0.5 && Number(c.budget.stopAt) <= 1)) throw new Error(tr('msg.ctx.stopAt'));
  if (!Array.isArray(c.projectRoots) || c.projectRoots.some((r) => typeof r !== 'string')) throw new Error(tr('msg.ctx.rootsList'));
  return true;
}

export const agentConfig = (agent) => ctx.config?.agents?.[agent];
export const enabledAgents = () => AGENT_IDS.filter((a) => ctx.config.agents[a]?.enabled);
