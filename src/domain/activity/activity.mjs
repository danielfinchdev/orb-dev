// The activity of Orb read on demand: the engine's own logs, the agents' events, what the user did and the app's stderr.
// Nothing here runs by itself: no timers, no watchers, no caches. A call reads each log from its end in blocks, only as far
// as it needs to fill one page, and hands back a cursor to go on.
import fs from 'node:fs';
import path from 'node:path';
import { ctx } from '../../platform/context.mjs';
import { redactSecrets } from '../../shared/secrets-scan.mjs';
import { eventText } from '../tasks/board.mjs';
import { userLogFile } from './user-log.mjs';

export const SOURCES = Object.freeze(['orb', 'subagentes', 'usuario', 'app']);
export const LEVELS = Object.freeze(['info', 'warn', 'error']);
export const BLOCK = 256 * 1024;
export const READ_CAP = 4 * 1024 * 1024; // bytes read per log stream per call
const EVENT_ROWS_CAP = 20_000;
const TEXT_MAX = 2000;
const DONE = 0; // a stream in the cursor with nothing left

// stream → its files (newest generation first) and the source it belongs to
const streams = () => {
  const runs = ctx.paths.runs;
  return {
    asistente: { source: 'orb', files: [path.join(runs, 'asistente.log'), path.join(runs, 'asistente.log.1')] },
    motor: { source: 'orb', files: [path.join(runs, 'motor.log'), path.join(runs, 'motor.log.1')] },
    usuario: { source: 'usuario', files: [userLogFile(), `${userLogFile()}.1`] },
    salida: { source: 'app', files: [path.join(runs, 'motor-salida.log'), path.join(runs, 'motor-salida.1.log')] }
  };
};

const ERROR_RE = /\b(error|fallo|failed|panic[a-z]*|exception|ERR)\b/i;
const WARN_RE = /\b(warn|warning|aviso)\b/i;
const levelOf = (text, explicit) => {
  const e = String(explicit ?? '').toLowerCase();
  if (e === 'error' || e === 'fatal' || e === 'err') return 'error';
  if (e === 'warn' || e === 'warning') return 'warn';
  if (e === 'info' || e === 'debug') return 'info';
  return ERROR_RE.test(text) ? 'error' : WARN_RE.test(text) ? 'warn' : 'info';
};
const FAIL_KIND = /(fail|error|problem|conflict|missed)/i;
const clip = (s, n = TEXT_MAX) => { const r = redactSecrets(typeof s === 'string' ? s : s == null ? '' : JSON.stringify(s)); return r.length > n ? `${r.slice(0, n)}…` : r; };
const ms = (v) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : /^\d+$/.test(String(v)) ? Number(v) : Date.parse(v);
  return Number.isFinite(n) ? n : null;
};

// One log line → an item (without id and position). A JSON line (usuario.log, an agent's message) gives its own fields.
function parseLine(line, source, name) {
  let at = null; let text = line; let json = null;
  const iso = /^(\d{4}-\d\d-\d\dT[\d:.]+Z?)\s+/.exec(line);
  if (iso) { at = iso[1]; text = line.slice(iso[0].length); }
  const brace = text.indexOf('{');
  if (text.endsWith('}') && (source === 'usuario' || (brace >= 0 && brace <= 24))) {
    try { json = JSON.parse(text.slice(brace)); } catch { json = null; }
  }
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const body = json.text ?? json.message ?? text;
    return { at: typeof json.at === 'string' ? json.at : at, level: levelOf(String(body), json.level), project: json.project ?? null, kind: String(json.kind ?? json.type ?? name), text: clip(body), before: json.before, after: json.after };
  }
  return { at, level: levelOf(text), project: null, kind: name, text: clip(text) };
}

// The first bytes of a file identify it across a rotation (a rename keeps them, and later appends do not change them).
// A creation time cannot be used: Windows hands a new file the old one's when it replaces a renamed file. Shorter files have none.
const HEAD = 64;
function headOf(file, fd = null) {
  let own = null;
  try {
    own = fd ?? fs.openSync(file, 'r');
    const buf = Buffer.alloc(HEAD);
    return fs.readSync(own, buf, 0, HEAD, 0) === HEAD ? buf.toString('base64') : null;
  } catch { return null; } finally { if (own != null && fd == null) { try { fs.closeSync(own); } catch { /* closed */ } } }
}

