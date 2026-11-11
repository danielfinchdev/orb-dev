// Generates test vectors for the native Android app from the PC's real code (src/shared). The Kotlin side loads the
// JSON and must reproduce every output byte for byte, so the PC code stays the single source of truth: this script only
// calls the real modules and records what they return, it never re-implements anything.
// Usage: node scripts/android-vectors.mjs [outDir]   (default: android/app/src/test/resources/vectors)
// Output is deterministic (fixed seeds, the nonce source is stubbed), so re-running it changes nothing.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// pairKdfOk accepts cheap scrypt costs under node:test; the vectors must reflect production rules, and a test that
// spawns this script would otherwise inherit the flag.
delete process.env.NODE_TEST_CONTEXT;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = await import('../src/shared/mobile-crypto.mjs');
const L = await import('../src/shared/link-payload.mjs');
const { b64, AAD } = C;

const GENERATED_BY = 'scripts/android-vectors.mjs';
const hex = (u) => Buffer.from(u).toString('hex');
const unhex = (h) => new Uint8Array(Buffer.from(h, 'hex'));
const fill = (n, f) => Uint8Array.from({ length: n }, (_, i) => f(i) & 255);
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex');

// Records the result of a call as data: the value, or that it threw (with the message and the `key` of link errors).
const rec = (fn) => {
  try { return { value: fn() }; }
  catch (e) { const o = { throws: true, message: e.message }; if (e.key) o.key = e.key; if (e.code) o.code = e.code; return o; }
};
const recAsync = async (fn) => {
  try { return { value: await fn() }; }
  catch (e) { const o = { throws: true, message: e.message }; if (e.code) o.code = e.code; return o; }
};

// ---------------------------------------------------------------- crypto
const PRIVS = {
  seq: fill(32, (i) => i + 1),
  ff: new Uint8Array(32).fill(0xff), // needs clamping
  low: Uint8Array.from([1, ...new Array(31).fill(0)]) // almost zero but a valid scalar
};
const pubOf = (k) => C.publicKeyOf(PRIVS[k]);
const names = Object.keys(PRIVS);

function b64Vectors() {
  const encInputs = [0, 1, 2, 3, 4, 5, 32].map((n) => fill(n, (i) => i * 7 + 3));
  encInputs.push(Uint8Array.from([0xfb, 0xff, 0xfe, 0xfb, 0xef, 0xff, 0x3e, 0x3f]), Uint8Array.from([0xfb]), Uint8Array.from([0xff, 0xff]));
  const enc = encInputs.map((b) => ({ bytes: hex(b), b64: b64.enc(b) }));
  const decInputs = [...enc.map((e) => e.b64), '', 'AAAA', 'AA==', 'AA', 'a+b', 'a/b', 'a=b', 'ab c', 'ab\n', 'é', 'A', 'AAAAA', '-_-_', '+/+/', 'YQ=='];
  const dec = decInputs.map((text) => {
    const r = rec(() => hex(b64.dec(text)));
    return r.throws ? { input: text, throws: true } : { input: text, bytes: r.value };
  });
  return { enc, dec };
}

function x25519Vectors() {
  const keys = names.map((k) => ({ name: k, priv: hex(PRIVS[k]), pub: hex(pubOf(k)), pubB64: b64.enc(pubOf(k)), fingerprint: C.fingerprint(pubOf(k)) }));
  const shared = [];
  for (const a of names) for (const b of names) {
    if (a === b) continue;
    const r = rec(() => hex(C.sharedSecret(PRIVS[a], pubOf(b))));
    shared.push({ priv: a, peer: b, ...(r.throws ? { throws: true } : { secret: r.value }) });
  }
  return { keys, shared, lowOrder: lowOrderVectors() };
}

