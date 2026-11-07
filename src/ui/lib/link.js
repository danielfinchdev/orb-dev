// The pure pieces of Magic Link (no React, no store): what a pasted link says, the order of the linked devices, whether this
// window may manage them and the countdown of a code. Tested in test/link-ui.test.mjs.

// What the user pasted to link with another Orb: the QR's text (its link or its JSON), or a short code and an address
// («ABCD-EFGH http://100.64.0.2:7777», in any order, or each in its own box). null when it says nothing usable.
export function parseLinkInput(text, address = '') {
  const s = String(text ?? '').trim();
  if (!s && !address) return null;
  if (/#vincular=|[?&]vincular=/.test(s) || s.startsWith('{')) return { qr: s };
  const code = /\b([A-Z0-9]{4})-?([A-Z0-9]{4})\b/i.exec(s);
  const addr = String(address ?? '').trim() || (/\b(https?:\/\/[^\s]+)/i.exec(s)?.[1] ?? /\b((?:\d{1,3}\.){3}\d{1,3}(?::\d+)?|[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?)\b/i.exec(s.replace(code?.[0] ?? '', ''))?.[1] ?? '');
  if (!code || !addr) return null;
  return { code: `${code[1]}-${code[2]}`.toUpperCase(), address: /^https?:\/\//i.test(addr) ? addr : `http://${addr}` };
}

// The linked devices: the ones on now first, then by last use (newest first).
export function sortDevices(list) {
  return [...(Array.isArray(list) ? list : [])].sort((a, b) => Number(Boolean(b.online)) - Number(Boolean(a.online)) || String(b.lastSeen ?? '').localeCompare(String(a.lastSeen ?? '')));
}

// Whether this window may link and unlink devices: the PC app always; a linked device only if the Orb lets it (app.state › access).
export const canManageLinks = ({ mobile, access } = {}) => !mobile || Boolean(access?.links);

// «4:59» until a code expires (0:00 when it has).
export function countdown(expiresAt, now = Date.now()) {
  const s = Math.max(0, Math.ceil((Number(expiresAt) - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
