// 3.7 (Orb Server, WS6): a minimal, read-only client of the Bitwarden protocol (Bitwarden cloud or a Vaultwarden on
// the local network). It signs in with the person's personal API key (client_credentials: no two-step prompt, revoked
// by rotating the key), asks for /api/sync, and opens with the master password ONLY the login items of the shared
// collection (the one the person made for Orb, «Orb» by default). Cards, identities, notes and every item outside that
// collection are dropped before anything of them is decrypted. It never writes to the vault.
//
// Runs only inside the vault's worker process (worker.mjs). Errors are short codes (VaultError.code), never a value.
import crypto from 'node:crypto';
import { kdfOf, unlock, decryptText, decrypt, symKey, VaultCryptoError } from './crypto.mjs';
import { isPrivateIp, parseUri } from './match.mjs';

export class VaultError extends Error {
  constructor(code, status = 0) { super(code); this.code = code; this.status = status; }
}
const fail = (code, status) => { throw new VaultError(code, status); };
export const codeOf = (error) => (error instanceof VaultError || error instanceof VaultCryptoError ? error.code : 'error');

// Bitwarden's item types: 1 login, 2 secure note, 3 card, 4 identity, 5 SSH key. Orb only ever opens logins.
export const LOGIN = 1;
export const CARD = 3;
export const DEVICE_TYPE = 25; // «Linux CLI» in Bitwarden's list: a program without a window
const CLIENT = { name: 'cli', version: '2025.1.0' };

// Field names come in camelCase (Vaultwarden 1.27+, Bitwarden) or PascalCase (older servers).
const g = (o, k) => (o == null ? undefined : o[k] ?? o[k[0].toUpperCase() + k.slice(1)]);

