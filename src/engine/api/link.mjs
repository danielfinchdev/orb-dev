// The phone access and Magic Link part of the engine's API: the phones and browsers
// linked with this PC. This PC only (src/domain/security/permissions.mjs).
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { ctx, tr } from '../../platform/context.mjs';
import { createScreenshot, sweepShots, SHOT_DIR } from '../host/screenshot.mjs';
import { PermissionError } from '../../domain/security/permissions.mjs';
import { saveConfig } from '../../platform/config.mjs';
import { PAIR_KINDS, PREVIEWS } from '../transport/remote.mjs';
import { tailscaleInfo, tailscaleLogin, markLinked } from '../transport/tailscale-status.mjs';
import { str, oneOf } from './common.mjs';

// Engine tests (they run with the fake agents) never touch the real screen: they copy a prepared JPEG instead. The
// hook needs the fake-agents mode and only accepts a real JPEG inside the temp folder. Residual risk: whoever controls
// this process's environment could still make a capture "show" a JPEG from the temp folder, which they could read anyway.
const fakeShot = () => {
  const src = process.env.ORB_FAKE_AGENTS && process.env.ORB_FAKE_SCREENSHOT;
  if (!src) return undefined;
  return async (out) => {
    const full = path.resolve(src); const tmp = path.resolve(os.tmpdir()) + path.sep;
    const rel = path.relative(tmp, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('fake screenshot outside the temp folder');
    const head = Buffer.alloc(2); const fh = await fs.promises.open(full, 'r');
    try { await fh.read(head, 0, 2, 0); } finally { await fh.close(); }
    if (head[0] !== 0xff || head[1] !== 0xd8) throw new Error('fake screenshot is not a JPEG');
    await fs.promises.copyFile(full, out);
  };
};

// "1.2.3" strictly, and newer than the running one: a malformed or stale version never reaches the phones.
const STRICT = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;
const isNewer = (a, b) => { const x = a.split('.').map(Number); const y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };

// Same gate as fakeShot: tests drive the capture's rate limiter by writing the fake time (ms) into this file, so they
// do not depend on how long a loaded machine took between two calls. Without the file, the real clock is used.
const fakeClock = () => {
  const file = process.env.ORB_FAKE_AGENTS && process.env.ORB_FAKE_SCREENSHOT_CLOCK;
  if (!file) return undefined;
  return () => { try { const n = Number(fs.readFileSync(file, 'utf8')); if (Number.isFinite(n) && n > 0) return n; } catch { /* no file yet */ } return Date.now(); };
};

export function linkMethods({ emit, remoteRef, log, version }) {
  const run = fakeShot(); // the test hook stands in for the Windows capture, so it also skips the platform check
  const now = fakeClock();
  const capture = createScreenshot(run ? { run, platform: 'win32', ...(now && { now }) } : {});
  const shotsDir = () => path.join(ctx.paths.internal, SHOT_DIR);
  sweepShots(shotsDir()).catch(() => {}); // leftovers of an engine that stopped before they expired
  return {
    // The phone asks for a picture of the PC's screen. It is stored in its own folder (never with the uploads) and only
    // that phone may download it; the PC always shows a notice (never silenced as a repeat) so nobody is watched
    // without knowing. Only the phone app may ask: a linked browser may not. Parameters are ignored.
    'pc.screenshot': async (_params, principal) => {
      if (principal?.channel !== 'phone' && principal?.channel !== 'desktop') throw Object.assign(new PermissionError('pc.screenshot'), { message: tr('msg.screenshot.phoneOnly') });
      // Settings › Mobile › screenshot: off means no phone gets a picture of the PC (the PC's own window is never blocked).
      if (principal?.channel === 'phone' && ctx.config?.mobile?.screenshot === false) throw Object.assign(new PermissionError('pc.screenshot'), { message: tr('msg.screenshot.off') });
      const name = await capture(shotsDir());
      const device = principal?.device ? remoteRef.current?.allowDownload(principal.device, name) : null;
      log(`móvil: captura de pantalla${device ? ` (${device})` : ''}`);
      const time = new Date().toLocaleTimeString(ctx.config?.language === 'en' ? 'en-GB' : 'es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      emit('notice', { body: device ? tr('msg.screenshot.taken', { device, time }) : tr('msg.screenshot.takenAnon', { time }), tone: 'warning', always: true });
      return { path: name };
    },
    // ---- phone access
    // The updater (Rust) found a new Orb: the linked phones are told once per version (announce keeps the once).
    'app.updateFound': ({ version: found } = {}) => {
      const v = typeof found === 'string' && found.length <= 32 && STRICT.test(found) ? found : null;
      if (!v || !isNewer(v, version) || !remoteRef.current) return { announced: false };
      return { announced: remoteRef.current.announce({ kind: 'update', version: v }) === true };
    },
    'remote.status': () => remoteRef.current.status(),
    'remote.enable': async ({ enabled }) => {
      const c = saveConfig({ mobile: { enabled: Boolean(enabled) } }); emit('config:changed', c);
      if (enabled) await remoteRef.current.start(); else await remoteRef.current.stop();
      return remoteRef.current.status();
    },
    // The ways in: home Wi-Fi and/or Tailscale (the servers reopen with the new choice).
    // preview: what notifications show on a locked phone ('all', 'chat' or 'none').
    'remote.configure': async ({ wifi, tailscale, preview, screenshot }) => {
      const patch = {};
      if (typeof screenshot === 'boolean') patch.screenshot = screenshot;
      if (typeof wifi === 'boolean') patch.wifi = wifi;
      if (typeof tailscale === 'boolean') patch.tailscale = tailscale;
      if (preview !== undefined) patch.preview = oneOf(preview, PREVIEWS, 'avisos');
      if (wifi === undefined && tailscale === undefined) { const c = saveConfig({ mobile: patch }); emit('config:changed', c); return remoteRef.current.status(); }
      const c = saveConfig({ mobile: patch }); emit('config:changed', c);
      if (c.mobile.enabled) await remoteRef.current.restart();
      return remoteRef.current.status();
    },
    // Tailscale as the account: its state and the devices of the same account (linked phones marked), and the sign-in. Finding a
    // device here links nothing: it still needs the pairing code and the master password.
    'tailscale.status': async () => { const info = await tailscaleInfo(); return { ...info, devices: markLinked(info.devices, remoteRef.current?.devices?.() ?? []) }; },
    'tailscale.login': () => tailscaleLogin(),
    'remote.pair': ({ kind }) => remoteRef.current.pair(oneOf(kind, ['wifi', 'tailscale'], 'vía', undefined)),
    'remote.revoke': ({ id }) => remoteRef.current.revoke(str(id, 'dispositivo', 64)),
    // ---- Magic Link
    // A QR (and a short code) to link a phone or a browser. Turns the access on if it was off.
    // device: what it is for (phone or browser), chosen here, never by the device.
    'link.qr': async ({ kind, device }) => {
      const via = oneOf(kind, ['wifi', 'tailscale'], 'vía', undefined);
      const forKind = device == null || device === '' ? null : oneOf(device, PAIR_KINDS, 'dispositivo');
      if (!remoteRef.current.status().running) {
        if (!ctx.config.mobile?.enabled) { const c = saveConfig({ mobile: { enabled: true } }); emit('config:changed', c); }
        await remoteRef.current.start();
      }
      return remoteRef.current.pair(via, { device: forKind });
    },
    'link.devices': () => remoteRef.current.devices(),
    'link.revoke': ({ id }) => remoteRef.current.revoke(str(id, 'dispositivo', 64)),
    'link.rename': ({ id, name }) => remoteRef.current.rename(str(id, 'dispositivo', 64), str(name, 'nombre', 60))
  };
}
