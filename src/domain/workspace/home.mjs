// Creating a workspace on first run and putting its fixed folders in order on every start.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PRODUCT } from '../../shared/product.mjs';
import { translate } from '../../shared/i18n.mjs';
import { paths, isHome, homeFor, writeJson, OLD_LOGS_DIR } from '../../platform/paths.mjs';
import { DEFAULT_CONFIG, merge, loadConfig } from '../../platform/config-file.mjs';
import { moveLogs, tidyProjectLogs, generalLogHeader } from '../../platform/journal-files.mjs';
import { migrateWorkspace, protectCore } from '../../core/core-folder.mjs';

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
  tidyProjectLogs(p.projectLogs);
  if (!fs.existsSync(p.generalLog)) {
    let c = config; if (!c) { try { c = loadConfig(home); } catch { c = DEFAULT_CONFIG; } }
    fs.writeFileSync(p.generalLog, generalLogHeader(c));
  }
  return protectCore(home, { wait });
}
