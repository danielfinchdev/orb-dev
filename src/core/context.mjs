// Process-wide context: which assistant folder this process serves and its configuration.
// The engine, the MCP server and the tests call useHome() once; every core module reads ctx.
import fs from 'node:fs';
import path from 'node:path';
import { paths, loadConfig, writeJson, merge, AGENT_IDS } from './home.mjs';

export const ctx = { home: null, paths: null, config: null, secret: null }; // secret: approval secret handed by the app (memory only)

export function useHome(home) {
  ctx.home = home; ctx.paths = paths(home); ctx.config = loadConfig(home);
  return ctx;
}

export function reloadConfig() { if (ctx.home) ctx.config = loadConfig(ctx.home); return ctx.config; }

// Settings saved from the app. Only known top-level keys are accepted.
const EDITABLE = ['assistantName', 'userName', 'language', 'orchestrator', 'autoRun', 'maxParallel', 'perAgent', 'timeoutMinutes', 'agentOrder', 'agents', 'budget', 'policy', 'review', 'mcpServers', 'projectRoots', 'ui', 'accounts', 'mobile', 'expert', 'browser', 'continuity', 'delegation'];
export function saveConfig(patch) {
  const unknown = Object.keys(patch ?? {}).filter((k) => !EDITABLE.includes(k));
  if (unknown.length) throw new Error(`ajustes desconocidos: ${unknown.join(', ')}`);
  const next = merge(ctx.config, patch);
  validateConfig(next);
  writeJson(ctx.paths.config, next);
  ctx.config = next;
  return next;
}

// An account's login folder holds that subscription's credentials: never where agents work (the assistant's folder, a
// project, the allowed roots) and never on a network share. Only the app's own .orb/cuentas is fine inside the folder.
export function checkAccountHome(home, c = ctx.config, projects = []) {
  const raw = String(home);
  if (/^(\\\\|\/\/)/.test(raw)) throw new Error('la carpeta de una cuenta no puede estar en la red');
  const norm = (p) => path.resolve(p).toLowerCase().replace(/[\\/]+$/, '');
  const target = norm(raw);
  const inside = (dir) => { const d = norm(dir); return target === d || target.startsWith(d + path.sep); };
  if (ctx.home && inside(ctx.home) && !inside(path.join(ctx.home, '.orb', 'cuentas'))) throw new Error('la carpeta de una cuenta no puede estar dentro de la carpeta del asistente (los agentes trabajan ahí)');
  for (const dir of [...(c?.projectRoots ?? []), ...projects]) if (dir && inside(dir)) throw new Error(`la carpeta de una cuenta no puede estar dentro de ${dir} (los agentes trabajan ahí)`);
}

