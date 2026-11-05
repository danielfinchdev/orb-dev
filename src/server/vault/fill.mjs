// 3.7 (Orb Server, WS6): «vault_fill»: Orb Server types a site's sign-in from the person's vault into the page that is
// open in the Server's browser. The agent (a bot) only ever learns «ok» or «failed: <reason>».
//
// CONTRACT with the browser (src/server/browser.mjs + src/core/browser-protocol.mjs, WS5):
//   The browser's action «vault_fill» calls the hook   hook(tab, { site }, page) → { ok: true } | { ok: false, reason }
//   made here by createVaultFillHook(deps). tab: { person, agent } (whose browser profile, which agent asks). page:
//     world(code) → value     a script in the page's isolated world, MAIN frame only (a cross-origin iframe is never
//                             reached: fields inside one are never found, so never filled)
//     snapshot()              WS5's SNAPSHOT (fills globalThis.__orbRefs, the elements the agent sees by number)
//     fieldInfo(ref)          { tag, type, visible, origin, top } of a ref (never its value)
//     markFilled(ref)         from now until the page navigates, SNAPSHOT never returns this field's value and
//                             screenshots black it out (WS5's redaction: finding 6)
//     focusPage(), insertText(text), url()
//   Equivalent direct form: vaultFill({ page, person, agent, site, ...deps }) (the hook calls it). Orb Server's engine
//   makes the hook (engine-server.mjs: ctx.vaultFill) and WS5's createServerBrowser({ vaultFill }) receives it.
//
// What it does, in order (any «no» ends it with failed and the reason; nothing is typed):
//   1. the page is https (or http to the private IP an item names exactly), and is the «site» the agent named, if any;
//   2. the worker (worker.mjs) says which item of the person's shared collection matches the page's address
//      (match.mjs: exact host by default) — only the item's uid comes back;
//   3. first use of that item on that host by that person: an approval card (or, without a bot, a notice) → failed:
//      needs_approval; once approved, every later fill just leaves a notice for the person;
//   4. the visible user name / password / one-time-code fields of the page's own origin are found;
//   5. only then the worker gives the values of that one item for that page (matched again there), the fields are
//      marked as filled (redacted) and typed at a human pace; the values are dropped right after;
//   6. the vault down (or the API key revoked): failed, and the person gets one notice a day about it.
import { tr } from '../../core/context.mjs';
import { hostOf, pageSchemeOk, siteIsPage } from './match.mjs';

const REASON = /^[a-z_]{2,40}$/;
const failed = (reason) => ({ ok: false, reason: REASON.test(String(reason)) ? reason : 'error' });
const DOWN = new Set(['vault_unavailable', 'vault_revoked', 'wrong_password', 'not_configured', 'no_collection', 'session_expired']);

// The fields the vault may fill, among the visible inputs of this document (refs as the agent sees them; an input that
// the snapshot did not number is added at the end of the list, so the agent's numbers do not change).
export const FIND_FIELDS = `(() => {
  const refs = (globalThis.__orbRefs = globalThis.__orbRefs || []);
  const shown = (el) => {
    if (!el || !el.isConnected || el.ownerDocument !== document || el.disabled || el.readOnly) return false;
    const r = el.getBoundingClientRect(); const st = getComputedStyle(el);
    if (r.width < 8 || r.height < 8 || st.visibility !== 'visible' || st.display === 'none' || Number(st.opacity) < 0.1) return false;
    for (let p = el; p; p = p.parentElement) { const s = getComputedStyle(p); if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.1) return false; if (p.hidden || p.getAttribute('aria-hidden') === 'true') return false; }
    return true;
  };
  const refOf = (el) => { let i = refs.indexOf(el); if (i < 0) { refs.push(el); i = refs.length - 1; } return i + 1; };
  const inputs = [...document.querySelectorAll('input')].filter(shown);
  const ac = (el) => String(el.getAttribute('autocomplete') || '').toLowerCase();
  const label = (el) => [el.name, el.id, el.getAttribute('aria-label'), el.placeholder].join(' ').toLowerCase();
  const pass = inputs.find((el) => el.type === 'password' && !/new-password/.test(ac(el))) || null;
  const otp = inputs.find((el) => el !== pass && (/one-time-code/.test(ac(el)) || (/(otp|totp|2fa|mfa|one.?time|verification|c(o|ó)digo|code|token)/.test(label(el)) && ['text', 'tel', 'number', ''].includes(el.type)))) || null;
  const textual = (el) => ['text', 'email', 'tel', ''].includes(el.type) && el !== otp;
  let user = inputs.find((el) => textual(el) && /(username|email)/.test(ac(el))) || null;
  if (!user && pass) { const before = inputs.filter((el) => textual(el) && (el.compareDocumentPosition(pass) & Node.DOCUMENT_POSITION_FOLLOWING)); user = (pass.form ? before.filter((el) => el.form === pass.form) : before).pop() || before.pop() || null; }
  if (!user && !pass) user = inputs.find((el) => textual(el) && (el.type === 'email' || /(user|login|email|correo|usuario|account)/.test(label(el)))) || null;
  return { user: user ? refOf(user) : null, pass: pass ? refOf(pass) : null, otp: otp ? refOf(otp) : null };
})()`;
// The field of a ref gets the keyboard, with its old text selected (typing replaces it). → true when it has the focus.
export const focusField = (ref) => `(() => {
  const el = (globalThis.__orbRefs || [])[${Number(ref) - 1}];
  if (!el || !el.isConnected || el.ownerDocument !== document) return false;
  el.scrollIntoView({ block: 'center' }); el.focus();
  if (typeof el.select === 'function') el.select();
  return document.activeElement === el;
})()`;

