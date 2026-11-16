// What the user did (messages, approvals, undo, settings, rules, rails): one JSON line each in core\ejecuciones\usuario.log.
// Written only when the action happens, by the engine after a legitimate call from the window or a linked phone: an agent
// has no way to write here. Nothing reads or watches this file while idle (src/domain/activity/activity.mjs reads it on demand).
import fs from 'node:fs';
import path from 'node:path';
import { ctx } from '../../platform/context.mjs';
import { rotateIfBig } from '../../platform/log.mjs';
import { redactSecrets } from '../../shared/secrets-scan.mjs';

export const USER_LOG_MAX = 10 * 1024 * 1024;
export const userLogFile = () => path.join(ctx.paths.runs, 'usuario.log');

const clip = (v, n) => { const s = redactSecrets(typeof v === 'string' ? v : JSON.stringify(v ?? null)); return s.length > n ? `${s.slice(0, n)}…` : s; };

// Never throws: a log that cannot be written must not break the action it describes.
export function logUserAction({ kind, text = '', project = null, before, after, level = 'info', max = USER_LOG_MAX } = {}) {
  try {
    if (!kind) return false;
    const file = userLogFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    rotateIfBig(file, max);
    const line = { at: new Date().toISOString(), level, kind: String(kind), project: project || null, text: clip(text, 2000) };
    if (before !== undefined) line.before = clip(before, 2000);
    if (after !== undefined) line.after = clip(after, 2000);
    fs.appendFileSync(file, `${JSON.stringify(line)}\n`);
    return true;
  } catch { return false; }
}

// Settings whose values are never written, only «changed»: connector environments and keys, protected paths…
const SENSITIVE = /(^|\.)(env|protected|token|secret|password|passphrase|apikey|api_key|key|keys|unlock|credentials?)$|mcpServers/i;
const redactedKeys = (value, prefix = '') => {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return { [prefix]: value };
  return Object.assign({}, ...Object.entries(value).map(([k, v]) => redactedKeys(v, prefix ? `${prefix}.${k}` : k)));
};
const pickPath = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

// before/after of only the keys a settings patch touches. `previous` is the config as it was before the save.
export function settingsDiff(patch, previous) {
  const flat = redactedKeys(patch ?? {});
  const before = {}; const after = {};
  for (const [key, value] of Object.entries(flat)) {
    if (!key) continue;
    if (SENSITIVE.test(key)) { before[key] = 'changed'; after[key] = 'changed'; continue; }
    before[key] = pickPath(previous, key) ?? null;
    after[key] = value;
  }
  return { before, after };
}
