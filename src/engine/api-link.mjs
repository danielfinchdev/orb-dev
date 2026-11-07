// The phone access and Magic Link part of the engine's API (split out of api.mjs in 3.6, unchanged).
import { ctx, saveConfig, tr, isHeadless } from '../core/context.mjs';
import { normalAddress } from '../core/link.mjs';
import { pairWithApp } from '../core/server-pair.mjs';
import { serverInstallCommand, parsePairTarget } from '../core/server-install.mjs';
import { PAIR_KINDS, PREVIEWS } from './remote.mjs';
import { fail, str, oneOf } from './api-common.mjs';
import { ownerOfBoard } from '../core/authz.mjs';
import { createPerson, listPersons } from '../core/persons.mjs';

export function linkMethods({ board, emit, remoteRef, version = null }) {
  // 3.6 (WS2): a person sees and manages their own devices and links; the owner, everyone's devices (names, not content).
  const owner = () => ownerOfBoard(board);
  const mineDevice = (id, who) => {
    const d = board.one('SELECT id, person_id FROM devices WHERE id = ?', String(id));
    if (!d) fail(tr('msg.remote.noDevice'));
    if (who.role !== 'owner' && (d.person_id ?? owner()) !== who.person) fail(tr('msg.remote.noDevice'));
    return d.id;
  };
  const minePeer = (p, who) => (p.person ?? owner()) === who.person;
  // «¿Para quién?»: a person by id or by name (Orb Server's `enlazar --persona <nombre>`).
  const personFor = (ref) => {
    const q = String(ref).trim().toLowerCase();
    const p = listPersons(board).find((x) => x.id === ref || x.name.toLowerCase() === q);
    if (!p) fail(tr('msg.persons.noPerson'));
    return p;
  };
  // 3.7 (WS2): the phone access on (as link.qr does), for a code or an offer that the other side has to reach.
  const accessOn = async () => {
    if (remoteRef.current.status().running) return;
    if (!ctx.config.mobile?.enabled) { const c = saveConfig({ mobile: { enabled: true } }); emit('config:changed', c); }
    await remoteRef.current.start();
    if (!remoteRef.current.status().running) fail(remoteRef.current.status().error ?? tr('msg.remote.enableFirst'));
  };
  const hub = () => remoteRef.hub ?? fail(tr('msg.link.unavailable'));
  // 3.7 (WS2), on the server: pair with the app that gave the install command (src/core/server-pair.mjs). The app links to
  // this server with a one-time offer made here (an Orb of the owner, that may program for it and, if it is the first,
  // administer it).
  async function pairApp({ code, address, fp }) {
    await accessOn();
    const r = remoteRef.current;
    const offer = r.handoffOffer({ kind: 'orb', dev: true, admin: 'first' });
    const me = { name: r.status().name, version: r.version?.() ?? version, features: r.features?.() ?? [], v: 3, min: 2 };
    const { url: _u, expiresAt: _e, ...payload } = offer;
    return pairWithApp({ code, address, fp, offer: payload, me });
  }
  return {
    // ---- 3.7 (WS2): «Añadir Orb Server» and the app's Orb Server (src/engine/hub.mjs)
    // The install command with a one-time code (10 min, one use, tied to this app's key) and the same by hand.
    'link.server.code': async ({ kind }) => { await accessOn(); return hub().code({ kind: kind == null ? null : oneOf(kind, ['wifi', 'tailscale'], 'vía') }); },
    'link.server.cancelCode': () => remoteRef.current.cancelServerCode(),
    // Is a server linked, its version and capabilities, who has to update (skew, with the upgrade command), the handoff.
    'link.server.status': () => hub().status(),
    // The plain install command (an upgrade in place of an Orb Server or a 3.6 Orb Núcleo; keeps data and pairing).
    'link.server.install': () => serverInstallCommand({ version }),
    // Who is who: { here: [...], there: [...] } with mappedTo; map { remote, local } | { remote, create: true } |
    // { local, createThere: true }; unmap { remote } | { local }.
    'link.server.persons': () => hub().persons(),
    'link.server.map': ({ remote, local, create, createThere }, who) => hub().map({ remote: remote == null ? null : str(remote, 'persona', 40), local: local == null ? null : str(local, 'persona', 40), create: create === true, createThere: createThere === true }, who),
    'link.server.unmap': ({ remote, local }) => hub().unmap({ remote: remote == null ? null : str(remote, 'persona', 40), local: local == null ? null : str(local, 'persona', 40) }),
    // The phones of this app go to the server now (also done by itself after pairing and mapping).
    'link.server.handoff': () => hub().handoffAll(),
    // The steps after pairing: the server's Claude / Codex, the bots to move, vault and browser (if the server can).
    'link.server.guide': (_, who) => hub().guide(who),
    // The server's own sign-in, windowless (its link and code; the code typed by the user goes there).
    'link.server.login': ({ agent, account, mode }) => hub().login({ agent: agent == null ? null : oneOf(agent, ['claude', 'codex'], 'agente'), account: account == null ? null : str(account, 'cuenta', 40), mode: mode == null ? null : oneOf(mode, ['web', 'device'], 'modo') }),
    'link.server.loginCode': ({ id, code }) => hub().loginCode({ id: str(id, 'inicio de sesión', 80), code: str(code, 'código', 2000) }),
    'link.server.loginState': ({ id }) => hub().loginState({ id: str(id, 'inicio de sesión', 80) }),
    'link.server.loginCancel': ({ id }) => hub().loginCancel({ id: str(id, 'inicio de sesión', 80) }),
    // On the server: pair with the app of the command (pair: «code@address#fp», or its parts).
    'link.pairApp': async ({ pair, code, address, fp }) => {
      const t = pair != null ? parsePairTarget(str(pair, 'emparejado', 400)) : { code: str(code, 'código', 40), address: str(address, 'dirección', 300), fp: str(fp, 'huella', 128) };
      try { return await pairApp(t); } catch (error) { fail(error.message); }
    },
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
    // ---- 3.5 Magic Link (PC only; a phone may ask link.status and taller.* through remote.mjs)
    // A QR (and a short code) to link a phone, a browser or another Orb. Turns the access on if it was off.
    // admin: (Orb Server's «orb-server enlazar») the device that uses it may administer this server, if it is the first.
    // 3.5.1: device: what it is for (phone, browser, orb), chosen here, never by the device; approve: it may
    // answer the bots' cards (default yes); dev: an Orb that may program for this one; admin: true (the owner gives it) or
    // 'first' (`orb-server enlazar`: only while no device administers this server).
    // 3.6: person (id or name): whom the device is for; newPerson: a name, for someone new (the owner makes them now).
    // Everyone makes QRs for themselves; for someone else, and «Puede administrar», only the owner (and admin only for a
    // device of the owner).
    'link.qr': async ({ kind, admin, device, approve, dev, person, newPerson }, who) => {
      const via = oneOf(kind, ['wifi', 'tailscale'], 'vía', undefined);
      const forKind = device == null || device === '' ? null : oneOf(device, PAIR_KINDS, 'dispositivo');
      let target = who.person;
      if (newPerson != null && newPerson !== '') {
        if (who.role !== 'owner') fail(tr('msg.authz.ownerOnly'));
        target = createPerson(board, { name: str(newPerson, 'nombre', 40) }).id; board.changed('persons');
      } else if (person != null && person !== '') target = personFor(str(person, 'persona', 60)).id;
      if (target !== who.person && who.role !== 'owner') fail(tr('msg.link.qrForOthers'));
      if (admin === true && (who.role !== 'owner' || target !== owner())) fail(tr('msg.link.adminOwnerOnly'));
      if (target !== owner()) admin = false;
      if (!remoteRef.current.status().running) {
        if (!ctx.config.mobile?.enabled) { const c = saveConfig({ mobile: { enabled: true } }); emit('config:changed', c); }
        await remoteRef.current.start();
      }
      return remoteRef.current.pair(via, { admin: admin === true ? true : admin === 'first' ? 'first' : false, device: forKind, approve: approve !== false, dev: dev === true, person: target });
    },
    // 3.5.1: «Puede aprobar» (the bots' cards) for a linked device, and the owner's confirmation that a linked device is
    // one of their Orbs (what 'orb') or the Orb that programs for this one (what 'taller').
    'link.setApprove': ({ id, approve }) => remoteRef.current.setApprove(str(id, 'dispositivo', 64), approve === true),
    'link.confirm': ({ id, what }) => remoteRef.current.confirm(str(id, 'dispositivo', 64), oneOf(what ?? 'orb', ['orb', 'taller'], 'qué')),
    // 3.5: «Puede administrar» for a linked device (its bots and links from afar).
    'link.setAdmin': ({ id, admin }) => remoteRef.current.setAdmin(str(id, 'dispositivo', 64), admin === true),
    'link.devices': (_, who) => remoteRef.current.devices().filter((d) => who.role === 'owner' || d.person === who.person),
    'link.revoke': ({ id }, who) => remoteRef.current.revoke(mineDevice(str(id, 'dispositivo', 64), who)),
    'link.rename': ({ id, name }, who) => remoteRef.current.rename(mineDevice(str(id, 'dispositivo', 64), who), str(name, 'nombre', 60)),
    'link.status': (_, who) => ({ ...remoteRef.current.linkStatus({ person: who.person }), peers: (remoteRef.link?.peers() ?? []).filter((p) => minePeer(p, who)) }),
    // This Orb links to another one: with its QR (the text or the object), or with the short code and its address.
    // 3.6: the link is of the person who makes it (their calls and events only go through it).
    'link.connect': async ({ qr, code, address, fp }, who) => {
      if (!remoteRef.link) fail(tr('msg.link.unavailable'));
      const person = who.person === owner() ? null : who.person;
      if (qr != null && qr !== '') {
        if (typeof qr === 'string') str(qr, 'QR', 4000);
        else if (typeof qr !== 'object' || JSON.stringify(qr).length > 4000) fail(tr('msg.api.invalid', { name: 'QR' }));
        return remoteRef.link.connect({ qr, person });
      }
      // 3.7 (WS2): on a server, the install command's code («code@address#fp» of an app with a code on screen): the
      // pairing of «Añadir Orb Server» (orb-server emparejar calls this).
      if (fp && (isHeadless() || ctx.product === 'server')) {
        const base = normalAddress(str(address, 'dirección', 300));
        const h = await fetch(`${base}/api/server-hello`, { credentials: 'omit' }).then((r) => r.ok).catch(() => false);
        if (h) { try { return await pairApp({ code: str(code, 'código', 40), address: base, fp: str(fp, 'huella', 128) }); } catch (error) { fail(error.message); } }
      }
      return remoteRef.link.connect({ code: str(code, 'código', 20), address: str(address, 'dirección', 300), fp: fp ? str(fp, 'huella', 40) : null, person });
    },
    'link.peers': (_, who) => (remoteRef.link?.peers() ?? []).filter((p) => minePeer(p, who)),
    'link.disconnect': ({ id }, who) => {
      if (!remoteRef.link) fail(tr('msg.link.unavailable'));
      const peer = remoteRef.link.peers().find((p) => p.id === str(id, 'enlace', 64));
      if (!peer || !minePeer(peer, who)) fail(tr('msg.link.noPeer'));
      return remoteRef.link.disconnect(peer.id);
    }
  };
}
