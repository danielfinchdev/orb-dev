// Read-only view of the session files that Claude Code (~/.claude/projects/**.jsonl) and Codex
// (~/.codex/sessions/**.jsonl) keep on this PC: the old chats as read-only conversations, and the usage by model,
// project and hour. Nothing here writes, moves or copies those files.
//   - It never leaves the two folders: every entry is checked with lstat (symbolic links and junctions are skipped, not
//     followed) and its real path must still be inside the real path of the folder.
//   - Callers never pass a path: a chat is named by an id made of the agent and a hash of its relative path, and it is
//     found again by walking the folder.
//   - Unknown formats are tolerated (a line or a field that is not understood is skipped). Limits cap the files read, the
//     bytes read per file, the length of a line, the messages and the text of each one.
//   - What the user sees passes through redactSecrets, so a token pasted in an old chat is not shown.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { redactSecrets } from '../../shared/secrets-scan.mjs';
import { oneLine } from '../../shared/text.mjs';

export const LIMITS = Object.freeze({
  files: 4000, // jsonl files looked at per agent
  depth: 5, // folders deep below the root
  listBytes: 256 * 1024, // read for a row of the list (title, project, model)
  readBytes: 8 * 1024 * 1024, // read to open one chat
  usageBytes: 32 * 1024 * 1024, // read per file for the usage
  lineBytes: 1024 * 1024, // a longer line is dropped
  messages: 500,
  text: 8000 // characters kept of one message
});
export const AGENTS = ['claude', 'codex'];

export const historyHome = () => process.env.ORB_HISTORY_HOME || os.homedir();
export const rootsOf = (home = historyHome()) => ({ claude: path.join(home, '.claude', 'projects'), codex: path.join(home, '.codex', 'sessions') });

const realOf = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
const inside = (root, file) => { const rel = path.relative(root, file); return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel); };

// The .jsonl files below a root, newest first. Symbolic links (files or folders) are never followed.
export async function listFiles(root, { limit = LIMITS.files } = {}) {
  const base = realOf(root);
  if (!base) return [];
  const out = [];
  const visit = async (dir, depth) => {
    if (out.length >= limit * 4 || depth > LIMITS.depth) return;
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { await visit(full, depth + 1); continue; }
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
      try {
        const st = await fs.promises.lstat(full);
        if (!st.isFile() || st.isSymbolicLink()) continue;
        const real = realOf(full);
        if (!real || !inside(base, real)) continue;
        out.push({ file: full, rel: path.relative(base, full).split(path.sep).join('/'), mtimeMs: st.mtimeMs, size: st.size });
      } catch { /* vanished */ }
    }
  };
  await visit(base, 0);
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit);
}

// Calls onLine(object) for each JSON line of the first maxBytes of a file. Lines that are too long or not JSON are skipped.
// Returns { truncated } (the file is larger than what was read).
export async function readJsonl(file, maxBytes, onLine) {
  let fh;
  try { fh = await fs.promises.open(file, 'r'); } catch { return { truncated: false }; }
  try {
    const { size } = await fh.stat();
    const buf = Buffer.allocUnsafe(64 * 1024);
    let pos = 0; let rest = Buffer.alloc(0); let skipping = false;
    const feed = (line) => {
      if (!line.length) return true;
      let obj;
      try { obj = JSON.parse(line.toString('utf8')); } catch { return true; }
      return obj && typeof obj === 'object' ? onLine(obj) !== false : true;
    };
    while (pos < Math.min(size, maxBytes)) {
      const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, maxBytes - pos), pos);
      if (!bytesRead) break;
      pos += bytesRead;
      let chunk = rest.length ? Buffer.concat([rest, buf.subarray(0, bytesRead)]) : Buffer.from(buf.subarray(0, bytesRead));
      rest = Buffer.alloc(0);
      let nl;
      while ((nl = chunk.indexOf(10)) >= 0) {
        const line = chunk.subarray(0, nl);
        chunk = chunk.subarray(nl + 1);
        if (skipping) { skipping = false; continue; }
        if (line.length <= LIMITS.lineBytes && feed(line) === false) return { truncated: pos < size };
      }
      if (chunk.length > LIMITS.lineBytes) skipping = true; else if (!skipping) rest = chunk;
    }
    // The last line has no newline only when the file was read to its end.
    if (pos >= size && rest.length && rest.length <= LIMITS.lineBytes) feed(rest);
    return { truncated: size > maxBytes };
  } finally { await fh.close().catch(() => {}); }
}

// ---- the two formats, read loosely