const defaultPace = () => 45 + Math.floor(Math.random() * 90); // ms between keys, like a person typing
const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

// deps: vault (createVaultService), approvals ({ has, ask, used }), notices ({ down }), pace() → ms, allowed(person).
export async function vaultFill({ page, person, agent = '', site = '', vault, approvals, notices = null, pace = defaultPace, allowed = () => true } = {}) {
  if (!vault || !page) return failed('vault_off');
  if (!allowed(person)) return failed('vault_off');
  let url; try { url = new URL(String(await page.url())); } catch { return failed('bad_page'); }
  if (!pageSchemeOk(url)) return failed('insecure_page');
  if (site && !siteIsPage(site, url.href)) return failed('other_site');
  const host = hostOf(url.href);
  let item;
  try { item = await vault.match(person, url.href); } catch (error) {
    const code = String(error?.code ?? 'error');
    if (DOWN.has(code)) { try { notices?.down?.(person, code); } catch { /* the answer is failed anyway */ } }
    return failed(code);
  }
  if (!(await approvals.has(person, item.uid, host))) {
    try { await approvals.ask({ person, agent, host, uid: item.uid }); } catch { /* the card could not be made: still refused */ }
    return failed('needs_approval');
  }
  // The fields: visible, of this page's own origin (main frame), inputs.
  try { await page.snapshot(); } catch { /* the refs of the last snapshot, if any */ }
  let found; try { found = await page.world(FIND_FIELDS); } catch { return failed('no_fields'); }
  const plan = [];
  for (const [kind, want] of [['user', 'username'], ['pass', 'password'], ['otp', 'totp']]) {
    const ref = found?.[kind];
    if (!Number.isInteger(ref)) continue;
    if ((want === 'username' && !item.username) || (want === 'password' && !item.password) || (want === 'totp' && !item.totp)) continue;
    let info; try { info = await page.fieldInfo(ref); } catch { info = null; }
    if (!info || info.tag !== 'input' || !info.visible || info.top === false || info.origin !== url.origin) continue;
    plan.push({ ref, want });
  }
  if (!plan.length) return failed('no_fields');
  // The page must still be the one that was matched.
  const same = async () => { try { return new URL(String(await page.url())).origin === url.origin; } catch { return false; } };
  if (!(await same())) return failed('page_changed');
  let values;
  try { values = await vault.secret(person, url.href, item.uid, plan.map((p) => p.want)); } catch (error) { return failed(String(error?.code ?? 'error')); }
  try {
    for (const step of plan) {
      const value = values?.[step.want];
      if (typeof value !== 'string' || !value) continue;
      if (!(await same())) return failed('page_changed');
      await page.markFilled(step.ref);
      if (!(await page.world(focusField(step.ref)))) return failed('no_fields');
      await page.focusPage();
      for (const ch of value) { await page.insertText(ch); await sleep(pace()); }
      await page.markFilled(step.ref);
      await sleep(pace() * 3);
    }
  } catch { return failed('error'); } finally { values = null; }
  try { await approvals.used?.(person, item.uid, host); } catch { /* a notice only */ }
  return { ok: true };
}

