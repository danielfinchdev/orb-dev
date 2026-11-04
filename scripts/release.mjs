// 3.7: the signing of Orb Server's releases (ed25519), on the owner's PC, offline. The private key never enters this
// repository: it lives in a file outside it, ORB_RELEASE_KEY or %USERPROFILE%\.orb-release\release.key (no passphrase,
// so the signing can run unattended; the file is readable by its owner only — keep that folder out of any sync/backup
// you do not trust). CI and the servers only verify, with the public key in src/server/release-key.mjs.
//   npm run release:keygen [-- --no-embed]   once: makes the pair (refuses to overwrite one) and writes the public key in
//                                            src/server/release-key.mjs (unless --no-embed)
//   npm run release:sign [-- --dir dist]     after `npm run dist:server`: writes dist/manifest.json (each package and its
//                                            sha256) and signs it and install.sh (manifest.json.sig, install.sh.sig)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const defaultKeyPath = (env = process.env) => path.resolve(env.ORB_RELEASE_KEY || path.join(env.USERPROFILE || os.homedir(), '.orb-release', 'release.key'));
export const KEY_MODULE = path.join(ROOT, 'src', 'server', 'release-key.mjs');
const inside = (root, p) => { const r = path.relative(path.resolve(root), path.resolve(p)); return !r.startsWith('..') && !path.isAbsolute(r); };
// The key may never be inside the repository (nor in any folder of it).
export function checkKeyPath(file, root = ROOT) {
  if (inside(root, file)) throw new Error(`la clave privada no puede estar dentro del repositorio (${file}): usa ORB_RELEASE_KEY con una ruta fuera`);
  return path.resolve(file);
}

export function keygen({ file = defaultKeyPath(), root = ROOT, embed = true, keyModule = KEY_MODULE } = {}) {
  checkKeyPath(file, root);
  if (fs.existsSync(file)) throw new Error(`ya hay una clave en ${file}: no se sobrescribe`);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'pem' });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(`${file}.pub`, pub);
  if (embed) fs.writeFileSync(keyModule, embedKey(fs.readFileSync(keyModule, 'utf8'), pub));
  return { file, publicKey: pub, fingerprint: fingerprint(pub) };
}
export const fingerprint = (pem) => crypto.createHash('sha256').update(crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
// release-key.mjs with this public key (only the RELEASE_PUBLIC_KEY line changes).
export function embedKey(source, pem) {
  const line = `export const RELEASE_PUBLIC_KEY = ${JSON.stringify(String(pem).replace(/\r\n/g, '\n'))};`;
  if (!/^export const RELEASE_PUBLIC_KEY = .*;$/m.test(source)) throw new Error('release-key.mjs no tiene RELEASE_PUBLIC_KEY');
  return source.replace(/^export const RELEASE_PUBLIC_KEY = .*;$/m, line);
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
// manifest.json of the release in dir: every package of version and install.sh, with their sums.
export function buildManifest(dir, version) {
  const assets = {};
  for (const name of fs.readdirSync(dir).sort()) {
    if (name === 'install.sh' || new RegExp(`^orb-server-${version.replace(/\./g, '\\.')}-linux-(x64|arm64)\\.tar\\.gz$`).test(name)) assets[name] = { sha256: sha256(path.join(dir, name)), size: fs.statSync(path.join(dir, name)).size };
  }
  if (!Object.keys(assets).some((n) => n.endsWith('.tar.gz'))) throw new Error(`no hay paquetes de Orb Server ${version} en ${dir}`);
  return { product: 'orb-server', version, created: new Date().toISOString(), assets };
}
export async function sign({ dir, version, file = defaultKeyPath(), root = ROOT, publicKey = null }) {
  checkKeyPath(file, root);
  let priv; try { priv = crypto.createPrivateKey(fs.readFileSync(file)); } catch (error) { throw new Error(`no se pudo leer la clave privada (${file}): ${error.message}`); }
  const pub = crypto.createPublicKey(priv).export({ type: 'spki', format: 'pem' });
  // The key must be the one whose public half the servers carry.
  const embedded = publicKey ?? (await import(pathToFileURL(KEY_MODULE).href)).RELEASE_PUBLIC_KEY;
  if (!embedded) throw new Error('src/server/release-key.mjs no tiene la clave pública: npm run release:keygen');
  if (fingerprint(embedded) !== fingerprint(pub)) throw new Error('esta clave privada no es la de la clave pública de src/server/release-key.mjs');
  const manifest = Buffer.from(`${JSON.stringify(buildManifest(dir, version), null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'manifest.json'), manifest);
  const out = ['manifest.json'];
  fs.writeFileSync(path.join(dir, 'manifest.json.sig'), `${crypto.sign(null, manifest, priv).toString('base64')}\n`);
  if (fs.existsSync(path.join(dir, 'install.sh'))) { fs.writeFileSync(path.join(dir, 'install.sh.sig'), `${crypto.sign(null, fs.readFileSync(path.join(dir, 'install.sh')), priv).toString('base64')}\n`); out.push('install.sh'); }
  return { signed: out, fingerprint: fingerprint(pub), installSha256: fs.existsSync(path.join(dir, 'install.sh')) ? sha256(path.join(dir, 'install.sh')) : null };
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  if (cmd === 'keygen') {
    const r = keygen({ embed: !args.includes('--no-embed') });
    console.log(`✔ clave privada: ${r.file} (no la subas a ningún sitio)`);
    console.log(`✔ clave pública (${r.fingerprint})${args.includes('--no-embed') ? `: ${r.file}.pub` : ' escrita en src/server/release-key.mjs: haz commit de ese archivo'}`);
    return;
  }
  if (cmd === 'sign') {
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    const r = await sign({ dir: path.resolve(opt('--dir') ?? path.join(ROOT, 'dist')), version });
    console.log(`✔ firmado (${r.fingerprint}): ${r.signed.join(', ')}`);
    if (r.installSha256) console.log(`  sha256 de install.sh: ${r.installSha256}`);
    return;
  }
  throw new Error('uso: node scripts/release.mjs keygen [--no-embed] | sign [--dir dist]');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`✖ ${error.message}`); process.exit(1); });
}
