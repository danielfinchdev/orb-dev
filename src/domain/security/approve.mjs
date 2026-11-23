// What a phone's fingerprint approves, as text. The PC and the phone must agree on the bytes: the vault (src-tauri/vault/src/approve.rs)
// signs-checks a payload that holds SHA-256 of the summary below, the phone shows that very summary and checks it hashes to the
// payload's hash, and the vault's one-use token carries `approve:<action>:<hex hash>` as its purpose, which the engine builds again
// from the call's real parameters when the action runs. So the phone can only have approved what then runs.
import crypto from 'node:crypto';

export const SUMMARY_MAX = 16_000;
// Values that are or hold secrets are shown as a keyed hash, not as text (the phone sees what the call is about, never a key). Any
// field whose name says it holds one counts. The hash is an HMAC with a key that stays on this PC, so a value of few possibilities
// cannot be guessed from what the phone receives.
const SECRET_KEY = /^(env|value|code|current|next)$|pass|secret|token|key|cred|auth|bearer|pin$/i;
const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const mac = (key, text) => crypto.createHmac('sha256', key).update(text, 'utf8').digest('hex');

// JSON with its keys in order and no spaces, so the same call always says the same text.
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v === undefined ? null : v)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter((k) => value[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
function redact(value, hmacKey, key = '', top = false) {
  if (SECRET_KEY.test(key) && value !== null && value !== undefined && value !== '') return `hmac:${mac(hmacKey, canonical(value))}`;
  if (Array.isArray(value)) return value.map((v) => redact(v, hmacKey));
  if (value && typeof value === 'object') {
    const out = {};
    // Only the call's own unlock token is left out (first level): a field of that name deeper down is a parameter like any other.
    for (const [k, v] of Object.entries(value)) if (!(top && k === 'unlock') && v !== undefined) out[k] = redact(v, hmacKey, k);
    return out;
  }
  return value;
}
// The summary of a call's parameters (never the unlock token). hmacKey: this PC's own key (never sent anywhere).
export const approveSummary = (params, hmacKey) => canonical(redact(params ?? {}, hmacKey, '', true));
export const summaryHash = (summary) => sha(summary);
// The purpose of the vault's token for this call: what the phone signed for.
export const approvePurpose = (method, params, hmacKey) => `approve:${method}:${summaryHash(approveSummary(params, hmacKey))}`;

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
