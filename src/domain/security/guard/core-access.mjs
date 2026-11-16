// Rules that keep commands away from the closed folders: names, globs, copies, searches, links and skill scripts.
import os from 'node:os';
import path from 'node:path';
import { expandEnv, pathWords, unescaped, unquoted, unwrapShell, winPath, words, workDirs } from './shell-text.mjs';
import { ADB_TEXT, OPEN_TEXT, appRoots, guardedRoots, isOrbData, localPath, norm, personalRoots, readText, realOf, rootsOf } from './roots.mjs';

// A word with a wildcard (`pers*`, `C:/Orb/*/x`, `p?rsonal`) that could expand into a closed folder (core, the owner's
// personal folder, the copies outside): its segments, resolved from the folder it runs in, matched against each root's.
export const GLOB = /[*?[]/;
export const globRe = (seg) => {
  // Bash and JS read brackets differently (`[]o]` is {']','o'} in bash but an empty class in JS, `[[:alpha:]]` is
  // a POSIX class), so a bracket expression becomes "any one character": it may over-match (more asks), never under-match.
  const s = String(seg); let re = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '[') {
      let j = i + 1;
      if (s[j] === '!' || s[j] === '^') j++;
      if (s[j] === ']') j++; // a ] right after the opening is a member, not the end
      let end = -1;
      for (; j < s.length; j++) {
        if (s[j] === '[' && s[j + 1] === ':') { const k = s.indexOf(':]', j + 2); if (k !== -1) { j = k + 1; continue; } }
        if (s[j] === ']') { end = j; break; }
      }
      if (end !== -1) { re += '.'; i = end; continue; }
      re += '\\[';
    } else if (ch === '*') re += '.*';
    else if (ch === '?') re += '.';
    else re += ch.replace(/[.+^${}()|\\\]]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
};
function globReaches(word, dir, roots) {
  const w = winPath(String(word ?? '')).replace(/^~(?=[\\/]|$)/, os.homedir());
  if (!GLOB.test(w)) return false;
  const abs = path.isAbsolute(w) || path.win32.isAbsolute(w) ? w : dir ? `${dir}\\${w}` : null;
  if (!abs) return false;
  const segs = []; // resolved by hand, segment by segment ('..' and '.' as a shell takes them)
  for (const s of abs.split(/[\\/]+/)) { if (!s || s === '.') continue; if (s === '..') segs.pop(); else segs.push(s); }
  return roots.some((r) => {
    const rs = r.split('\\').filter(Boolean);
    const n = Math.min(segs.length, rs.length);
    // No wildcard on the way to the root: the literal checks see it.
    if (!segs.slice(0, n).some((s) => GLOB.test(s))) return false;
    for (let i = 0; i < n; i++) { if (GLOB.test(segs[i]) ? !globRe(segs[i]).test(rs[i]) : segs[i].toLowerCase() !== rs[i]) return false; }
    return true;
  });
}
// What follows a closed folder's name in a command: the end of that name (a separator, the end, a quote…), or what Windows
// drops from it (`core.\`, `core \`, `core::$INDEX_ALLOCATION\`). Not `.orbx` or `core2`.
const sameFolder = (after) => /^($|[\\"'\s;|&)])/.test(after) || /^[. ]*(:[^\\"'\s;|&)]*)?($|[\\"';|&)])/.test(after);
export function touchesInternal(args) {
  const variants = [...new Set([args.command, unquoted(args.command), unescaped(args.command)].map((c) => String(c ?? '')))];
  return variants.some((command) => touchesOnce({ ...args, command }));
}
function touchesOnce({ command: given, paths, patterns, internalDir, cwd, read = false }) {
  if (!internalDir) return false;
  const command = expandEnv(given);
  if ([...paths, ...patterns].some((p) => isOrbData(p, internalDir, cwd, { read }))) return true;
  // The folder written out anywhere in the command (in a script's string too), with either separator or case.
  const t = String(command ?? '').replace(/\//g, '\\').toLowerCase();
  const coreRoots = rootsOf(internalDir);
  for (const r of [...coreRoots, ...guardedRoots, ...personalRoots, ...(read === true ? [] : appRoots)]) {
    for (let i = t.indexOf(r); i >= 0; i = t.indexOf(r, i + 1)) {
      const after = t.slice(i + r.length);
      if (!sameFolder(after)) continue; // .orbx is another folder
      if (!coreRoots.includes(r) || !(OPEN_TEXT.test(after) || readText(read, after) || (read === true && ADB_TEXT.test(after)))) return true;
    }
  }
  if (pathWords(command).some((w) => isOrbData(w, internalDir, cwd, { read }))) return true;
  // each part of the command in the folder it really runs in (after its `cd`s): a part that runs in
  // core (but its open folders) is refused whatever it names, and each word, also one without a slash (a junction's
  // name), is resolved there. (An agent whose own folder is inside core, a run's: its plain words are not looked at.)
  const start = cwd ? norm(realOf(cwd)) : null;
  const startInCore = Boolean(start) && coreRoots.some((root) => start === root || start.startsWith(`${root}\\`));
  const roots = [...coreRoots, ...guardedRoots, ...personalRoots, ...(read === true ? [] : appRoots)];
  for (const part of workDirs(command, cwd)) {
    if (part.moved && part.dir && isOrbData(part.dir, internalDir, null, { read })) return true;
    for (const w of part.words) {
      if (globReaches(w, part.dir, roots)) return true;
      if (/^-/.test(w) && !/[\\/]/.test(w)) continue;
      if (!part.moved && startInCore && !/[\\/~]|^\.\.?$/.test(w)) continue;
      if (isOrbData(w, internalDir, part.dir, { read })) return true;
    }
  }
  return false;
}
// copying, moving or packing a folder that holds a closed one (the workspace holds core, the user's
// folder holds .android) takes the closed one with it. The program of each part of the command (cp, Copy-Item, robocopy,
// xcopy, tar, Compress-Archive, 7z, zip, rsync…) and every folder it names (resolved where that part runs) are looked at.
const COPIERS = /^(cp|copy|cpi|copy-item|xcopy|robocopy|mv|move|mi|move-item|tar|bsdtar|compress-archive|7z|7za|7zr|zip|rar|winrar|rsync|scp|ditto)$/i;
const COPY_TO = /^(cp|copy|cpi|copy-item|xcopy|mv|move|mi|move-item|rsync|scp|ditto)$/;
export function copiesClosedParent(command, internalDir, cwd) {
  const closed = [...(internalDir ? rootsOf(internalDir) : []), ...guardedRoots, ...personalRoots];
  if (!closed.length) return false;
  const c = expandEnv(command);
  if (/createfromdirectory/i.test(c) && pathWords(c).some((w) => holds(w, cwd, closed))) return true;
  return workDirs(c, cwd).some((part) => {
    const exe = String(part.words[0] ?? '').replace(/^.*[\\/]/, '').replace(/\.exe$/i, '');
    if (!COPIERS.test(exe)) return false;
    // What is copied (the sources), not where to: an option (-r, /E, /MIR…) is not a folder, the value of -Destination
    // and, for a copy or a move, its last folder are where it goes; robocopy's source is its first folder.
    const args = []; const ws = part.words.slice(1);
    for (let i = 0; i < ws.length; i++) {
      if (/^-(destination|d|t|target-directory)$/i.test(ws[i])) { i++; continue; }
      if (/^-/.test(ws[i]) || /^\/[a-z0-9:]{1,8}$/i.test(ws[i])) continue;
      args.push(ws[i]);
    }
    const lower = exe.toLowerCase();
    const sources = lower === 'robocopy' ? args.slice(0, 1) : COPY_TO.test(lower) && args.length > 1 ? args.slice(0, -1) : args;
    return sources.some((w) => holds(w, part.dir, closed));
  });
}
function holds(word, dir, closed) {
  let p = winPath(String(word)).replace(/^~(?=[\\/]|$)/, os.homedir());
  const local = localPath(p); if (local === false) return true; if (local) p = local;
  if (!path.isAbsolute(p) && !path.win32.isAbsolute(p)) { if (!dir) return false; p = path.resolve(dir, p); }
  const full = norm(realOf(p));
  return closed.some((r) => r === full || r.startsWith(`${full}\\`) || (/^[a-z]:$/.test(full) && r.startsWith(`${full}\\`)));
}
// searching the contents of a folder that holds a closed one (Grep over C:\Orb or the user's
// folder, rg/grep -r/findstr /s, Get-ChildItem -Recurse into a reader) reads the closed one too. Reading tools: their
// folder (Grep, or the agent's folder when none is given); commands: what each part names, or the folder it runs in.
const LISTERS = /^(get-childitem|gci|dir|ls)$/i;
const READ_PIPE = /\|\s*(select-string|sls|get-content|gc|cat|type|findstr|grep|rg|copy-item|cpi)\b/i;
const RECURSE = /^-r(e(c(u(r(se?)?)?)?)?)?$/i;
export function searchesClosedParent({ tool, cls, command, paths, cwd, internalDir }) {
  const closed = [...(internalDir ? rootsOf(internalDir) : []), ...guardedRoots, ...personalRoots];
  if (!closed.length) return false;
  if (cls === 'read') {
    if (!/^(grep|search)$/i.test(String(tool ?? '').replace(/^mcp__[^_]+__/, ''))) return false;
    return (paths.length ? paths : [cwd]).some((p) => p && holds(p, cwd, closed));
  }
  if (cls !== 'exec') return false;
  const c = expandEnv(command);
  return workDirs(c, cwd).some((part) => {
    const exe = String(part.words[0] ?? '').replace(/^.*[\\/]/, '').replace(/\.(exe|cmd)$/i, '').toLowerCase();
    const args = part.words.slice(1);
    const recursive = ['rg', 'ag', 'ack'].includes(exe)
      || (['grep', 'egrep', 'fgrep'].includes(exe) && args.some((a) => /^(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive|--dereference-recursive)$/.test(a)))
      || (exe === 'findstr' && args.some((a) => /^\/s$/i.test(a)))
      || (['select-string', 'sls'].includes(exe) && args.some((a) => RECURSE.test(a)))
      || (LISTERS.test(exe) && args.some((a) => RECURSE.test(a) || /^\/s$/i.test(a)) && READ_PIPE.test(c))
      || (exe === 'git' && args[0] === 'grep' && args.includes('--no-index'));
    if (!recursive) return false;
    const named = args.filter((a) => !/^-/.test(a) && !/^\/[a-z]$/i.test(a));
    return [...named, ...(part.dir ? [part.dir] : [])].some((w) => holds(w, part.dir, closed));
  });
}
// a command that makes a link (a junction, a symbolic or a hard link), in any shell or language: one that names core
// (or runs inside it) is denied, so nothing in core\preparacion (or anywhere) can point into core and turn an allowed write
// there into a write in core\skills, core\datos…
const MAKES_LINK = /\bmklink\b|\b(new-item|ni)\b[^|;&\n]*\b(junction|symboliclink|hardlink)\b|\bfsutil(\.exe)?\s+(hardlink|reparsepoint)\b|(^|[\s;&|(`"'])ln(\.exe)?\s|\bjunction(64)?(\.exe)?\s|create(symbolic|hard)link|createjunction|\b(sym)?linksync\b|\b(fs|fsp|promises)\.(sym)?link\b|\bos\.(sym)?link\b|\.(symlink|hardlink)_to\b|\bmountvol\b/i;
export const makesLink = (command) => MAKES_LINK.test(String(command ?? ''));
export function linkIntoCore(command, internalDir, cwd) {
  if (!internalDir || !makesLink(command)) return false;
  const [root, realRoot = root] = rootsOf(internalDir);
  const inCore = (p) => { const f = norm(realOf(p)); return [root, realRoot].some((r) => f === r || f.startsWith(`${r}\\`)); };
  const t = expandEnv(command).replace(/\//g, '\\').toLowerCase();
  const named = (r) => { for (let i = t.indexOf(r); i >= 0; i = t.indexOf(r, i + 1)) if (sameFolder(t.slice(i + r.length))) return true; return false; };
  if (named(root) || named(realRoot)) return true;
  if (cwd && inCore(cwd)) return true;
  if (pathWords(expandEnv(command)).some((w) => { const p = path.isAbsolute(w) || path.win32.isAbsolute(w) ? w : cwd ? path.resolve(cwd, w) : null; return p ? inCore(p) : false; })) return true;
  // also after a `cd` (into core\preparacion, say): the folder it runs in, and what it names from there.
  return workDirs(expandEnv(command), cwd).some((part) => (part.dir && inCore(part.dir))
    || part.words.some((w) => { const p = winPath(w); const full = path.isAbsolute(p) || path.win32.isAbsolute(p) ? p : part.dir ? path.resolve(part.dir, p) : null; return full ? inCore(full) : false; }));
}
// running a script of a skill of core: one interpreter and one script file in core\skills, as a single plain command
// (no -c / -e, no chaining, no redirection). It asks; any other command that touches core\skills is denied.
const RUNNERS = { python: [], python3: [], py: [], node: [], bash: [], sh: [], pwsh: ['-noprofile', '-nologo', '-noninteractive', '-executionpolicy'], powershell: ['-noprofile', '-nologo', '-noninteractive', '-executionpolicy'] };
export function runsSkillScript(command, internalDir, cwd) {
  const c = unwrapShell(command).trim(); // Codex runs every command as powershell -Command '…'
  if (!c || /[;&|<>`\r\n]|\$\(/.test(c)) return false;
  const w = words(c);
  const exe = String(w[0] ?? '').replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase();
  if (!Object.hasOwn(RUNNERS, exe)) return false;
  let i = 1;
  if (exe === 'pwsh' || exe === 'powershell') {
    for (; i < w.length && w[i].toLowerCase() !== '-file'; i++) {
      const a = w[i].toLowerCase();
      if (!RUNNERS[exe].includes(a)) return false;
      if (a === '-executionpolicy') i++;
    }
    if (w[i]?.toLowerCase() !== '-file') return false;
    i++;
  }
  const script = w[i];
  if (!script || !/\.(py|js|mjs|cjs|sh|ps1)$/i.test(script)) return false;
  const full = path.isAbsolute(script) || path.win32.isAbsolute(script) ? script : cwd ? path.resolve(cwd, script) : null;
  if (!full) return false;
  const f = norm(realOf(full));
  return rootsOf(path.join(internalDir, 'skills')).some((skills) => f.startsWith(`${skills}\\`) && !f.slice(skills.length + 1).startsWith('.'));
}
