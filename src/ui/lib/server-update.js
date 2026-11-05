// 3.7: a new version of the linked Orb Server, shown like the app's own (components/update-card.jsx › ServerUpdateCard).
// Pure pieces (test/server-update-card.test.mjs): when to ask the Server, whether to show the card and which refusals hide it.
export const POLL_MS = 4 * 3600_000; // how often the app asks the Server for its update state
export const STALE_MS = 12 * 3600_000; // older than this (or never checked): ask the Server to check now

// status: server.update.status ({ available, checkedAt, applying, appDir, ... }) or null (no updater there).
export const needsCheck = (status, now = Date.now()) => {
  if (!status || status.applying) return false;
  const at = Date.parse(status.checkedAt ?? '');
  return !Number.isFinite(at) || now - at > STALE_MS;
};

// What the card shows: null (nothing) or { version, applying }. Only for the app's own link to a Server that is online
// (on the Server itself or a phone there is no card, like the app's), only an installed Server (it can update itself),
// only when the caller may administer it and not hidden for that version.
export function serverOffer({ server, status, denied = false, hidden = '' } = {}) {
  if (!server?.linked || server.direct || !server.peer?.online || denied) return null;
  const version = status?.available?.version;
  if (!version || !status.appDir || hidden === version) return null;
  return { version, applying: Boolean(status.applying) };
}

// A refusal of the Server (not the owner, or the device lacks «Puede administrar»): the card stays hidden for good. Through
// the app's bridge only the text arrives (wrapped: «Error invoking remote method …: <text>»).
export const isDenied = (error, messages = []) => {
  if (!error) return false;
  if (error.status === 403 || error.name === 'AuthzError') return true;
  const text = String(error.message ?? error);
  return messages.some((m) => m && text.includes(m));
};