// Peers of small order and non-canonical encodings. The oracle records what the real code does for each (a value or a
// throw) for the shared secret and for both derived keys; Kotlin must match or be stricter, never accept more.
function lowOrderVectors() {
  const le = (n) => Uint8Array.from({ length: 32 }, (_, i) => Number((n >> BigInt(8 * i)) & 0xffn));
  const P = 2n ** 255n - 19n;
  const peers = [
    ['u=0', le(0n)], ['u=1', le(1n)], ['u=p-1', le(P - 1n)], ['u=p', le(P)], ['u=p+1', le(P + 1n)],
    ['order-8 point a', unhex('e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800')],
    ['order-8 point b', unhex('5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157')]
  ];
  // The same points with the unused top bit set (RFC 7748 says to mask it, so they must behave like the originals).
  for (const [name, u] of [...peers]) { const m = Uint8Array.from(u); m[31] |= 0x80; peers.push([`${name} (msb set)`, m]); }
  const code = 'abc_DEF-123';
  return peers.map(([name, u]) => {
    const one = (fn) => { const r = rec(() => hex(fn())); return r.throws ? { throws: true } : { value: r.value }; };
    return {
      name, peerPub: hex(u), priv: hex(PRIVS.seq), code,
      sharedSecret: one(() => C.sharedSecret(PRIVS.seq, u)),
      pairingKey: one(() => C.pairingKey(PRIVS.seq, u, code)),
      sessionKey: one(() => C.sessionKey(PRIVS.seq, u))
    };
  });
}

function keyVectors() {
  const codes = ['abc_DEF-123', 'corto:ABCDEFGH', 'código-ñ-日本語-😀', ''];
  const pairing = [];
  for (const code of codes) pairing.push({ priv: hex(PRIVS.seq), peerPub: hex(pubOf('ff')), code, key: hex(C.pairingKey(PRIVS.seq, pubOf('ff'), code)) });
  pairing.push({ priv: hex(PRIVS.ff), peerPub: hex(pubOf('low')), code: 'abc_DEF-123', key: hex(C.pairingKey(PRIVS.ff, pubOf('low'), 'abc_DEF-123')) });
  const session = [];
  for (const [a, b] of [['seq', 'ff'], ['ff', 'seq'], ['low', 'seq']]) session.push({ priv: hex(PRIVS[a]), peerPub: hex(pubOf(b)), key: hex(C.sessionKey(PRIVS[a], pubOf(b))) });
  return { pairing, session };
}

function shortVectors() {
  return [['ABCDEFGH', b64.enc(pubOf('seq'))], ['23456789', b64.enc(pubOf('ff'))], ['código', b64.enc(pubOf('low'))]]
    .map(([code, pcPubB64]) => ({ code, pcPubB64, secret: C.shortSecret(code, pcPubB64) }));
}

async function verifierVectors() {
  const salt = fill(16, (i) => 0xa0 + i);
  const kdf = { N: 2 ** 15, r: 8, p: 1, salt: b64.enc(salt) };
  const seeds = [fill(32, (i) => i), new Uint8Array(32)].map((s) => {
    const v = C.verifierFromSeed(s); return { seed: hex(s), priv: hex(v.priv), pub: hex(v.pub) };
  });
  const passwords = ['correct horse', 'contraseña', 'contraseña', '🔑 clave 😀', '', 'a'.repeat(100)];
  const of = [];
  for (const password of passwords) {
    const v = await C.verifierOf(password, kdf);
    of.push({ password, passwordUtf8Hex: hex(new TextEncoder().encode(password)), kdf, priv: hex(v.priv), pub: hex(v.pub) });
  }
  const okSalt = b64.enc(fill(16, (i) => i));
  const kdfCases = [
    ['valid 2^15', { N: 2 ** 15, r: 8, p: 1, salt: okSalt }], ['valid 2^16', { N: 2 ** 16, r: 8, p: 1, salt: okSalt }], ['valid 2^18', { N: 2 ** 18, r: 8, p: 1, salt: okSalt }],
    ['N not power of 2', { N: 40000, r: 8, p: 1, salt: okSalt }], ['N 2^14 too cheap', { N: 2 ** 14, r: 8, p: 1, salt: okSalt }],
    ['N 2^19 too costly', { N: 2 ** 19, r: 8, p: 1, salt: okSalt }], ['r not 8', { N: 2 ** 15, r: 4, p: 1, salt: okSalt }],
    ['p not 1', { N: 2 ** 15, r: 8, p: 2, salt: okSalt }], ['salt of 15 bytes', { N: 2 ** 15, r: 8, p: 1, salt: b64.enc(fill(15, (i) => i)) }],
    ['salt of 17 bytes', { N: 2 ** 15, r: 8, p: 1, salt: b64.enc(fill(17, (i) => i)) }], ['bad base64 salt', { N: 2 ** 15, r: 8, p: 1, salt: 'a+b' }],
    ['N as string', { N: '32768', r: 8, p: 1, salt: okSalt }], ['missing salt', { N: 2 ** 15, r: 8, p: 1 }], ['missing N', { r: 8, p: 1, salt: okSalt }],
    ['null', null], ['string', 'x']
  ].map(([label, k]) => ({ label, kdf: k, ok: C.pairKdfOk(k) }));
  const cheap = { N: 2 ** 14, r: 8, p: 1, salt: okSalt };
  const rejected = await recAsync(() => C.verifierOf('x', cheap));
  return { seeds, of, kdfCases, verifierOfRejects: { kdf: cheap, throws: Boolean(rejected.throws), code: rejected.code ?? null } };
}

