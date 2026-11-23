// What a phone's fingerprint approves, as text. The PC and the phone must agree on the bytes: the vault (src-tauri/vault/src/approve.rs)
// signs-checks a payload that holds SHA-256 of the summary below, the phone shows that very summary and checks it hashes to the
// payload's hash, and the vault's one-use token carries `approve:<action>:<hex hash>` as its purpose, which the engine builds again
// from the call's real parameters when the action runs. So the phone can only have approved what then runs.
import crypto from 'node:crypto';

export const SUMMARY_MAX = 16_000;
// Values that are or hold secrets are shown as their hash, not as text (the phone sees what the call is about, never a key).
const SECRET_KEYS = new Set(['env', 'value', 'token', 'password', 'secret', 'key', 'code', 'current', 'next']);
const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// JSON with its keys in order and no spaces, so the same call always says the same text.
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v === undefined ? null : v)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter((k) => value[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
function redact(value, key = '') {
  if (SECRET_KEYS.has(key) && value !== null && value !== undefined && value !== '') return `sha256:${sha(canonical(value))}`;
  if (Array.isArray(value)) return value.map((v) => redact(v));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (k !== 'unlock' && v !== undefined) out[k] = redact(v, k);
    return out;
  }
  return value;
}
// The summary of a call's parameters (never the unlock token).
export const approveSummary = (params) => canonical(redact(params ?? {}));
export const summaryHash = (summary) => sha(summary);
// The purpose of the vault's token for this call: what the phone signed for.
export const approvePurpose = (method, params) => `approve:${method}:${summaryHash(approveSummary(params))}`;

// The signed payload (src-tauri/vault/src/approve.rs › message), built here for the tests and the phones' shared vectors.
const field = (bytes) => { const len = Buffer.alloc(4); len.writeUInt32BE(bytes.length); return Buffer.concat([len, bytes]); };
export function buildPayload({ action, hash, nonce, orbId, deviceId, pcPub, expires }) {
  const until = Buffer.alloc(8); until.writeBigUInt64BE(BigInt(expires));
  return Buffer.concat([Buffer.from('orb-approve-v1'), Buffer.from(action), Buffer.from(hash, 'hex'), Buffer.from(nonce), Buffer.from(orbId), Buffer.from(deviceId), Buffer.from(pcPub), until].map(field));
}
// The other way round: the fields of a payload, or null when it is not one.
export function parsePayload(bytes) {
  const out = []; let at = 0;
  while (at < bytes.length) {
    if (at + 4 > bytes.length) return null;
    const len = bytes.readUInt32BE(at); at += 4;
    if (at + len > bytes.length) return null;
    out.push(bytes.subarray(at, at + len)); at += len;
  }
  if (out.length !== 8 || out[0].toString() !== 'orb-approve-v1' || out[7].length !== 8) return null;
  return { action: out[1].toString(), hash: out[2].toString('hex'), nonce: out[3], orbId: out[4].toString(), deviceId: out[5].toString(), pcPub: out[6], expires: Number(out[7].readBigUInt64BE()) };
}