// ---- the board side (the engine): approvals per (person, item uid, host), the cards, the notices.
const okKey = (person, uid, host) => `vault_ok:${person}:${uid}:${host}`;
// The approval card's answer (src/engine/bots.mjs › execute 'vault'): this person, this item, this host.
export function grantVault(board, person, uid, host) {
  if (!person || !/^[\w-]{1,80}$/.test(String(uid ?? '')) || !/^[a-z0-9.:[\]-]{1,260}$/i.test(String(host ?? ''))) throw new Error('vault: tarjeta sin datos válidos');
  board.settingJson(okKey(person, uid, host), { at: new Date().toISOString() });
}
export function boardApprovals(board, { addRequest = null, noticeEveryMs = 10 * 60_000 } = {}) {
  const lastNotice = new Map();
  return {
    has: (person, uid, host) => Boolean(board.settingJson(okKey(person, uid, host))),
    grant: (person, uid, host) => grantVault(board, person, uid, host),
    // 3.7 (WS4): the sites this person approved (Ajustes › Orb Server › Contraseñas): [{ host, at }], newest first, one per
    // host (several items on one site count once). Nothing of the vault itself: only the host and when.
    list(person) {
      const prefix = `vault_ok:${person}:`;
      const rows = board.all("SELECT key, value FROM settings WHERE key LIKE ? ESCAPE '\\'", `${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      const byHost = new Map();
      for (const r of rows) {
        const host = r.key.slice(prefix.length).split(':').slice(1).join(':'); if (!host) continue;
        let at = null; try { at = JSON.parse(r.value)?.at ?? null; } catch { /* old value */ }
        if (!byHost.has(host) || String(at ?? '') > String(byHost.get(host) ?? '')) byHost.set(host, at);
      }
      return [...byHost].map(([host, at]) => ({ host, at })).sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
    },
    forget: (person) => board.run("DELETE FROM settings WHERE key LIKE ? ESCAPE '\\'", `${`vault_ok:${person}:`.replace(/[\\%_]/g, (c) => `\\${c}`)}%`),
    // A bot asks: a card in its conversation (one at a time per item and host). Anyone else: a notice for the person.
    ask({ person, agent, host, uid }) {
      const bot = /^bot:(\d+)$/.exec(String(agent ?? ''))?.[1];
      if (bot && addRequest) {
        const open = board.all("SELECT payload FROM bot_requests WHERE bot_id = ? AND kind = 'vault' AND status IN ('pending', 'waiting')", Number(bot));
        if (open.some((r) => { try { const p = JSON.parse(r.payload); return p.uid === uid && p.host === host && p.person === person; } catch { return false; } })) return;
        addRequest(board, Number(bot), 'vault', { person, host, uid }, { person });
        return;
      }
      board.notice(tr('msg.vault.needsOk', { host }), 'warning', { person });
    },
    // After a fill that was approved before: a notice for the person (not more than one per host every 10 minutes).
    used(person, uid, host) {
      const k = `${person}|${host}`; const now = Date.now();
      if (now - (lastNotice.get(k) ?? 0) < noticeEveryMs) return;
      lastNotice.set(k, now);
      board.notice(tr('msg.vault.filled', { host }), 'info', { person });
    }
  };
}
// The vault could not be used: one notice a day per person.
export function boardNotices(board) {
  return {
    down(person, code) {
      const day = new Date().toISOString().slice(0, 10);
      const key = `vault_down:${person}`;
      if (board.setting(key) === day) return;
      board.setting(key, day);
      board.notice(tr(code === 'vault_revoked' ? 'msg.vault.revoked' : code === 'not_configured' ? 'msg.vault.notConfigured' : 'msg.vault.down'), 'warning', { person });
    }
  };
}

// The hook WS5's browser calls: (tab, { site }, page) → { ok, reason }. deps: { vault, board, addRequest, allowed, pace }.
export function createVaultFillHook({ vault, board, addRequest = null, allowed = () => true, pace = defaultPace, approvals = null, notices = null }) {
  const ap = approvals ?? boardApprovals(board, { addRequest });
  const nt = notices ?? boardNotices(board);
  return async (tab, args, page) => {
    const r = await vaultFill({ page, person: tab?.person, agent: tab?.agent ?? '', site: typeof args?.site === 'string' ? args.site : '', vault, approvals: ap, notices: nt, pace, allowed });
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  };
}
