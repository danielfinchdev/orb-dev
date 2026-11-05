// 3.7 (Orb Server, WS6): the API of the password vault. Each method acts on the CALLER's own vault account (one per
// person); nobody, not the owner either, sets up, reads or forgets another person's. Who may use one at all: the owner,
// and the people the owner gave the «vault» capability (persons.setCaps). No method ever returns a secret: only the
// state (configured, server's host, collection, how many items, last sync) and short reasons.
// The master password and the API key pass through vault.setup once, straight to the vault's worker (worker.mjs), which
// tries them and seals them with the server's key; they are not logged, audited with values, nor queued in the link.
import { execFile } from 'node:child_process';
import { ctx, tr, saveConfig } from '../core/context.mjs';
import { mayUseVault } from '../core/persons.mjs';
import { fail, str } from '../engine/api-common.mjs';
import { boardApprovals } from './vault/fill.mjs';
import { argon2Available } from './vault/crypto.mjs';
import { VAULT_PROTECTED } from '../core/home.mjs';

const CODE = /^[a-z_]{2,40}$/;
export const reasonText = (code) => { const c = CODE.test(String(code)) ? code : 'error'; const k = `msg.vault.err.${c}`; const t = tr(k); return t === k ? tr('msg.vault.err.error') : t; };
// 3.7: a code the screen can name (msg.vault.err.<code> exists), else 'error': the app never shows a raw key such as
// «msg.vault.err.not_ready».
export const knownCode = (code) => { const c = CODE.test(String(code)) ? code : 'error'; const k = `msg.vault.err.${c}`; return tr(k) === k ? 'error' : c; };

// The containers and data folders of a Vaultwarden/Bitwarden on this machine, added to «Cosas que nadie toca» so no
// agent reaches them except through the official API above. Best effort (Linux with docker); never in the tests.
export function detectVaultTargets({ run = execFile } = {}) {
  if (process.platform !== 'linux' || process.env.ORB_FAKE_AGENTS) return Promise.resolve([]);
  return new Promise((resolve) => {
    run('docker', ['ps', '-a', '--format', '{{.Names}}\t{{.Image}}\t{{.Mounts}}'], { timeout: 5000, windowsHide: true }, (error, out) => {
      if (error) return resolve([]);
      const found = new Set();
      for (const line of String(out ?? '').split('\n')) {
        const [name, image, mounts] = line.split('\t');
        if (!/vaultwarden|bitwarden/i.test(`${name} ${image}`)) continue;
        if (/^[\w.-]{2,80}$/.test(name ?? '')) found.add(name);
        for (const m of String(mounts ?? '').split(',')) { const t = m.trim(); if (/^[\w./-]{2,200}$/.test(t)) found.add(t); }
      }
      resolve([...found]);
    });
  });
}
export function protectTargets(list) {
  const have = Array.isArray(ctx.config.protected) ? ctx.config.protected : [];
  const add = list.filter((x) => !have.some((h) => String(h).toLowerCase() === String(x).toLowerCase()));
  if (add.length) saveConfig({ protected: [...have, ...add] });
  return add;
}

// shared: { board, log }; vault: createVaultService (null: this server has no vault, e.g. the tests of other parts).
export function vaultMethods({ board, log = () => {}, vault = null }) {
  const personOf = (who) => (who && who.channel !== 'system' && who.person ? who.person : board.ownerId());
  const mine = (who) => {
    const p = personOf(who);
    if (!mayUseVault(board, p)) fail(tr('msg.vault.notAllowed'));
    if (!vault) fail(tr('msg.vault.err.vault_off'));
    return p;
  };
  const call = async (fn) => { try { return await fn(); } catch (error) { if (error?.userFacing) throw error; fail(reasonText(error?.code)); } return null; };
  const approvals = boardApprovals(board);
  return {
    'vault.status': async (_p, who) => {
      const p = personOf(who);
      const allowed = mayUseVault(board, p);
      const base = { allowed, available: Boolean(vault), argon2: argon2Available() };
      if (!allowed || !vault) return { ...base, configured: false };
      if (!vault.configured(p)) return { ...base, configured: false };
      try { return { ...base, ...(await vault.status(p)), approvals: approvals.list(p) }; } catch (error) { return { ...base, configured: true, error: knownCode(error?.code) }; }
    },
    // { server, clientId, clientSecret, password, collection } → the state. Tried at once; nothing is kept if it fails.
    'vault.setup': async (params, who) => {
      const p = mine(who);
      const cfg = {
        server: str(params?.server, 'servidor', 300), clientId: str(params?.clientId, 'client_id', 80), clientSecret: str(params?.clientSecret, 'client_secret', 200),
        password: typeof params?.password === 'string' && params.password.length <= 1024 ? params.password : fail(tr('msg.vault.err.no_password')),
        collection: str(params?.collection ?? 'Orb', 'colección', 100)
      };
      const out = await call(() => vault.setup(p, cfg));
      board.event(null, 'usuario', 'vault.setup', out?.server ?? '', { person: p });
      log(`bóveda: conectada para ${p} (${out?.server ?? ''}, ${out?.items ?? 0} elementos)`);
      // The vault's own containers and folders on this machine: nobody's business but the API's.
      detectVaultTargets().then((found) => { const added = protectTargets([...VAULT_PROTECTED, ...found]); if (added.length) log(`bóveda: protegidos ${added.length} contenedores o carpetas`); }).catch(() => {});
      return out;
    },
    'vault.test': async (_p, who) => { const p = mine(who); return call(() => vault.test(p)); },
    // Forgets the sign-in, the cache and the sites approved. In the vault itself nothing changes (the person may also
    // remove Orb's account from the organisation or rotate its API key).
    'vault.forget': async (_p, who) => {
      const p = personOf(who);
      if (vault) await call(() => vault.forget(p));
      approvals.forget(p);
      board.event(null, 'usuario', 'vault.forget', '', { person: p });
      return { configured: false };
    }
  };
}