const textOf = (content) => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b) => (typeof b === 'string' ? b : b && typeof b.text === 'string' && (!b.type || ['text', 'input_text', 'output_text'].includes(b.type)) ? b.text : '')).filter(Boolean).join('\n');
};
const toolsOf = (content) => (Array.isArray(content) ? content.filter((b) => b?.type === 'tool_use' && typeof b.name === 'string').map((b) => b.name) : []);
const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
const when = (v) => { const t = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v); return Number.isFinite(t) ? t : null; };
const clip = (s) => { const t = redactSecrets(String(s ?? '').trim()); return t.length > LIMITS.text ? `${t.slice(0, LIMITS.text)}…` : t; };
// Text the agents' own tools put in the user turn (not something the person wrote).
const SYNTHETIC = /^\s*<(environment_context|user_instructions|system-reminder|command-(name|message|args)|local-command-(stdout|stderr|caveat)|ide_[a-z_]+)\b/i;

// One line of a session file → what Orb cares about: { meta, message, usage }. The agent decides the shape.
export function parseLine(agent, o, state = {}) {
  const out = {};
  const ts = when(o.timestamp ?? o.payload?.timestamp);
  if (agent === 'claude') {
    if (typeof o.cwd === 'string') out.meta = { cwd: o.cwd, id: o.sessionId };
    const m = o.message;
    if ((o.type === 'user' || o.type === 'assistant') && m && typeof m === 'object' && !o.isMeta) {
      const role = o.type;
      const text = textOf(m.content);
      const tools = toolsOf(m.content);
      if (role === 'assistant' && m.model && m.model !== '<synthetic>') out.model = String(m.model).slice(0, 80);
      if (text.trim() && !(role === 'user' && SYNTHETIC.test(text))) out.message = { role, text: clip(text), at: ts };
      else if (role === 'assistant' && tools.length) out.message = { role, text: clip(`[${tools.slice(0, 4).join(', ')}]`), at: ts, tool: true };
      const u = m.usage;
      // Claude writes the same assistant message once per content block: count each message id once.
      if (role === 'assistant' && u && typeof u === 'object' && ts != null && out.model) {
        const key = m.id ?? o.uuid;
        if (!key || !state.seen?.has(key)) {
          state.seen?.add(key);
          out.usage = { at: ts, model: out.model, tokensIn: num(u.input_tokens) + num(u.cache_creation_input_tokens), tokensOut: num(u.output_tokens) };
        }
      }
    }
  } else {
    const p = o.payload && typeof o.payload === 'object' ? o.payload : null;
    if (o.type === 'session_meta' && p) out.meta = { cwd: typeof p.cwd === 'string' ? p.cwd : undefined, id: p.id };
    else if (o.type === 'turn_context' && p) { if (typeof p.model === 'string') out.model = p.model.slice(0, 80); if (typeof p.cwd === 'string') out.meta = { cwd: p.cwd }; }
    // First version of the Codex file: the lines are the items themselves.
    const item = o.type === 'response_item' ? p : o.type === 'message' ? o : null;
    if (item && item.type === 'message' && (item.role === 'user' || item.role === 'assistant')) {
      const text = textOf(item.content);
      if (text.trim() && !(item.role === 'user' && SYNTHETIC.test(text))) out.message = { role: item.role, text: clip(text), at: ts };
    }
    if (o.type === 'event_msg' && p?.type === 'token_count' && p.info && typeof p.info === 'object' && ts != null) {
      const last = p.info.last_token_usage; const total = JSON.stringify(p.info.total_token_usage ?? null);
      if (last && typeof last === 'object' && total !== state.lastTotal) {
        state.lastTotal = total;
        // Codex's input includes the cached part.
        out.usage = { at: ts, model: state.model ?? null, tokensIn: Math.max(0, num(last.input_tokens) - num(last.cached_input_tokens)), tokensOut: num(last.output_tokens) };
      }
    }
    if (out.model) state.model = out.model;
  }
  return out;
}

const projectOf = (cwd, fallback) => {
  const parts = String(cwd ?? '').split(/[\\/]+/).filter(Boolean);
  return (parts.at(-1) || fallback || '').slice(0, 80);
};
// Claude names the folder of a project from its path («C--orb-project»): the last piece is a fair name when there is no cwd.
const folderProject = (rel) => { const f = rel.split('/')[0] ?? ''; return f.split('-').filter(Boolean).at(-1) ?? f; };
const idOf = (agent, rel) => `${agent}:${crypto.createHash('sha1').update(rel).digest('hex').slice(0, 20)}`;

