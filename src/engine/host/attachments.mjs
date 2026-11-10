// 3.8.2: «Adjuntar» takes any file. Each one is copied into the conversation's own folder (<folder>\.orb-adjuntos\<stamp>\,
// kept out of git), where every agent of that chat may read it, and Orb tells the agent what it is and how to use it:
// pictures go natively to the agents that read them; a video becomes a few frames (and a transcript when this PC can
// make one); a PDF or an office document, its text; anything else, its path and what Orb knows about it.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { ctx, tr } from '../../platform/context.mjs';
import { isOrbData } from '../../domain/security/guard.mjs';
import { fingerprints } from './android.mjs';
import { kindOf } from '../../shared/attach-kind.mjs';

export { kindOf };

export const ATTACH_DIR = '.orb-adjuntos';
export const ATTACH_COUNT = 10;
export const ATTACH_MAX = 100 * 1024 * 1024; // per file
const NATIVE_MAX = 5 * 1024 * 1024; // a picture larger than this goes by its path (the agents' APIs refuse bigger ones)
const NATIVE_COUNT = 20;
const TEXT_MAX = 2 * 1024 * 1024; // extracted text kept, at most
const FRAMES_EVEN = 6;
const FRAMES_SCENE = 4;
const SCENE_MAX_S = 180; // scene detection decodes the whole video: only for short ones

const NATIVE_IMAGE = /\.(png|jpe?g|gif|webp)$/i;
const safeName = (name) => (path.basename(name).replace(/[^\w.-]+/g, '_').replace(/^\.+/, '') || 'adjunto').slice(0, 120);

// Copies the files into <cwd>\.orb-adjuntos\<stamp>\. → [{ path, name, kind, size }]
// Never a folder, a link, a file over the limit, one of Orb's own (core\datos and the like) or a protected one; and never
// into a folder that is Orb's own data.
export function placeAttachments(files, cwd, { now = Date.now(), internalDir = ctx.paths?.internal } = {}) {
  const list = (files ?? []).slice(0, ATTACH_COUNT);
  if (!list.length) return [];
  if (!cwd || isOrbData(cwd, internalDir, null)) throw new Error(tr('msg.sessions.attachNoPlace'));
  const checked = list.map((file) => {
    let st; try { st = fs.lstatSync(file); } catch { throw new Error(tr('msg.sessions.noAttachment', { file })); }
    if (!st.isFile() || st.isSymbolicLink()) throw new Error(tr('msg.sessions.attachNotFile', { file }));
    if (st.size > ATTACH_MAX) throw new Error(tr('msg.sessions.attachTooBig', { name: path.basename(file), max: ATTACH_MAX / 1024 / 1024 }));
    if (isOrbData(file, internalDir, null, { read: true })) throw new Error(tr('msg.sessions.attachOrbData', { name: path.basename(file) }));
    return { file, size: st.size };
  });
  const dir = path.join(cwd, ATTACH_DIR, String(now));
  fs.mkdirSync(dir, { recursive: true });
  const taken = new Set();
  return checked.map(({ file, size }) => {
    let name = safeName(file);
    for (let i = 2; taken.has(name.toLowerCase()); i++) { const ext = path.extname(name); name = `${path.basename(name, ext)}-${i}${ext}`; }
    taken.add(name.toLowerCase());
    const target = path.join(dir, name);
    fs.copyFileSync(file, target);
    return { path: target, name, kind: kindOf(name), size };
  });
}

// ---- Text out of PDFs and office documents (no extra dependencies; the original is always there too) ----

