// Makes an error text safe to show: file paths shrink to their last segment and anything that looks like a secret
// (api keys, bearer tokens, long opaque strings) is dropped. The engine writes its messages for people, so the
// sentence stays; only what must not leak goes.
const PATH = /(?:[A-Za-z]:[\/]|\\|\/(?:home|Users|root|var|tmp|etc|opt|mnt)\/)[^\s'"`<>|]*/g;
const SECRET = /\b(?:sk|pk|ghp|gho|ghs|xox[a-z])[-_][A-Za-z0-9_-]{10,}|\bBearer\s+\S+|\b[A-Za-z0-9+/_-]{32,}={0,2}/g;
const MAX = 240;

export function redact(text) {
  const clean = String(text ?? '')
    .replace(PATH, (m) => { const last = m.split(/[\/]/).filter(Boolean).pop(); return last ? `…/${last}` : '…'; })
    .replace(SECRET, '…');
  return clean.length > MAX ? `${clean.slice(0, MAX - 1)}…` : clean;
}