// ---- the list of old chats
export async function listChats({ agent, q, limit = 200, home } = {}) {
  const roots = rootsOf(home);
  const needle = String(q ?? '').toLowerCase().trim();
  const out = [];
  for (const a of AGENTS) {
    if (agent && agent !== a) continue;
    for (const f of await listFiles(roots[a])) {
      const row = { id: idOf(a, f.rel), agent: a, title: '', project: '', model: null, updatedAt: f.mtimeMs, startedAt: null, messages: 0, size: f.size, partial: f.size > LIMITS.listBytes };
      const state = { seen: new Set() }; let cwd = '';
      const r = await readJsonl(f.file, LIMITS.listBytes, (o) => {
        const p = parseLine(a, o, state);
        if (p.meta?.cwd && !cwd) cwd = p.meta.cwd;
        if (p.model) row.model = p.model;
        if (p.message && !p.message.tool) {
          row.messages += 1;
          if (!row.title && p.message.role === 'user') row.title = oneLine(p.message.text, 90);
          row.startedAt ??= p.message.at;
        }
      });
      if (r.truncated) row.partial = true;
      if (!row.messages) continue; // a file with no conversation in it (only metadata) is not a chat
      row.project = projectOf(cwd, folderProject(f.rel));
      row.title ||= '—';
      if (needle && !`${row.title} ${row.project}`.toLowerCase().includes(needle)) continue;
      out.push(row);
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, Math.max(1, Math.min(Number(limit) || 200, 1000)));
}

// ---- one old chat
export async function readChat(id, { home } = {}) {
  const m = /^(claude|codex):([0-9a-f]{20})$/.exec(String(id ?? ''));
  if (!m) return null;
  const [, a, hash] = m;
  const found = (await listFiles(rootsOf(home)[a])).find((f) => idOf(a, f.rel) === id);
  if (!found) return null;
  const messages = []; const state = { seen: new Set() }; let cwd = ''; let model = null; let cut = false;
  const r = await readJsonl(found.file, LIMITS.readBytes, (o) => {
    const p = parseLine(a, o, state);
    if (p.meta?.cwd && !cwd) cwd = p.meta.cwd;
    if (p.model) model = p.model;
    if (p.message) {
      if (messages.length >= LIMITS.messages) { cut = true; return false; }
      // Consecutive messages of the same speaker with the tool marks only: keep them short, one line each.
      messages.push({ role: p.message.role, text: p.message.text, at: p.message.at, tool: !!p.message.tool });
    }
    return true;
  });
  return { id, agent: a, project: projectOf(cwd, folderProject(found.rel)), model, updatedAt: found.mtimeMs, readOnly: true, messages, truncated: cut || r.truncated, hash };
}

// ---- usage by model, project and hour
const FORMATS = new Map();
function zoned(ts, tz) {
  let f = FORMATS.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short' }); FORMATS.set(tz, f); }
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, weekday: { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[p.weekday] ?? 0 };
}

// Per file: the events (time, model, tokens) and the project; kept while the file does not change.
const CACHE = new Map();
async function eventsOf(agent, f) {
  const key = `${agent}\0${f.file}`;
  const hit = CACHE.get(key);
  if (hit && hit.mtimeMs === f.mtimeMs && hit.size === f.size) return hit;
  const state = { seen: new Set() }; const events = []; let cwd = '';
  const r = await readJsonl(f.file, LIMITS.usageBytes, (o) => {
    const p = parseLine(agent, o, state);
    if (p.meta?.cwd && !cwd) cwd = p.meta.cwd;
    if (p.usage) events.push(p.usage);
  });
  const value = { mtimeMs: f.mtimeMs, size: f.size, events, project: projectOf(cwd, folderProject(f.rel)), truncated: r.truncated };
  if (CACHE.size > 3000) CACHE.clear();
  CACHE.set(key, value);
  return value;
}

export async function usageOf({ days = 30, tz = 'UTC', now = Date.now(), home } = {}) {
  const roots = rootsOf(home);
  const since = now - days * 86_400_000;
  const zero = () => ({ turns: 0, tokensIn: 0, tokensOut: 0 });
  const add = (into, e) => { into.turns += 1; into.tokensIn += e.tokensIn; into.tokensOut += e.tokensOut; return into; };
  const byModel = new Map(); const byProject = new Map(); const total = zero(); let truncated = false; let files = 0;
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const a of AGENTS) {
    for (const f of await listFiles(roots[a])) {
      if (f.mtimeMs < since) continue; // nothing written since the start of the range
      const ev = await eventsOf(a, f);
      files += 1; truncated ||= ev.truncated;
      for (const e of ev.events) {
        if (e.at < since || e.at > now + 86_400_000) continue;
        const model = e.model ?? '';
        add(total, e);
        add(byModel.get(`${a}\0${model}`) ?? byModel.set(`${a}\0${model}`, { agent: a, model: model || null, ...zero() }).get(`${a}\0${model}`), e);
        add(byProject.get(ev.project) ?? byProject.set(ev.project, { project: ev.project, ...zero() }).get(ev.project), e);
        const z = zoned(e.at, tz); heat[z.weekday][z.hour] += 1;
      }
    }
  }
  const most = (x, y) => (y.tokensIn + y.tokensOut) - (x.tokensIn + x.tokensOut) || y.turns - x.turns;
  return { days, total, models: [...byModel.values()].sort(most), projects: [...byProject.values()].sort(most).slice(0, 50), heat, files, truncated };
}
