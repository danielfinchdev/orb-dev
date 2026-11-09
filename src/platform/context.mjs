// Process-wide context: which assistant folder this process serves and its configuration.
// The engine, the MCP server and the tests call useHome() once; every core module reads ctx.
import { paths } from './paths.mjs';
import { loadConfig } from './config-file.mjs';
import { translate } from '../shared/i18n.mjs';

// secret: this PC's secret when the engine was handed it (tests; with the app it stays in Rust). keys: the keys made
// from it (src/platform/keys.mjs; inVault: from the app's vault). master: the master password and Orb's own secrets (3.8,
// src/core/master.mjs), opened by the engine.
export const ctx = { home: null, paths: null, config: null, secret: null, keys: null, master: null };

// Message in the language of the settings (Spanish until a configuration is loaded).
export const tr = (key, vars) => translate(ctx.config?.language ?? 'es', key, vars);


export function useHome(home) {
  ctx.home = home; ctx.paths = paths(home); ctx.config = loadConfig(home);
  return ctx;
}
