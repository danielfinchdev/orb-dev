// The pure pieces of Magic Link (no React, no store): the order of the linked devices and the countdown of a code.
// Tested in test/link-ui.test.mjs.

// The linked devices: the ones on now first, then by last use (newest first).
export function sortDevices(list) {
  return [...(Array.isArray(list) ? list : [])].sort((a, b) => Number(Boolean(b.online)) - Number(Boolean(a.online)) || String(b.lastSeen ?? '').localeCompare(String(a.lastSeen ?? '')));
}

// «4:59» until a code expires (0:00 when it has).
export function countdown(expiresAt, now = Date.now()) {
  const s = Math.max(0, Math.ceil((Number(expiresAt) - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
