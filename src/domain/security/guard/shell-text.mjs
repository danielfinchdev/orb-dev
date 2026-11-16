// Text helpers shared by the guard rules: quote stripping, word splitting, shell unwrapping, statement
// splitting, environment expansion and the folders a compound command works in.
import os from 'node:os';
import path from 'node:path';

export const words = (s) => (s.match(/"(?:[^"\\]|\\.)*"|'[^']*'|\S+/g) ?? []).map((w) => w.replace(/^(["'])([\s\S]*)\1$/, '$2'));
// The words of a command that may be paths (a=b and --opt=b give b), without quotes.
// the folders a command may name through the environment (%APPDATA%, $env:APPDATA, $APPDATA, ${env:APPDATA}, ~ and the
// like): written out, so the checks below see the real path (the copies of Orb's secrets live under %APPDATA%).
// HOMEDRIVE and HOMEPATH too (%HOMEDRIVE%%HOMEPATH% is the user's folder), and ANDROID_USER_HOME.
const ENV_DIRS = ['APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'ANDROID_USER_HOME', 'PROGRAMDATA', 'TEMP', 'TMP'];
export function expandEnv(command) {
  let t = String(command ?? '');
  for (const name of ENV_DIRS) {
    const value = process.env[name] ?? (name === 'HOME' || name === 'USERPROFILE' ? os.homedir() : null);
    if (!value) continue;
    t = t.replace(new RegExp(`%${name}%|\\$\\{env:${name}\\}|\\$env:${name}\\b|\\$\\{${name}\\}|\\$${name}\\b`, 'gi'), () => value);
  }
  return t.replace(/(^|[\s"'=(])~(?=[\\/])/g, (_m, pre) => `${pre}${os.homedir()}`);
}
export const pathWords = (command) => String(command ?? '').split(/[\s|&;<>()`]+/).map((w) => w.replace(/^["']+|["',]+$/g, '').replace(/^[^=]*=(?=.*[\\/~.])/, '')).filter((w) => /[\\/]|^~|^\.\.?$/.test(w));
// the folder each part of a command runs in. `cd`, `chdir`, `pushd`, `popd`, `Set-Location`, `sl`,
// `Push-Location` and `Pop-Location` (bash, cmd and PowerShell; also `cd..`, `cd\x` and `cd /d`) are followed from the
// agent's folder through ; && || & | new lines and brackets, and inside `cmd /c`, `bash -c` or `powershell -Command`.
// Quotes do not stop the split (a stray split only makes the check stricter). → [{ dir, words, moved }] (dir: null when
// it cannot be told; moved: a `cd` changed it).
const CD_CMD = /^(cd|chdir|pushd|set-location|sl|push-location)$/i;
const POP_CMD = /^(popd|pop-location)$/i;
const SHELL_CMD = /^(cmd|bash|sh|zsh|dash|powershell|pwsh|wsl)$/i;
const RUN_FLAG = /^(\/c|\/k|-c|-command|-commandwithargs)$/i;
// A Git Bash, Cygwin or WSL path of a Windows drive (/c/Users…, /cygdrive/c/…, /mnt/c/…) as Windows writes it.
export const winPath = (p) => (process.platform === 'win32' ? String(p).replace(/^\/(?:cygdrive\/|mnt\/)?([a-z])(?=\/|$)/i, (_m, d) => `${d.toUpperCase()}:`) : String(p));
export const bare = (w) => String(w ?? '').replace(/^["'`]+|["'`,;]+$/g, '').replace(/^\d*[<>]+&?/, '').replace(/^[^=\\/]*=(?=.)/, '');
export function workDirs(command, cwd) {
  const out = [];
  let dir = cwd ? path.resolve(cwd) : null; let prev = dir; const stack = [];
  const resolveDir = (target) => {
    const t = winPath(bare(target));
    if (!t) return dir;
    if (t === '-') return prev;
    if (t === '~') return os.homedir();
    if (path.isAbsolute(t) || path.win32.isAbsolute(t)) return path.resolve(t);
    return dir ? path.resolve(dir, t) : null;
  };
  for (const part of String(command ?? '').split(/\r?\n|[;&|(){}]/)) {
    let w = words(part).map(bare).filter(Boolean);
    // A shell inside the command: what it runs is read as part of this one.
    for (let i = 0; i < 4 && w.length && SHELL_CMD.test(w[0].replace(/^.*[\\/]/, '').replace(/\.exe$/i, '')); i++) {
      const at = w.findIndex((x, j) => j > 0 && RUN_FLAG.test(x));
      w = at > 0 ? w.slice(at + 1) : w.slice(1).filter((x) => !x.startsWith('-'));
    }
    if (!w.length) continue;
    out.push({ dir, words: w, moved: dir !== (cwd ? path.resolve(cwd) : null) });
    const first = w[0].replace(/^@/, '');
    const glued = /^(cd|chdir)([\\/.].*)$/i.exec(first); // cmd: cd.. and cd\folder
    const cmd = glued ? glued[1] : first;
    if (CD_CMD.test(cmd)) {
      const args = glued ? [glued[2]] : w.slice(1);
      let target = null;
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (/^-(path|literalpath)$/i.test(a)) { target = args[i + 1] ?? null; break; }
        if (/^(\/d|-[a-z]+|--)$/i.test(a)) continue;
        target = a; break;
      }
      // cd alone: bash and PowerShell go to the home folder, so later relative paths must resolve there.
      if (target === null) target = '~';
      const next = resolveDir(target);
      if (/^(pushd|push-location)$/i.test(cmd)) stack.push(dir);
      prev = dir; dir = next;
      out.push({ dir, words: [], moved: true });
    } else if (POP_CMD.test(cmd)) { prev = dir; dir = stack.length ? stack.pop() : dir; out.push({ dir, words: [], moved: true }); }
  }
  return out;
}
// the same command with its quotes and escapes taken out
// (`pers''onal`, "pers"onal, PowerShell's `, cmd's ^, bash's \x between letters) is checked too: any of them that names
// a closed folder refuses it.
export const unquoted = (c) => String(c ?? '').replace(/['"`^]/g, '');
export const unescaped = (c) => unquoted(c).replace(/(?<=[A-Za-z0-9_.-])\\(?=[A-Za-z0-9_.-])/g, '');
export const unq = (w) => String(w ?? '').replace(/^(["'])([\s\S]*)\1$/, '$2');
// the last name as Windows opens it (`.env.`, `.env `, `.env::$DATA` and `id_rsa:x` are the file).
export const lastName = (p) => String(p ?? '').replace(/["']/g, '').replace(/[\\/]+$/, '')
  .replace(/(^|[\\/])([^\\/:]*):[^\\/]*$/, (m, sep, name) => (!sep && /^[a-z]$/i.test(name) ? m : `${sep}${name}`)).replace(/(?<=[^\\/.])[. ]+$/, '');
// The command inside a "powershell -Command '…'" wrapper (how Codex runs every command on Windows), or the command itself.
export function unwrapShell(command) {
  const c = String(command ?? '').trim();
  const m = c.match(/^(?:"[^"]*[\\/]|[^\s"]*[\\/])?(?:powershell|pwsh)(?:\.exe)?"?\s+(?:[-/]\w+\s+)*?(?:-command|-c)\s+(['"])([\s\S]*)\1\s*$/i);
  if (!m) return c;
  return m[1] === "'" ? m[2].replace(/''/g, "'") : m[2];
}
// The statements of a command line (split at ; && || and new lines, outside quotes, braces and brackets).
export function statements(command) {
  const s = String(command ?? ''); const out = []; let cur = ''; let quote = null; let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '{' || ch === '(') depth++;
    if ((ch === '}' || ch === ')') && depth > 0) depth--;
    if (!depth && (ch === ';' || ch === '\n' || ch === '\r' || ((ch === '&' || ch === '|') && s[i + 1] === ch))) { if (cur.trim()) out.push(cur.trim()); cur = ''; if (ch !== ';' && ch !== '\n' && ch !== '\r') i++; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
