// Makes test/fixtures/vault/account.json: what a Bitwarden-compatible server answers (/identity/connect/token and
// /api/sync), recorded once in Bitwarden's own formats (EncString type 2 with HMAC, RSA-OAEP org keys, per-item keys) for
// an invented account. Every secret in it is a test canary (CANARY-…): nothing real, the repository is public.
//   node test/fixtures/vault/generate.mjs        (only when the format changes; the tests read the JSON)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { masterKey, stretch, symKey, encrypt, rsaEncrypt, KDF } from '../../../src/server/vault/crypto.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'account.json');
const EMAIL = 'Orb-Server@Example.test'; // mixed case on purpose: the salt is the lowercase e-mail
const PASSWORD = 'CANARY-MASTER-pw-7f3a';
const pbkdf2 = { type: KDF.PBKDF2, iterations: 100000, memory: null, parallelism: null };
const argon = { type: KDF.ARGON2ID, iterations: 3, memory: 16, parallelism: 2 };

const userKeyBytes = crypto.randomBytes(64); const userKey = symKey(userKeyBytes);
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'der' }, privateKeyEncoding: { type: 'pkcs8', format: 'der' } });
const orgKeyBytes = crypto.randomBytes(64); const orgKey = symKey(orgKeyBytes);
const otherOrgBytes = crypto.randomBytes(64); const otherOrg = symKey(otherOrgBytes);
const itemKeyBytes = crypto.randomBytes(64); const itemKey = symKey(itemKeyBytes);
const e = (s, k = orgKey) => encrypt(Buffer.from(s, 'utf8'), k);
const ORG = '7d3e1a52-0f0a-4b8a-9e55-0d9b4c1b0001'; const ORG2 = '7d3e1a52-0f0a-4b8a-9e55-0d9b4c1b0002';
const COL_ORB = 'c0000000-0000-4000-8000-00000000000a'; const COL_FAM = 'c0000000-0000-4000-8000-00000000000b'; const COL_ORB2 = 'c0000000-0000-4000-8000-00000000000c';
const login = (id, name, { user, pass, totp = null, uris, collection = COL_ORB, org = ORG, key = orgKey, cipherKey = null, deletedAt = null }) => ({
  object: 'cipherDetails', id, type: 1, organizationId: org, collectionIds: collection ? [collection] : [], deletedAt, reprompt: 0, key: cipherKey,
  name: e(name, key), notes: null, fields: null,
  login: { username: user ? e(user, key) : null, password: pass ? e(pass, key) : null, totp: totp ? e(totp, key) : null, uris: uris.map(([uri, match]) => ({ uri: e(uri, key), match })) }
});
const ciphers = [
  login('a1000000-0000-4000-8000-000000000001', 'Tienda', { user: 'ana@example.test', pass: 'CANARY-PW-tienda-91c2', totp: 'otpauth://totp/Tienda:ana?secret=JBSWY3DPEHPK3PXP&issuer=Tienda', uris: [['https://tienda.example.com/login', null]] }),
  login('a1000000-0000-4000-8000-000000000002', 'Banco', { user: 'ana.banco', pass: 'CANARY-PW-banco-55aa', uris: [['banco.example.co.uk', 0]] }),
  login('a1000000-0000-4000-8000-000000000003', 'Router', { user: 'admin', pass: 'CANARY-PW-router-0042', uris: [['http://192.168.1.1:8080', null]] }),
  // a per-item key (Bitwarden's «cipher key encryption»), and URIs that must never match (regular expression, never)
  login('a1000000-0000-4000-8000-000000000004', 'Correo', { user: 'ana@mail.example.org', pass: 'CANARY-PW-correo-7e7e', key: itemKey, cipherKey: e(itemKeyBytes), uris: [['https://mail.example.org', 1], ['.*', 4], ['https://nunca.example.org', 5]] }),
  // a payment card in the shared collection: must never be decrypted
  { object: 'cipherDetails', id: 'a1000000-0000-4000-8000-0000000000c3', type: 3, organizationId: ORG, collectionIds: [COL_ORB], deletedAt: null, key: null,
    name: e('CANARY-CARD-name'), card: { cardholderName: e('CANARY-CARD-holder'), number: e('CANARY-CARD-4111111111111111'), code: e('CANARY-CARD-cvv-123'), expMonth: e('12'), expYear: e('2030'), brand: e('Visa') } },
  // an identity and a secure note in the shared collection: not logins, never opened
  { object: 'cipherDetails', id: 'a1000000-0000-4000-8000-0000000000d4', type: 4, organizationId: ORG, collectionIds: [COL_ORB], deletedAt: null, name: e('CANARY-ID-name'), identity: { ssn: e('CANARY-ID-ssn') } },
  { object: 'cipherDetails', id: 'a1000000-0000-4000-8000-0000000000e2', type: 2, organizationId: ORG, collectionIds: [COL_ORB], deletedAt: null, name: e('CANARY-NOTE-name'), notes: e('CANARY-NOTE-body'), secureNote: { type: 0 } },
  // a login in another collection of the same organisation, a deleted one, a personal one and one of another organisation
  login('a1000000-0000-4000-8000-000000000005', 'Familia', { user: 'fam', pass: 'CANARY-PW-familia-other', uris: [['https://tienda.example.com/login', null]], collection: COL_FAM }),
  login('a1000000-0000-4000-8000-000000000006', 'Borrado', { user: 'del', pass: 'CANARY-PW-borrado', uris: [['https://tienda.example.com', null]], deletedAt: '2026-01-01T00:00:00Z' }),
  { ...login('a1000000-0000-4000-8000-000000000007', 'Personal', { user: 'me', pass: 'CANARY-PW-personal', uris: [['https://tienda.example.com', null]], key: userKey }), organizationId: null, collectionIds: [] },
  login('a1000000-0000-4000-8000-000000000008', 'Otra org', { user: 'x', pass: 'CANARY-PW-otra-org', uris: [['https://tienda.example.com', null]], org: ORG2, key: otherOrg, collection: COL_ORB2 })
];
const account = (kdf) => {
  const master = masterKey(PASSWORD, EMAIL, kdf);
  return { key: encrypt(userKeyBytes, stretch(master)) };
};
const pb = account(pbkdf2);
const ar = account(argon);
const profile = {
  object: 'profile', id: 'u0000000-0000-4000-8000-000000000001', email: EMAIL, name: 'Orb Server', key: pb.key, privateKey: encrypt(privateKey, userKey),
  organizations: [{ object: 'profileOrganization', id: ORG, name: 'Casa', key: rsaEncrypt(orgKeyBytes, publicKey, 4), type: 2 }, { object: 'profileOrganization', id: ORG2, name: 'Trabajo', key: rsaEncrypt(otherOrgBytes, publicKey, 3), type: 2 }]
};
const sync = {
  object: 'sync', profile,
  collections: [{ object: 'collectionDetails', id: COL_ORB, organizationId: ORG, name: e(' orb ') }, { object: 'collectionDetails', id: COL_FAM, organizationId: ORG, name: e('Familia') }, { object: 'collectionDetails', id: COL_ORB2, organizationId: ORG2, name: e('Compartida', otherOrg) }],
  folders: [], sends: [], policies: [], ciphers, domains: null
};
const token = { access_token: 'fake-access-token-not-a-secret', expires_in: 3600, token_type: 'Bearer', scope: 'api', Key: pb.key, PrivateKey: profile.privateKey, Kdf: 0, KdfIterations: pbkdf2.iterations, KdfMemory: null, KdfParallelism: null, ResetMasterPassword: false };
const fixture = {
  about: 'Recorded in Bitwarden formats for an invented account; all secrets are test canaries. Made by generate.mjs.',
  email: EMAIL, password: PASSWORD, clientId: 'user.0b5e0a3c-4a51-4c3e-9d8e-5a1f0c2b7d11', clientSecret: 'CANARY-API-SECRET-c1i3nt',
  kdf: { pbkdf2, argon2id: argon }, argon2Key: ar.key,
  // the expected values, to check the decryption against (hex)
  expect: { userKey: userKeyBytes.toString('hex'), orgKey: orgKeyBytes.toString('hex'), otherOrgKey: otherOrgBytes.toString('hex') },
  token, sync
};
fs.writeFileSync(OUT, `${JSON.stringify(fixture, null, 1)}\n`);
console.log(`escrito ${OUT}`);