// A cursor remembers the head of the file it stopped in. If the log rotated between two pages, that file now has
// another index (or is gone): follow it, so the next page neither repeats lines nor jumps over the older ones.
function resumePoint(def, from) {
  // A cursor comes from a client: a file index outside the list (or a negative offset) would make the scan loop
  // for as many turns as the number says, so anything but a plain in-range integer restarts from the newest line.
  const sane = Number.isSafeInteger(from?.f) && from.f >= 0 && from.f <= def.files.length && (from.o == null || (Number.isSafeInteger(from.o) && from.o >= 0));
  if (from != null && !sane) return { f: 0, o: null };
  if (from?.h == null) return { f: from?.f ?? 0, o: from?.o ?? null };
  for (let g = 0; g < def.files.length; g += 1) if (headOf(def.files[g]) === from.h) return { f: g, o: from.o ?? null };
  // not found: that file is gone, so go on with the older ones
  return { f: from.f + 1, o: null };
}

// Reads one stream backwards from `from` ({ f: file index, o: end offset, h: file head } or nothing = its very end),
// calling `take(item)` for each line, newest first, until take returns false, `budget` bytes are read or the files end.
// → { end, read }: end is where the next call resumes ({ f, o, h }), or null when the stream is exhausted.
// A line without a time (the assistant's and the app's logs) takes the time of the nearest older line of its file that
// has one, so it sorts next to what happened around it; with none, it sorts last.
export function scanStream(def, from, take, budget = READ_CAP) {
  const start0 = resumePoint(def, from);
  let f = start0.f; let endAt = start0.o; let read = 0;
  while (f < def.files.length) {
    let fd = null;
    try {
      fd = fs.openSync(def.files[f], 'r');
      const st = fs.fstatSync(fd);
      const head = headOf(def.files[f], fd);
      let newerSort = st.mtimeMs; // the time of the newer timed line, for lines that must be flushed before an older one is seen
      const size = st.size;
      let pos = endAt == null || endAt > size ? size : endAt;
      const startPos = pos;
      let lastStart = pos; let carry = Buffer.alloc(0);
      const pending = []; // timeless lines waiting for the older timed line that dates them
      // → the position to stop at when take refuses an item
      const flush = (time) => {
        for (const p of pending.splice(0)) { p.sort = time; if (take(p) === false) return p.pos; }
        return null;
      };
      while (pos > 0) {
        if (read >= budget) {
          const stopped = flush(newerSort); if (stopped) return { end: stopped, read };
          // inside a line longer than the whole budget nothing completed: resume where the read got to, so the next
          // call cannot start at the same place for ever (that line's tail is skipped)
          return { end: { f, o: lastStart < startPos ? lastStart : pos, h: head }, read };
        }
        const start = Math.max(0, pos - BLOCK);
        const block = Buffer.alloc(pos - start);
        const got = fs.readSync(fd, block, 0, block.length, start); read += got;
        const data = Buffer.concat([block.subarray(0, got), carry]);
        let body = data; let bodyStart = start; carry = Buffer.alloc(0);
        if (start > 0) {
          const nl = data.indexOf(0x0A);
          // a line longer than the block: keep growing backwards until its start
          if (nl < 0) { carry = data; pos = start; continue; }
          carry = data.subarray(0, nl); body = data.subarray(nl + 1); bodyStart = start + nl + 1;
        }
        pos = start;
        let stop = body.length;
        while (stop > 0) {
          const nl = body.lastIndexOf(0x0A, stop - 1);
          // a newline closing the line is not the start of an empty one
          if (nl === stop - 1) { stop -= 1; continue; }
          const lineStart = nl + 1;
          const raw = body.subarray(lineStart, stop).toString('utf8').replace(/\r$/, '');
          const offset = bodyStart + lineStart;
          if (raw.trim()) {
            const item = parseLine(raw, def.source, def.name);
            item.file = path.basename(def.files[f]); item.offset = offset; item.pos = { f, o: offset, h: head };
            const t = ms(item.at);
            if (t == null) pending.push(item);
            else {
              newerSort = t;
              const stopped = flush(t); if (stopped) return { end: stopped, read };
              item.sort = t;
              if (take(item) === false) return { end: item.pos, read };
            }
          }
          lastStart = offset;
          stop = nl < 0 ? 0 : nl;
        }
        if (start === 0) break;
      }
      const stopped = flush(0); if (stopped) return { end: stopped, read };
    } catch { /* a missing or rotated file: on to the previous generation */ }
    finally { if (fd != null) { try { fs.closeSync(fd); } catch { /* closed */ } } }
    f += 1; endAt = null;
  }
  return { end: null, read };
}

