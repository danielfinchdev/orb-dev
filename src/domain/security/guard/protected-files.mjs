// Protected things: the user's protected list, agent config files and secret files.
import path from 'node:path';
import { ctx } from '../../../platform/context.mjs';
import { DEFAULT_PROTECTED } from '../../../platform/paths.mjs';
import { expandEnv, lastName, pathWords, winPath, workDirs } from './shell-text.mjs';
import { GLOB, globRe } from './core-access.mjs';
import { insideProject, resolveTarget } from './project-writes.mjs';

// the project's agent settings: a task could leave there rules or programs that later agents in the same folder
// (other conversations) would take as the user's (Claude's permissions.allow skips Orb's guard; env, apiKeyHelper and the
// like run programs). Changing them asks first, whatever the permission but «total». See also claude.mjs (what Orb
// loads of them) and cursor.mjs (its hooks are off while Orb runs it).
const AGENT_CONFIG = /(^|[\\/])\.claude[\\/]+settings[^\\/]*\.json$|(^|[\\/])\.cursor[\\/]+(hooks|cli|mcp)\.json$/i;
export const AGENT_CONFIG_IN = /\.claude[\\/]+settings|\.cursor[\\/]+(hooks|cli|mcp)\.json/i;
export const isAgentConfig = (p) => AGENT_CONFIG.test(String(p ?? '').trim());
// «Cosas que nadie toca» (config.protected, Ajustes › Avanzado): names, paths or containers that are nobody's
// business, whatever the permission. A path, a command or a container that names one is denied. By default the usual
// password managers and secret stores (DEFAULT_PROTECTED); the user adds or removes entries. Matched without case, with
// \ read as / and a name is a whole word (keepass does not match keepassxc, but both are on the list).
export const protectedList = () => {
  const list = ctx.config?.protected;
  return (Array.isArray(list) ? list : DEFAULT_PROTECTED).map((x) => String(x ?? '').trim()).filter((x) => x.length >= 2);
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const entryRe = (e) => new RegExp(`${/^[a-z0-9]/i.test(e) ? '(?<![a-z0-9])' : ''}${esc(e.replace(/\\/g, '/'))}${/[a-z0-9]$/i.test(e) ? '(?![a-z0-9])' : ''}`, 'i');
// The first protected entry that the text names, or null.
export function protectedHit(text, list = protectedList()) {
  const t = String(text ?? '').replace(/\\/g, '/');
  if (!t) return null;
  return list.find((e) => entryRe(e).test(t)) ?? null;
}
export const touchesProtected = (text, list) => protectedHit(text, list) !== null;
// Always blocked: another project's secrets (.env, keys, certificates): readable inside the current project (they
// are needed to program it), never elsewhere. .env.example and the like are not secrets.
const SECRET_FILE = /(^|[\\/])(\.env(\.(?!example$|sample$|template$|dist$)[\w.-]+)?|[^\\/]+\.(pem|key|p12|pfx|jks|keystore)|id_(rsa|dsa|ecdsa|ed25519)(\.\w+)?)$/i;
export const isSecretFile = (p) => SECRET_FILE.test(lastName(p));
// a wildcard that may open a secret (`.en?`, `.env*`, `*` in PowerShell, which shows hidden files).
const SECRET_SAMPLES = ['.env', '.env.local', 'id_rsa', 'id_ed25519', 'x.pem', 'x.key', 'x.pfx', 'x.p12'];
const globSecret = (w) => { const name = String(w ?? '').replace(/["']/g, '').replace(/[\\/]+$/, '').split(/[\\/]/).pop(); return GLOB.test(name) && SECRET_SAMPLES.some((s) => globRe(name).test(s)); };
// Programs that only list names (a wildcard there shows no file's content).
const NAME_ONLY = /^(ls|dir|get-childitem|gci|tree|find|test-path|resolve-path|du|stat|where|which)$/i;
export function otherSecret({ command, paths, patterns, cwd, roots, names = false }) {
  const abs = (w) => path.isAbsolute(winPath(w)) || path.win32.isAbsolute(winPath(w)) || /^~[\\/]/.test(w) || String(w).startsWith('\\\\');
  const away = (w, dir) => (roots ? !insideProject(w, dir, roots) : abs(w));
  // The word, or where it really leads (a link inside the project named config.txt that points at another project's .env).
  const out = (w, dir) => { const f = resolveTarget(w, dir); return (isSecretFile(w) || (f && isSecretFile(f)) || (!names && globSecret(w))) && (roots ? !insideProject(w, dir, roots) : abs(w) || Boolean(f && isSecretFile(f))); };
  if ([...paths, ...patterns].some((p) => out(p, cwd))) return true;
  const c = expandEnv(command);
  if (pathWords(c).some((w) => !globSecret(w) && out(w, cwd))) return true;
  return workDirs(c, cwd).some((part) => {
    const exe = String(part.words[0] ?? '').replace(/^.*[\\/]/, '').replace(/\.exe$/i, '');
    // git show / cat-file of a secret at a revision (HEAD:.env) of a repository outside the project.
    if (/^git$/i.test(exe)) {
      const at = part.words.indexOf('-C'); const repo = at > 0 ? part.words[at + 1] ?? '' : '.';
      if (part.words.some((w) => /^[^\s:\\/]*:(?![\\/])./.test(w) && isSecretFile(w.slice(w.indexOf(':') + 1))) && away(repo, part.dir)) return true;
    }
    return part.words.some((w, i) => !/^-/.test(w) && (globSecret(w) ? i > 0 && !NAME_ONLY.test(exe) && away(w, part.dir) : out(w, part.dir)));
  });
}
