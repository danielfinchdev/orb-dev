// 3.7 (Orb Server, WS6): la criptografía de la bóveda (Bitwarden / Vaultwarden), sin red ni Docker. Contra vectores
// oficiales de los estándares que usa Bitwarden (PBKDF2-SHA256 de RFC 7914, HKDF de RFC 5869, Argon2id de RFC 9106,
// TOTP de RFC 6238) y contra una cuenta grabada en los formatos de Bitwarden (test/fixtures/vault/account.json:
// EncString tipo 2 con HMAC, claves de organización RSA-OAEP, claves por elemento). Las tarjetas nunca se descifran.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT } from './helpers.mjs';
import * as C from '../src/server/vault/crypto.mjs';
import * as V from '../src/server/vault/client.mjs';
import { totp, hotp, parseTotp, base32 } from '../src/server/vault/totp.mjs';

const F = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'vault', 'account.json'), 'utf8'));
const code = (c) => (e) => e?.code === c;

test('PBKDF2-SHA256 y HKDF-Expand: vectores de RFC 7914 y RFC 5869', () => {
  // RFC 7914 §11: PBKDF2-HMAC-SHA256 (P="passwd", S="salt", c=1, dkLen=64)
  assert.equal(crypto.pbkdf2Sync('passwd', 'salt', 1, 64, 'sha256').toString('hex'),
    '55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783');
  // RFC 5869 A.1: HKDF-Expand from its PRK (Bitwarden expands the master key directly, without the extract step)
  const prk = Buffer.from('077709362c2e32df0ddc3f0dc47bba6390b6c73bb50f9c3122ec844ad7c2b3e5', 'hex');
  const info = Buffer.from('f0f1f2f3f4f5f6f7f8f9', 'hex');
  assert.equal(C.hkdfExpand(prk, info, 42).toString('hex'), '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865');
  // The master key is PBKDF2(password, lowercase e-mail): the fixture's e-mail has capitals on purpose.
  const mk = C.masterKey(F.password, F.email, F.kdf.pbkdf2);
  assert.deepEqual(mk, crypto.pbkdf2Sync(F.password, F.email.trim().toLowerCase(), F.kdf.pbkdf2.iterations, 32, 'sha256'));
  assert.deepEqual(C.stretch(mk).enc, C.hkdfExpand(mk, 'enc', 32));
});

test('Argon2id: vector de RFC 9106, y la cuenta Argon2 de la grabación (o una negativa clara sin Node 24)', { skip: !C.argon2Available() && 'Node sin crypto.argon2' }, () => {
  const r = crypto.argon2Sync('argon2id', { message: Buffer.alloc(32, 1), nonce: Buffer.alloc(16, 2), secret: Buffer.alloc(8, 3), associatedData: Buffer.alloc(12, 4), parallelism: 4, tagLength: 32, memory: 32, passes: 3 });
  assert.equal(Buffer.from(r).toString('hex'), '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659');
  // Bitwarden's Argon2id: salt = SHA-256(lowercase e-mail), memory in MiB.
  const mk = C.masterKey(F.password, F.email, F.kdf.argon2id);
  assert.equal(C.decrypt(F.argon2Key, C.stretch(mk)).toString('hex'), F.expect.userKey);
});

test('ajustes de KDF fuera de los límites de Bitwarden se rechazan; sin Argon2 hay un código propio', () => {
  assert.throws(() => C.masterKey('x', 'a@b.c', { type: 0, iterations: 1 }), code('bad_kdf'));
  assert.throws(() => C.masterKey('x', 'a@b.c', { type: 1, iterations: 3, memory: 4096, parallelism: 1 }), code('bad_kdf'));
  assert.throws(() => C.masterKey('x', 'a@b.c', { type: 7, iterations: 600000 }), code('bad_kdf'));
  if (!C.argon2Available()) assert.throws(() => C.masterKey('x', 'a@b.c', F.kdf.argon2id), code('argon2_unsupported'));
});

test('EncString tipo 2: el HMAC se comprueba antes de descifrar; tipos sin MAC no se aceptan', () => {
  const key = C.symKey(Buffer.from(F.expect.orgKey, 'hex'));
  const s = C.encrypt('hola', key);
  assert.equal(C.decryptText(s, key), 'hola');
  const [head, data, mac] = s.split('|');
  const flipped = Buffer.from(data, 'base64'); flipped[0] ^= 1;
  assert.throws(() => C.decrypt(`${head}|${flipped.toString('base64')}|${mac}`, key), code('bad_mac'));
  assert.throws(() => C.decrypt(s, C.symKey(crypto.randomBytes(64))), code('bad_mac'));
  assert.throws(() => C.parseEncString(`0.${head.slice(2)}|${data}`), code('unsupported_encstring'));
  assert.throws(() => C.parseEncString(`${head}|${data}`), code('bad_encstring'));
  assert.throws(() => C.parseEncString('sin tipo'), code('bad_encstring'));
});

