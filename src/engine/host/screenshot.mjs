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
const MIN_GAP_MS = 5000;
const TIMEOUT_MS = 20_000;

// The real runner; tests inject their own.
export async function runHostScreenshot(out, call = hostCall) {
  try { await call('host.screenshot', { path: out }, TIMEOUT_MS); }
  catch (error) { throw error?.code === 'noApp' ? Object.assign(new Error(tr('msg.screenshot.noApp')), { clear: true }) : error; }
}

// run(outPath) must write a JPEG at outPath. Returns a function (dir) => Promise<name>.
export function createScreenshot({ run = runHostScreenshot, platform = process.platform, now = Date.now } = {}) {
  let busy = false;
  let last = 0;
  return async function capture(dir) {
    if (platform !== 'win32') throw new Error(tr('msg.screenshot.windowsOnly'));
    if (busy || now() - last < MIN_GAP_MS) throw new Error(tr('msg.screenshot.wait'));
    busy = true; last = now();
    const name = `${now()}-${crypto.randomBytes(4).toString('hex')}.jpg`;
    const file = path.join(dir, name);
    try {
      await fs.promises.mkdir(dir, { recursive: true });
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
