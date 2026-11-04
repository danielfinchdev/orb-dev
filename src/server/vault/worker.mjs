// 3.7 (Orb Server, WS6): the vault's own process. It is the only place where the vault is ever open:
//   · it signs in to the person's Bitwarden-compatible vault (client.mjs), keeps the decrypted keys and the login items of
//     the shared collection in its memory only, and drops them when told to forget (or when it ends);
//   · on disk it keeps two files per person in <data>/vault/, both sealed (AES-256-GCM) with a key derived from the
//     server's key (clave.bin): the sign-in (server, API key, master password, collection) and a cache of the last sync
//     (still encrypted by Bitwarden, usable for 24 h when the vault cannot be reached);
//   · it answers the engine with states and short codes; the only values that ever leave it are the user name, password
//     and current TOTP code of ONE item, handed to the filler (fill.mjs) for the page whose address matches that item,
//     checked again here. The engine's API, the agents, the MCP servers and the logs never get any of them.
// It has no stdout/stderr of its own (ignored by the parent) and logs nothing.
//
// The engine side is createVaultService() (same file): it starts the worker on first use (fork, no window) and talks to
// it over IPC: { id, op, ...params } → { id, ok, result | code }.
import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(import.meta.url);
export const CACHE_TTL_MS = 24 * 3600_000; // the sealed sync cache is used for 24 h at most
export const REFRESH_MS = 15 * 60_000; // an open vault older than this is synced again (a revoked item stops soon)
const safe = (person) => String(person ?? '').replace(/[^\w-]/g, '_').slice(0, 60) || 'owner';

// ======================================================================================================================
// The engine's side.
// ======================================================================================================================
// dir: <data>/vault; sealKey: vaultSealKey(server secret) (crypto.mjs) — the worker never sees the server key itself.
export function createVaultService({ dir, sealKey, log = () => {}, timeoutMs = 60_000, env = null } = {}) {
  let child = null; let seq = 0; const waiting = new Map();
  const keyHex = Buffer.from(sealKey).toString('hex');
  function start() {
    if (child) return child;
    const base = env ?? Object.fromEntries(['PATH', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'LANG'].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
    child = fork(FILE, ['--orb-vault-worker'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true, serialization: 'json', execArgv: [], env: base });
    const me = child;
    child.on('message', (m) => { const w = waiting.get(m?.id); if (!w) return; waiting.delete(m.id); clearTimeout(w.timer); if (m.ok) w.resolve(m.result); else w.reject(Object.assign(new Error(m.code), { code: m.code })); });
    child.on('exit', () => {
      if (child === me) child = null;
      for (const [id, w] of waiting) { clearTimeout(w.timer); w.reject(Object.assign(new Error('vault_unavailable'), { code: 'vault_unavailable' })); waiting.delete(id); }
    });
    child.on('error', () => {});
    child.send({ id: 0, op: 'init', key: keyHex, dir });
    return child;
  }
  function request(op, params = {}) {
    const c = start();
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => { waiting.delete(id); reject(Object.assign(new Error('vault_unavailable'), { code: 'vault_unavailable' })); }, timeoutMs);
      waiting.set(id, { resolve, reject, timer });
      try { c.send({ id, op, ...params }); } catch { clearTimeout(timer); waiting.delete(id); reject(Object.assign(new Error('vault_unavailable'), { code: 'vault_unavailable' })); }
    });
  }
  const person = (p) => String(p ?? '');
  return {
    // The person's vault account: tried at once (sign-in, sync, the shared collection opens) and only then kept.
    setup: (p, cfg) => request('setup', { person: person(p), cfg }),
    status: (p) => request('status', { person: person(p) }),
    test: (p) => request('test', { person: person(p) }),
    forget: (p) => request('forget', { person: person(p) }),
    // Fill time (fill.mjs only): which item fits this page (uid only), and then that item's values for it.
    match: (p, url) => request('match', { person: person(p), url: String(url ?? '') }),
    secret: (p, url, uid, want) => request('secret', { person: person(p), url: String(url ?? ''), uid: String(uid ?? ''), want }),
    configured: (p) => fs.existsSync(path.join(dir, `vault-${safe(p)}.json`)),
    running: () => Boolean(child),
    close() { const c = child; child = null; if (c) { try { c.send({ id: -1, op: 'shutdown' }); } catch { /* gone */ } setTimeout(() => { try { c.kill(); } catch { /* gone */ } }, 1500).unref?.(); } }
  };
}

