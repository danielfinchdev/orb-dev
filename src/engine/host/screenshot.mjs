// Screenshot of the whole desktop (every monitor) for the linked phone. It is taken by the app in native code
// (src-tauri/src/screenshot.rs): antivirus software blocks the script way, so no script or child process is involved
// here, and the path handed to the app is one this module builds itself, never anything that came from the phone.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { tr } from '../../platform/context.mjs';
import { UPLOAD_MAX } from '../transport/remote-common.mjs';
import { hostCall } from './host.mjs';

export const SHOT_NAME = /^\d+-[0-9a-f]{8}\.jpg$/;
// Captures live in their own folder, apart from the phone's uploads, so one can never be passed on as an upload's
// `images` path. The app that wants one in a chat uploads it again as a normal picture.
export const SHOT_DIR = 'capturas-movil';
export const SHOT_TTL_MS = 10 * 60_000;
const MIN_GAP_MS = 5000;
const PER_HOUR = 60;
const TIMEOUT_MS = 20_000;

// The real runner; tests inject their own.
export async function runHostScreenshot(out, call = hostCall) {
  try { await call('host.screenshot', { path: out }, TIMEOUT_MS); }
  catch (error) {
    if (/demasiado grande/.test(String(error?.message))) throw Object.assign(new Error(tr('msg.screenshot.tooBig')), { clear: true });
    throw error?.code === 'noApp' ? Object.assign(new Error(tr('msg.screenshot.noApp')), { clear: true }) : error;
  }
}

// Deletes captures older than maxAge (a registry entry that expired, or an engine that restarted before cleaning up).
export async function sweepShots(dir, maxAge = SHOT_TTL_MS, now = Date.now()) {
  let names; try { names = await fs.promises.readdir(dir); } catch { return; }
  for (const n of names) {
    if (!SHOT_NAME.test(n)) continue;
    const file = path.join(dir, n);
    try { if (now - (await fs.promises.stat(file)).mtimeMs > maxAge) await fs.promises.rm(file, { force: true }); } catch { /* gone */ }
  }
}

// run(outPath) must write a JPEG at outPath. Returns a function (dir) => Promise<name>.
export function createScreenshot({ run = runHostScreenshot, platform = process.platform, now = Date.now } = {}) {
  let busy = false;
  let last = 0;
  let recent = []; // start times within the last hour
  return async function capture(dir) {
    if (platform !== 'win32') throw new Error(tr('msg.screenshot.windowsOnly'));
    if (busy || now() - last < MIN_GAP_MS) throw new Error(tr('msg.screenshot.wait'));
    const t = now();
    recent = recent.filter((x) => t - x < 3_600_000);
    if (recent.length >= PER_HOUR) throw Object.assign(new Error(tr('msg.screenshot.tooMany')), { clear: true });
    recent.push(t);
    busy = true; last = now();
    const name = `${now()}-${crypto.randomBytes(4).toString('hex')}.jpg`;
    const file = path.join(dir, name);
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      await sweepShots(dir, SHOT_TTL_MS, t);
      await run(file);
      const st = await fs.promises.stat(file).catch(() => null);
      if (!st || !st.size) throw new Error(tr('msg.screenshot.failed'));
      if (st.size > UPLOAD_MAX) throw Object.assign(new Error(tr('msg.screenshot.tooBig')), { clear: true });
      return name;
    } catch (error) {
      await fs.promises.rm(file, { force: true }).catch(() => {});
      throw error.clear ? error : new Error(tr('msg.screenshot.failed')); // the app's failure text is never shown
    } finally { busy = false; }
  };
}