function pakeVectors() {
  const kdf = { N: 2 ** 16, r: 8, p: 1, salt: b64.enc(fill(16, (i) => 0x40 + i)) };
  const base = { devPub: pubOf('seq'), pcPub: pubOf('ff'), sid: 'sid-0123456789abcdef', kdf };
  const transcripts = [{ ...base, via: 'qr' }, { ...base, via: 'corto', sid: 'sid-ñ' }].map((t) => ({
    via: t.via, devPub: hex(t.devPub), pcPub: hex(t.pcPub), sid: t.sid, kdf: t.kdf, transcript: hex(C.pakeTranscript(t))
  }));
  const keys = [];
  for (const [i, t] of transcripts.entries()) {
    const secret = i === 0 ? 'abc_DEF-123' : 'corto:ABCDEFGH';
    const dhDevice = C.sharedSecret(PRIVS.seq, pubOf('ff')); const dhPassword = C.sharedSecret(PRIVS.low, pubOf('ff'));
    const key = C.pakeKey({ secret, dhDevice, dhPassword, transcript: unhex(t.transcript) });
    keys.push({
      secret, dhDevice: hex(dhDevice), dhPassword: hex(dhPassword), transcript: t.transcript, key: hex(key),
      macPhone: hex(C.pakeMac(key, C.MAC_PHONE)),
      macPc: ['dev-1', 'dispositivo-ñ'].map((id) => ({ id, label: C.macPc(id), mac: hex(C.pakeMac(key, C.macPc(id))) }))
    });
  }
  return { transcripts, keys };
}

// seal() draws its 24-byte nonce from crypto.getRandomValues; the module is not edited, the source is replaced instead.
function withNonce(nonce, fn) {
  const real = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues: (a) => { a.set(nonce); return a; } } });
  try { return fn(); } finally { Object.defineProperty(globalThis, 'crypto', real); }
}