// The server's two addresses. https always, except a private IP address (a Vaultwarden at home) or localhost.
export function endpoints(server) {
  const u = parseUri(server);
  if (!u) fail('bad_server');
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' && !(isPrivateIp(host) || host === 'localhost')) fail('insecure_server');
  for (const region of ['com', 'eu']) {
    if (host === `bitwarden.${region}` || host === `vault.bitwarden.${region}`) return { identity: `https://identity.bitwarden.${region}`, api: `https://api.bitwarden.${region}`, cloud: true };
  }
  const base = `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  return { identity: `${base}/identity`, api: `${base}/api`, cloud: false };
}

async function call(fetchImpl, url, init) {
  let res;
  try { res = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20_000) }); } catch { return fail('vault_unavailable'); }
  let body = null; try { body = await res.json(); } catch { body = null; }
  return { status: res.status, ok: res.ok, body };
}
const headers = (extra = {}) => ({ Accept: 'application/json', 'Device-Type': String(DEVICE_TYPE), 'Bitwarden-Client-Name': CLIENT.name, 'Bitwarden-Client-Version': CLIENT.version, ...extra });

// Sign-in with the personal API key. → { accessToken, expiresAt, kdf (if the server says), key, privateKey }
export async function login({ server, clientId, clientSecret, deviceId, fetchImpl = globalThis.fetch }) {
  if (!/^user\.[0-9a-f-]{36}$/i.test(String(clientId ?? '')) || !String(clientSecret ?? '').trim()) fail('bad_api_key');
  const ep = endpoints(server);
  const form = new URLSearchParams({ grant_type: 'client_credentials', scope: 'api', client_id: String(clientId), client_secret: String(clientSecret).trim(),
    deviceType: String(DEVICE_TYPE), deviceIdentifier: String(deviceId), deviceName: 'Orb Server' });
  const r = await call(fetchImpl, `${ep.identity}/connect/token`, { method: 'POST', headers: headers({ 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' }), body: form.toString() });
  if (r.status === 400 || r.status === 401) fail(String(g(r.body, 'error') ?? '') === 'invalid_client' || r.status === 401 ? 'bad_api_key' : 'login_refused', r.status);
  if (r.status === 429) fail('rate_limited', 429);
  if (!r.ok) fail(r.status >= 500 ? 'vault_unavailable' : 'login_refused', r.status);
  const b = r.body ?? {};
  const token = b.access_token;
  if (typeof token !== 'string' || !token) fail('login_refused');
  const hasKdf = g(b, 'kdf') != null || b.Kdf != null;
  return { accessToken: token, expiresAt: Date.now() + Math.max(60, Number(b.expires_in) || 3600) * 1000 - 30_000, kdf: hasKdf ? kdfOf(b) : null, key: g(b, 'key') ?? null, privateKey: g(b, 'privateKey') ?? null };
}

// The KDF of an account, when the token response did not carry it.
export async function prelogin({ server, email, fetchImpl = globalThis.fetch }) {
  const ep = endpoints(server);
  const r = await call(fetchImpl, `${ep.identity}/accounts/prelogin`, { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ email }) });
  if (!r.ok) fail(r.status >= 500 || !r.status ? 'vault_unavailable' : 'login_refused', r.status);
  return kdfOf(r.body ?? {});
}

export async function sync({ server, accessToken, fetchImpl = globalThis.fetch }) {
  const ep = endpoints(server);
  const r = await call(fetchImpl, `${ep.api}/sync?excludeDomains=true`, { method: 'GET', headers: headers({ Authorization: `Bearer ${accessToken}` }) });
  if (r.status === 401) fail('session_expired', 401);
  if (!r.ok || !r.body) fail(r.status >= 500 || !r.status ? 'vault_unavailable' : 'sync_refused', r.status);
  return r.body;
}

// What is kept of a sync (and sealed in the cache): the account data needed to unlock, the shared collections and the
// login items in organisations. Cards and every non-login item are dropped HERE, before any field of them is opened;
// personal items (no organisation) too: only what the person shared with Orb's collection.
export function slim(raw, kdf = null) {
  const p = g(raw, 'profile') ?? {};
  const kept = (g(raw, 'ciphers') ?? []).filter((c) => Number(g(c, 'type')) === LOGIN && !g(c, 'deletedAt') && g(c, 'organizationId'));
  return {
    account: {
      email: g(p, 'email') ?? '', key: g(p, 'key') ?? null, privateKey: g(p, 'privateKey') ?? null, kdf,
      organizations: (g(p, 'organizations') ?? []).map((o) => ({ id: g(o, 'id'), key: g(o, 'key') })).filter((o) => o.id && o.key)
    },
    collections: (g(raw, 'collections') ?? []).map((c) => ({ id: g(c, 'id'), organizationId: g(c, 'organizationId'), name: g(c, 'name') })).filter((c) => c.id && c.organizationId && c.name),
    ciphers: kept.map((c) => {
      const l = g(c, 'login') ?? {};
      return { id: g(c, 'id'), organizationId: g(c, 'organizationId'), collectionIds: g(c, 'collectionIds') ?? [], key: g(c, 'key') ?? null, name: g(c, 'name') ?? null,
        login: { username: g(l, 'username') ?? null, password: g(l, 'password') ?? null, totp: g(l, 'totp') ?? null, uris: (g(l, 'uris') ?? []).map((u) => ({ uri: g(u, 'uri') ?? null, match: g(u, 'match') ?? null })) } };
    })
  };
}

// Opens the slim vault with the master password. → { items: [{ uid, name, username, password, totp, uris }], collection }
// Only the login items in a collection named `collection` (no case, trimmed).
export function openVault(slimmed, password, { collection = 'Orb' } = {}) {
  const { orgs } = unlock(password, slimmed.account);
  const want = String(collection ?? '').trim().toLowerCase();
  const ids = new Set();
  for (const c of slimmed.collections) {
    const key = orgs.get(String(c.organizationId)); if (!key) continue;
    let name = null; try { name = decryptText(c.name, key); } catch { /* a collection that does not open: not ours */ }
    if (name != null && name.trim().toLowerCase() === want) ids.add(String(c.id));
  }
  if (!ids.size) fail('no_collection');
  const items = [];
  for (const c of slimmed.ciphers) {
    if (!(c.collectionIds ?? []).some((id) => ids.has(String(id)))) continue;
    const orgKey = orgs.get(String(c.organizationId)); if (!orgKey) continue;
    try {
      const key = c.key ? symKey(decrypt(c.key, orgKey)) : orgKey;
      const t = (s) => decryptText(s, key);
      const uris = (c.login.uris ?? []).map((u) => ({ uri: t(u.uri), match: u.match == null ? null : Number(u.match) })).filter((u) => u.uri);
      items.push({ uid: String(c.id), name: t(c.name) ?? '', username: t(c.login.username), password: t(c.login.password), totp: t(c.login.totp), uris });
    } catch { /* an item that does not open (changed meanwhile, a bad MAC) is skipped, never half used */ }
  }
  return { items };
}

// A device id for this server's sign-ins (kept with the sealed sign-in, so the vault shows one «Orb Server» device).
export const newDeviceId = () => crypto.randomUUID();
