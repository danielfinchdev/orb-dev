// Expert mode (PC only): read-only views of a project for demanding users — file tree, file viewer, git status / diff /
// history — and the machine's load. Everything stays inside the project's folder (symlinks included), secret files are
// listed but never read, and every answer is size-limited.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { isSecretPath, redactSecrets } from '../core/safety.mjs';
import { tr } from '../core/context.mjs';

const MAX_ENTRIES = 600;
const MAX_READ = 512 * 1024;
const MAX_DIFF = 400 * 1024;
const HIDDEN = new Set(['.git', '.orb', '.orb-adjuntos']); // compared in lower case (Windows ignores case)
const isHidden = (part) => HIDDEN.has(part.toLowerCase());
const realpath = fs.realpathSync.native ?? fs.realpathSync; // native: the real case and long names (not ENV~1) on Windows

// git without blocking the engine, with paths taken literally (never as patterns: "*" or "[.]env" would match .env).
const git = (cwd, args, { max = 32 * 1024 * 1024 } = {}) => new Promise((resolve) => {
  execFile('git', ['-C', cwd, '--literal-pathspecs', '-c', 'core.quotepath=off', ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: max, timeout: 30_000 }, (error, stdout, stderr) => {
    resolve({ status: error ? (typeof error.code === 'number' ? error.code : -1) : 0, stdout: stdout ?? '', stderr: stderr ?? '', cut: error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' });
  });
});
const userError = (message) => { const e = new Error(message); e.userFacing = true; return e; };

// Absolute path of `rel` inside the project, refusing anything that leaves it (.., absolute paths, links pointing out).
// Windows reads «.env::$DATA», «.env.» and «.env » as .env: names like these are refused before anything else.
const sneaky = (clean) => clean.includes(':') || clean.split('/').some((part) => /[. ]$/.test(part) && part !== '.' && part !== '..');
export function insideProject(root, rel = '') {
  const real = realpath(root);
  const clean = String(rel ?? '').replace(/\\/g, '/');
  if (clean.includes('\0') || path.isAbsolute(clean) || /^[a-z]:/i.test(clean) || sneaky(clean)) throw userError(tr('msg.expert.badPath'));
  const abs = path.resolve(real, clean);
  let resolved; try { resolved = realpath(abs); } catch { throw userError(tr('msg.expert.notFound')); }
  const back = path.relative(real, resolved);
  if (back.startsWith('..') || path.isAbsolute(back)) throw userError(tr('msg.expert.outside'));
  if (back.split(path.sep).some(isHidden)) throw userError(tr('msg.expert.internal'));
  return { abs: resolved, rel: back.split(path.sep).join('/') };
}

export function tree(root, dir = '') {
  const { abs, rel } = insideProject(root, dir);
  if (!fs.statSync(abs).isDirectory()) throw userError(tr('msg.expert.notFolder'));
  const entries = [];
  const list = fs.readdirSync(abs, { withFileTypes: true }).filter((e) => !isHidden(e.name));
  for (const e of list.slice(0, MAX_ENTRIES)) {
    const child = rel ? `${rel}/${e.name}` : e.name;
    let kind = e.isDirectory() ? 'dir' : e.isFile() ? 'file' : e.isSymbolicLink() ? 'link' : 'other';
    let size = null;
    if (kind === 'link') { try { const st = fs.statSync(path.join(abs, e.name)); kind = st.isDirectory() ? 'dir' : 'file'; size = st.size; } catch { kind = 'other'; } }
    else if (kind === 'file') { try { size = fs.statSync(path.join(abs, e.name)).size; } catch { /* gone */ } }
    entries.push({ name: e.name, path: child, kind, size, secret: kind === 'file' && isSecretPath(child) });
  }
  entries.sort((a, b) => (a.kind === 'dir') === (b.kind === 'dir') ? a.name.localeCompare(b.name, 'es', { numeric: true }) : a.kind === 'dir' ? -1 : 1);
  return { dir: rel, entries, cut: list.length > MAX_ENTRIES };
}

export function readFile(root, file) {
  const { abs, rel } = insideProject(root, file);
  if (isSecretPath(rel) || isSecretPath(rel.toLowerCase())) throw userError(tr('msg.expert.secrets'));
  const st = fs.statSync(abs);
  if (!st.isFile()) throw userError(tr('msg.expert.notFile'));
  const fd = fs.openSync(abs, 'r');
  try {
    const buf = Buffer.alloc(Math.min(st.size, MAX_READ));
    fs.readSync(fd, buf, 0, buf.length, 0);
    if (buf.subarray(0, 8000).includes(0)) return { path: rel, size: st.size, binary: true, text: '' };
    return { path: rel, size: st.size, binary: false, cut: st.size > MAX_READ, text: redactSecrets(buf.toString('utf8')) };
  } finally { fs.closeSync(fd); }
}

const hasHead = async (root) => (await git(root, ['rev-parse', '--verify', '-q', 'HEAD'])).status === 0;
const isRepo = async (root) => (await git(root, ['rev-parse', '--is-inside-work-tree'])).stdout.trim() === 'true';
// git status names files from the repository's root: a project that is a subfolder of a bigger repository sees its own
// files only, relative to itself (like every other path here). Untracked folders are listed as folders (not every file
// inside an unignored node_modules).
async function changed(root) {
  const prefix = (await git(root, ['rev-parse', '--show-prefix'])).stdout.trim();
  const [tracked, others] = await Promise.all([
    git(root, ['status', '--porcelain=v1', '-z', '-uno', '--', '.']),
    git(root, ['ls-files', '--others', '--exclude-standard', '--directory', '--no-empty-directory', '-z']) // relative to the project
  ]);
  const parts = tracked.stdout.split('\0'); const out = [];
  for (let i = 0; i < parts.length && out.length < 1000; i++) {
    const entry = parts[i]; if (entry.length < 4) continue;
    const code = entry.slice(0, 2); let file = entry.slice(3).replace(/\\/g, '/');
    if (/^[RC]/.test(code)) i++;
    if (prefix) { if (!file.startsWith(prefix)) continue; file = file.slice(prefix.length); }
    out.push({ code, path: file });
  }
  let untracked = others.stdout.split('\0').filter(Boolean);
  // A project that git does not track at all comes back as «./»: then its files, one by one (within the size limit).
  if (untracked.includes('./')) untracked = (await git(root, ['ls-files', '--others', '--exclude-standard', '-z'], { max: 4 * 1024 * 1024 })).stdout.split('\0').filter(Boolean);
  for (const file of untracked) { if (out.length >= 1000) break; out.push({ code: '??', path: file.replace(/\\/g, '/') }); }
  return out;
}

export async function gitStatus(root) {
  if (!(await isRepo(root))) return { repo: false, files: [] };
  const branch = (await git(root, ['branch', '--show-current'])).stdout.trim() || (await git(root, ['rev-parse', '--short', 'HEAD'])).stdout.trim() || '(sin commits)';
  const files = (await changed(root)).map(({ code, path: file }) => ({ path: file, code, state: code === '??' ? 'nuevo' : /D/.test(code) ? 'borrado' : /R/.test(code) ? 'renombrado' : /A/.test(code) ? 'añadido' : 'cambiado', staged: code[0] !== ' ' && code[0] !== '?', secret: isSecretPath(file) }));
  const ab = await git(root, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']);
  const [behind, ahead] = ab.status === 0 ? ab.stdout.trim().split(/\s+/).map(Number) : [null, null];
  return { repo: true, branch, files, ahead, behind };
}

// Leaves out of a diff the sections of secret files (whatever name git printed: renames included).
function withoutSecrets(diff) {
  return diff.split(/(?=^diff --git )/m).filter((part) => {
    const m = part.match(/^diff --git a\/(.*?) b\/(.*)$/m);
    return !m || (!isSecretPath(m[1]) && !isSecretPath(m[2]));
  }).join('');
}

// The changes of one changed file, or of every changed file (secret files left out), against the last commit.
export async function gitDiff(root, file) {
  if (!(await isRepo(root))) throw userError(tr('msg.expert.noGit'));
  const list = await changed(root);
  let paths;
  if (file) {
    // Only a file of the changes list, by its exact name.
    const f = list.find((x) => x.path === String(file));
    if (!f) throw userError(tr('msg.expert.noChanges'));
    if (isSecretPath(f.path) || sneaky(f.path)) throw userError(tr('msg.expert.secrets'));
    paths = [f.path];
  } else paths = ['.'];
  const head = await hasHead(root);
  const args = ['diff', '--no-color', '--no-ext-diff', '--relative', '-M', ...(head ? ['HEAD'] : ['--cached']), '--', ...paths];
  const r = await git(root, args, { max: MAX_DIFF * 4 });
  let out = withoutSecrets(r.stdout);
  // New files git does not track yet: shown whole, as added lines.
  const untracked = list.filter((x) => x.code === '??' && (!file || x.path === file) && !x.path.endsWith('/') && !isSecretPath(x.path));
  for (const { path: p } of untracked) {
    if (out.length > MAX_DIFF) break;
    try { const f = readFile(root, p); out += `diff --git a/${p} b/${p}\nnew file\n--- /dev/null\n+++ b/${p}\n${f.binary ? '(archivo binario)\n' : f.text.split('\n').map((l) => `+${l}`).join('\n')}\n`; } catch { /* unreadable */ }
  }
  return { diff: redactSecrets(out.slice(0, MAX_DIFF)), cut: r.cut || out.length > MAX_DIFF };
}

export async function gitLog(root, limit = 40) {
  if (!(await isRepo(root)) || !(await hasHead(root))) return [];
  const n = Math.max(1, Math.min(Number(limit) || 40, 200));
  const r = await git(root, ['log', `-${n}`, '--date=iso-strict', '--pretty=format:%h%x1f%an%x1f%ad%x1f%s%x1f%D%x1e']);
  return r.stdout.split('\x1e').map((l) => l.trim()).filter(Boolean).map((l) => { const [hash, author, date, subject, refs] = l.split('\x1f'); return { hash, author, date, subject, refs }; });
}

// Machine load: CPU since the previous call, memory, the disk of the assistant's folder and the engine's own memory.
let lastCpu = null;
export function systemStats(home) {
  const cpus = os.cpus();
  const total = cpus.reduce((acc, c) => { for (const [k, v] of Object.entries(c.times)) acc[k === 'idle' ? 'idle' : 'busy'] += v; return acc; }, { idle: 0, busy: 0 });
  let cpu = null;
  if (lastCpu) { const busy = total.busy - lastCpu.busy; const idle = total.idle - lastCpu.idle; cpu = busy + idle > 0 ? Math.round((busy / (busy + idle)) * 100) : 0; }
  lastCpu = total;
  let disk = null;
  try { const s = fs.statfsSync(home); disk = { free: s.bavail * s.bsize, total: s.blocks * s.bsize }; } catch { /* not available */ }
  return { cpu, cores: cpus.length, memory: { free: os.freemem(), total: os.totalmem() }, disk, engine: process.memoryUsage().rss, uptime: Math.round(os.uptime()), platform: `${os.type()} ${os.release()}` };
}