const encodeCursor = (c) => Buffer.from(JSON.stringify(c)).toString('base64url');
function decodeCursor(s) {
  if (!s) return {};
  try { const v = JSON.parse(Buffer.from(String(s), 'base64url').toString('utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}

function matcher(p) {
  const min = Math.max(0, LEVELS.indexOf(p.level));
  const needle = String(p.q ?? '').toLowerCase().trim();
  const from = ms(p.from); const to = ms(p.to);
  return (it) => {
    if (LEVELS.indexOf(it.level) < min) return false;
    if (p.project && it.project !== p.project) return false;
    if (from != null || to != null) {
      const t = ms(it.at) ?? it.sort; // a line without a time is placed by the one it was dated with
      if (t == null || (from != null && t < from) || (to != null && t > to)) return false;
    }
    if (needle && !`${it.kind} ${it.text} ${it.project ?? ''} ${it.before ?? ''} ${it.after ?? ''}`.toLowerCase().includes(needle)) return false;
    return true;
  };
}

// → { items, next }: newest first, `next` a cursor for the following page (null at the end). `stats` receives the bytes read.
export function readActivity(board, params = {}, stats = {}) {
  const limit = Math.min(500, Math.max(1, Math.trunc(Number(params.limit)) || 100));
  const want = new Set(Array.isArray(params.sources) && params.sources.length ? params.sources.filter((s) => SOURCES.includes(s)) : SOURCES);
  const match = matcher(params);
  const cursor = decodeCursor(params.cursor);
  stats.bytes = 0; stats.rows = 0;
  const got = {}; // stream → { list, end }

  for (const [name, def] of Object.entries(streams())) {
    if (!want.has(def.source) || cursor[name] === DONE) continue;
    const list = [];
    const r = scanStream({ ...def, name }, cursor[name], (raw) => {
      const it = { ...raw, source: def.source, id: `${def.source}:${raw.file}:${raw.offset}`, stream: name };
      if (match(it)) list.push(it);
      return list.length < limit;
    });
    stats.bytes += r.read;
    got[name] = { list, end: r.end };
  }

  if (want.has('subagentes') && cursor.events !== DONE) {
    const list = [];
    let before = Number.isFinite(cursor.events) ? cursor.events : null;
    let end = null; let scanned = 0; let exhausted = false;
    outer: while (scanned < EVENT_ROWS_CAP) {
      let rows = [];
      try {
        rows = before == null
          ? board.all('SELECT e.id, e.actor, e.kind, e.detail, e.at, t.title, t.project FROM events e LEFT JOIN tasks t ON t.id = e.task_id ORDER BY e.id DESC LIMIT 500')
          : board.all('SELECT e.id, e.actor, e.kind, e.detail, e.at, t.title, t.project FROM events e LEFT JOIN tasks t ON t.id = e.task_id WHERE e.id < ? ORDER BY e.id DESC LIMIT 500', before);
      } catch { rows = []; }
      for (const e of rows) {
        scanned += 1; before = e.id;
        const detail = eventText(e.detail);
        const failed = FAIL_KIND.test(e.kind) || (e.kind === 'task.updated' && /^failed$/i.test(String(e.detail)));
        const text = clip(`${e.actor}${e.title ? ` · ${e.title}` : ''}${detail ? ` · ${detail}` : ''}`);
        const it = { id: `events:${e.id}`, at: e.at ?? null, sort: ms(e.at) ?? 0, source: 'subagentes', level: failed ? 'error' : levelOf(text, 'info'), project: e.project ?? null, kind: e.kind, text, stream: 'events', pos: e.id };
        if (match(it)) { list.push(it); if (list.length >= limit) { end = e.id; break outer; } }
      }
      // fewer rows than asked: the table is over, so no stale resume point may be kept (a page would repeat)
      if (rows.length < 500) { end = null; exhausted = true; break; }
      end = before;
    }
    if (end == null && !exhausted && scanned >= EVENT_ROWS_CAP) end = before;
    stats.rows = scanned;
    got.events = { list, end };
  }

  // newest first, taking from every stream the ones that come first by time
  const all = Object.values(got).flatMap((g) => g.list).sort((a, b) => b.sort - a.sort);
  const items = all.slice(0, limit);
  const emitted = new Set(items);

  // where each stream resumes: after the last item of it in this page; after all it scanned if it gave none
  // because nothing matched; unchanged if its matches were all newer-than-page leftovers.
  const next = { ...cursor };
  for (const [name, { list, end }] of Object.entries(got)) {
    const given = list.filter((it) => emitted.has(it));
    if (!list.length) next[name] = end ?? DONE;
    else if (!given.length) next[name] = cursor[name] ?? { f: 0, o: null };
    else if (given.length === list.length) next[name] = end ?? DONE;
    else next[name] = given.at(-1).pos;
  }
  const more = Object.entries(got).some(([name]) => next[name] !== DONE);
  const publicItems = items.map(({ sort, stream, pos, offset, file, before: b, after: a, ...it }) => ({ ...it, ...(b !== undefined ? { before: clip(b) } : {}), ...(a !== undefined ? { after: clip(a) } : {}) }));
  return { items: publicItems, next: more ? encodeCursor(next) : null };
}

// Paths of this PC: the phone gets places, not folders.
export function hidePcPaths(text) {
  const swap = (s, from, to) => (from ? s.split(from).join(to) : s);
  const home = ctx.home ? String(ctx.home) : '';
  const user = process.env.USERPROFILE || process.env.HOME || '';
  let out = String(text ?? '');
  out = swap(out, home, '<Orb>'); out = swap(out, home.replaceAll(String.fromCharCode(92), '/'), '<Orb>');
  out = swap(out, user, '~'); out = swap(out, user.replaceAll(String.fromCharCode(92), '/'), '~');
  return out;
}

// Text for an issue or an agent: the last `lines` items up to `at`, oldest first, secrets hidden twice.
const REPORT_MAX = 60 * 1024;
export function buildReport(board, { at, lines, version, remote = false, filters = {} } = {}) {
  const n = Math.min(500, Math.max(1, Math.trunc(Number(lines)) || 100));
  const until = ms(at) ?? Date.now();
  const { items } = readActivity(board, { limit: n, to: until, ...filters });
  const toText = (it) => `[${it.at ?? 'sin hora'}] [${it.source}] [${it.level}] ${it.project ?? '-'} ${it.text}`.replace(/\r?\n/g, ' ');
  const head = [`Orb ${version ?? '?'} · ${process.platform} ${process.arch}`, `Generado: ${new Date().toISOString()}`, `Hasta: ${new Date(until).toISOString()} · líneas: ${n}${Object.keys(filters).length ? ` · filtros: ${JSON.stringify(filters)}` : ''}`, ''];
  const body = items.slice().reverse().map(toText).join('\n');
  const header = head.join('\n');
  // over the limit the oldest lines go, not the header
  const room = Math.max(0, REPORT_MAX - header.length - 1);
  let text = `${header}\n${body.length > room ? body.slice(body.length - room).replace(/^[^\n]*\n/, '') : body}`;
  text = redactSecrets(text);
  // paths of this PC: the phone gets places, not folders
  if (remote) text = hidePcPaths(text);
  return { text };
}