function sealVectors() {
  const id = 'dev-42';
  const aads = { pair: AAD.pair, pairChallenge: AAD.pairChallenge, paired: AAD.paired(id), request: AAD.request(id), response: AAD.response(id), event: AAD.event(id), upload: AAD.upload(id) };
  const values = [
    { id: 'string', value: 'hola' }, { id: 'unicode', value: { texto: 'Canción ñ 日本語 😀', n: 1 } },
    { id: 'nested', value: { a: [1, 2.5, -0, 1e21, 0.1, null, true], b: { c: { d: 'x"y\\z\n' } }, e: [] } },
    { id: 'empty-object', value: {} }, { id: 'number', value: 42 }
  ];
  const key = fill(32, (i) => 0x10 + i);
  const cases = [];
  let n = 0;
  for (const [aadName, aad] of Object.entries(aads)) {
    const v = values[n % values.length];
    const nonce = fill(24, (i) => n * 16 + i);
    const box = withNonce(nonce, () => C.seal(key, v.value, aad));
    const text = withNonce(nonce, () => C.sealText(key, v.value, aad));
    const plaintext = JSON.stringify(v.value);
    const bytesIn = new TextEncoder().encode(plaintext);
    const sealed = withNonce(nonce, () => C.sealBytes(key, bytesIn, aad));
    // The real open must give back exactly what went in, and the string/bytes forms must agree with the box.
    if (JSON.stringify(C.open(key, box, aad)) !== JSON.stringify(JSON.parse(plaintext))) throw new Error('open mismatch');
    if (text !== `${box.n}.${box.c}`) throw new Error('sealText mismatch');
    if (hex(C.openBytes(key, sealed, aad)) !== hex(bytesIn)) throw new Error('openBytes mismatch');
    if (hex(sealed) !== hex(nonce) + hex(b64.dec(box.c))) throw new Error('sealBytes mismatch');
    cases.push({ valueId: v.id, key: hex(key), nonce: hex(nonce), aadName, aad, plaintext, box, text, bytes: hex(sealed) });
    n++;
  }
  // Raw binary payload (a picture): not valid UTF-8 on purpose.
  const bin = fill(300, (i) => i * 31);
  const binNonce = fill(24, (i) => 0xe0 + i);
  const sealedBin = withNonce(binNonce, () => C.sealBytes(key, bin, AAD.upload(id)));
  if (hex(C.openBytes(key, sealedBin, AAD.upload(id))) !== hex(bin)) throw new Error('openBytes bin mismatch');
  const binary = { key: hex(key), nonce: hex(binNonce), aad: AAD.upload(id), plaintext: hex(bin), bytes: hex(sealedBin) };

  const good = cases[3]; // request
  const goodBox = good.box;
  const flip = (s) => { const u = b64.dec(s); u[0] ^= 1; return b64.enc(u); };
  const negatives = [
    ['wrong aad', goodBox, AAD.response(id)], ['flipped ciphertext byte', { n: goodBox.n, c: flip(goodBox.c) }, good.aad],
    ['flipped nonce byte', { n: flip(goodBox.n), c: goodBox.c }, good.aad], ['nonce of 23 bytes', { n: b64.enc(fill(23, (i) => i)), c: goodBox.c }, good.aad],
    ['missing n', { c: goodBox.c }, good.aad], ['missing c', { n: goodBox.n }, good.aad], ['null box', null, good.aad],
    ['n not a string', { n: 5, c: goodBox.c }, good.aad], ['bad base64 in c', { n: goodBox.n, c: 'a+b' }, good.aad], ['ciphertext too short', { n: goodBox.n, c: b64.enc(fill(8, (i) => i)) }, good.aad]
  ].map(([label, box, aad]) => ({ label, key: good.key, box, aad, throws: Boolean(rec(() => C.open(key, box, aad)).throws) }));
  const flipLast = unhex(good.bytes); flipLast[flipLast.length - 1] ^= 1;
  const negBytes = [
    ['wrong aad', unhex(good.bytes), AAD.response(id)], ['shorter than 40 bytes', fill(39, (i) => i), good.aad], ['flipped last byte', flipLast, good.aad]
  ].map(([label, b, aad]) => ({ label, key: good.key, bytes: hex(b), aad, throws: Boolean(rec(() => C.openBytes(key, b, aad)).throws) }));
  const openText = {
    text: good.text, aad: good.aad, key: good.key, plaintext: good.plaintext,
    bad: ['nodot', '.', 'a.b.c'].map((t) => ({ text: t, throws: Boolean(rec(() => C.openText(key, t, good.aad)).throws) }))
  };
  return { aads, cases, binary, negatives, negativeBytes: negBytes, openText };
}

