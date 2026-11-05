// 3.7 (WS5): «Ver navegador del Server» in the engine's API: a person sees and uses their own page of Orb Server's
// browser (src/server/browser.mjs) from their phone, a browser or the app linked to the Server.
//   browser.live.start({ width, dpr, url?, quality? }) → { sid, width, height, url, title }
//   browser.live.input({ sid, ack?, pause?, release?, events?, go?, back? })   ack: the picture seq the device got (flow control);
//                                go: an address to open (the view's address bar), back: the page before; → { ok, using, url };
//                                pause: the device's app went to the background; release: «Devolver a los bots»;
//                                events: [{ type: 'tap'|'mouse'|'wheel'|'text'|'key', … }] (src/server/screencast.mjs)
//   browser.live.stop({ sid })
// The pictures come as the event «browser:live» { person, device, sid, seq, data, w, h } (or { sid, state: 'stopped',
// reason }) to that one device only, end-to-end encrypted like every other event (remote.mjs); they are never kept.
// Only the person whose browser it is: there is no way to name someone else's (not even for the owner), every start and
// every refusal is in the audit log.
import { ctx, tr } from '../core/context.mjs';
import { audit } from '../core/authz.mjs';
import { fail, str } from './api-common.mjs';

export function browserMethods({ board, emit }) {
  const sb = () => ctx.serverBrowser ?? fail(tr('msg.browser.live.off'));
  const deviceOf = (who) => String(who?.device || who?.channel || 'desktop');
  const deny = (who, method, person, reason) => { audit(board, who, method, { type: 'person', id: person }, 'deny', reason); fail(tr('msg.browser.live.notYours')); };
  // A view of someone else's (or of another device): refused and audited.
  const guarded = async (who, method, sid, fn) => {
    try { return await fn(); } catch (error) {
      if (error?.code === 'NOT_YOURS') deny(who, method, `sid:${String(sid).slice(0, 12)}`, 'notYours');
      if (error?.code === 'GONE') fail(tr('sys.browser.liveGone'));
      throw error;
    }
  };
  return {
    'browser.live.start': async ({ width, dpr, url, quality, person }, who) => {
      const me = who?.person;
      if (person != null && person !== '' && person !== me) deny(who, 'browser.live.start', String(person), 'notYours');
      const device = deviceOf(who);
      const r = await sb().live.start({
        person: me, device, width: Number(width) || 390, dpr: Number(dpr) || 1, quality: Number(quality) || undefined, url: url ? str(url, 'dirección', 2000) : null,
        send: (f) => emit('browser:live', { person: me, device, ...f }),
        onStop: (reason, sid) => emit('browser:live', { person: me, device, sid, state: 'stopped', reason })
      });
      audit(board, who, 'browser.live.start', { type: 'person', id: me }, 'allow', device);
      return r;
    },
    'browser.live.input': ({ sid, ack, pause, release, events, go, back }, who) => {
      const id = str(sid, 'id', 64);
      const to = go == null || go === '' ? null : str(go, 'dirección', 2000);
      return guarded(who, 'browser.live.input', id, () => sb().live.input(id, { person: who?.person, device: deviceOf(who) }, { ack, pause, release, events, go: to, back: back === true }));
    },
    'browser.live.stop': async ({ sid }, who) => {
      const id = str(sid, 'id', 64);
      const r = await guarded(who, 'browser.live.stop', id, () => sb().live.stop(id, { person: who?.person, device: deviceOf(who) }));
      audit(board, who, 'browser.live.stop', { type: 'person', id: who?.person }, 'allow', deviceOf(who));
      return r;
    }
  };
}
