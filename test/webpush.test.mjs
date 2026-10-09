// Notifications to the phone (Web Push): the message is encrypted so only that browser can read it (RFC 8291), the VAPID
// signature is valid (RFC 8292), and only known push services over https are accepted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { newVapidKeys, checkSubscription, encryptPayload } from '../src/engine/webpush.mjs';

// What the phone's browser does with what it receives (RFC 8291, the receiving side).
function decrypt(body, uaEcdh, auth) {
  const salt = body.subarray(0, 16); const idlen = body[20]; const as = body.subarray(21, 21 + idlen); const ct = body.subarray(21 + idlen);
  const ua = uaEcdh.getPublicKey();
  const secret = uaEcdh.computeSecret(as);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua, as]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, 'delimitador de último registro');
  return plain.subarray(0, -1).toString();
}

test('el aviso va cifrado para ese móvil y solo él lo abre', () => {
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const sub = checkSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } });
  const body = encryptPayload(sub, JSON.stringify({ title: 'Orb', body: 'La tarea #3 espera tu aprobación' }));
  assert.ok(!body.toString('latin1').includes('aprobación'), 'no se lee por el camino');
  assert.deepEqual(JSON.parse(decrypt(body, ua, auth)), { title: 'Orb', body: 'La tarea #3 espera tu aprobación' });
  const other = crypto.createECDH('prime256v1'); other.generateKeys();
  assert.throws(() => decrypt(body, other, auth), 'otro navegador no puede');
});

test('la clave VAPID firma y su parte pública es la que espera el navegador', () => {
  const v = newVapidKeys();
  const pub = Buffer.from(v.publicKey, 'base64url');
  assert.equal(pub.length, 65); assert.equal(pub[0], 4);
  const key = crypto.createPrivateKey({ key: v.privateJwk, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from('hola'), { key, dsaEncoding: 'ieee-p1363' });
  const pubKey = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from('hola'), { key: pubKey, dsaEncoding: 'ieee-p1363' }, sig));
});

test('solo servicios de avisos conocidos, por https y con claves bien formadas', () => {
  const keys = { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url'), auth: Buffer.alloc(16).toString('base64url') };
  for (const endpoint of ['https://web.push.apple.com/abc', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://fcm.googleapis.com/fcm/send/y']) assert.ok(checkSubscription({ endpoint, keys }));
  for (const endpoint of ['http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.atacante.example/x', 'https://127.0.0.1/x', 'file:///c:/x']) assert.throws(() => checkSubscription({ endpoint, keys }), endpoint);
  assert.throws(() => checkSubscription({ endpoint: 'https://fcm.googleapis.com/x', keys: { ...keys, auth: 'corta' } }));
});
