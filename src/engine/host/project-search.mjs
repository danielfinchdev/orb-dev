// Ctrl+P (find a file of the project) and Ctrl+Shift+F (find text in the project), from the command palette. PC only.
// Everything stays inside the project's folder: links are never followed, Orb's own folders, secret files, the
// user's «cosas que nadie toca» (rail rutas-protegidas) and the agents' settings files are never listed or read, and
// what is shown goes through the secret scrubber. ripgrep does the work when this PC has it; without it, the same
// search runs here. The query is data: it is never put in a shell line, and never read by rg as an option.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { insideProject } from './expert.mjs';
import { isSecretPath, redactSecrets } from '../../shared/secrets-scan.mjs';
import { protectedHitRail, isAgentConfig } from '../../domain/security/guard/protected-files.mjs';
import { isRailOn } from '../../domain/rules/rails.mjs';

export const MAX_FILES = 60;
export const MAX_HITS = 80;
const MAX_WALK = 40_000; // files looked at before it gives up
const MAX_BYTES = 1024 * 1024; // a bigger file is not searched
const BUDGET_MS = 6000;
const SKIP_DIRS = new Set(['.git', '.orb', '.orb-adjuntos', 'node_modules', 'dist', 'build', 'target', '.next', '.cache', '__pycache__', '.venv', 'venv', 'coverage', '.gradle']);
const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const userError = (message) => { const e = new Error(message); e.userFacing = true; return e; };

// Whether a path (relative to the project, with /) may be listed or read.
export function allowedPath(rel) {
  const parts = String(rel).split('/');
  if (parts.some((p) => SKIP_DIRS.has(p.toLowerCase()))) return false;
  if (isSecretPath(rel) || isSecretPath(rel.toLowerCase()) || isAgentConfig(rel)) return false;
  return protectedHitRail(rel, isRailOn('rutas-protegidas')) === null;
}

// Where ripgrep is (the PATH's absolute folders only), or null.
export function findRg(env = process.env, exists = fs.existsSync) {
  for (const dir of String(env.PATH ?? env.Path ?? '').split(path.delimiter).filter((d) => path.isAbsolute(d))) {
    for (const name of process.platform === 'win32' ? ['rg.exe'] : ['rg']) { const f = path.join(dir, name); if (exists(f)) return f; }
  }
  return null;
}

// The files of the project, as relative paths with /. Without links, without the folders above.
async function* walk(root, deadline) {
  const stack = [''];
  let seen = 0;
  while (stack.length) {
    const rel = stack.pop();
    let list;
    try { list = await fs.promises.readdir(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of list) {
      if (e.isSymbolicLink()) continue; // a link (or a junction) may leave the project
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name.toLowerCase())) stack.push(child); continue; }
      if (!e.isFile() || !allowedPath(child)) continue;
      if (++seen > MAX_WALK || Date.now() > deadline) return;
      yield child;
    }
  }
}

// How well `rel` answers the words (every word must be in the path), higher is better; 0 = no.
export function fileScore(rel, words) {
  const full = fold(rel); const base = full.slice(full.lastIndexOf('/') + 1);
  if (!words.every((w) => full.includes(w))) return 0;
  let score = 1;
  if (base === words.join(' ')) score += 100;
  else if (base.startsWith(words[0])) score += 40;
  else if (words.every((w) => base.includes(w))) score += 20;
  return score - Math.min(full.length, 200) / 1000; // shorter paths first
}

const cleanQuery = (q, min) => {
  const s = String(q ?? '').trim();
  if (s.length < min) return '';
  if (s.length > 200 || s.includes('\0')) throw userError('búsqueda no válida');
  return s;
};

// → { files: [relative path], engine: 'built-in' }
export async function findFiles(root, query) {
  const text = cleanQuery(query, 1);
  if (!text) return { files: [], engine: 'built-in' };
  const words = fold(text).split(/\s+/).filter(Boolean);
  const real = insideProject(root, '').abs;
  const scored = [];
  for await (const rel of walk(real, Date.now() + BUDGET_MS)) {
    const s = fileScore(rel, words);
    if (s > 0) scored.push([s, rel]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1]));
  return { files: scored.slice(0, MAX_FILES).map((x) => x[1]), engine: 'built-in' };
}

