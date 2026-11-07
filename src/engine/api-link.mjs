// The phone access and Magic Link part of the engine's API (split out of api.mjs in 3.6): the phones and browsers
// linked with this PC.
import { ctx, saveConfig, tr } from '../core/context.mjs';
import { PAIR_KINDS, PREVIEWS } from './remote.mjs';
import { fail, str, oneOf } from './api-common.mjs';
import { ownerOfBoard } from '../core/authz.mjs';
import { createPerson, listPersons } from '../core/persons.mjs';

export function linkMethods({ board, emit, remoteRef }) {
  // 3.6 (WS2): a person sees and manages their own devices; the owner, everyone's devices (names, not content).
  const owner = () => ownerOfBoard(board);
  const mineDevice = (id, who) => {
    const d = board.one('SELECT id, person_id FROM devices WHERE id = ?', String(id));
    if (!d) fail(tr('msg.remote.noDevice'));
    if (who.role !== 'owner' && (d.person_id ?? owner()) !== who.person) fail(tr('msg.remote.noDevice'));
    return d.id;
  };
  // «¿Para quién?»: a person by id or by name.
  const personFor = (ref) => {
    const q = String(ref).trim().toLowerCase();
    const p = listPersons(board).find((x) => x.id === ref || x.name.toLowerCase() === q);
    if (!p) fail(tr('msg.persons.noPerson'));
    return p;
  };
  return {
    // ---- phone access (PC only: these are not in the phone's allowed list)
    'remote.status': () => remoteRef.current.status(),
    'remote.enable': async ({ enabled }) => {
      const c = saveConfig({ mobile: { enabled: Boolean(enabled) } }); emit('config:changed', c);
      if (enabled) await remoteRef.current.start(); else await remoteRef.current.stop();
      return remoteRef.current.status();
    },
    // The ways in: home Wi-Fi and/or Tailscale (the servers reopen with the new choice).
    // 3.5.1: lanHttp: browsers may link over the home Wi-Fi in plain http (off by default); preview: what notifications
    // show on a locked phone ('all', 'chat' or 'none').
    'remote.configure': async ({ wifi, tailscale, lanHttp, preview }) => {
      const patch = {};
      if (typeof wifi === 'boolean') patch.wifi = wifi;
      if (typeof tailscale === 'boolean') patch.tailscale = tailscale;
      if (typeof lanHttp === 'boolean') patch.lanHttp = lanHttp;
      if (preview !== undefined) patch.preview = oneOf(preview, PREVIEWS, 'avisos');
      if (wifi === undefined && tailscale === undefined) { const c = saveConfig({ mobile: patch }); emit('config:changed', c); return remoteRef.current.status(); }
      const c = saveConfig({ mobile: patch }); emit('config:changed', c);
      if (c.mobile.enabled) await remoteRef.current.restart();
      return remoteRef.current.status();
    },
    'remote.pair': ({ kind }) => remoteRef.current.pair(oneOf(kind, ['wifi', 'tailscale'], 'vía', undefined)),
    'remote.revoke': ({ id }) => remoteRef.current.revoke(str(id, 'dispositivo', 64)),
    // ---- 3.5 Magic Link (PC only)
    // A QR (and a short code) to link a phone or a browser. Turns the access on if it was off.
    // 3.5.1: device: what it is for (phone or browser), chosen here, never by the device.
    // 3.6: person (id or name): whom the device is for; newPerson: a name, for someone new (the owner makes them now).
    // Everyone makes QRs for themselves; for someone else, only the owner.
    'link.qr': async ({ kind, device, person, newPerson }, who) => {
      const via = oneOf(kind, ['wifi', 'tailscale'], 'vía', undefined);
      const forKind = device == null || device === '' ? null : oneOf(device, PAIR_KINDS, 'dispositivo');
      let target = who.person;
      if (newPerson != null && newPerson !== '') {
        if (who.role !== 'owner') fail(tr('msg.authz.ownerOnly'));
        target = createPerson(board, { name: str(newPerson, 'nombre', 40) }).id; board.changed('persons');
      } else if (person != null && person !== '') target = personFor(str(person, 'persona', 60)).id;
      if (target !== who.person && who.role !== 'owner') fail(tr('msg.link.qrForOthers'));
      if (!remoteRef.current.status().running) {
        if (!ctx.config.mobile?.enabled) { const c = saveConfig({ mobile: { enabled: true } }); emit('config:changed', c); }
        await remoteRef.current.start();
      }
      return remoteRef.current.pair(via, { device: forKind, person: target });
    },
    'link.devices': (_, who) => remoteRef.current.devices().filter((d) => who.role === 'owner' || d.person === who.person),
    'link.revoke': ({ id }, who) => remoteRef.current.revoke(mineDevice(str(id, 'dispositivo', 64), who)),
    'link.rename': ({ id, name }, who) => remoteRef.current.rename(mineDevice(str(id, 'dispositivo', 64), who), str(name, 'nombre', 60))
  };
}
