// The assistant's own folder ("home"): created on first run where the user chooses, holds everything Orb owns.
// Nothing personal is hard-coded: names, models, limits and folders come from <home>/orb.json.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PRODUCT, folderName } from './product.mjs';
import { APPEARANCE_DEFAULTS } from './appearance.mjs';
import { translate } from './i18n.mjs';
import { CORE_DIR, CATEGORIES, DEFAULT_PROTECTED } from './layout.mjs';
import { migrateWorkspace, protectCore } from './core-folder.mjs';

export const CONFIG_FILE = 'orb.json';
// 2.3: besides Claude Code, Codex and Cursor, the agents that speak ACP (src/agents/acp.mjs). They show up in Agentes and
// take work only when their program is installed on this PC.
export const AGENT_IDS = ['claude', 'codex', 'cursor', 'gemini', 'opencode', 'qwen', 'copilot'];
export const AGENT_LABELS = { claude: 'Claude', codex: 'Codex', cursor: 'Cursor', gemini: 'Gemini', opencode: 'OpenCode', qwen: 'Qwen Code', copilot: 'GitHub Copilot' };

export const DEFAULT_CONFIG = Object.freeze({
  version: 5,
  assistantName: PRODUCT.assistant,
  userName: '',
  language: 'es',
  // The assistant's own model: Sonnet to save (default) or Opus; "orchestrate" = only coordinate (true) or free mode (false).
  // renewAt: share of the context window at which the assistant starts a fresh conversation (the board and logs remember).
  orchestrator: { agent: 'claude', account: 'claude', model: 'claude-sonnet-5-5', reasoning: 'medium', maxTurns: 60, renewAt: 0.6, orchestrate: true,
    models: [{ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' }, { id: 'claude-opus-5-5', label: 'Opus 5.5' }] },
  autoRun: true,
  maxParallel: 3,
  perAgent: 1,
  timeoutMinutes: 60,
  // 3.1: tasks work at the same time by default (each in its own copy when another one is writing in the folder, joined
  // back by Orb when it ends); oneAtATime makes them wait for each other. approvalWaitMinutes: a task's permission that
  // nobody answers in this time is denied and the agent goes on another way (0 = wait for ever).
  oneAtATime: false,
  approvalWaitMinutes: 10,
  agentOrder: ['claude', 'codex', 'cursor', 'gemini', 'opencode', 'qwen', 'copilot'],
  agents: {
    // Claude Code accepts the aliases sonnet/opus/haiku, so the list keeps working when new versions come out.
    claude: { enabled: true, path: '', models: ['sonnet', 'opus', 'haiku'], defaultModel: 'sonnet', heavyModels: ['opus'],
      strengths: 'arquitectura, revisión de código, documentación, redacción, razonar sobre diseño' },
    // Empty model = the one configured in Codex itself. The user can add model ids in Ajustes.
    codex: { enabled: true, path: '', models: [], defaultModel: '', heavyModels: [],
      strengths: 'implementación, backend, refactors, tests, scripts, depurar' },
    cursor: { enabled: true, path: '', models: ['auto'], defaultModel: 'auto', heavyModels: [],
      strengths: 'interfaz, frontend, cambios rápidos en varios archivos' },
    gemini: { enabled: true, path: '', models: [], defaultModel: '', heavyModels: [],
      strengths: 'contexto enorme: leer proyectos grandes, investigar, documentar y revisar' },
    opencode: { enabled: true, path: '', models: [], defaultModel: '', heavyModels: [],
      strengths: 'agente abierto con muchos proveedores y modelos' },
    qwen: { enabled: true, path: '', models: [], defaultModel: '', heavyModels: [],
      strengths: 'implementación rápida y barata, tareas repetitivas' },
    copilot: { enabled: true, path: '', models: [], defaultModel: '', heavyModels: [],
      strengths: 'cambios con contexto de GitHub: issues y pull requests' }
  },
  // Accounts (subscriptions) per agent. id = agent and home '' = the CLI's own folder; more can be added from the app.
  accounts: AGENT_IDS.map((a) => ({ id: a, agent: a, label: AGENT_LABELS[a], home: '', enabled: true })),
  // 2.3, balance between doing and spending: the agents now report their real usage (Claude and Codex say how much of the
  // 5-hour / weekly window is used and when it resets), so the fixed caps are a safety net, not the brake they were.
  // stopAt: share of the real window (0-1) at which new tasks wait for the reset instead of eating the last of it.
  // profile (2.6): the «ahorro ↔ uso» slider of Ajustes (0 = maximum saving … 4 = maximum use; null = set by hand).
  budget: { profile: 2, windowHours: 5, stopAt: 0.92, agents: Object.fromEntries(AGENT_IDS.map((a) => [a, { maxTasks: 20, maxHeavy: 6 }])) },
  policy: { reasoning: ['low', 'medium', 'high'], highNeedsApproval: true, fast: false, banned: [] },
  sensitive: ['external_write', 'publish', 'financial', 'credential_access', 'destructive', 'razonamiento_alto'],
  // Task Review: another model (another provider when there is one) audits finished work read-only and gives a verdict.
  review: { auto: false },
  // 2.3: interrupted tasks continue when the app opens again; tasks stopped by a usage limit continue at the reset.
  continuity: { resumeAfterRestart: true, resumeAtReset: true },
  // 2.3: agents may hand subtasks to other agents (orb_delegate). trusted: subtasks without risk words go straight to the
  // queue (instead of waiting for approval), up to maxPerTask per task.
  delegation: { enabled: true, trusted: true, maxPerTask: 4 },
  mcpServers: [],
  // 3.8.1: the skills of core\skills that are on ([{ name, enabled, source }]; one without an entry is off).
  skills: [],
  projectRoots: [],
  // pip: the little window that shows the agent's browser; sounds and motion: the robot's. lockMinutes (3.8.1): Orb's lock
  // screen after that long without use (src/ui/lib/idle-lock.js).
  // skin, font, codeFont, codeTheme: Ajustes → Apariencia (src/core/appearance.mjs). usageLine (3.8.2): the cost and tokens
  // under each reply of an agent's conversation (Ajustes → Apariencia).
  ui: { companion: true, theme: 'sistema', pip: true, sounds: true, volume: 0.5, motion: 'completa', lockMinutes: 15, usageLine: true, ...APPEARANCE_DEFAULTS },
  // Expert mode (PC only): an IDE-like view with the panels chosen here around the assistant's chat.
  expert: { enabled: false, panels: { explorer: true, git: true, history: true, running: true, usage: true, system: true, activity: true } },
  browser: { enabled: true }, // the agents' browser (pages drawn by the app, driven through the MCP tools)
  // Phone access (off until the user turns it on): through the home Wi-Fi and/or Tailscale (https when the tailnet has it).
  mobile: { enabled: false, port: 3131, wifi: true, tailscale: true },
  // 3.5: «Cosas que nadie toca» (Ajustes › Avanzado): names, paths or containers that no agent touches, whatever the
  // permission (a command or a path that names one is denied).
  protected: [...DEFAULT_PROTECTED]
});

// Layout of the workspace (3.8): always <chosen folder>\Orb, the same for every user (C:\Orb by default):
//   core\                       Orb's own folder, hidden: everything Orb needs to work
//     orb.json                  settings
//     datos\                    database, secret, identity; ejecuciones\ task runs; copias\ isolated copies and undo points
//     bitacora\                 the general log and one per project (bitacora\proyectos)
//     mcp\                      every MCP server (each subfolder is one; Ajustes › Skills y MCP)
//     skills\                   every skill (each subfolder, with its SKILL.md); .activas: what the agents load
//     preparacion\              what an agent makes (a skill or a server) until the user turns it on
//     herramientas\adb\         what Orb downloads to build and test (Android's adb and fastboot)
//     secretos\                 the secrets sealed with the master password
//   windows\ linux\ ios\ android\ web\ multi\   categories: every subfolder of one of them is a project
// Orb 3.7 kept .orb, orb.json, bitacora, mcp-servers and android\adb-tools at the top (LEGACY). .orb and orb.json are
// Orb's own data and move into core when the engine starts; the others move only when the user says so in the window
// (src/core/core-folder.mjs › planWorkspace). A bitacora or adb-tools left at the top is used where it is (paths).
export { CORE_DIR, CATEGORIES, PLATFORMS, MULTI, SHARED_DIR, DEFAULT_CATEGORY, DEFAULT_PROTECTED } from './layout.mjs';
export const INTERNAL_DIR = CORE_DIR;
export const LOGS_DIR = 'bitacora';
export const MCP_DIR = 'mcp';
export const SKILLS_DIR = 'skills'; // 3.8.1: every skill (src/core/extensions.mjs)
export const STAGING_DIR = 'preparacion'; // 3.8.1: what an agent makes before the user turns it on (the only part of core agents write)
export const OLD_LOGS_DIR = 'bitacoras'; // 2.3.0 and older
// 3.5–3.7: the bots' memories. 3.8: no bots; an old bots\ folder is never taken for a project (the 3.8 migration archives it).
export const BOTS_DIR = 'bots';
// Where Orb 3.7 kept what now lives in core (relative to the workspace).
export const LEGACY = Object.freeze({ internal: '.orb', config: CONFIG_FILE, logs: 'bitacora', mcp: 'mcp-servers', adb: ['android', 'adb-tools'] });
const OLD_ADB_DIR = LEGACY.adb[1];
const lower = (name) => String(name ?? '').toLowerCase();
const isDirSync = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
// Top-level folders that belong to Orb itself (or did in older versions), never to the user's projects.
export const isConfigName = (name) => /^\./.test(String(name)) || [CORE_DIR, LEGACY.logs, LEGACY.mcp, OLD_LOGS_DIR, BOTS_DIR, 'node_modules', '$recycle.bin', 'system volume information'].includes(lower(name));
export const isCategory = (name) => CATEGORIES.includes(lower(name));
// Folders inside a category that are never projects (hidden ones, 3.7's Android tools until they move into core).
export const isReservedInCategory = (category, name) => /^\./.test(String(name)) || ['node_modules', '$recycle.bin'].includes(lower(name)) || (lower(category) === 'android' && lower(name) === OLD_ADB_DIR);
// Names a project can never take (they would read as one of Orb's own folders).
export const isReservedName = (name) => isConfigName(name) || lower(name) === OLD_ADB_DIR;

// What the user decided in «Ordenar carpetas» about the logs at the top (core\carpetas.json, core-folder.mjs).
const logsDecision = (core) => { try { return JSON.parse(fs.readFileSync(path.join(core, 'carpetas.json'), 'utf8'))?.decided?.bitacora ?? null; } catch { return null; } };
export function paths(home) {
  const core = path.join(home, CORE_DIR);
  const data = path.join(core, 'datos');
  // A log folder or Android tools left at the top (kept by the user, or not decided about yet) are used there.
  // 3.8.1: the logs at the top are the general log only when the user kept them there, or before deciding while core has
  // no general log of its own (a 3.7 workspace). Once they moved into core (or a workspace that always had them there),
  // a bitacora that shows up at the top again (a tool outside Orb writing to the old path) never takes core's place
  // («Ordenar carpetas» offers to merge it into core).
  const keptLogs = path.join(home, LEGACY.logs);
  const keptAdb = path.join(home, ...LEGACY.adb);
  const coreLogs = path.join(core, LOGS_DIR);
  const decided = isDirSync(keptLogs) ? logsDecision(core) : 'move';
  const logs = decided === 'keep' || (decided === null && !fs.existsSync(path.join(coreLogs, 'GENERAL.md'))) ? keptLogs : coreLogs;
  const copies = path.join(core, 'copias');
  const tools = path.join(core, 'herramientas');
  return {
    home, core, internal: core, config: path.join(core, CONFIG_FILE), data, db: path.join(data, 'orb.db'), key: path.join(data, 'clave.bin'),
    logs, generalLog: path.join(logs, 'GENERAL.md'), projectLogs: path.join(logs, 'proyectos'),
    mcp: path.join(core, MCP_DIR), skills: path.join(core, SKILLS_DIR), staging: path.join(core, STAGING_DIR), tools, adb: isDirSync(keptAdb) ? keptAdb : path.join(tools, 'adb'), secrets: path.join(core, 'secretos'),
    projects: home, categories: Object.fromEntries(CATEGORIES.map((c) => [c, path.join(home, c)])),
    runs: path.join(core, 'ejecuciones'),
    copies, worktrees: path.join(copies, 'aisladas'), checkpoints: path.join(copies, 'fotos')
  };
}

// A workspace's name for what Orb keeps about it outside it (its backups, a copy of its sealed secret): the folder's name
// and a short hash of its whole path in any case (C:\Orb → orb-<8 hex>). Two workspaces never share it, and a long path
// does not make a long name.
export const homeKey = (home) => {
  const full = path.resolve(home);
  const name = path.basename(full).toLowerCase().replace(/[^\w.-]+/g, '_').slice(0, 40) || 'orb';
  return `${name}-${crypto.createHash('sha256').update(full.toLowerCase()).digest('hex').slice(0, 8)}`;
};
// The name the first 3.8 builds used (C:\Orb → C-Orb): what was kept under it is taken over once (backup.mjs, desktop-home.mjs).
export const oldHomeKey = (home) => path.resolve(home).replace(/[:\\/]+/g, '-').replace(/^-+|-+$/g, '') || 'orb';

// Category of a project folder inside Orb's folder: <home>\<category>\<project>[\…]. null for anything else (outside,
// a category folder itself, Orb's configuration folders, 3.7's Android tools). A multiplatform project is the folder
// under multi (multi\<project>\android is part of <project>).
export function categoryOf(home, folder) {
  const rel = path.relative(home, folder);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const parts = rel.split(/[\\/]/);
  return parts.length >= 2 && isCategory(parts[0]) && !isReservedInCategory(parts[0], parts[1]) ? lower(parts[0]) : null;
}
// A folder as the project list compares them (real path, any case).
export const folderKey = (folder) => { try { return fs.realpathSync(folder).toLowerCase(); } catch { return path.resolve(folder).toLowerCase(); } };
// 3.8: the folders of other users' projects of 3.7 that stay in the categories, which Orb no longer lists (JSON list of
// folderKey; the 3.8 migration writes it, adding one of them by hand takes it out).
export const IGNORED_PROJECTS = 'projects_ignored';
// 3.8.1: the projects the user finished (src/core/project-close.mjs): their folders stay, Orb no longer lists them.
export const FINISHED_PROJECTS = 'projects_finished';
// 3.8.1: the projects being deleted (between the engine's check and the end of the Recycle Bin: project-close.mjs).
export const DELETING_PROJECTS = 'projects_deleting';

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
// Deep merge where arrays and scalars of `over` replace those of `base`.
export function merge(base, over) {
  if (!isObject(base) || !isObject(over)) return over === undefined ? structuredClone(base) : structuredClone(over);
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over)) out[k] = isObject(v) && isObject(out[k]) ? merge(out[k], v) : structuredClone(v);
  return out;
}

export { folderName };

// A workspace: core\orb.json, or orb.json at the top (Orb 3.7, moved into core when the engine starts).
export function isHome(dir) {
  const file = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
  return file(path.join(dir, CORE_DIR, CONFIG_FILE)) || file(path.join(dir, LEGACY.config));
}

// The folder a chosen base turns into: <base>\Orb whatever the assistant is called (or the base itself when it already is
// an Orb folder or is called Orb), so the layout is the same for everybody.
export function homeFor(base) {
  if (isHome(base) || lower(path.basename(base)) === lower(PRODUCT.folder)) return base;
  return path.join(base, PRODUCT.folder);
}

// First run: <base>\Orb with core, the categories, config, secret and the general log. An existing workspace is reused as
// it is; a folder called Orb with other things in it (projects, notes, the folders of an older Orb) keeps them: nothing
// in it is overwritten or moved. Only Orb 3.7's own data (.orb, orb.json) moves into core; its logs, MCP servers and
// Android tools stay where they are until the user decides in the window (src/core/core-folder.mjs › planWorkspace).
export function createHome(base, { assistantName = PRODUCT.assistant, userName = '', language = 'es' } = {}) {
  const T = (key, vars) => translate(language, key, vars);
  if (!base || !path.isAbsolute(base)) throw new Error(T('msg.home.absolute'));
  let stat; try { stat = fs.statSync(base); } catch { throw new Error(T('msg.home.noFolder', { base })); }
  if (!stat.isDirectory()) throw new Error(T('msg.home.notFolder', { base }));
  // A drive root is fine as a base: the home is always a subfolder of it.
  const home = homeFor(base);
  if (isHome(home)) { ensureLayout(home); return { home, created: false }; }
  migrateWorkspace(home);
  const p = paths(home);
  for (const dir of [p.data, p.runs, p.worktrees, p.checkpoints]) fs.mkdirSync(dir, { recursive: true });
  const config = merge(DEFAULT_CONFIG, { assistantName: String(assistantName || PRODUCT.assistant).trim().slice(0, 40) || PRODUCT.assistant, userName: String(userName ?? '').trim().slice(0, 40), language: language === 'en' ? 'en' : 'es' });
  writeJson(p.config, config);
  if (!fs.existsSync(p.key)) fs.writeFileSync(p.key, crypto.randomBytes(32), { mode: 0o600 });
  ensureLayout(home, config);
  return { home, created: true };
}

// Every start: Orb 3.7's own data moves into core (src/core/core-folder.mjs), and the fixed folders (core's, the six
// categories) exist. Folders made by 2.3.0 and older are put in order: their "bitacoras" moves into the log
// folder, dropping only the empty logs 2.3.0 wrote for the category and configuration folders it took for projects.
// Nothing with content is deleted. core is hidden again (src/core/core-folder.mjs › protectCore; wait false: without
// waiting for it, as the engine starts: the promise of whether it worked is returned).
export function ensureLayout(home, config = null, { wait = true } = {}) {
  migrateWorkspace(home);
  const p = paths(home);
  for (const dir of [p.data, p.runs, p.logs, p.projectLogs, p.mcp, p.skills, p.tools, p.secrets, ...Object.values(p.categories)]) fs.mkdirSync(dir, { recursive: true });
  const old = path.join(home, OLD_LOGS_DIR);
  if (fs.existsSync(old)) { try { moveLogs(old, p.logs); } catch { /* left as it is; tried again on the next start */ } }
  if (!fs.existsSync(p.generalLog)) {
    let c = config; if (!c) { try { c = loadConfig(home); } catch { c = DEFAULT_CONFIG; } }
    fs.writeFileSync(p.generalLog, generalLogHeader(c));
  }
  return protectCore(home, { wait });
}

// Moves a log folder into another: a file that exists in both keeps the new one and gets the old entries at its end.
export function moveLogs(from, to) {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, e.name); const dst = path.join(to, e.name);
    if (e.isDirectory()) { fs.mkdirSync(dst, { recursive: true }); moveLogs(src, dst); continue; }
    const text = /\.md$/i.test(e.name) ? fs.readFileSync(src, 'utf8') : null;
    const name = e.name.replace(/\.md$/i, '');
    if (text !== null && path.basename(from) === 'proyectos' && (isReservedName(name) || isCategory(name)) && text.trim() === projectLogHeader(name).trim()) { fs.rmSync(src); continue; }
    if (!fs.existsSync(dst)) { fs.renameSync(src, dst); continue; }
    // Both exist: the old entries go at the end of the new file (a log only grows); the old header is dropped.
    if (text !== null) {
      const body = text.replace(/^#[^\n]*\n\n(?:[^\n]+\n)*/, '').trim();
      if (body) fs.appendFileSync(dst, `\n${body}\n`);
      fs.rmSync(src);
    }
  }
  try { fs.rmdirSync(from); } catch { /* something could not be merged: kept */ }
}

