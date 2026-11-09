// 3.8.2 (item 13, decision D4): the music's tracks (src/core/music.mjs), downloaded the first time one is played and
// kept in core\herramientas\musica, read-only for agents (src/core/guard.mjs). A track is used only when its file is
// exactly the pinned one (size and SHA-256), checked on every read: a file changed or left there by anyone else is
// thrown away and downloaded again. The window plays it from the bytes this returns (src/ui/lib/music.js).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ctx, tr } from '../core/context.mjs';
import { trackOf } from '../core/music.mjs';
import { fail } from './api-common.mjs';

export const musicDir = () => path.join(ctx.paths.tools, 'musica');
const fileOf = (t) => path.join(musicDir(), `${t.id}${t.mime === 'audio/ogg' ? '.ogg' : '.mp3'}`);
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
export const matches = (buf, t) => Buffer.isBuffer(buf) && buf.length === t.size && sha256(buf) === t.sha256;
// Tests (fake agents) and ORB_NO_DOWNLOADS=1 never download, unless they bring their own fetch.
const downloadsOff = () => process.env.ORB_NO_DOWNLOADS === '1' || Boolean(process.env.ORB_FAKE_AGENTS);

const running = new Map(); // id → the download under way
async function download(t, fetchImpl, log) {
  const res = await fetchImpl(t.url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(tr('sys.music.download', { status: res.status }));
  const declared = Number(res.headers?.get?.('content-length'));
  if (declared && declared !== t.size) throw new Error(tr('sys.music.badFile'));
  const buf = Buffer.from(await res.arrayBuffer());
  if (!matches(buf, t)) throw new Error(tr('sys.music.badFile'));
  fs.mkdirSync(musicDir(), { recursive: true });
  const part = `${fileOf(t)}.${crypto.randomBytes(4).toString('hex')}.part`;
  fs.writeFileSync(part, buf);
  fs.renameSync(part, fileOf(t));
  log(`música: «${t.title}» descargada y comprobada`);
  return buf;
}

// The track's bytes, downloaded first when they are not there (or not as pinned). → Buffer; throws with a message for
// the window when it cannot be had. pin: the track (its manifest entry; the tests bring their own).
export async function trackBytes(id, { fetchImpl = null, log = () => {}, pin = trackOf(id) } = {}) {
  const t = pin;
  if (!t) fail(tr('sys.music.unknown'));
  let buf = null;
  try { buf = fs.readFileSync(fileOf(t)); } catch { /* not downloaded yet */ }
  if (buf && matches(buf, t)) return buf;
  if (buf) { log(`música: «${t.title}» no coincide con lo descargado; se descarga de nuevo`); fs.rmSync(fileOf(t), { force: true }); }
  if (downloadsOff() && !fetchImpl) fail(tr('sys.music.off'));
  if (!running.has(id)) running.set(id, download(t, fetchImpl ?? globalThis.fetch, log).finally(() => running.delete(id)));
  try { return await running.get(id); } catch (error) { fail(error.message || tr('sys.music.badFile')); }
}

// The API (this PC only, src/core/permissions.mjs). 'music.track' → { id, mime, data } with the bytes in base64.
export function musicMethods({ log = () => {}, fetchImpl = null } = {}) {
  return {
    'music.track': async ({ id } = {}) => {
      const t = trackOf(typeof id === 'string' ? id : '');
      if (!t) fail(tr('sys.music.unknown'));
      const buf = await trackBytes(t.id, { fetchImpl, log });
      return { id: t.id, mime: t.mime, data: buf.toString('base64') };
    }
  };
}
