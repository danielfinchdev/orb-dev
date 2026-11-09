// The phone access and Magic Link part of the engine's API (split out of api.mjs in 3.6): the phones and browsers
// linked with this PC. This PC only (src/core/permissions.mjs).
import { ctx } from '../platform/context.mjs';
import { saveConfig } from '../platform/config.mjs';
import { PAIR_KINDS, PREVIEWS } from './remote.mjs';
import { str, oneOf } from './api-common.mjs';

export function linkMethods({ emit, remoteRef }) {
  return {
    // ---- phone access
    'remote.status': () => remoteRef.current.status(),
    'remote.enable': async ({ enabled }) => {
      const c = saveConfig({ mobile: { enabled: Boolean(enabled) } }); emit('config:changed', c);
      if (enabled) await remoteRef.current.start(); else await remoteRef.current.stop();
      return remoteRef.current.status();
    },
    // The ways in: home Wi-Fi and/or Tailscale (the servers reopen with the new choice).
    // preview (3.5.1): what notifications show on a locked phone ('all', 'chat' or 'none').
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
    // ---- 3.5 Magic Link
    // A QR (and a short code) to link a phone or a browser. Turns the access on if it was off.
    // 3.5.1: device: what it is for (phone or browser), chosen here, never by the device.
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
