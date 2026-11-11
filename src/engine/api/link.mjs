// The phone access and Magic Link part of the engine's API: the phones and browsers
// linked with this PC. This PC only (src/domain/security/permissions.mjs).
import path from 'node:path';
import fs from 'node:fs';
import { ctx, tr } from '../../platform/context.mjs';
import { createScreenshot } from '../host/screenshot.mjs';
import { saveConfig } from '../../platform/config.mjs';
import { PAIR_KINDS, PREVIEWS } from '../transport/remote.mjs';
import { str, oneOf } from './common.mjs';

// Engine tests (they run with the fake agents) never touch the real screen: they copy a prepared JPEG instead.
const fakeShot = () => (process.env.ORB_FAKE_AGENTS && process.env.ORB_FAKE_SCREENSHOT
  ? (out) => fs.promises.copyFile(process.env.ORB_FAKE_SCREENSHOT, out) : undefined);

export function linkMethods({ emit, remoteRef, log }) {
  const capture = createScreenshot({ run: fakeShot() });
  return {
    // The phone asks for a picture of the PC's screen. It is stored with the phone's uploads and only that phone may
    // download it; the PC always shows a notice so nobody is watched without knowing. Parameters are ignored.
    'pc.screenshot': async (_params, principal) => {
      const name = await capture(path.join(ctx.paths.internal, 'adjuntos-movil'));
      const device = principal?.device ? remoteRef.current?.allowDownload(principal.device, name) : null;
      log(`móvil: captura de pantalla${device ? ` (${device})` : ''}`);
      emit('notice', { body: device ? tr('msg.screenshot.taken', { device }) : tr('msg.screenshot.takenAnon'), tone: 'warning' });
      return { path: name };
    },
    // ---- phone access
    'remote.status': () => remoteRef.current.status(),
    'remote.enable': async ({ enabled }) => {
      const c = saveConfig({ mobile: { enabled: Boolean(enabled) } }); emit('config:changed', c);
      if (enabled) await remoteRef.current.start(); else await remoteRef.current.stop();
      return remoteRef.current.status();
    },
    // The ways in: home Wi-Fi and/or Tailscale (the servers reopen with the new choice).
    // preview: what notifications show on a locked phone ('all', 'chat' or 'none').
    'remote.configure': async ({ wifi, tailscale, preview }) => {
      const patch = {};
      if (typeof wifi === 'boolean') patch.wifi = wifi;
      if (typeof tailscale === 'boolean') patch.tailscale = tailscale;
      if (preview !== undefined) patch.preview = oneOf(preview, PREVIEWS, 'avisos');
      if (wifi === undefined && tailscale === undefined) { const c = saveConfig({ mobile: patch }); emit('config:changed', c); return remoteRef.current.status(); }
      const c = saveConfig({ mobile: patch }); emit('config:changed', c);
      if (c.mobile.enabled) await remoteRef.current.restart();
      return remoteRef.current.status();
    },
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
