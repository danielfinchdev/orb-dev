// Process-wide context: which assistant folder this process serves and its configuration.
// The engine, the MCP server and the tests call useHome() once; every core module reads ctx.
import fs from 'node:fs';
import path from 'node:path';
import { paths, loadConfig, writeJson, merge, AGENT_IDS, relabelEmptyLogs, ROLES, hostsBots, doesDev } from './home.mjs';
import { translate } from './i18n.mjs';
import { SKINS, FONTS, CODE_FONTS, CODE_THEMES } from './appearance.mjs';

export const ctx = { home: null, paths: null, config: null, secret: null }; // secret: approval secret handed by the app (memory only)

// Message in the language of the settings (Spanish until a configuration is loaded).
export const tr = (key, vars) => translate(ctx.config?.language ?? 'es', key, vars);

// 3.5: this Orb's role (see ROLES in home.mjs). Every process reads it from orb.json, so the MCP servers agree with the engine.
export const role = () => (ROLES.includes(ctx.config?.role) ? ctx.config.role : 'todo');
export const keepsBots = () => hostsBots(role()); // «centro» or «todo»: the Orbs linked with it may use its bots
export const programs = () => doesDev(role()); // «taller» or «todo»

export function useHome(home) {
  ctx.home = home; ctx.paths = paths(home); ctx.config = loadConfig(home);
  ctx.owner = null; ctx.personStore = null; // 3.6: set when this home's database is opened (db.mjs)
  return ctx;
}

// ---- 3.6 «Personas»: settings of each person (table person_settings) and the settings' migration.
// What is each person's own (the rest of orb.json stays global, the owner's). For the owner, a key with no row yet reads
// where 3.5.1 kept it (legacy), so one person behaves exactly as before; the first write through personSetting makes
// the row. Keys: language, tz (also columns of persons), preview (notifications on a locked phone), brain (the
// assistant's agent/model/account), active_project, rules (personal golden rules), protected (personal additions),
// bots.location, bots_location_asked.
export const PERSON_KEYS = ['language', 'tz', 'preview', 'brain', 'active_project', 'rules', 'protected', 'bots.location', 'bots_location_asked',
  // 3.7 (WS3, Q3): «Copia en el PC»: this person's bots also keep a live copy on the owner's other Orbs (default off).
  'replica.pc'];
const LEGACY = {
  language: () => ctx.config?.language,
  preview: () => ctx.config?.mobile?.preview,
  brain: () => { const o = ctx.config?.orchestrator; return o ? { agent: o.agent ?? 'claude', model: o.model ?? null, account: o.account ?? null } : undefined; },
  active_project: (store) => store?.prepare("SELECT value FROM settings WHERE key = 'active_project'").get()?.value,
  'bots.location': () => ctx.config?.bots?.location,
  bots_location_asked: (store) => { try { return JSON.parse(store?.prepare("SELECT value FROM settings WHERE key = 'bots_location_asked'").get()?.value || 'null') ?? undefined; } catch { return undefined; } }
};
// personSetting(pid, key) → the value (parsed JSON) or undefined; personSetting(pid, key, value) saves it (null removes
// the row). store: a node:sqlite database (default: this home's, opened by db.mjs); a Board passes its own.
export function personSetting(pid, key, value, store = ctx.personStore) {
  if (!PERSON_KEYS.includes(key)) throw new Error(`unknown person setting: ${key}`);
  if (!store) throw new Error('no database for person settings');
  const id = String(pid ?? ctx.owner ?? '');
  if (value === undefined) {
    const row = store.prepare('SELECT value FROM person_settings WHERE person_id = ? AND key = ?').get(id, key);
    if (row) { try { return JSON.parse(row.value); } catch { return row.value; } }
    const owner = store.prepare("SELECT id FROM persons WHERE role = 'owner' AND deleted_at IS NULL LIMIT 1").get()?.id;
    return id === owner ? LEGACY[key]?.(store) ?? undefined : undefined;
  }
  if (value === null) store.prepare('DELETE FROM person_settings WHERE person_id = ? AND key = ?').run(id, key);
  else store.prepare('INSERT INTO person_settings (person_id, key, value) VALUES (?, ?, ?) ON CONFLICT(person_id, key) DO UPDATE SET value = excluded.value').run(id, key, JSON.stringify(value));
  return value;
}
// The accounts and the connectors of orb.json are the owner's (accounts[].person, mcpServers[].person). Only what is
// missing is filled. Once, at the migration; the file is read again right before (another process may have just saved
// it). An account or connector without person (added later by older code) is the owner's.
export function migrateConfigPersons(owner) {
  if (!owner || !ctx.paths?.config || !fs.existsSync(ctx.paths.config)) return false;
  let raw; try { raw = JSON.parse(fs.readFileSync(ctx.paths.config, 'utf8')); } catch { return false; }
  const missing = (list) => Array.isArray(list) && list.some((x) => x && typeof x === 'object' && !x.person);
  const stamp = (list) => (Array.isArray(list) ? list.map((x) => (x && typeof x === 'object' && !x.person ? { ...x, person: owner } : x)) : list);
  if (!missing(raw.accounts) && !missing(raw.mcpServers)) return false;
  writeJson(ctx.paths.config, { ...raw, ...(raw.accounts ? { accounts: stamp(raw.accounts) } : {}), ...(raw.mcpServers ? { mcpServers: stamp(raw.mcpServers) } : {}) });
  if (ctx.config) ctx.config = { ...ctx.config, accounts: stamp(ctx.config.accounts ?? []), mcpServers: stamp(ctx.config.mcpServers ?? []) };
  return true;
}

