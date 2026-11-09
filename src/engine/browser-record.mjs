// 3.8.2 (T3 3.11): the recording of the agents' browser. The JPEG pictures of the page's screencast (host-browser.mjs)
// at a steady rate, written as a Motion-JPEG AVI that Windows' own player opens; no encoder or extra program needed.
import fs from 'node:fs';
import path from 'node:path';
import { ctx, tr } from '../core/context.mjs';
import { placeAttachments } from './attachments.mjs';

export const RECORD_FPS = 5;
export const RECORD_MAX_MS = 3 * 60_000;
export const RECORD_MAX_BYTES = 120 * 1024 * 1024;

// A JPEG's size (its first SOF marker). → { width, height } or null.
export function jpegSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  for (let at = 2; at + 9 < buf.length;) {
    if (buf[at] !== 0xff) return null;
    const marker = buf[at + 1]; const len = buf.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: buf.readUInt16BE(at + 5), width: buf.readUInt16BE(at + 7) };
    at += 2 + len;
  }
  return null;
}

// Pictures that came when the page changed ({ at: ms, data: Buffer }) → one per tick of 1/fps s, each the newest at
// that moment (a still page repeats its picture).
export function resample(frames, fps = RECORD_FPS) {
  if (!frames.length) return [];
  const step = 1000 / fps; const start = frames[0].at; const end = frames.at(-1).at;
  const out = []; let i = 0;
  for (let t = start; t <= end + step / 2; t += step) {
    while (i + 1 < frames.length && frames[i + 1].at <= t) i++;
    out.push(frames[i].data);
  }
  return out;
}

const fourcc = (s) => Buffer.from(s, 'latin1');
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const chunk = (id, data) => Buffer.concat([fourcc(id), u32(data.length), data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
const list = (type, parts) => { const body = Buffer.concat([fourcc(type), ...parts]); return Buffer.concat([fourcc('LIST'), u32(body.length), body]); };

// JPEG pictures → a Motion-JPEG AVI (RIFF, one video stream, with its index).
export function mjpegAvi(jpegs, fps = RECORD_FPS) {
  if (!jpegs.length) throw new Error('sin imágenes');
  const size = jpegSize(jpegs[0]) ?? { width: 1280, height: 800 };
  const biggest = Math.max(...jpegs.map((j) => j.length));
  const avih = Buffer.alloc(56);
  avih.writeUInt32LE(Math.round(1e6 / fps), 0); avih.writeUInt32LE(biggest * fps, 4); avih.writeUInt32LE(0x10, 12); // AVIF_HASINDEX
  avih.writeUInt32LE(jpegs.length, 16); avih.writeUInt32LE(1, 24); avih.writeUInt32LE(biggest, 28); avih.writeUInt32LE(size.width, 32); avih.writeUInt32LE(size.height, 36);
  const strh = Buffer.alloc(56);
  fourcc('vids').copy(strh, 0); fourcc('MJPG').copy(strh, 4); strh.writeUInt32LE(1, 20); strh.writeUInt32LE(fps, 24);
  strh.writeUInt32LE(jpegs.length, 32); strh.writeUInt32LE(biggest, 36); strh.writeInt32LE(-1, 40);
  strh.writeUInt16LE(size.width, 52); strh.writeUInt16LE(size.height, 54);
  const strf = Buffer.alloc(40);
  strf.writeUInt32LE(40, 0); strf.writeInt32LE(size.width, 4); strf.writeInt32LE(size.height, 8); strf.writeUInt16LE(1, 12); strf.writeUInt16LE(24, 14);
  fourcc('MJPG').copy(strf, 16); strf.writeUInt32LE(size.width * size.height * 3, 20);
  const hdrl = list('hdrl', [chunk('avih', avih), list('strl', [chunk('strh', strh), chunk('strf', strf)])]);
  const frames = jpegs.map((j) => chunk('00dc', j));
  const index = Buffer.alloc(16 * jpegs.length);
  let offset = 4; // from the «movi» fourcc
  jpegs.forEach((j, i) => { fourcc('00dc').copy(index, i * 16); index.writeUInt32LE(0x10, i * 16 + 4); index.writeUInt32LE(offset, i * 16 + 8); index.writeUInt32LE(j.length, i * 16 + 12); offset += frames[i].length; });
  const body = Buffer.concat([fourcc('AVI '), hdrl, list('movi', frames), chunk('idx1', index)]);
  return Buffer.concat([fourcc('RIFF'), u32(body.length), body]);
}

// Where a pointed element and a recording go, once the engine has its sessions. toWindow: an event for this PC's window
// only (never a phone's).
//   pointed: the element's picture in core\preparacion\imagenes (as a captured window: images.mark) and the window is told
//            which chat's message box gets it.
//   saveRecording: the video among that chat's attachments (<its folder>\.orb-adjuntos\<stamp>\, attachments.mjs) and a
//            line in the chat. → its path, or null when the chat is gone.
export function browserSink({ sessions, toWindow, log = () => {}, now = () => Date.now() }) {
  return {
    async pointed(p) {
      const dir = path.join(ctx.paths.internal, 'imagenes'); fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `elemento-${now()}.png`); fs.writeFileSync(file, p.png);
      toWindow('browser:pointed', { session: p.session, path: file, selector: p.selector, text: p.text, url: p.url });
    },
    async saveRecording(session, avi) {
      const s = sessions.get(session); if (!s) return null;
      const tmp = path.join(ctx.paths.internal, 'imagenes', `navegador-${now()}.avi`);
      fs.mkdirSync(path.dirname(tmp), { recursive: true }); fs.writeFileSync(tmp, avi);
      try {
        const [placed] = placeAttachments([tmp], s.cwd, { now: now() });
        log(`navegador del agente: grabación guardada · chat ${s.id}`);
        try { sessions.addItem(s.id, 'system', 'status', tr('msg.browser.recorded', { name: placed.name })); } catch { /* the chat went */ }
        toWindow('browser:recorded', { session: s.id, path: placed.path });
        return placed.path;
      } finally { fs.rmSync(tmp, { force: true }); }
    }
  };
}