// The headers of the logs, in the language of the settings.
export const generalLogHeader = (config) => translate(config?.language, 'sys.logs.generalHeader', { name: config.assistantName });
export const projectLogHeader = (name, language = 'es') => translate(language, 'sys.logs.projectHeader', { name });

// After a change of language: a log that has nothing but its header gets the header in the new language (logs only
// grow, so one with entries stays as it is).
export function relabelEmptyLogs(home, before, after) {
  const p = paths(home);
  const read = (file) => { try { return fs.readFileSync(file, 'utf8').trim(); } catch { return null; } };
  const write = (file, text) => { try { fs.writeFileSync(file, text); } catch { /* busy: left as it is */ } };
  if (read(p.generalLog) === generalLogHeader(before).trim()) write(p.generalLog, generalLogHeader(after));
  // A project's header carries its name as the user wrote it (the file name may be simplified): read it from the header.
  const [pre, post] = projectLogHeader('\u0000', before.language).trim().split('\u0000');
  let files = []; try { files = fs.readdirSync(p.projectLogs).filter((f) => /\.md$/i.test(f)); } catch { /* no project logs yet */ }
  for (const f of files) {
    const file = path.join(p.projectLogs, f); const text = read(file);
    if (!text?.startsWith(pre) || !text.endsWith(post)) continue;
    const name = text.slice(pre.length, text.length - post.length);
    if (name && !name.includes('\n')) write(file, projectLogHeader(name, after.language));
  }
}

