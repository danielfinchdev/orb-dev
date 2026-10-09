// Notifications on the phone (Web Push), sent by the PC itself to the browser's push service (Google, Apple, Mozilla):
// free, no server of our own. The message is encrypted for that phone (RFC 8291), so the push service cannot read it,
// and signed with this PC's VAPID key (RFC 8292). Works when the phone's page is HTTPS (Tailscale), which browsers need
// for push.
import crypto from 'node:crypto';

const PUSH_HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)android\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];
const SUBJECT = 'https://github.com/danielfinchdev/orb-dev';
const b64u = (buf) => Buffer.from(buf).toString('base64url');

// This PC's VAPID key, made once and kept with the device keys ({ publicKey, privateJwk }).
export function newVapidKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  return { publicKey: b64u(raw), privateJwk: privateKey.export({ format: 'jwk' }) };
}

// A subscription a phone sent is only kept if it points to a known push service over https (never anywhere else).
export function checkSubscription(sub) {
  if (!sub || typeof sub !== 'object') throw new Error('suscripción no válida');
  let url; try { url = new URL(String(sub.endpoint)); } catch { throw new Error('suscripción no válida'); }
  if (url.protocol !== 'https:' || !PUSH_HOSTS.some((re) => re.test(url.hostname))) throw new Error('servicio de avisos no reconocido');
  const p256dh = Buffer.from(String(sub.keys?.p256dh ?? ''), 'base64url');
  const auth = Buffer.from(String(sub.keys?.auth ?? ''), 'base64url');
  if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) throw new Error('suscripción no válida');
  return { endpoint: url.toString(), keys: { p256dh: b64u(p256dh), auth: b64u(auth) } };
}

function vapidHeader(endpoint, vapid) {
  const key = crypto.createPrivateKey({ key: vapid.privateJwk, format: 'jwk' });
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${vapid.publicKey}`;
}

// RFC 8291 (aes128gcm): one record with the payload.
export function encryptPayload(sub, payload) {
  const ua = Buffer.from(sub.keys.p256dh, 'base64url');
  const auth = Buffer.from(sub.keys.auth, 'base64url');
  const ecdh = crypto.createECDH('prime256v1');
  const as = ecdh.generateKeys();
  const secret = ecdh.computeSecret(ua);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua, as]), 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21); salt.copy(header, 0); header.writeUInt32BE(4096, 16); header.writeUInt8(as.length, 20);
  return Buffer.concat([header, as, body]);
}

// Sends one notification. Returns 'ok', 'gone' (the phone dropped the subscription: forget it) or 'error'.
export async function sendPush(sub, data, vapid) {
  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: { Authorization: vapidHeader(sub.endpoint, vapid), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' },
      body: encryptPayload(sub, JSON.stringify(data)),
      signal: AbortSignal.timeout(15_000)
    });
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.ok ? 'ok' : 'error';
  } catch { return 'error'; }
}