// The files of a zip (docx, xlsx, pptx, odt…): name → () => Buffer. Bounded, so a zip bomb cannot fill the memory: maxOut
// is for all the files read together (3.8.2 final review: an epub or pptx of many entries each just under it, too).
export function zipEntries(buf, { maxOut = 64 * 1024 * 1024 } = {}) {
  const out = new Map();
  let left = maxOut;
  const spend = (b) => { if (b.length > left) { left = 0; return Buffer.alloc(0); } left -= b.length; return b; };
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return out;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length && buf.readUInt32LE(p) === 0x02014b50; n++) {
    const method = buf.readUInt16LE(p + 10); const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28); const extra = buf.readUInt16LE(p + 30); const comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extra + comment;
    out.set(name, () => {
      if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) return Buffer.alloc(0);
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      if (left <= 0) return Buffer.alloc(0);
      if (method === 0) return spend(data);
      if (method === 8) { try { return spend(zlib.inflateRawSync(data, { maxOutputLength: left })); } catch { left = 0; return Buffer.alloc(0); } }
      return Buffer.alloc(0);
    });
  }
  return out;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decodeEntities = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)); try { return String.fromCodePoint(n); } catch { return m; } }
  return ENTITIES[e.toLowerCase()] ?? m;
});
// The words of an office XML: one line per paragraph, cell or row.
export function xmlText(xml) {
  return decodeEntities(String(xml)
    .replace(/<(w:tab|w:br|a:br|text:tab|text:line-break)\b[^>]*\/>/g, (m) => (/tab/.test(m) ? '\t' : '\n'))
    .replace(/<\/(w:p|a:p|text:p|text:h|si|row|table:table-row)>/g, '\n')
    .replace(/<\/(c|table:table-cell)>/g, '\t')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const byNumber = (re) => (a, b) => Number(a.match(re)?.[1] ?? 0) - Number(b.match(re)?.[1] ?? 0);
function officeText(buf, ext) {
  const z = zipEntries(buf);
  const read = (name) => (z.has(name) ? z.get(name)().toString('utf8') : '');
  if (ext === 'docx') return xmlText(read('word/document.xml'));
  if (ext === 'pptx') {
    const re = /slide(\d+)\.xml$/;
    return [...z.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(byNumber(re))
      .map((n, i) => `--- ${i + 1} ---\n${xmlText(read(n))}`).join('\n\n');
  }
  if (ext === 'xlsx') {
    const re = /sheet(\d+)\.xml$/;
    const shared = [...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText(m[1]));
    return [...z.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort(byNumber(re)).map((n, i) => {
      const rows = [...read(n).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((r) => [...r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
        const v = c[2]?.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? c[2]?.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? '';
        return /t="s"/.test(c[1]) ? shared[Number(v)] ?? '' : decodeEntities(v);
      }).join('\t'));
      return `--- ${i + 1} ---\n${rows.join('\n')}`;
    }).join('\n\n');
  }
  if (['odt', 'ods', 'odp'].includes(ext)) return xmlText(read('content.xml'));
  if (ext === 'epub') return [...z.keys()].filter((n) => /\.x?html?$/i.test(n)).sort().map((n) => xmlText(read(n).replace(/<\/(p|h\d|li|div)>/g, '</text:p>'))).join('\n\n');
  return '';
}

function rtfText(raw) {
  return raw.replace(/\{\\\*[^{}]*\}/g, '').replace(/\\par[d]?\b ?/g, '\n').replace(/\\tab\b ?/g, '\t')
    .replace(/\\'([0-9a-f]{2})/gi, (_m, h) => Buffer.from([parseInt(h, 16)]).toString('latin1'))
    .replace(/\\u(-?\d+)\??/g, (_m, n) => String.fromCharCode((Number(n) + 65536) % 65536))
    .replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

// The text a PDF shows, best effort: its content streams (inflated when compressed) and the strings of their text
// operators. PDFs whose fonts use their own encodings come out unreadable; then there is no text (looksLikeText).
function pdfString(s) {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_m, e) => ({ n: '\n', r: '', t: '\t', b: '', f: '', '(': '(', ')': ')', '\\': '\\' }[e] ?? String.fromCharCode(parseInt(e, 8))));
}
function pdfHex(h) {
  const b = Buffer.from(h.replace(/\s+/g, '').padEnd(Math.ceil(h.replace(/\s+/g, '').length / 2) * 2, '0'), 'hex');
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return b.subarray(2).swap16().toString('utf16le');
  return b.toString('latin1');
}
export function pdfText(buf) {
  const raw = buf.toString('latin1');
  const parts = [];
  const re = /<<([\s\S]{0,2000}?)>>\s*stream\r?\n/g;
  let m;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    re.lastIndex = end;
    if (/\/Subtype\s*\/(Image|XML)|\/Type\s*\/(XObject|Metadata|XRef|ObjStm)|\/Length1/.test(m[1])) continue;
    let data = buf.subarray(start, end);
    if (/\/FlateDecode/.test(m[1])) { try { data = zlib.inflateSync(data, { maxOutputLength: 32 * 1024 * 1024 }); } catch { try { data = zlib.inflateSync(data.subarray(0, data.length - 1)); } catch { continue; } } }
    else if (/\/Filter/.test(m[1])) continue;
    const s = data.toString('latin1');
    if (!/\bBT\b/.test(s)) continue;
    for (const block of s.match(/BT[\s\S]*?ET/g) ?? []) {
      let line = '';
      for (const op of block.matchAll(/\[((?:[^\]\\]|\\.)*)\]\s*TJ|\(((?:[^()\\]|\\.)*)\)\s*(?:Tj|'|")|<([0-9a-fA-F\s]+)>\s*Tj|(T\*|Td|TD|Tm)/g)) {
        if (op[4]) { if (op[4] !== 'Tm' || line) line += '\n'; continue; }
        if (op[2] != null) line += pdfString(op[2]);
        else if (op[3] != null) line += pdfHex(op[3]);
        else for (const piece of op[1].matchAll(/\(((?:[^()\\]|\\.)*)\)|<([0-9a-fA-F\s]+)>|(-?\d+(?:\.\d+)?)/g)) {
          if (piece[1] != null) line += pdfString(piece[1]); else if (piece[2] != null) line += pdfHex(piece[2]); else if (Number(piece[3]) < -200) line += ' ';
        }
      }
      parts.push(line);
    }
  }
  return parts.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
// Mostly letters, digits, spaces and punctuation: real text, not the codes of a font.
export const looksLikeText = (s) => {
  const t = String(s ?? '').slice(0, 20_000);
  if (t.replace(/\s/g, '').length < 20) return false;
  const good = (t.match(/[\p{L}\p{N}\s.,;:!?¿¡'"()\-–—%€$@/]/gu) ?? []).length;
  return good / t.length > 0.85;
};

// The text of a PDF or a document. → string ('' when there is none or it cannot be read)
export function extractText(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  let buf; try { buf = fs.readFileSync(file); } catch { return ''; }
  let text = '';
  try {
    if (ext === 'pdf') text = pdfText(buf);
    else if (ext === 'rtf') text = rtfText(buf.toString('latin1'));
    else text = officeText(buf, ext);
  } catch { text = ''; }
  return looksLikeText(text) ? text.slice(0, TEXT_MAX) : '';
}

// ---- Video and audio: ffmpeg (and a transcript only with a local speech-to-text program) ----

// ffmpeg 7.1.1 essentials (Gyan Doshi's Windows build, also published on GitHub; checked 2026-11-09). Downloaded the first
// time a video is attached, when this PC has no ffmpeg of its own. A newer version needs a new pin here.
export const FFMPEG = Object.freeze({
  win32: {
    url: 'https://github.com/GyanD/codexffmpeg/releases/download/7.1.1/ffmpeg-7.1.1-essentials_build.zip',
    size: 92234348, sha1: '637c9520ccd3f85b3ce3e0fe4525654e87e3df7e', sha256: '04861d3339c5ebe38b56c19a15cf2c0cc97f5de4fa8910e4d47e5e6404e4a2d4',
    member: 'ffmpeg-7.1.1-essentials_build/bin/ffmpeg.exe', exeSha256: 'b90225987bdd042cca09a1efb5e34e9848f2d1dbf5fbcd388753a44145522997'
  }
});
const exe = (name) => (process.platform === 'win32' ? `${name}.exe` : name);
export const ffmpegDir = () => path.join(ctx.paths.tools, 'ffmpeg');
const ffmpegPrints = () => path.join(ctx.paths.data, 'ffmpeg-huellas.json');
// Tests (fake agents) and ORB_NO_DOWNLOADS=1 never download.
const downloadsOff = () => process.env.ORB_NO_DOWNLOADS === '1' || Boolean(process.env.ORB_FAKE_AGENTS);

// A program in PATH (with Windows' PATHEXT), or null.
export function inPath(name, env = process.env) {
  const exts = process.platform === 'win32' ? (env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean) : [''];
  for (const dir of String(env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)) {
    for (const e of exts) { const f = path.join(dir, `${name}${e.toLowerCase()}`); try { if (fs.statSync(f).isFile()) return f; } catch { /* not here */ } }
  }
  return null;
}

// Orb's own ffmpeg, only when it is exactly what Orb downloaded (as adb: core\herramientas\ffmpeg is read-only for agents).
function ownFfmpeg() {
  const file = path.join(ffmpegDir(), exe('ffmpeg'));
  if (!fs.existsSync(file)) return null;
  let want; try { want = JSON.parse(fs.readFileSync(ffmpegPrints(), 'utf8')).files; } catch { return null; }
  let have; try { have = fingerprints(ffmpegDir()); } catch { return null; }
  const a = Object.keys(want ?? {});
  return a.length && a.length === Object.keys(have).length && a.every((k) => have[k] === want[k]) ? file : null;
}

let fetching = null;
async function downloadFfmpeg(pin, fetchImpl, log) {
  const work = path.join(ctx.paths.internal, 'descargas', `ffmpeg-${crypto.randomBytes(4).toString('hex')}`);
  try {
    fs.mkdirSync(work, { recursive: true });
    const res = await fetchImpl(pin.url, { signal: AbortSignal.timeout(600_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length !== pin.size || crypto.createHash('sha1').update(buf).digest('hex') !== pin.sha1 || crypto.createHash('sha256').update(buf).digest('hex') !== pin.sha256) throw new Error('hash');
    const zip = path.join(work, 'ffmpeg.zip'); fs.writeFileSync(zip, buf);
    const out = path.join(work, 'x'); fs.mkdirSync(out);
    const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
    spawnSync(path.join(system32, 'tar.exe'), ['-xf', zip, '-C', out, pin.member], { windowsHide: true, timeout: 180_000 });
    const got = path.join(out, ...pin.member.split('/'));
    if (!fs.existsSync(got) || crypto.createHash('sha256').update(fs.readFileSync(got)).digest('hex') !== pin.exeSha256) throw new Error('exe');
    fs.rmSync(ffmpegDir(), { recursive: true, force: true });
    fs.mkdirSync(ffmpegDir(), { recursive: true });
    fs.copyFileSync(got, path.join(ffmpegDir(), exe('ffmpeg')));
    fs.mkdirSync(ctx.paths.data, { recursive: true });
    fs.writeFileSync(ffmpegPrints(), JSON.stringify({ version: pin.url, files: fingerprints(ffmpegDir()) }));
    log(`adjuntos: ffmpeg descargado y comprobado en ${ffmpegDir()}`);
    return path.join(ffmpegDir(), exe('ffmpeg'));
  } catch (error) {
    log(`adjuntos: no se pudo descargar ffmpeg: ${error.message}`);
    return null;
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}

// The ffmpeg to use: Orb's own (checked), the one in PATH, or (Windows) Orb's downloaded now. → path or null
export async function findFfmpeg({ fetchImpl = null, pin = FFMPEG[process.platform], log = () => {} } = {}) {
  const own = ctx.paths ? ownFfmpeg() : null;
  if (own) return own;
  const found = inPath('ffmpeg');
  if (found) return found;
  if (!pin || (downloadsOff() && !fetchImpl)) return null;
  fetching ??= downloadFfmpeg(pin, fetchImpl ?? globalThis.fetch, log).finally(() => { fetching = null; });
  return fetching;
}

const run = (cmd, args, { timeoutMs = 120_000 } = {}) => new Promise((resolve) => {
  let err = ''; let done = false;
  let child;
  try { child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] }); } catch (error) { resolve({ code: -1, err: error.message }); return; }
  const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, timeoutMs);
  child.stderr.on('data', (d) => { if (err.length < 200_000) err += d; });
  const end = (code) => { if (done) return; done = true; clearTimeout(timer); resolve({ code, err }); };
  child.on('error', (e) => { err += e.message; end(-1); });
  child.on('close', end);
});

// What ffmpeg says about a file: its length (s) and whether it has sound.
export function probeInfo(stderr) {
  const d = String(stderr).match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return { duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : null, audio: /Stream #\d+:\d+.*?: Audio:/.test(stderr), video: /Stream #\d+:\d+.*?: Video:/.test(stderr) };
}
// The moments for the evenly spaced frames (not the very start or end).
export const evenTimes = (duration, n = FRAMES_EVEN) => (duration > 0 ? Array.from({ length: n }, (_v, i) => Math.round(((i + 0.5) * duration / n) * 100) / 100) : [0]);
const stamp = (s) => `${Math.floor(s / 60)}m${String(Math.floor(s % 60)).padStart(2, '0')}s`;

// A few frames of a video into <file>-fotogramas\. → { dir, frames: [paths], duration, audio }
export async function extractFrames(file, ffmpeg, { runImpl = run } = {}) {
  const info = probeInfo((await runImpl(ffmpeg, ['-hide_banner', '-i', file], { timeoutMs: 30_000 })).err);
  const dir = `${file}-fotogramas`;
  fs.mkdirSync(dir, { recursive: true });
  const scale = "scale='min(1280,iw)':-2";
  const frames = [];
  for (const [i, t] of evenTimes(info.duration).entries()) {
    const out = path.join(dir, `${String(i + 1).padStart(2, '0')}-${stamp(t)}.jpg`);
    await runImpl(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', scale, '-q:v', '4', out], { timeoutMs: 30_000 });
    if (fs.existsSync(out)) frames.push(out);
  }
  // Scene changes too, when cheap (a short video): what the evenly spaced frames may miss.
  if (info.duration && info.duration <= SCENE_MAX_S) {
    const pattern = path.join(dir, 'escena-%02d.jpg');
    await runImpl(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-vf', `select='gt(scene,0.4)',${scale}`, '-vsync', 'vfr', '-frames:v', String(FRAMES_SCENE), '-q:v', '4', pattern], { timeoutMs: 60_000 });
    for (let i = 1; i <= FRAMES_SCENE; i++) { const f = path.join(dir, `escena-${String(i).padStart(2, '0')}.jpg`); if (fs.existsSync(f)) frames.push(f); }
  }
  return { dir, frames, duration: info.duration, audio: info.audio };
}

// A transcript of the sound, only with a speech-to-text program already on this PC (OpenAI's whisper in PATH). Orb does
// not bring one (too heavy): without it, the agent is told so. → path of the .txt or null
export async function transcribe(file, { whisper = inPath('whisper'), runImpl = run } = {}) {
  if (!whisper) return null;
  const dir = `${file}-transcripcion`;
  fs.mkdirSync(dir, { recursive: true });
  await runImpl(whisper, [file, '--model', 'base', '--output_format', 'txt', '--output_dir', dir], { timeoutMs: 15 * 60_000 });
  const txt = path.join(dir, `${path.basename(file, path.extname(file))}.txt`);
  return fs.existsSync(txt) && fs.statSync(txt).size > 0 ? txt : null;
}

// ---- What the agent receives ----

const mb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

// For one turn: what each attachment becomes. → { images: [paths for agents that read pictures], text: block for the prompt }
// deps (tests): ffmpeg (a path, null for none, or undefined to look for one), whisper, runImpl, extract.
export async function prepareAttachments(list, { nativeImages = false, deps = {}, log = () => {} } = {}) {
  if (!list?.length) return { images: [], text: '' };
  const images = [];
  const lines = [];
  let ffmpeg = deps.ffmpeg;
  const getFfmpeg = async () => { if (ffmpeg === undefined) ffmpeg = await findFfmpeg({ log }); return ffmpeg; };
  const native = (f) => { if (nativeImages && images.length < NATIVE_COUNT) { images.push(f); return true; } return false; };
  for (const a of list) {
    const head = `- ${a.name} (${tr(`sys.attach.kind.${a.kind}`)}, ${mb(a.size)}): ${a.path}`;
    const notes = [];
    try {
      if (a.kind === 'image') {
        if (!(NATIVE_IMAGE.test(a.name) && a.size <= NATIVE_MAX && native(a.path))) notes.push(tr('sys.attach.openImage'));
      } else if (a.kind === 'pdf' || a.kind === 'document') {
        const text = (deps.extract ?? extractText)(a.path);
        if (text) { const txt = `${a.path}.txt`; fs.writeFileSync(txt, text); notes.push(tr('sys.attach.textAt', { path: txt, n: text.length })); }
        else notes.push(tr('sys.attach.noText'));
      } else if (a.kind === 'video' || a.kind === 'audio') {
        const ff = await getFfmpeg();
        let hasAudio = a.kind === 'audio';
        if (a.kind === 'video') {
          if (ff) {
            const v = await extractFrames(a.path, ff, { runImpl: deps.runImpl });
            hasAudio = v.audio;
            if (v.duration) notes.push(tr('sys.attach.duration', { time: clock(v.duration) }));
            if (v.frames.length) { const inline = v.frames.filter((f) => native(f)).length; notes.push(tr(inline ? 'sys.attach.framesSent' : 'sys.attach.framesAt', { n: v.frames.length, dir: v.dir })); }
            else notes.push(tr('sys.attach.noFrames'));
          } else notes.push(tr('sys.attach.noFfmpeg'));
        }
        if (hasAudio) {
          const said = await transcribe(a.path, { whisper: deps.whisper === undefined ? inPath('whisper') : deps.whisper, runImpl: deps.runImpl });
          notes.push(said ? tr('sys.attach.transcriptAt', { path: said }) : tr('sys.attach.noTranscript'));
        }
      } else if (a.kind === 'text') notes.push(tr('sys.attach.readText'));
      else if (a.kind === 'archive') notes.push(tr('sys.attach.archive'));
      else notes.push(tr('sys.attach.unknown'));
    } catch (error) { log(`adjunto ${a.name}: ${error.message}`); notes.push(tr('sys.attach.failed')); }
    lines.push(notes.length ? `${head}\n  ${notes.join('\n  ')}` : head);
  }
  return { images, text: `${tr('sys.attach.header')}\n${lines.join('\n')}` };
}