async function buildCrypto() {
  const sid = 'dev-42';
  return {
    generatedBy: GENERATED_BY,
    source: sha('src/shared/mobile-crypto.mjs'),
    constants: {
      CLOCK_SKEW_MS: C.CLOCK_SKEW_MS, PAIR_KDF: C.PAIR_KDF, MAC_PHONE: C.MAC_PHONE, aadSampleId: sid, macPcSample: C.macPc(sid),
      AAD: { pair: AAD.pair, pairChallenge: AAD.pairChallenge, paired: AAD.paired(sid), request: AAD.request(sid), response: AAD.response(sid), event: AAD.event(sid), upload: AAD.upload(sid) }
    },
    b64: b64Vectors(),
    x25519: x25519Vectors(),
    keys: keyVectors(),
    shortSecret: shortVectors(),
    verifier: await verifierVectors(),
    pake: pakeVectors(),
    seal: sealVectors()
  };
}

// ---------------------------------------------------------------- link payload
// Hostile and odd URL forms. The JS is the oracle for every one of them; Kotlin may only be stricter where the test
// names the case explicitly (non-ASCII hosts).
const HOSTILE = [
  'http://evil.com\\@10.0.0.1', 'http://a@b@10.0.0.1', 'http://10.0.0.1:3131@8.8.8.8', 'http://%31%30.0.0.1', 'http://012.0.0.1',
  'http://0300.0250.1.1', 'http://１０．０．０．１', 'http://nas.local.', 'http://[::ffff:10.0.0.1]', 'http://[::fd00:1]', 'http://[fdff::]',
  'http://10.0.0.1:65536', 'http://xn--.example', 'http://xn--a.example', 'http://xn--zzzzzzzzzzzz.example', 'http://xn--nas-9ra.local', 'http://nas.lo\u200dcal'
];
function buildLink() {
  const PC = b64.enc(pubOf('seq'));
  const call = (fn, input) => ({ input, ...rec(() => fn(input)) });
  const callArgs = (fn, args) => ({ input: args, ...rec(() => fn(...args)) });
  const parse = [
    `http://192.168.1.20:3131/#vincular=abc_DEF-123&pc=${PC}`,
    `http://192.168.1.20:3131/#vincular=c0de&pc=${PC}&v=2&n=Servidor&r=centro&a=${encodeURIComponent(['http://192.168.1.20:3131', 'https://casa.tail1234.ts.net:3131', 'http://100.101.102.103:3131'].join(','))}`,
    JSON.stringify({ v: 2, urls: ['http://100.64.0.7:3131', 'https://pc.tail.ts.net'], pc: PC, code: 'k', role: 'taller' }),
    'hola', 'https://example.com/', '{"v":2}', '{roto',
    'http://192.168.1.2:3131/#vincular=abc', 'http://192.168.1.2:3131/#vincular=abc&pc=corta',
    `http://8.8.8.8:3131/#vincular=abc&pc=${PC}`, `orb://x/#vincular=abc&pc=${PC}`,
    `https://orb.example.com/#vincular=abc&pc=${PC}`,
    // extra edge cases
    `  http://10.0.0.5:3131/#vincular=z&pc=${PC}  `, `HTTP://LOCALHOST:3131/#vincular=z&pc=${PC}`, `http://[fd12:3456::1]:3131/#vincular=z&pc=${PC}`,
    `http://192.168.1.2/#vincular=z&pc=${PC}`, `http://192.168.1.2:80/#vincular=z&pc=${PC}`, `https://pc.ts.net:443/#vincular=z&pc=${PC}`,
    `http://192.168.1.2:3131/#vincular=z&pc=${PC}=`, `http://192.168.1.2:3131/#vincular=z&pc=${PC}&v=abc`, `http://192.168.1.2:3131/#vincular=z&pc=${PC}&v=3&n=Caf%C3%A9+%F0%9F%98%80`,
    `http://192.168.1.2:3131/path/x?q=1#vincular=z&pc=${PC}`, `http://192.168.1.2:3131/#vincular=&pc=${PC}`, `http://user:pw@192.168.1.2:3131/#vincular=z&pc=${PC}`,
    '', '   ', null,
    { v: 2, url: 'http://192.168.0.9:3131', pc: PC, code: 'k' }, { urls: ['ftp://x', 'http://192.168.0.9:3131'], pc: PC, code: 'k', name: 'N' },
    { v: '3', urls: ['http://192.168.0.9:3131'], pc: PC, code: 'k' }, { urls: ['http://192.168.0.9:3131'], pc: 5, code: 'k' }, { urls: [], pc: PC, code: 'k' },
    { urls: ['http://8.8.8.8'], pc: PC, code: 'k' },
    ...HOSTILE.map((u) => `${u}/#vincular=z&pc=${PC}`)
  ].map((i) => call(L.parseLinkPayload, i));

  const manual = [
    { text: `  http://10.0.0.5:3131/#vincular=z&pc=${PC}  ` }, { code: 'abcd-efgh', address: '100.64.1.2' }, { code: '', address: '100.64.1.2' },
    { code: 'ABCDEFGH', address: '' }, { code: 'ABCDEFGH', address: '1.1.1.1' }, { code: 'ABCDE', address: '100.64.1.2' }, { code: 'abcdefgh', address: 'casa.tail.ts.net' },
    { code: 'abcdefgh', address: 'https://orb.example.com' }, { code: 'abcdefgh', address: 'http://192.168.1.5:4000/' }, { code: 'abcdefgh', address: '[fd12::1]' },
    { code: 'oO0o1234abcdefgh9999', address: '10.0.0.1' }, { text: '   ', code: 'abcdefgh', address: '10.0.0.1' }, { text: 'hola' }, {}, undefined,
    ...HOSTILE.map((address) => ({ code: 'abcdefgh', address }))
  ].map((i) => call(L.parseManual, i));

  const orderBases = [
    ['http://example.com', 'http://192.168.1.1:3131', 'http://192.168.1.1:3131', 'basura::'],
    ['http://192.168.1.20:3131', 'https://casa.tail1234.ts.net:3131', 'http://100.101.102.103:3131'], ['http://192.168.1.1', '192.168.1.1', 'http://192.168.1.1:3131'],
    ['HTTP://PC.TS.NET', 'http://a.local', 'https://z.example.com'], [], null, ['', '   ', 5, 'http://10.0.0.1'], ['http://[fd12::1]:3131', 'http://100.64.0.1']
  ].map((i) => call(L.orderBases, i));

  const baseInputs = [...HOSTILE, 'https://example.com', 'http://example.com', 'ftp://192.168.1.1', 'http://192.168.1.1:3131', 'http://[::1]:3131', 'http://100.64.0.1', 'http://100.128.0.1', 'nonsense', '', 'HTTP://LOCALHOST', 'http://pc.TS.NET'];
  const allowedBase = baseInputs.map((i) => call(L.allowedBase, i));

  const hosts = ['evil.com\\', '10.0.0.1:3131@8.8.8.8', '012.0.0.1', '０.０.０.０', 'nas.local.', '::ffff:10.0.0.1', '::fd00:1', 'fdff::', 'nas.lo\u200dcal', 'xn--', '100.64.0.1', '100.127.255.254', '100.63.255.255', '100.128.0.0', '10.1.2.3', '172.16.0.1', '172.15.255.255', '172.31.9.9', '172.32.0.1', '192.168.0.10', '192.169.0.1', '127.0.0.1', '127.255.255.255',
    'localhost', 'LOCALHOST', 'pc.tail1234.ts.net', 'home-server', 'nas.local', 'a.lan', 'x.home.arpa', '::1', '[::1]', 'fd12:3456::1', 'fc00::1', 'fe80::1', 'fec0::1', '2001:db8::1',
    '8.8.8.8', 'example.com', '300.1.1.1', '1.2.3', '12345', '1.2.3.4.5', '', null, 'a_b', 'ts.net', 'UPPER-CASE', '0.0.0.0', '169.254.1.1'].map((i) => call(L.isPrivateHost, i));

  const addrs = [...HOSTILE, '100.64.1.2', '100.64.1.2:3131', 'casa.tail.ts.net', 'http://100.64.1.2', 'https://pc.tail.ts.net/', 'HTTPS://PC.TS.NET:8443/x?y#z', ' 10.0.0.1 ', '', '   ', null, '[fd12::1]', '[fd12::1]:4000',
    'http://[::1]', 'http://host:80', 'https://host:443', 'http://host:99999', 'http://', 'http://exa mple.com', 'http://用户.example', 'http://192.168.1.1:3131/', 'http://192.168.1.1.', 'http://0x7f.1', 'http://2130706433', 'http://user:pw@host'].map((i) => call(L.normalAddress, i));

  const secrets = [{ via: 'qr', code: 'abc_DEF-123' }, { via: 'code', code: 'abcd-efgh' }, { via: 'code', code: 'oO0o1234' }, { via: 'code', code: 'a'.repeat(20) }, { via: 'code', code: null }]
    .map((i) => call(L.pairingSecret, i));
  const normalCode = ['abcd-efgh', 'ABCD EFGH', 'oO01', 'a'.repeat(20), '', null, 'ñandú-12'].map((i) => call(L.normalCode, i));
  const shortCodeLabel = ['abcdefgh', 'ABCD-EFGH', 'abc', 'abcd', 'abcde', 'a'.repeat(20), '', null, 'ab cd.ef'].map((i) => call(L.shortCodeLabel, i));
  const versionOfProtocol = [1, 2, 3, 4, 5, '4', 0, null, undefined, 'x'].map((i) => call(L.versionOfProtocol, i));
  const updateNeeded = [[{ min: 5 }], [{ min: 4 }], [{ min: 2 }], [{ min: '6' }], [null], [{}], [{ min: 5 }, 9], [{ min: 'x' }]].map((a) => callArgs(L.updateNeeded, a));
  const passwordPageOk = [[{ protocol: 'https:', hostname: 'x.com' }], [{ protocol: 'http:', hostname: 'localhost' }], [{ protocol: 'http:', hostname: '127.0.0.5' }], [{ protocol: 'http:', hostname: '[::1]' }],
    [{ protocol: 'http:', hostname: 'a.ts.net' }], [{ protocol: 'http:', hostname: '100.64.0.1' }], [{ protocol: 'http:', hostname: '100.128.0.1' }], [{ protocol: 'http:', hostname: '192.168.1.1' }],
    [{ protocol: 'http:', hostname: '192.168.1.1' }, { app: true }], [undefined]].map((a) => callArgs(L.passwordPageOk, a));

  return {
    generatedBy: GENERATED_BY,
    source: sha('src/shared/link-payload.mjs'),
    // pickBridge is web-only (it picks the page's bridge) and is not part of the native app, so it has no vectors.
    constants: { DEFAULT_PORT: L.DEFAULT_PORT, PROTOCOL: L.PROTOCOL, MIN_PROTOCOL: L.MIN_PROTOCOL, PAIR_PROTOCOL: L.PAIR_PROTOCOL, CODE_ALPHABET: L.CODE_ALPHABET },
    pcKeyB64: PC,
    parseLinkPayload: parse, parseManual: manual, orderBases, allowedBase, isPrivateHost: hosts, normalAddress: addrs,
    pairingSecret: secrets, normalCode, shortCodeLabel, versionOfProtocol, updateNeeded, passwordPageOk
  };
}

// ---------------------------------------------------------------- write
const out = path.resolve(process.argv[2] ?? path.join(ROOT, 'android/app/src/test/resources/vectors'));
fs.mkdirSync(out, { recursive: true });
const write = (name, data) => fs.writeFileSync(path.join(out, name), `${JSON.stringify(data, null, 2)}\n`);
write('crypto.json', await buildCrypto());
write('link-payload.json', buildLink());
// The methods a linked phone may call (src/domain/security/permissions.mjs): the client's contract test checks every
// method its API wrapper calls against this list, so a wrapper can never name a method the PC would refuse.
const { REMOTE_METHODS } = await import('../src/domain/security/permissions.mjs');
write('remote-methods.json', { generatedBy: GENERATED_BY, source: sha('src/domain/security/permissions.mjs'), methods: [...REMOTE_METHODS].sort() });
console.log(`vectors written to ${out}`);
