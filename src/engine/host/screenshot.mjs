// Screenshot of the whole desktop (every monitor) for the linked phone. PowerShell starts only when a capture is asked
// for, never at start-up or at rest, and its script is fixed: the output path travels in the environment, so nothing
// that came from the phone is ever part of a command.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { tr } from '../../platform/context.mjs';
import { UPLOAD_MAX } from '../transport/remote-common.mjs';

export const SHOT_NAME = /^\d+-[0-9a-f]{8}\.jpg$/;
const MIN_GAP_MS = 5000;
const TIMEOUT_MS = 20_000;

const SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName System.Windows.Forms, System.Drawing',
  '$v = [System.Windows.Forms.SystemInformation]::VirtualScreen',
  '$bmp = New-Object System.Drawing.Bitmap $v.Width, $v.Height',
  '$g = [System.Drawing.Graphics]::FromImage($bmp)',
  '$g.CopyFromScreen($v.Left, $v.Top, 0, 0, $bmp.Size)',
  "$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }",
  '$q = New-Object System.Drawing.Imaging.EncoderParameters 1',
  '$q.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 80L',
  '$bmp.Save($env:ORB_SHOT_OUT, $codec, $q)',
  '$g.Dispose(); $bmp.Dispose()'
].join('; ');

// The real runner; tests inject their own.
function runPowerShell(out) {
  const root = process.env.SystemRoot || 'C:\Windows';
  const exe = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve, reject) => {
    execFile(exe, ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', SCRIPT],
      { windowsHide: true, timeout: TIMEOUT_MS, env: { ...process.env, ORB_SHOT_OUT: out } }, (error) => (error ? reject(error) : resolve()));
  });
}

// run(outPath) must write a JPEG at outPath. Returns a function (dir) => Promise<name>.
export function createScreenshot({ run = runPowerShell, platform = process.platform, now = Date.now } = {}) {
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
      throw error.clear ? error : new Error(tr('msg.screenshot.failed')); // a PowerShell failure's text is never shown
    } finally { busy = false; }
  };
}
