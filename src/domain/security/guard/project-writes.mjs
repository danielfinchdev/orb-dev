// Project folders and what a command writes, deletes or runs outside them (git-run files, build folders).
import os from 'node:os';
import path from 'node:path';
import { STAGING_DIR } from '../../../platform/paths.mjs';
import { bare, expandEnv, lastName, pathWords, unq, unwrapShell, winPath, workDirs } from './shell-text.mjs';
import { localPath, norm, realOf, rootsOf } from './roots.mjs';
import { GLOB, globRe } from './core-access.mjs';

// whether a shell command writes a file of the project (for the read-only guard). A redirection (`>`, `>>`, not
// `2>`/`>&`), or a cmdlet that writes a file (Out-File, Set-Content, Add-Content, New-Item -ItemType File, tee), to a
// target that is not the null device and not inside a build folder (dist, build, out, coverage, .vite, .next, node_modules).
const BUILD_DIR = /(^|[\\/])(dist|build|out|coverage|\.vite|\.next|\.turbo|\.cache|node_modules|tmp|temp)([\\/]|$)/i;
const NULLISH = /^(\$null|\/dev\/null|nul|con|\/dev\/stdout|\/dev\/stderr|&\d)$/i;
export function writesProjectFile(command) {
  const c = String(command ?? '');
  const to = [];
  // A redirection `>`/`>>` into a file (not `2>` or `>&`, which redirect a stream, not a file the task means to keep).
  for (const m of c.matchAll(/(?<![0-9&])>>?\s*("[^"]+"|'[^']+'|[^\s|&;<>]+)/g)) to.push(m[1]);
  // A cmdlet that writes a file: its -Path, or the first positional argument that looks like a file name.
  if (/\b(?:Out-File|Set-Content|Add-Content|tee|tee-object)\b/i.test(c) || /\bNew-Item\b[^|;&\n]*-ItemType\s+File\b/i.test(c)) {
    const named = c.match(/-(?:File)?Path\s+("[^"]+"|'[^']+'|[^\s|&;<>]+)/i);
    if (named) to.push(named[1]);
    else { const cand = (c.match(/"[^"]+"|'[^']+'|[^\s|&;<>]+/g) ?? []).map(unq).reverse().find((t) => !t.startsWith('-') && /[.\\/]/.test(t) && !/^(Out-File|Set-Content|Add-Content|tee|tee-object|New-Item)$/i.test(t)); if (cand) to.push(cand); }
  }
  return to.map(unq).some((t) => t && !NULLISH.test(t) && !BUILD_DIR.test(t));
}
// ---- inside or outside the project («Auto» and «Preguntar»).
// The project: the folder of the chat or the task (or its isolated copy), core\preparacion (what an agent makes for the
// user to turn on) and the system's temporary folders. Compared by RESOLVED path (links and junctions followed, 8.3 names
// made long, a UNC path to this PC made local, `..` and case folded): a junction inside the project that points elsewhere
// is outside. null: no project known (no inside/outside rule applies).
const tempRoots = () => [os.tmpdir(), process.env.TEMP, process.env.TMP].filter((d) => d && path.isAbsolute(d));
export function projectRoots({ projectDir, internalDir } = {}) {
  if (!projectDir) return null;
  return [...new Set([projectDir, ...(internalDir ? [path.join(internalDir, STAGING_DIR)] : []), ...tempRoots()].flatMap(rootsOf))];
}
// Where a word of a command (or a tool's path) really is: a normalized real path, or null when it cannot be told (a
// variable left unexpanded, another computer's share, a relative path with no folder to resolve it against).
export function resolveTarget(word, dir) {
  let p = winPath(String(word ?? '').trim()).replace(/^~(?=[\\/]|$)/, os.homedir());
  if (!p) return null;
  const local = localPath(p);
  if (local === false) return null;
  if (local) p = local;
  else if (p.startsWith('\\\\') || p.startsWith('//')) return null;
  if (/[$%]/.test(p)) return null; // a variable the shell would expand
  if (!path.isAbsolute(p) && !path.win32.isAbsolute(p)) { if (!dir) return null; p = path.resolve(dir, p); }
  return norm(realOf(p));
}
export function insideProject(word, dir, roots) {
  if (!roots) return true;
  const full = resolveTarget(word, dir);
  return Boolean(full) && roots.some((r) => full === r || full.startsWith(`${r}\\`));
}
// Programs that write, move or delete what they name; for a copy only its destination counts (reading elsewhere is fine).
const WRITERS = /^(rm|rmdir|rd|del|erase|remove-item|ri|mv|move|move-item|mi|cp|copy|copy-item|cpi|xcopy|robocopy|mkdir|md|new-item|ni|touch|set-content|add-content|out-file|tee|tee-object|rename-item|ren|rename|clear-content|clc|truncate|unlink|shred|chmod|chown|icacls|attrib|takeown|ln|mklink)$/i;
const COPY_DEST = /^(cp|copy|copy-item|cpi|xcopy)$/i;
// Programs that only look: a part of a command that runs in a folder outside the project with one of these is fine.
const LOOKERS = /^(ls|dir|cat|type|more|less|head|tail|wc|get-childitem|gci|get-content|gc|get-item|gi|select-string|sls|rg|grep|findstr|find|tree|pwd|echo|write-output|write-host|test-path|resolve-path|get-location|where|which|stat|file|du|cd|chdir|pushd|popd|set-location|sl|push-location|pop-location)$/i;
const GIT_LOOK = /^(status|log|diff|show|branch|rev-parse|ls-files|remote|describe|blame|config|fetch)$/i;
const targetsOf = (exe, ws) => {
  const args = []; let dest = null;
  for (let i = 0; i < ws.length; i++) {
    if (/^-(destination|d|t|target-directory)$/i.test(ws[i]) && COPY_DEST.test(exe)) { dest = ws[i + 1] ?? null; i++; continue; }
    if (/^-(value|encoding|itemtype|type|filter|include|exclude|erroraction|ea|newname)$/i.test(ws[i])) { i++; continue; }
    if (/^-/.test(ws[i]) || /^\/[a-z0-9:]{1,8}$/i.test(ws[i])) continue;
    args.push(ws[i]);
  }
  if (COPY_DEST.test(exe)) return dest ? [dest] : args.length > 1 ? args.slice(-1) : [];
  if (/^robocopy$/i.test(exe)) return args.slice(1, 2);
  return args;
};
// The first thing a command writes, or a part of it runs, outside the project: { what } or null. Hardening, not a
// boundary (a script can write anywhere): what it names and where each of its parts runs.
export function writesOutside(command, cwd, roots) {
  if (!roots) return null;
  const c = expandEnv(unwrapShell(command));
  for (const m of c.matchAll(/(?<![0-9&])>>?\s*("[^"]+"|'[^']+'|[^\s|&;<>]+)/g)) {
    const t = unq(m[1]);
    if (t && !NULLISH.test(t) && !insideProject(t, cwd, roots)) return { what: t };
  }
  for (const part of workDirs(c, cwd)) {
    if (!part.words.length) continue;
    const exe = String(part.words[0]).replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase();
    const here = Boolean(part.dir) && insideProject(part.dir, null, roots);
    const sub = part.words.find((w, i) => i > 0 && !w.startsWith('-')) ?? '';
    if (!here && !LOOKERS.test(exe) && !(exe === 'git' && GIT_LOOK.test(sub))) return { what: part.dir ?? exe };
    if (exe === 'git') {
      const at = part.words.indexOf('-C');
      if (at > 0 && !insideProject(part.words[at + 1] ?? '', part.dir, roots) && !GIT_LOOK.test(part.words[at + 2] ?? '')) return { what: part.words[at + 1] ?? 'git -C' };
    }
    if (!WRITERS.test(exe)) continue;
    // a target that is a shell variable (`Set-Content $f`, `Out-File -FilePath $out`) cannot be placed; in a
    // part that runs inside the project it is taken as unknown, not as outside (the user could not act on «$f»). Not for
    // what deletes or moves (`rm -rf $dir`): those still ask.
    // only a variable of the command's own ($f, $_.FullName), never the shell's folders ($PROFILE,
    // $env:X, [Environment]::GetFolderPath…), and only when every path the command names is inside the project
    // (`$f = "C:\Users\…\.gitconfig"; Add-Content $f` or `gci ~ | % { Add-Content $_.FullName }` still ask).
    for (const t of targetsOf(exe, part.words.slice(1))) { if (here && !DELETERS.test(exe) && ownVariable(t, c, part.dir, roots)) continue; if (!insideProject(t, part.dir, roots)) return { what: t }; }
  }
  return null;
}
const SHELL_PLACES = /\$(?:profile|home|pshome|pwd|env:|\{|executioncontext|myinvocation|psscriptroot)|%[\w~]|\[(?:system\.)?(?:environment|io\.path|io\.directory)\]|getfolderpath|psdrive|join-path|split-path|resolve-path|convert-path|get-location|\.\.(?:[\\/]|$)/i;
const ownVariable = (t, command, dir, roots) => /^["']?\$[\w:.]+["']?$/.test(t) && !SHELL_PLACES.test(command) && pathWords(command).every((w) => insideProject(w, dir, roots));
// git's own settings and hooks of the project (.git/config, .git/hooks/…, .git/info/attributes).
// Written by hand they do what `git config filter.x.clean …` does (gitRuns): Orb's snapshots run git in the project
// as the engine, and a filter or merge driver there runs as the engine. They ask like the git config forms.
const GIT_RUNS_FILE = /(^|[\\/])\.git[\\/]+(?:(?:worktrees|modules)[\\/]+.+[\\/]+)?(?:config(?:\.worktree)?|hooks(?:[\\/].*)?|info[\\/]+attributes)$/i;
export const isGitRunsFile = (p, dir) => { const f = resolveTarget(p, dir); return GIT_RUNS_FILE.test(lastName(p)) || Boolean(f && GIT_RUNS_FILE.test(f)); };
export function writesGitRunsFile(command, cwd) {
  const c = expandEnv(unwrapShell(command));
  for (const m of c.matchAll(/(?<![0-9&])>>?\s*("[^"]+"|'[^']+'|[^\s|&;<>]+)/g)) if (isGitRunsFile(unq(m[1]), cwd)) return true;
  return workDirs(c, cwd).some((part) => {
    const exe = String(part.words[0] ?? '').replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase();
    if (WRITERS.test(exe)) return !DELETERS.test(exe) && targetsOf(exe, part.words.slice(1)).some((t) => isGitRunsFile(bare(t), part.dir));
    // Any other program that names them (sed -i, [IO.File]::WriteAllText, node -e …), except one that only looks and git
    // itself (its config forms are the gitRuns rule).
    return !LOOKERS.test(exe) && exe !== 'git' && GIT_RUNS_TEXT.test(part.words.join(' '));
  });
}
const GIT_RUNS_TEXT = /(^|[\\/\s"'`(=,])\.git[\\/]+(?:config|hooks|info[\\/]+attributes)(?![\w.-])/i;
// a deletion that takes the project folder itself, a folder that holds it, its .git (where Orb's
// snapshots live) or everything at its top (`*`, which in PowerShell takes .git too): «Deshacer» could not bring it back.
const DELETERS = /^(rm|rmdir|rd|del|erase|remove-item|ri|unlink|shred|mv|move|move-item|mi|rename-item|rni|ren|rename)$/i;
export function deletesProjectOrGit(command, cwd, projectDir) {
  const top = projectDir ? resolveTarget(projectDir) : null;
  return workDirs(expandEnv(unwrapShell(command)), cwd).some((part) => {
    const exe = String(part.words[0] ?? '').replace(/^.*[\\/]/, '').replace(/\.exe$/i, '');
    if (!DELETERS.test(exe)) return false;
    const all = targetsOf(exe, part.words.slice(1));
    // A move's destination (`mv src/a.js .`) is not what goes away.
    const gone = /^(mv|move|move-item|mi)$/i.test(exe) && all.length > 1 ? all.slice(0, -1) : all;
    return all.some((t, i) => {
      // A stale lock of git's own (index.lock after a crash) is the usual fix, not an attack on the checkpoints.
      if (/(^|[\\/])\.git([\\/]|$)/i.test(bare(t)) && !/(^|[\\/])\.git[\\/][^\\/]*\.lock$/i.test(bare(t))) return true;
      if (!gone.includes(t) || i >= gone.length) return false;
      const full = resolveTarget(t, part.dir);
      if (!full || !top) return false;
      if (full === top || top.startsWith(`${full}\\`)) return true;
      const name = full.split('\\').pop();
      return GLOB.test(name) && full.slice(0, -name.length - 1) === top && globRe(name).test('.git');
    });
  });
}