test('la cuenta grabada se abre: clave de usuario, clave privada y claves de organización (RSA-OAEP SHA-1 y SHA-256)', () => {
  const account = V.slim(F.sync, F.kdf.pbkdf2).account;
  const { userKey, orgs } = C.unlock(F.password, account);
  assert.equal(C.keyBytes(userKey).toString('hex'), F.expect.userKey);
  assert.equal(C.keyBytes(orgs.get(F.sync.profile.organizations[0].id)).toString('hex'), F.expect.orgKey, 'tipo 4: OAEP con SHA-1');
  assert.equal(C.keyBytes(orgs.get(F.sync.profile.organizations[1].id)).toString('hex'), F.expect.otherOrgKey, 'tipo 3: OAEP con SHA-256');
  assert.throws(() => C.unlock('otra contraseña', account), code('wrong_password'));
});

test('solo los inicios de sesión de la colección compartida; tarjetas, identidades y notas se quitan antes de descifrar nada', () => {
  const slimmed = V.slim(F.sync, F.kdf.pbkdf2);
  const raw = JSON.stringify(slimmed);
  for (const c of F.sync.ciphers.filter((x) => x.type !== 1)) {
    assert.ok(!raw.includes(c.id), `el elemento de tipo ${c.type} no se guarda`);
    for (const v of Object.values(c.card ?? c.identity ?? {})) assert.ok(!raw.includes(v), 'ni sus campos cifrados');
    assert.ok(!raw.includes(c.name));
  }
  assert.ok(slimmed.ciphers.every((c) => c.organizationId), 'nada personal');
  const { items } = V.openVault(slimmed, F.password, { collection: 'Orb' });
  assert.deepEqual(items.map((i) => i.name).sort(), ['Banco', 'Correo', 'Router', 'Tienda']);
  const out = JSON.stringify(items);
  for (const canary of ['CANARY-CARD', 'CANARY-ID', 'CANARY-NOTE', 'CANARY-PW-familia', 'CANARY-PW-borrado', 'CANARY-PW-personal', 'CANARY-PW-otra-org']) assert.ok(!out.includes(canary), canary);
  const correo = items.find((i) => i.name === 'Correo');
  assert.equal(correo.password, 'CANARY-PW-correo-7e7e', 'con su propia clave de elemento');
  assert.deepEqual(correo.uris.map((u) => u.match), [1, 4, 5]);
  assert.throws(() => V.openVault(slimmed, F.password, { collection: 'No existe' }), code('no_collection'));
});

test('lo que se guarda en disco va sellado con la clave del servidor (AES-256-GCM, con su propósito)', () => {
  const key = C.vaultSealKey(crypto.randomBytes(32));
  const box = C.seal(key, { password: F.password }, 'vault:json:p1');
  assert.ok(!JSON.stringify(box).includes(F.password));
  assert.deepEqual(C.open(key, box, 'vault:json:p1'), { password: F.password });
  assert.throws(() => C.open(key, box, 'vault:json:p2'), code('bad_seal'), 'el sello de otra persona no vale');
  assert.throws(() => C.open(C.vaultSealKey(crypto.randomBytes(32)), box, 'vault:json:p1'), code('bad_seal'));
});

test('TOTP: vectores de RFC 6238 (SHA-1, SHA-256, SHA-512) y los formatos de Bitwarden', () => {
  const seeds = { SHA1: Buffer.from('12345678901234567890'), SHA256: Buffer.from('12345678901234567890123456789012'), SHA512: Buffer.from('1234567890123456789012345678901234567890123456789012345678901234') };
  const table = [[59, '94287082', '46119246', '90693936'], [1111111109, '07081804', '68084774', '25091201'], [1111111111, '14050471', '67062674', '99943326'],
    [1234567890, '89005924', '91819424', '93441116'], [2000000000, '69279037', '90698825', '38618901'], [20000000000, '65353130', '77737706', '47863826']];
  for (const [t, ...want] of table) {
    ['SHA1', 'SHA256', 'SHA512'].forEach((algorithm, i) => assert.equal(totp({ key: seeds[algorithm], digits: 8, period: 30, algorithm }, t * 1000), want[i], `${algorithm} T=${t}`));
  }
  assert.equal(hotp(seeds.SHA1, 0), '755224', 'RFC 4226 apéndice D');
  assert.deepEqual(base32('GEZDGNBVGY3TQOJQ'), Buffer.from('1234567890'));
  const p = parseTotp('otpauth://totp/Tienda:ana?secret=JBSWY3DPEHPK3PXP&issuer=Tienda&digits=6');
  assert.equal(p.digits, 6); assert.equal(p.period, 30);
  assert.equal(totp('JBSWY3DPEHPK3PXP', 59_000), totp(p, 59_000));
  assert.throws(() => parseTotp('steam://ABCDEF'), code('bad_totp'));
  assert.throws(() => parseTotp('otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=1'), code('bad_totp'));
});