export function validateConfig(c) {
  const int = (v, min, max, name) => { if (!Number.isInteger(v) || v < min || v > max) throw new Error(`${name} debe ser un número entre ${min} y ${max}`); };
  int(c.maxParallel, 1, 10, 'maxParallel'); int(c.perAgent, 1, 5, 'perAgent'); int(c.timeoutMinutes, 5, 600, 'timeoutMinutes');
  if (!String(c.assistantName ?? '').trim()) throw new Error('el asistente necesita un nombre');
  if (!['es', 'en'].includes(c.language)) throw new Error('idioma no soportado');
  for (const id of AGENT_IDS) {
    const a = c.agents?.[id]; if (!a) throw new Error(`falta la configuración de ${id}`);
    if (!Array.isArray(a.models) || a.models.some((m) => typeof m !== 'string' || !/^[\w.:\-[\]=,]{1,80}$/.test(m))) throw new Error(`modelos de ${id} no válidos`);
    if (a.path) {
      // A hand-set program path must be a real executable file (on Windows an .exe: .cmd/.bat would need a shell).
      if (typeof a.path !== 'string' || !path.isAbsolute(a.path)) throw new Error(`la ruta de ${id} debe ser absoluta`);
      if (process.platform === 'win32' && !/\.exe$/i.test(a.path)) throw new Error(`la ruta de ${id} debe ser un .exe`);
      let st; try { st = fs.statSync(a.path); } catch { throw new Error(`no existe ${a.path}`); }
      if (!st.isFile()) throw new Error(`la ruta de ${id} no es un archivo`);
    }
  }
  const o = c.orchestrator ?? {};
  if (!Array.isArray(o.models) || !o.models.length || o.models.some((m) => !/^[\w.:-]{1,80}$/.test(m?.id ?? '') || typeof m.label !== 'string')) throw new Error('modelos del asistente no válidos');
  if (!o.models.some((m) => m.id === o.model)) throw new Error(`el modelo del asistente debe ser uno de: ${o.models.map((m) => m.label).join(', ')}`);
  if (!['low', 'medium', 'high'].includes(o.reasoning)) throw new Error('razonamiento del asistente no válido');
  if (typeof o.orchestrate !== 'boolean') throw new Error('orchestrate debe ser verdadero o falso');
  int(o.maxTurns, 2, 200, 'maxTurns');
  if (o.account && !(c.accounts ?? []).some((a) => a.id === o.account && a.agent === 'claude')) throw new Error('el asistente necesita una cuenta de Claude');
  if (c.mobile) { if (typeof c.mobile.enabled !== 'boolean') throw new Error('mobile.enabled debe ser verdadero o falso'); int(c.mobile.port, 1024, 65535, 'el puerto del móvil'); }
  if (!Array.isArray(c.accounts)) throw new Error('accounts debe ser una lista');
  const ids = new Set();
  for (const a of c.accounts) {
    if (!/^[a-z0-9-]{1,40}$/.test(a?.id ?? '') || ids.has(a.id)) throw new Error(`id de cuenta no válido o repetido: ${a?.id}`);
    ids.add(a.id);
    if (!AGENT_IDS.includes(a.agent)) throw new Error(`agente desconocido en la cuenta ${a.id}`);
    if (typeof a.label !== 'string' || !a.label.trim() || a.label.length > 60) throw new Error(`la cuenta ${a.id} necesita un nombre`);
    if (a.home && (typeof a.home !== 'string' || !path.isAbsolute(a.home))) throw new Error(`la carpeta de la cuenta ${a.label} debe ser una ruta absoluta`);
    if (a.home) checkAccountHome(a.home, c);
    if (a.agent === 'cursor' && a.home) throw new Error('Cursor guarda su sesión en un sitio fijo: solo admite una cuenta');
  }
  if (c.accounts.filter((a) => a.agent === 'cursor').length > 1) throw new Error('Cursor solo admite una cuenta');
  const homes = c.accounts.filter((a) => a.home).map((a) => path.resolve(a.home).toLowerCase());
  if (new Set(homes).size !== homes.length) throw new Error('dos cuentas no pueden usar la misma carpeta');
  if (!Array.isArray(c.mcpServers)) throw new Error('mcpServers debe ser una lista');
  for (const s of c.mcpServers) {
    if (!/^[a-z0-9_-]{1,40}$/i.test(s?.name ?? '') || s.name.toLowerCase() === 'orb') throw new Error(`nombre de conector no válido: ${s?.name}`);
    if (typeof s.command !== 'string' || !s.command.trim()) throw new Error(`el conector ${s.name} necesita un comando`);
    if (s.args && (!Array.isArray(s.args) || s.args.some((x) => typeof x !== 'string'))) throw new Error(`argumentos del conector ${s.name} no válidos`);
  }
  if (!['sistema', 'claro', 'oscuro'].includes(c.ui?.theme ?? 'sistema')) throw new Error('tema no válido');
  // 2.3: continue tasks after a restart / at the reset, and delegation between agents (orb_delegate).
  const bool = (v, name) => { if (v !== undefined && typeof v !== 'boolean') throw new Error(`${name} debe ser verdadero o falso`); };
  bool(c.continuity?.resumeAfterRestart, 'continuity.resumeAfterRestart'); bool(c.continuity?.resumeAtReset, 'continuity.resumeAtReset');
  bool(c.delegation?.enabled, 'delegation.enabled'); bool(c.delegation?.trusted, 'delegation.trusted');
  if (c.delegation?.maxPerTask !== undefined) int(c.delegation.maxPerTask, 0, 20, 'delegation.maxPerTask');
  if (!Array.isArray(c.projectRoots) || c.projectRoots.some((r) => typeof r !== 'string')) throw new Error('projectRoots debe ser una lista de carpetas');
  return true;
}

export const agentConfig = (agent) => ctx.config?.agents?.[agent];
export const enabledAgents = () => AGENT_IDS.filter((a) => ctx.config.agents[a]?.enabled);
