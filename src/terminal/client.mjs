// 3.5, Orb en la terminal: what the terminal asks a linked Orb, over Magic Link (src/core/link.mjs), with the same
// methods and limits as a phone (remote.mjs › ALLOWED): talk to Orbe or to a bot (streamed), tasks, the approval cards,
// and the workshop seen from a centre.

import { PROTOCOL, MIN_PROTOCOL, versionGap, versionOfProtocol } from '../core/link.mjs';

const isUser = (l) => l.role === 'usuario';

// 3.6: what to tell about the versions after /api/me: this terminal is too old for that Orb, or that Orb for this
// terminal (null: they understand each other).
export function versionNotice(me, name, t) {
  if (!me) return null;
  const gap = versionGap({ v: PROTOCOL, min: MIN_PROTOCOL }, me);
  if (gap === 'me') return t('term.version.updateTerminal', { has: versionOfProtocol(PROTOCOL), need: versionOfProtocol(me.min) });
  if (gap === 'them') return t('term.version.updateOrb', { name, has: me.version ?? versionOfProtocol(me.v ?? 2), need: versionOfProtocol(MIN_PROTOCOL) });
  return null;
}

export function createClient({ link, peer }) {
  const call = (method, params = {}, opts = {}) => link.call(peer.id, method, params, opts);
  const maxId = (lines) => lines.reduce((m, l) => Math.max(m, Number(l.id) || 0), 0);

  // Waits for the answer to a message: streams the partial text (onPartial gets the whole text so far) and resolves with
  // the new lines once the turn is over. Live events when the stream is open, and a check every `everyMs` in any case.
  function follow({ mode, conversation = null, bot = null, sinceId = 0, onPartial = () => {}, everyMs = 1200, timeoutMs = 0 }) {
    let cancel = () => {};
    const promise = new Promise((resolve, reject) => {
      let done = false; let checking = false; let again = false; let lastPartial = '';
      const offs = [];
      const partial = (text) => { if (typeof text === 'string' && text && text !== lastPartial) { lastPartial = text; onPartial(text); } };
      const finish = (error, value) => {
        if (done) return; done = true;
        clearInterval(timer); clearTimeout(limit); for (const off of offs) off();
        if (error) reject(error); else resolve(value);
      };
      const probe = async () => {
        if (mode === 'bot') {
          const r = await call('bots.chat', { id: bot.id, limit: 40 });
          const fresh = (r.lines ?? []).filter((l) => l.id > sinceId && !isUser(l));
          if (r.state?.busy && r.state.partial) partial(r.state.partial);
          if (r.state?.busy || r.state?.queued) return null;
          return fresh.some((l) => l.role === 'bot') ? fresh : null;
        }
        const [lines, st] = await Promise.all([call('chat.list', { conversation }), call('app.state')]);
        const lane = (st?.chats ?? []).find((c) => c.conversation === conversation);
        if (lane?.busy && lane.partial) partial(lane.partial);
        if (lane && (lane.busy || lane.waiting)) return null;
        const fresh = (lines ?? []).filter((l) => l.id > sinceId && !isUser(l));
        return fresh.some((l) => l.role === 'orb') ? fresh : null;
      };
      const check = async () => {
        if (done) return;
        if (checking) { again = true; return; }
        checking = true;
        try { const r = await probe(); if (r) finish(null, r); }
        catch (error) { if (error.revoked || (!error.offline && error.status !== 0)) finish(error); } // offline: keep trying
        finally { checking = false; if (again && !done) { again = false; check(); } }
      };
      if (mode === 'bot') offs.push(link.on('bot.state', (p, from) => { if (from?.id !== peer.id || Number(p?.bot) !== Number(bot.id)) return; if (p.busy) partial(p.partial); else check(); }));
      else offs.push(link.on('chat:state', (p, from) => { if (from?.id !== peer.id || p?.conversation !== conversation) return; if (p.busy) partial(p.partial); else check(); }));
      offs.push(link.on('link:peers', (list) => { if (list.find((x) => x.id === peer.id)?.revoked) finish(Object.assign(new Error('revoked'), { revoked: true })); }));
      const timer = setInterval(check, everyMs); timer.unref?.();
      const limit = timeoutMs ? setTimeout(() => finish(Object.assign(new Error('timeout'), { timeout: true })), timeoutMs) : null;
      check();
      cancel = () => finish(Object.assign(new Error('cancelled'), { cancelled: true }));
    });
    promise.cancel = () => cancel();
    return promise;
  }

  const client = {
    peer, call, follow,
    status: () => call('link.status'),
    // 3.6: whom this terminal is for on that Orb ({ person: { id, name }, v, min, version }).
    me: () => link.me(peer.id),
    state: () => call('app.state'),
    // A message to Orbe: in the conversation given, or a new one. → { conversation, sinceId }
    async sendOrb(text, conversation = null) {
      const sinceId = conversation ? maxId(await call('chat.list', { conversation })) : 0;
      const r = await call('chat.send', { text, ...(conversation ? { conversation } : {}) });
      return { conversation: r.conversation, sinceId };
    },
    stopOrb: (conversation) => call('chat.stop', { conversation }),
    async bots() { const r = await call('bots.list'); return r.bots ?? []; },
    async sendBot(bot, text) {
      const before = await call('bots.chat', { id: bot.id, limit: 40 });
      const sinceId = maxId(before.lines ?? []);
      await call('bots.send', { id: bot.id, text });
      return { sinceId };
    },
    stopBot: (bot) => call('bots.stop', { id: bot.id }),
    tasks: (limit = 15) => call('tasks.list', { limit }),
    // Every card waiting for a yes or no: an agent's permission, a task waiting for approval, a bot's card.
    async approvals() {
      const out = [];
      const [perms, tasks, bots] = await Promise.all([call('approvals.list').catch(() => []), call('tasks.list', { limit: 100 }).catch(() => []), client.bots().catch(() => [])]);
      for (const a of perms ?? []) out.push({ kind: 'permiso', id: a.id, title: a.body?.title || a.body?.tool || '', detail: a.body?.reason ?? '', where: a.session?.title ?? '', session: a.session?.id, request: a.body?.id });
      for (const x of tasks ?? []) if (x.status === 'awaiting_approval') out.push({ kind: 'tarea', id: x.id, title: x.title, detail: x.project ?? '', where: `#${x.id}` });
      for (const b of bots) {
        const r = await call('bots.chat', { id: b.id, limit: 60 }).catch(() => null);
        for (const l of r?.lines ?? []) if (l.meta?.kind === 'bot_card' && l.meta.status === 'pending') out.push({ kind: 'bot', id: l.id, title: l.body, detail: l.meta.card ?? '', where: b.name });
      }
      return out;
    },
    // decision: 'allow' | 'deny' | 'always' (always only for an agent's permission).
    // 3.6: a sensitive card asks the person's PIN (askPin) once: it gives a ticket for this terminal for a few minutes.
    async decide(card, decision, { askPin = null } = {}) {
      const run = async (opts) => {
        if (card.kind === 'permiso') return call('sessions.approve', { id: card.session, request: card.request, decision }, opts);
        if (card.kind === 'tarea') {
          const full = await call('tasks.get', { id: card.id });
          return call('tasks.approve', { id: card.id, decision: decision === 'deny' ? 'rejected' : 'approved', hash: full.previewHash }, opts);
        }
        return call('bots.decide', { item: card.id, decision: decision === 'deny' ? 'deny' : 'allow' }, opts);
      };
      try { return await run(client.ticket ? { ticket: client.ticket } : {}); }
      catch (error) {
        if (error.reason !== 'strong' || !askPin) throw error;
        const pin = await askPin();
        const r = await call('persons.verifyPin', { pin });
        if (!r?.ok) throw Object.assign(new Error(r?.reason ?? 'wrong'), { key: r?.reason === 'locked' ? 'term.pin.locked' : 'term.pin.wrong' });
        client.ticket = r.ticket;
        return run({ ticket: r.ticket });
      }
    },
    taller: () => call('taller.status'),
    wake: () => call('taller.wake')
  };
  return client;
}

// The text of an answer still to print, given what was already streamed: the rest of the first answer line, then the others.
export function answerText(lines, streamed = '') {
  const out = []; let first = true;
  for (const l of lines) {
    const body = String(l.body ?? '');
    if (first && (l.role === 'orb' || l.role === 'bot') && streamed) {
      first = false;
      if (body.startsWith(streamed)) { const rest = body.slice(streamed.length); if (rest) out.push({ line: l, text: rest, cont: true }); continue; }
      out.push({ line: l, text: body, cont: false, redo: true }); continue;
    }
    if (l.role === 'orb' || l.role === 'bot') first = false;
    out.push({ line: l, text: body, cont: false });
  }
  return out;
}
