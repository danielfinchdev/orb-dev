// Deterministic test vector for the sealed download of a PC screenshot (AAD.download), for the Android client.
// Prints JSON on stdout: { binary, negatives }. `binary` has the same shape as the `binary` entry of the Android vectors.
import { sealBytes, openBytes, AAD } from '../src/shared/mobile-crypto.mjs';

const hex = (u) => Buffer.from(u).toString('hex');
const fill = (n, f) => Uint8Array.from({ length: n }, (_, i) => f(i) & 255);

// sealBytes() draws its nonce from crypto.getRandomValues: replaced for the call so the output never changes.
function withNonce(nonce, fn) {
  const real = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues: (a) => { a.set(nonce); return a; } } });
  try { return fn(); } finally { Object.defineProperty(globalThis, 'crypto', real); }
}

function buildVector() {
  const deviceId = 'dev-42';
  const name = '1760000000000-0a1b2c3d.jpg';
  const key = fill(32, (i) => i + 1);
  const nonce = fill(24, (i) => 0xe0 + i);
  // JPEG-like bytes that are not valid UTF-8 on purpose.
  const plaintext = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...fill(296, (i) => i * 31)]);
  const aad = AAD.download(deviceId, name);
  const bytes = withNonce(nonce, () => sealBytes(key, plaintext, aad));
  if (hex(openBytes(key, bytes, aad)) !== hex(plaintext)) throw new Error('openBytes mismatch');
  const binary = { key: hex(key), nonce: hex(nonce), aad, name, deviceId, plaintext: hex(plaintext), bytes: hex(bytes) };
  const attempt = (a) => { try { openBytes(key, bytes, a); return false; } catch { return true; } };
  const wrong = [['aad of another name', AAD.download(deviceId, '1760000000000-ffffffff.jpg')], ['aad of upload', AAD.upload(deviceId)], ['aad of another device', AAD.download('dev-43', name)]];
  const negatives = wrong.map(([label, a]) => ({ label, key: binary.key, bytes: binary.bytes, aad: a, throws: attempt(a) }));
  return { binary, negatives };
}

if (process.argv[1]?.endsWith('link-vector-descarga.mjs')) {
  process.stdout.write(`${JSON.stringify(buildVector(), null, 2)}\n`);
}