const clip = (line) => redactSecrets(String(line).replace(/\s+/g, ' ').trim().slice(0, 200));

// The lines of one file that have the text; at most 3 per file.
async function grepFile(root, rel, needle, caseSensitive) {
  let abs;
  try { abs = insideProject(root, rel).abs; } catch { return []; }
  let fh;
  try {
    fh = await fs.promises.open(abs, 'r');
    const st = await fh.stat();
    if (!st.isFile() || st.size > MAX_BYTES) return [];
    const buf = Buffer.alloc(st.size);
    await fh.read(buf, 0, buf.length, 0);
    if (buf.subarray(0, 8000).includes(0)) return [];
    const out = [];
    const lines = buf.toString('utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length && out.length < 3; i += 1) {
      if ((caseSensitive ? lines[i] : lines[i].toLowerCase()).includes(needle)) out.push({ file: rel, line: i + 1, text: clip(lines[i]) });
    }
    return out;
  } catch { return []; } finally { await fh?.close().catch(() => {}); }
}

function runRg(rg, root, args) {
  return new Promise((resolve) => {
    // minimal environment: no RIPGREP_CONFIG_PATH (and --no-config), nothing else of the engine's
    const env = { PATH: process.env.PATH ?? process.env.Path ?? '', SystemRoot: process.env.SystemRoot ?? '' };
    execFile(rg, args, { cwd: root, timeout: 8000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, encoding: 'utf8', env }, (error, stdout) => {
      // exit 1 = no match (not an error); a timeout or another failure falls back to the built-in search
      if (error && error.code !== 1) resolve(null); else resolve(String(stdout ?? ''));
    });
  });
}
const RG_BASE = ['--no-config', '--hidden', '--no-follow', '--color', 'never', '--max-filesize', '1M', ...[...SKIP_DIRS].flatMap((d) => ['--glob', `!${d}`])];

// → { hits: [{ file, line, text }], engine: 'rg' | 'built-in' }
export async function searchText(root, query, { rg = findRg() } = {}) {
  const text = cleanQuery(query, 2);
  if (!text) return { hits: [], engine: 'built-in' };
  const real = insideProject(root, '').abs;
  if (rg) {
    // -e: the query is the pattern even when it starts with a dash; --fixed-strings: it is text, not a regex; the «.» and
    // --null: paths come as «path NUL line:text», whatever characters the names have.
    const out = await runRg(rg, real, [...RG_BASE, '--fixed-strings', '--smart-case', '--no-heading', '--null', '--line-number', '--max-count', '3', '-e', text, '--', '.']);
    if (out !== null) {
      const hits = [];
      for (const row of out.split('\n')) {
        const nul = row.indexOf('\0'); if (nul < 0) continue;
        const file = row.slice(0, nul).replace(/\\/g, '/').replace(/^\.\//, '');
        const m = /^(\d+):(.*)$/s.exec(row.slice(nul + 1).replace(/\r$/, '')); if (!m || !allowedPath(file)) continue;
        try { insideProject(real, file); } catch { continue; }
        hits.push({ file, line: Number(m[1]), text: clip(m[2]) });
        if (hits.length >= MAX_HITS) break;
      }
      return { hits, engine: 'rg' };
    }
  }
  const caseSensitive = text !== text.toLowerCase();
  const needle = caseSensitive ? text : text.toLowerCase();
  const hits = [];
  for await (const rel of walk(real, Date.now() + BUDGET_MS)) {
    hits.push(...await grepFile(real, rel, needle, caseSensitive));
    if (hits.length >= MAX_HITS) break;
  }
  return { hits: hits.slice(0, MAX_HITS), engine: 'built-in' };
}
