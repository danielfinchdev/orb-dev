// Who is signed in to an agent's folder, without spending any plan: Claude Code answers accountInfo() and Codex answers
// account/read; neither is a turn. The e-mail is turned into a fingerprint right here and never leaves this module: what
// goes on is { who, hint }, a 16-character hash and a masked form for the person to recognise it. The organisation's name
// is not part of the fingerprint (a rename must not look like another account).
import crypto from 'node:crypto';

const fingerprint = (email, id) => {
  const e = String(email ?? '').trim(); const i = String(id ?? '').trim();
  return e || i ? crypto.createHash('sha256').update(`${e}|${i}`.toLowerCase()).digest('hex').slice(0, 16) : null;
};

// «d***@g***.com»: enough to tell two accounts apart by eye, not enough to rebuild the address.
export function maskEmail(email) {
  const m = /^([^@\s])[^@\s]*@([^@\s.])[^.@\s]*(\.[^@\s]+)?$/.exec(String(email ?? '').trim());
  return m ? `${m[1]}***@${m[2]}***${m[3] ?? ''}` : null;
}

// What the SDK's accountInfo() says → { who, hint, viaKey, external, plan }.
//   who: null when there is no e-mail to trust (an API key, a gateway or a cloud provider: the folder's login is not what runs).
//   viaKey: an API key (apiKeySource) is what would pay for the turn.
export function identityFromClaude(info) {
  if (!info || typeof info !== 'object') return null;
  const external = Boolean(info.apiProvider) && info.apiProvider !== 'firstParty';
  const viaKey = Boolean(info.apiKeySource) && String(info.apiKeySource).toLowerCase() !== 'none';
  const email = !external && typeof info.email === 'string' && info.email ? info.email : null;
  return { who: email ? fingerprint(email, '') : null, hint: email ? maskEmail(email) : null, viaKey, external, plan: typeof info.subscriptionType === 'string' ? info.subscriptionType : null };
}

// What Codex's account/read says (its `account`) → the same shape. An API-key login has no e-mail.
export function identityFromCodex(account) {
  if (!account || typeof account !== 'object') return null;
  const viaKey = /api.?key/i.test(String(account.type ?? ''));
  const email = typeof account.email === 'string' && account.email ? account.email : null;
  return { who: email ? fingerprint(email, account.accountId) : null, hint: email ? maskEmail(email) : null, viaKey, external: false, plan: typeof account.planType === 'string' ? account.planType : null };
}