export function loadConfig(home) {
  let stored = {};
  try { stored = JSON.parse(fs.readFileSync(paths(home).config, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new Error(`${CONFIG_FILE} no es válido: ${error.message}`); }
  return configFrom(stored);
}
// The configuration a stored orb.json gives: the defaults filled in and the settings of older versions updated.
export function configFrom(stored) {
  const config = merge(DEFAULT_CONFIG, stored);
  // 2.3 balance: the old fixed caps (6 tasks, 2 heavy per window; 20 turns) were too tight. Values the user never changed
  // move to the new ones; anything the user set by hand stays.
  if ((stored.version ?? 2) < 3) {
    for (const b of Object.values(config.budget.agents ?? {})) { if (b.maxTasks === 6) b.maxTasks = 20; if (b.maxHeavy === 2) b.maxHeavy = 6; }
    if (config.orchestrator.maxTurns === 20) config.orchestrator.maxTurns = 60;
    config.version = 3;
  }
  // 2.4: the robot is called Orb·e. Who kept the old default name ("Orb") gets the new one; a name chosen by hand stays.
  if ((stored.version ?? 2) < 4) {
    if (config.assistantName.trim() === 'Orb') config.assistantName = PRODUCT.assistant;
    config.version = 4;
  }
  // 2.6: the default name is written Orbe (Orb·E only as the drawn wordmark). Who kept the 2.4 default gets it.
  if ((stored.version ?? 2) < 5) {
    if (config.assistantName.trim() === 'Orb·e') config.assistantName = PRODUCT.assistant;
    config.version = 5;
  }
  // 3.8: Orbs no longer link with each other: this Orb's role (todo / centro / taller) and «Orb para programar» go.
  delete config.role; delete config.devTarget;
  // 3.7: «Monitoreo del equipo» and Opti Bot are gone. 3.8: the bots, Open Control Edge and the «Orb | Bots» mode too.
  // Their settings go (the file loses them at the next save).
  delete config.monitor; delete config.bots; delete config.oce;
  if (config.ui) { delete config.ui.mode; delete config.ui.menuBar; } // menuBar: Windows' menu bar is always hidden now
  // 3.8: the phone never types the master password on a page without encryption: «mobile.lanHttp» is gone.
  if (config.mobile) delete config.mobile.lanHttp;
  // Folders made by older versions: agents added later get their default account and their place in the order.
  for (const a of AGENT_IDS) {
    if (!config.accounts.some((x) => x.agent === a)) config.accounts.push({ id: a, agent: a, label: AGENT_LABELS[a], home: '', enabled: true });
    if (!config.agentOrder.includes(a)) config.agentOrder.push(a);
  }
  return config;
}

// Atomic write: a crash in the middle never leaves a half-written file, and a failed one never leaves its temporary file.
export function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(tmp, file);
  } catch (error) { try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ } throw error; }
}

export function readKey(home) {
  const file = paths(home).key;
  try {
    const key = fs.readFileSync(file);
    // 3.5: on Linux this file is the secret itself: readable by its owner only, also when copied from elsewhere.
    if (key.length >= 32) { if (process.platform !== 'win32') { try { if ((fs.statSync(file).mode & 0o077) !== 0) fs.chmodSync(file, 0o600); } catch { /* best effort */ } } return key; }
  } catch { /* created below */ }
  const key = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, key, { mode: 0o600 });
  return key;
}
