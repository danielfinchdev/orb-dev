// Tokens of the agents outside Orb (Claude Code in a terminal, Claude Desktop) that create tasks through the loopback MCP
// server (src/engine/host/mcp-external.mjs). One token per client. Only a SHA-256 of the secret part is kept, in the vault
// (secretos.json, sealed with the data key): the token itself is shown once, when it is made. A token has an expiry, a list
// of the projects it may use and can be revoked; nothing here can raise a permission (the server makes every task isolated
// and at «Preguntar», whatever the client says). No imports of the engine.
import crypto from 'node:crypto';

export const PREFIX = 'mcpext/';
export const MAX_TOKENS = 20;
export const MAX_NAME = 60;
export const MAX_PROJECTS = 50;
export const DEFAULT_DAYS = 30;
export const MAX_DAYS = 365;
export const TOKEN_RE = /^orbmcp_([0-9a-f]{12})_([A-Za-z0-9_-]{43})$/;
const DAY = 86_400_000;

export class TokenError extends Error {
  constructor(code, message) { super(message ?? code); this.name = 'TokenError'; this.code = code; this.userFacing = true; }
}

const sha = (secret) => crypto.createHash('sha256').update(String(secret)).digest();
// control, format (zero-width, bidi) and line-separator characters are dropped: a name cannot spoof a log line
const cleanName = (v) => String(v ?? '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
export const clientLabel = (id) => `mcp:${id}`;

function cleanProjects(list) {
  if (!Array.isArray(list) || !list.length) throw new TokenError('projects', 'choose at least one project');
  if (list.length > MAX_PROJECTS) throw new TokenError('projects', 'too many projects');
  const out = [...new Set(list.map((p) => String(p ?? '').trim()).filter(Boolean))];
  if (!out.length || out.some((p) => p.length > 200)) throw new TokenError('projects', 'bad project list');
  return out;
}

const read = (master, id) => { try { const r = JSON.parse(master.get(`${PREFIX}${id}`) ?? 'null'); return r && typeof r === 'object' ? r : null; } catch { return null; } };
const write = (master, rec) => master.set(`${PREFIX}${rec.id}`, JSON.stringify(rec));
const unlockedOrThrow = (master) => { if (!master?.unlocked?.()) throw new TokenError('locked', 'the vault is locked'); };
const view = (r, now) => ({ id: r.id, name: r.name, projects: r.projects, created: r.created, expires: r.expires, revoked: Boolean(r.revoked), expired: r.expires <= now });

export function listTokens(master, now = Date.now()) {
  if (!master?.unlocked?.()) return [];
  return master.ids(PREFIX).map((k) => read(master, k.slice(PREFIX.length))).filter(Boolean).map((r) => view(r, now)).sort((a, b) => b.created - a.created);
}

// → { token, ...view }. The token is returned this once.
export function createToken(master, { name, projects, days = DEFAULT_DAYS, now = Date.now() }) {
  unlockedOrThrow(master);
  const label = cleanName(name); if (!label) throw new TokenError('name', 'the client needs a name');
  const d = Number(days); if (!Number.isFinite(d) || d < 1 || d > MAX_DAYS) throw new TokenError('days', `expiry between 1 and ${MAX_DAYS} days`);
  if (listTokens(master, now).length >= MAX_TOKENS) throw new TokenError('max', 'too many tokens: remove one');
  const id = crypto.randomBytes(6).toString('hex');
  const secret = crypto.randomBytes(32).toString('base64url');
  const rec = { id, name: label, hash: sha(secret).toString('hex'), projects: cleanProjects(projects), created: now, expires: now + Math.round(d * DAY), revoked: false };
  write(master, rec);
  return { token: `orbmcp_${id}_${secret}`, ...view(rec, now) };
}

// Revoking keeps the row (to show it and to refuse the token); removing deletes it.
export function revokeToken(master, id, now = Date.now()) {
  unlockedOrThrow(master);
  const rec = read(master, String(id)); if (!rec) throw new TokenError('missing', 'unknown token');
  if (!rec.revoked) write(master, { ...rec, revoked: true, revokedAt: now });
  return view({ ...rec, revoked: true }, now);
}
export function removeToken(master, id) {
  unlockedOrThrow(master);
  if (!read(master, String(id))) throw new TokenError('missing', 'unknown token');
  master.set(`${PREFIX}${id}`, null);
  return true;
}
export function setTokenProjects(master, id, projects, now = Date.now()) {
  unlockedOrThrow(master);
  const rec = read(master, String(id)); if (!rec) throw new TokenError('missing', 'unknown token');
  const next = { ...rec, projects: cleanProjects(projects) };
  write(master, next);
  return view(next, now);
}

// The header value → the client it belongs to ({ id, name, projects }), or null for anything that is not a live token:
// malformed, unknown, another token's secret, revoked, expired or a locked vault. One answer for all of them (no oracle).
export function checkToken(master, header, now = Date.now()) {
  try {
    if (!master?.unlocked?.()) return null;
    const m = /^Bearer ([^\s]{1,200})$/.exec(String(header ?? ''));
    const t = m && TOKEN_RE.exec(m[1]); if (!t) return null;
    const rec = read(master, t[1]);
    // hash the secret even when the row is missing, so the time does not tell whether the id exists
    const given = sha(t[2]); const kept = Buffer.from(typeof rec?.hash === 'string' && /^[0-9a-f]{64}$/.test(rec.hash) ? rec.hash : '0'.repeat(64), 'hex');
    const same = crypto.timingSafeEqual(given, kept);
    if (!rec || !same || rec.revoked || !(rec.expires > now) || rec.id !== t[1]) return null;
    return { id: rec.id, name: rec.name, projects: Array.isArray(rec.projects) ? rec.projects.map(String) : [] };
  } catch { return null; }
}