// Settings saved from the app. Only known top-level keys are accepted.
const EDITABLE = ['assistantName', 'userName', 'language', 'orchestrator', 'autoRun', 'maxParallel', 'perAgent', 'timeoutMinutes', 'agentOrder', 'agents', 'budget', 'policy', 'review', 'mcpServers', 'projectRoots', 'ui', 'accounts', 'mobile', 'expert', 'browser', 'continuity', 'delegation', 'oce', 'oneAtATime', 'approvalWaitMinutes', 'bots', 'role', 'devTarget', 'protected', 'backup', 'tz'];
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
  if (ctx.home && inside(ctx.home) && !inside(path.join(ctx.paths?.internal ?? path.join(ctx.home, '.orb'), 'cuentas'))) throw new Error(tr('msg.ctx.accountInHome'));
  for (const dir of [...(c?.projectRoots ?? []), ...projects]) if (dir && inside(dir)) throw new Error(tr('msg.ctx.accountInDir', { dir }));
}

export function validateConfig(c) {
  const int = (v, min, max, name) => { if (!Number.isInteger(v) || v < min || v > max) throw new Error(tr('msg.ctx.numRange', { name, min, max })); };
  int(c.maxParallel, 1, 10, 'maxParallel'); int(c.perAgent, 1, 5, 'perAgent'); int(c.timeoutMinutes, 5, 600, 'timeoutMinutes');
  if (!String(c.assistantName ?? '').trim()) throw new Error(tr('msg.ctx.needName'));
  if (!['es', 'en'].includes(c.language)) throw new Error(tr('msg.ctx.badLanguage'));
  for (const id of AGENT_IDS) {
    const a = c.agents?.[id]; if (!a) throw new Error(tr('msg.ctx.missingAgentCfg', { id }));
    if (!Array.isArray(a.models) || a.models.some((m) => typeof m !== 'string' || !/^[A-Za-z0-9][\w.:\-/[\]=,@]{0,79}$/.test(m))) throw new Error(tr('msg.ctx.badModels', { id }));
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
  if (brain !== 'claude' && o.model && !/^[A-Za-z0-9][\w.:\-/[\]=,@]{0,79}$/.test(o.model)) throw new Error(tr('msg.ctx.badModels', { id: brain }));
  if (!['low', 'medium', 'high', 'xhigh'].includes(o.reasoning)) throw new Error(tr('msg.ctx.badReasoning'));
  if (typeof o.orchestrate !== 'boolean') throw new Error(tr('msg.ctx.orchestrateBool'));
  int(o.maxTurns, 2, 200, 'maxTurns');
  if (o.parallel !== undefined) int(o.parallel, 1, 6, 'parallel'); // 3.2: conversations answered at the same time
  if (o.account && !(c.accounts ?? []).some((a) => a.id === o.account && a.agent === brain)) throw new Error(tr('msg.ctx.assistantNeedsClaude'));
  if (c.mobile) {
    if (typeof c.mobile.enabled !== 'boolean') throw new Error(tr('msg.ctx.mobileBool'));
    int(c.mobile.port, 1024, 65535, tr('msg.ctx.mobilePort'));
    for (const k of ['wifi', 'tailscale']) if (c.mobile[k] !== undefined && typeof c.mobile[k] !== 'boolean') throw new Error(tr('msg.ctx.mobileBool'));
  }
  if (c.devTarget !== undefined && (typeof c.devTarget !== 'string' || !/^(|local|[\w-]{1,64})$/.test(c.devTarget))) throw new Error(tr('msg.ctx.badAppearance', { name: 'devTarget' }));
  if (c.role !== undefined && !ROLES.includes(c.role)) throw new Error(tr('msg.ctx.badRole', { roles: ROLES.join(', ') }));
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
  bool(c.budget?.autoModel, 'budget.autoModel'); // 2.7: Orb chooses each task's model (true / missing) or the agents' defaults
  // 2.7: the bridge with Open Control Edge (on unless turned off). 3.7: oce.share (it was monitor.shareWithOce, with the
  // Monitoreo del equipo that 3.7 removed: home.mjs › loadConfig moves it).
  bool(c.oce?.share, 'oce.share');
  bool(c.oce?.optimus, 'oce.optimus'); // 3.7 (WS8): «Crear Optimus automáticamente» when Open Control Edge is found (on unless off)
  bool(c.ui?.tourDone, 'ui.tourDone');
  bool(c.ui?.recoveryNoticed, 'ui.recoveryNoticed'); // 3.6: the one notice about the recovery code was shown // 2.6: the guided tour was seen (or skipped) in this assistant folder
  if (c.delegation?.maxPerTask !== undefined) int(c.delegation.maxPerTask, 0, 20, 'delegation.maxPerTask');
  // 3.1: «Una tarea cada vez» (no parallel work, not even in isolated copies) and how long a task's permission waits for
  // an answer before it is denied (0 = for ever).
  bool(c.oneAtATime, 'oneAtATime');
  // 3.5: the bots' golden rules (up to 30 short sentences) and Home Assistant's address.
  if (c.bots) {
    const rules = c.bots.rules ?? [];
    if (!Array.isArray(rules) || rules.length > 30 || rules.some((r) => typeof r !== 'string' || r.length > 400)) throw new Error(tr('msg.ctx.badAppearance', { name: 'bots.rules' }));
    const url = c.bots.homeAssistant?.url ?? '';
    if (typeof url !== 'string' || (url && !/^https?:\/\/[^\s]+$/i.test(url))) throw new Error(tr('msg.ctx.badAppearance', { name: 'bots.homeAssistant.url' }));
    if (c.bots.idleMinutes !== undefined) int(c.bots.idleMinutes, 1, 1440, 'bots.idleMinutes');
    // 3.5: where the bots live: 'local' or the id of a linked Orb (a centre).
    if (c.bots.location !== undefined && (typeof c.bots.location !== 'string' || !/^(local|[\w-]{1,64})$/.test(c.bots.location))) throw new Error(tr('msg.ctx.badAppearance', { name: 'bots.location' }));
  }
  // 3.5: «Cosas que nadie toca»: up to 50 names, paths or containers (2-200 characters each).
  if (c.protected !== undefined && (!Array.isArray(c.protected) || c.protected.length > 50 || c.protected.some((x) => typeof x !== 'string' || x.trim().length < 2 || x.length > 200))) throw new Error(tr('msg.ctx.badAppearance', { name: 'protected' }));
  // 3.6: backups (src/core/backup.mjs): on/off, another folder (absolute), and whether project folders and the agents'
  // login folders go in too (both off). tz: this Orb's time zone until each person has their own (src/core/tz.mjs).
  if (c.backup !== undefined) {
    if (!c.backup || typeof c.backup !== 'object' || Array.isArray(c.backup)) throw new Error(tr('msg.ctx.badAppearance', { name: 'backup' }));
    bool(c.backup.enabled, 'backup.enabled'); bool(c.backup.projects, 'backup.projects'); bool(c.backup.accounts, 'backup.accounts');
    if (c.backup.folder !== undefined && c.backup.folder !== '' && (typeof c.backup.folder !== 'string' || !path.isAbsolute(c.backup.folder) || c.backup.folder.length > 500)) throw new Error(tr('msg.ctx.badAppearance', { name: 'backup.folder' }));
  }
  if (c.tz !== undefined && c.tz !== '' && !(typeof c.tz === 'string' && c.tz.length <= 64 && (() => { try { new Intl.DateTimeFormat('en', { timeZone: c.tz }); return true; } catch { return false; } })())) throw new Error(tr('msg.ctx.badAppearance', { name: 'tz' }));
  if (c.approvalWaitMinutes !== undefined) int(c.approvalWaitMinutes, 0, 240, 'approvalWaitMinutes');
  if (c.budget?.stopAt != null && !(Number(c.budget.stopAt) >= 0.5 && Number(c.budget.stopAt) <= 1)) throw new Error(tr('msg.ctx.stopAt'));
  if (c.budget?.profile != null && ![0, 1, 2, 3, 4].includes(c.budget.profile)) throw new Error(tr('msg.ctx.profile'));
  if (!Array.isArray(c.projectRoots) || c.projectRoots.some((r) => typeof r !== 'string')) throw new Error(tr('msg.ctx.rootsList'));
  return true;
}

export const enabledAgents = () => AGENT_IDS.filter((a) => ctx.config.agents[a]?.enabled);
