// 3.5/3.7: .tar.gz without the system's tar. Writing (ustar with pax names, so the Linux permissions are exact when the
// package is made on Windows), reading a small one in memory, and unpacking a big one as a stream (an agent engine from
// npm is hundreds of MB unpacked: never whole in memory, Orb Server runs within 512 MB).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const block = (n) => Math.ceil(n / 512) * 512;
function header(name, { size = 0, mode = 0o644, type = '0', mtime = 0, linkname = '' }) {
  const h = Buffer.alloc(512);
  const put = (s, off, len) => { Buffer.from(s, 'utf8').copy(h, off, 0, len); };
  const oct = (v, off, len) => put(v.toString(8).padStart(len - 1, '0') + '\0', off, len);
  put(name, 0, 100); oct(mode, 100, 8); oct(0, 108, 8); oct(0, 116, 8); oct(size, 124, 12); oct(mtime, 136, 12);
  h.fill(' ', 148, 156); put(type, 156, 1); put(linkname, 157, 100); put('ustar\0', 257, 6); put('00', 263, 2);
  put('root', 265, 32); put('root', 297, 32);
  let sum = 0; for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return h;
}
function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`; let len = Buffer.byteLength(body) + 1;
  while (String(len).length + Buffer.byteLength(body) !== len) len = String(len).length + Buffer.byteLength(body);
  return `${len}${body}`;
}
// entries: [{ name, mode, data?: Buffer, file?: absolute path, dir?: true }] → the .tar.gz at out.
export async function writeTarGz(out, entries, { mtime = Math.floor(Date.now() / 1000) } = {}) {
  async function* chunks() {
    for (const e of entries) {
      const name = e.dir ? `${e.name.replace(/\/$/, '')}/` : e.name;
      const data = e.dir ? Buffer.alloc(0) : (e.data ?? fs.readFileSync(e.file));
      if (Buffer.byteLength(name) > 100) {
        const pax = Buffer.from(paxRecord('path', name), 'utf8');
        yield header('PaxHeader/x', { size: pax.length, type: 'x', mtime });
        yield Buffer.concat([pax, Buffer.alloc(block(pax.length) - pax.length)]);
      }
      yield header(name.slice(0, 100), { size: data.length, mode: e.mode ?? (e.dir ? 0o755 : 0o644), type: e.dir ? '5' : '0', mtime });
      if (data.length) { yield data; const pad = block(data.length) - data.length; if (pad) yield Buffer.alloc(pad); }
    }
    yield Buffer.alloc(1024);
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await pipeline(Readable.from(chunks()), zlib.createGzip({ level: 9 }), fs.createWriteStream(out));
}

const parseHeader = (h) => {
  const str = (a, l) => h.subarray(a, a + l).toString('utf8').replace(/\0.*$/s, '');
  const size = parseInt(str(124, 12).trim() || '0', 8); const type = str(156, 1) || '0';
  const prefix = str(345, 155); const name = prefix ? `${prefix}/${str(0, 100)}` : str(0, 100);
  return { size, type, name, mode: parseInt(str(100, 8).trim() || '0', 8), linkname: str(157, 100) };
};

// The files of a small .tar.gz (pax names understood): [{ name, mode, type, data }]. Only regular files and directories.
export function readTarGz(file) {
  const buf = zlib.gunzipSync(fs.readFileSync(file));
  const list = []; let off = 0; let paxName = null;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const x = parseHeader(h); let { name } = x;
    const data = buf.subarray(off + 512, off + 512 + x.size);
    off += 512 + block(x.size);
    if (x.type === 'x') { const m = data.toString('utf8').match(/\d+ path=([^\n]*)\n/); paxName = m ? m[1] : null; continue; }
    if (x.type === 'L') { paxName = data.toString('utf8').replace(/\0.*$/s, ''); continue; } // GNU long name
    if (x.type === 'g') continue;
    if (paxName) { name = paxName; paxName = null; }
    list.push({ name, mode: x.mode, type: x.type, data, linkname: x.linkname });
  }
  return list;
}

// A name from an archive, made safe: relative, no «..», no drive, `strip` leading folders dropped. null: skip it.
export function safeName(name, strip = 0) {
  const parts = String(name).replace(/\\/g, '/').split('/').filter((p) => p && p !== '.');
  if (parts.some((p) => p === '..') || /^[A-Za-z]:/.test(parts[0] ?? '') || String(name).startsWith('/')) return null;
  const rest = parts.slice(strip);
  return rest.length ? rest.join('/') : null;
}

// Unpacks a .tar.gz into dest as a stream. Only files and folders (links and devices are skipped), never outside dest,
// with their x bit kept. strip: leading folders dropped (npm's «package/»). maxBytes: refuse an archive that unpacks to
// more than this. → { files, bytes }
export async function extractTarGz(file, dest, { strip = 0, maxBytes = 2 * 1024 ** 3 } = {}) {
  fs.mkdirSync(dest, { recursive: true });
  const root = path.resolve(dest);
  const gunzip = fs.createReadStream(file).pipe(zlib.createGunzip());
  let buf = Buffer.alloc(0); let state = null; let paxName = null; let files = 0; let bytes = 0; let done = false;
  const target = (name) => { const safe = safeName(name, strip); if (!safe) return null; const full = path.resolve(root, ...safe.split('/')); return full.startsWith(root + path.sep) ? full : null; };
  try {
    for await (const chunk of gunzip) {
      if (done) continue;
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      while (!done) {
        if (!state) {
          if (buf.length < 512) break;
          const h = buf.subarray(0, 512); buf = buf.subarray(512);
          if (h.every((b) => b === 0)) { done = true; break; }
          const x = parseHeader(h);
          if (paxName && x.type !== 'x' && x.type !== 'L') { x.name = paxName; paxName = null; }
          state = { ...x, left: x.size, pad: block(x.size) - x.size, fd: null, meta: (x.type === 'x' || x.type === 'L') ? [] : null };
          if (x.type === '0' || x.type === '\0' || x.type === '7') {
            const out = target(x.name);
            if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); state.fd = fs.openSync(out, 'w', (x.mode & 0o111) ? 0o755 : 0o644); state.out = out; files++; }
          } else if (x.type === '5') { const out = target(x.name); if (out) fs.mkdirSync(out, { recursive: true }); }
          bytes += x.size;
          if (bytes > maxBytes) throw new Error('el archivo descomprimido es demasiado grande');
        }
        if (state.left > 0) {
          if (!buf.length) break;
          const take = buf.subarray(0, Math.min(state.left, buf.length)); buf = buf.subarray(take.length); state.left -= take.length;
          if (state.fd != null) fs.writeSync(state.fd, take);
          if (state.meta) state.meta.push(Buffer.from(take));
          if (state.left > 0) break;
        }
        if (state.pad > 0) { if (buf.length < state.pad) { state.pad -= buf.length; buf = Buffer.alloc(0); break; } buf = buf.subarray(state.pad); state.pad = 0; }
        if (state.fd != null) { fs.closeSync(state.fd); if (process.platform !== 'win32') { try { fs.chmodSync(state.out, (state.mode & 0o111) ? 0o755 : 0o644); } catch { /* best effort */ } } }
        if (state.meta) {
          const text = Buffer.concat(state.meta).toString('utf8');
          paxName = state.type === 'L' ? text.replace(/\0.*$/s, '') : (text.match(/\d+ path=([^\n]*)\n/)?.[1] ?? null);
        }
        state = null;
      }
    }
  } finally { if (state?.fd != null) { try { fs.closeSync(state.fd); } catch { /* closed */ } } }
  return { files, bytes };
}
