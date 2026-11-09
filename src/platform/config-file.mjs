// orb.json: its default values, how a stored file is read (defaults filled in, older versions' settings updated) and the
// deep merge used for settings. No process state: src/platform/context.mjs holds the loaded configuration.
import fs from 'node:fs';
import { PRODUCT } from '../shared/product.mjs';
import { APPEARANCE_DEFAULTS } from '../shared/appearance.mjs';
import { DEFAULT_PROTECTED } from '../shared/layout.mjs';
import { CONFIG_FILE, paths } from './paths.mjs';

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
  // skin, font, codeFont, codeTheme: Ajustes → Apariencia (src/shared/appearance.mjs). usageLine (3.8.2): the cost and tokens
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

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
// Deep merge where arrays and scalars of `over` replace those of `base`.
export function merge(base, over) {
  if (!isObject(base) || !isObject(over)) return over === undefined ? structuredClone(base) : structuredClone(over);
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over)) out[k] = isObject(v) && isObject(out[k]) ? merge(out[k], v) : structuredClone(v);
  return out;
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