// ======================================================================================================================
// The worker (this file run as a process).
// ======================================================================================================================
async function workerMain() {
  const C = await import('./crypto.mjs');
  const V = await import('./client.mjs');
  const M = await import('./match.mjs');
  const { totp, secondsLeft } = await import('./totp.mjs');
  let sealKey = null; let dir = null;
  const open = new Map(); // person -> { items, syncedAt, token }
  const fetchImpl = globalThis.fetch;

  const file = (p, kind) => path.join(dir, `vault-${safe(p)}.${kind}`);
  const readSealed = (p, kind) => { try { return C.open(sealKey, JSON.parse(fs.readFileSync(file(p, kind), 'utf8')), `vault:${kind}:${p}`); } catch { return null; } };
  const writeSealed = (p, kind, value) => {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const f = file(p, kind); const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(C.seal(sealKey, value, `vault:${kind}:${p}`)), { mode: 0o600 });
    fs.renameSync(tmp, f);
  };
  const remove = (p) => { for (const k of ['json', 'cache']) { try { fs.rmSync(file(p, k), { force: true }); } catch { /* gone */ } } };
  const cleanCfg = (c) => ({
    server: String(c?.server ?? '').trim().slice(0, 300), clientId: String(c?.clientId ?? '').trim().slice(0, 80), clientSecret: String(c?.clientSecret ?? '').trim().slice(0, 200),
    password: String(c?.password ?? ''), collection: String(c?.collection ?? 'Orb').trim().slice(0, 100) || 'Orb', deviceId: String(c?.deviceId ?? '') || V.newDeviceId()
  });

  // Signs in and syncs. → { slim, at } (and the cache sealed)
  async function fetchVault(p, cfg) {
    const s = await V.login({ server: cfg.server, clientId: cfg.clientId, clientSecret: cfg.clientSecret, deviceId: cfg.deviceId, fetchImpl });
    const raw = await V.sync({ server: cfg.server, accessToken: s.accessToken, fetchImpl });
    let kdf = s.kdf;
    const email = raw?.profile?.email ?? raw?.Profile?.Email;
    if (!kdf) kdf = await V.prelogin({ server: cfg.server, email, fetchImpl });
    const slim = V.slim(raw, kdf);
    if (!slim.account.key && s.key) slim.account.key = s.key;
    if (!slim.account.privateKey && s.privateKey) slim.account.privateKey = s.privateKey;
    return { slim, at: Date.now() };
  }
  // The person's vault, open: synced now when it is old, else (vault down) the sealed cache while it is under 24 h.
  async function ensureOpen(p, { force = false } = {}) {
    const have = open.get(p);
    if (have && !force && Date.now() - have.syncedAt < REFRESH_MS) return have;
    const cfg = readSealed(p, 'json');
    if (!cfg) { open.delete(p); throw new V.VaultError('not_configured'); }
    let fresh = null; let fromCache = false;
    try { fresh = await fetchVault(p, cfg); } catch (error) {
      const code = V.codeOf(error);
      // The API key was rotated or the account removed: nothing of it is used any more.
      if (code === 'bad_api_key') { open.delete(p); try { fs.rmSync(file(p, 'cache'), { force: true }); } catch { /* gone */ } throw new V.VaultError('vault_revoked'); }
      if (have && Date.now() - have.syncedAt < CACHE_TTL_MS) return have;
      const cached = readSealed(p, 'cache');
      if (!cached || Date.now() - Number(cached.at) >= CACHE_TTL_MS) { open.delete(p); throw new V.VaultError(code === 'vault_unavailable' || code === 'rate_limited' ? 'vault_unavailable' : code); }
      fresh = cached; fromCache = true;
    }
    const { items } = V.openVault(fresh.slim, cfg.password, { collection: cfg.collection });
    if (!fromCache) writeSealed(p, 'cache', fresh);
    const state = { items, syncedAt: Number(fresh.at), collection: cfg.collection, server: cfg.server };
    open.set(p, state);
    return state;
  }
  function status(p) {
    const cfg = readSealed(p, 'json');
    const st = open.get(p);
    let host = ''; let cloud = false;
    if (cfg) { try { const e = V.endpoints(cfg.server); host = new URL(e.api).host; cloud = e.cloud; } catch { /* bad server */ } }
    return { configured: Boolean(cfg), server: host, cloud, collection: cfg?.collection ?? null, items: st ? st.items.length : null, syncedAt: st ? new Date(st.syncedAt).toISOString() : null, argon2: C.argon2Available() };
  }

  const ops = {
    init(m) { sealKey = Buffer.from(String(m.key), 'hex'); dir = String(m.dir); if (sealKey.length !== 32) throw new V.VaultError('bad_key'); return true; },
    async setup(m) {
      const cfg = cleanCfg(m.cfg);
      V.endpoints(cfg.server);
      if (!cfg.password) throw new V.VaultError('no_password');
      const fresh = await fetchVault(m.person, cfg);
      const { items } = V.openVault(fresh.slim, cfg.password, { collection: cfg.collection });
      writeSealed(m.person, 'json', cfg);
      writeSealed(m.person, 'cache', fresh);
      open.set(m.person, { items, syncedAt: fresh.at, collection: cfg.collection, server: cfg.server });
      return status(m.person);
    },
    status: (m) => status(m.person),
    async test(m) { await ensureOpen(m.person, { force: true }); return status(m.person); },
    forget(m) { open.delete(m.person); remove(m.person); return status(m.person); },
    async match(m) {
      let page; try { page = new URL(m.url); } catch { throw new V.VaultError('bad_page'); }
      if (!M.pageSchemeOk(page)) throw new V.VaultError('insecure_page');
      const st = await ensureOpen(m.person);
      const it = M.pickItem(st.items, page);
      if (!it) throw new V.VaultError('no_match');
      return { uid: it.uid, totp: Boolean(it.totp), username: Boolean(it.username), password: Boolean(it.password) };
    },
    // The one place a value leaves this process: for the item `uid` on the page `url`, matched again here.
    async secret(m) {
      const st = await ensureOpen(m.person);
      const it = st.items.find((x) => x.uid === m.uid);
      if (!it || M.itemScore(it, m.url) <= 0 || M.pickItem(st.items, m.url)?.uid !== it.uid) throw new V.VaultError('no_match');
      const want = new Set(Array.isArray(m.want) ? m.want : []);
      const out = {};
      if (want.has('username') && it.username) out.username = it.username;
      if (want.has('password') && it.password) out.password = it.password;
      if (want.has('totp') && it.totp) {
        try {
          // A code with under 3 s left is not typed: wait for the next one.
          if (secondsLeft(it.totp) < 3) await new Promise((r) => setTimeout(r, secondsLeft(it.totp) * 1000 + 200));
          out.totp = totp(it.totp);
        } catch { throw new V.VaultError('bad_totp'); }
      }
      return out;
    },
    shutdown() { open.clear(); setTimeout(() => process.exit(0), 10); return true; }
  };
  process.on('message', async (m) => {
    const id = m?.id;
    const op = Object.hasOwn(ops, m?.op) ? ops[m.op] : null;
    try {
      if (!op) throw new V.VaultError('bad_op');
      if (m.op !== 'init' && !sealKey) throw new V.VaultError('not_ready');
      const result = await op(m);
      if (id) process.send({ id, ok: true, result });
    } catch (error) {
      // Only a short code goes back, never a message that could carry something of the vault.
      const code = /^[a-z_]{2,40}$/.test(String(error?.code ?? '')) ? error.code : 'error';
      if (id) process.send({ id, ok: false, code });
    }
  });
  process.on('disconnect', () => { open.clear(); process.exit(0); });
}

if (process.argv.includes('--orb-vault-worker') && typeof process.send === 'function') workerMain();
