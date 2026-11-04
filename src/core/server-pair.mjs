// 3.7 (WS2): «Añadir Orb Server». The app issues a one-time code (10 minutes, one use) bound to its own key; the command
// it shows carries «code@app-address#app-key-fingerprint» (src/core/server-install.mjs). On the server, the installer
// (`orb-server emparejar`, engine method link.pairApp) does pairWithApp():
//   1. GET <app>/api/server-hello → the app's public key; the server checks its fingerprint is the one in the command
//      (computed here from the key, never taken from the answer), so it only pairs with THAT app.
//   2. POST <app>/api/server-pair { pub, proof }: proof = sealed with a key from both keys and the code stretched and tied
//      to the app's key (as the 3.5.1 short code), carrying the server's own one-time pairing offer (its QR payload).
//   3. The app opens it (it had the code), uses the code up, links to the server with that offer (it becomes the PC
//      linked to its Orb Server, as with a QR) and answers sealed with the same key: the server knows the app had the
//      code too.
// The code never travels. A wrong fingerprint, an old code, a used code or a wrong code: nothing is linked.
// Also: which side has to update (serverSkew), from the versions and capabilities both say in their hello.
import * as C from './mobile-crypto.mjs';
import { normalCode, normalAddress } from './link.mjs';

export const SERVER_CODE_MINUTES = 10;
export const SERVER_CODE_LENGTH = 10;
export const AAD_SERVER = { proof: 'orb:servidor:emparejar', answer: 'orb:servidor:emparejado' };
// The capabilities of 3.7 an Orb says in its hello (src/core/link.mjs › capsFor).
export const CAPS = { home: 'bots.home.v1', replica: 'replica.v1', browserLive: 'browser.live.v1', vault: 'vault.v1' };

const err = (message, extra = {}) => Object.assign(new Error(message), extra);
// The code stretched and tied to the app's key (both sides derive the same; a key swapped on the way gives another).
export const serverSecret = (code, appPubB64) => C.shortSecret(`srv:${normalCode(code)}`, appPubB64);
export const serverSecretAsync = (code, appPubB64) => C.shortSecretAsync(`srv:${normalCode(code)}`, appPubB64);
const sameFp = (a, b) => String(a ?? '').toLowerCase().replace(/[^0-9a-f]/g, '') === String(b ?? '').toLowerCase().replace(/[^0-9a-f]/g, '');

// The server's side. offer: its own pairing (remote.handoffOffer: { v, urls, pc, code, h, name, role }); me: what it
// says of itself ({ name, version, features, v, min }). → { ok, app: { name, fp, peer }, skew }
export async function pairWithApp({ code, address, fp, offer, me = {}, fetch: f = globalThis.fetch } = {}) {
  const base = normalAddress(address);
  if (!normalCode(code) || !fp) throw err('faltan el código o la huella');
  let res; try { res = await f(`${base}/api/server-hello`, { credentials: 'omit' }); } catch (e) { throw err(`la app no responde (${e.cause?.code ?? e.message})`, { offline: true }); }
  const h = await res.json().catch(() => ({}));
  if (!res.ok || typeof h.pc !== 'string') throw err(h.error ?? `la app no tiene un código activo (${res.status})`, { status: res.status });
  let appPub; try { appPub = C.b64.dec(h.pc); } catch { appPub = null; }
  if (appPub?.length !== 32) throw err('la app no ha dado una clave válida');
  // Its fingerprint, computed from the key: the one in the command or nothing.
  if (!sameFp(C.fingerprint(appPub), fp)) throw err('la huella no coincide: no se enlaza', { status: 403, fingerprint: true });
  const secret = await serverSecretAsync(code, h.pc);
  const { priv, pub } = C.newKeyPair();
  const pk = C.pairingKey(priv, appPub, secret);
  let skew = 0;
  const body = () => JSON.stringify({ pub: C.b64.enc(pub), proof: C.seal(pk, { pub: C.b64.enc(pub), t: Date.now() + skew, offer, ...me }, AAD_SERVER.proof) });
  const send = () => f(`${base}/api/server-pair`, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: body() });
  res = await send();
  if (res.status === 409) { const d = await res.clone().json().catch(() => ({})); if (Number.isFinite(d.now)) { skew = d.now - Date.now(); res = await send(); } }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw err(data.error ?? `error ${res.status}`, { status: res.status, ...(data.update ? { update: data.update } : {}) });
  let ok; try { ok = C.open(pk, data.box, AAD_SERVER.answer); } catch { ok = null; }
  if (!ok?.peer) throw err('la app no es la del código');
  return { ok: true, app: { name: ok.name ?? null, fp: C.fingerprint(appPub), peer: ok.peer, version: ok.version ?? null }, skew: ok.skew ?? null };
}

// The app's side: opens what the server sent with the active code. → { pub, msg } or null (a wrong code or key).
export function openServerProof(ownPriv, body, secret) {
  if (!body || typeof body.pub !== 'string') return null;
  let pub; try { pub = C.b64.dec(body.pub); } catch { return null; }
  if (pub.length !== 32) return null;
  const pk = C.pairingKey(ownPriv, pub, secret);
  let msg; try { msg = C.open(pk, body.proof, AAD_SERVER.proof); } catch { return null; }
  if (!msg || msg.pub !== body.pub) return null;
  return { pub, pk, msg };
}
export const sealServerAnswer = (pk, value) => C.seal(pk, value, AAD_SERVER.answer);

// ---- versions: Orb Server serves the app of its minor version and the one before (N and N-1).
const minor = (v) => { const m = /^(\d+)\.(\d+)/.exec(String(v ?? '')); return m ? { major: Number(m[1]), minor: Number(m[2]), n: Number(m[1]) * 1000 + Number(m[2]), label: `${m[1]}.${m[2]}` } : null; };
// app / server: their versions ('3.7.0'); features: what the server said it can do. → null (fine) or
// { who: 'app' | 'server', reason: 'nucleo' | 'old', key, has, need, upgrade }: who has to update, the text to show and
// whether the app should offer the upgrade command (serverInstallCommand without a code).
export function serverSkew({ app, server, features = null } = {}) {
  // A 3.6 Orb Núcleo (no homes for bots): upgraded in place with the same command (keeps its data and pairing).
  if (Array.isArray(features) && !features.includes(CAPS.home)) return { who: 'server', reason: 'nucleo', key: 'msg.server.skewNucleo', has: server ?? null, need: minor(app)?.label ?? null, upgrade: true };
  const a = minor(app); const s = minor(server);
  if (!a || !s) return null;
  if (a.n > s.n) return { who: 'server', reason: 'old', key: 'msg.server.skewOldServer', has: s.label, need: a.label, upgrade: true };
  if (a.n < s.n - 1 || a.major !== s.major) return { who: 'app', reason: 'old', key: 'msg.server.skewOldApp', has: a.label, need: `${s.major}.${Math.max(0, s.minor - 1)}`, upgrade: false };
  return null;
}
// A capability the other Orb lacks for something the user asked: the text key that says to update it, or null.
export function missingCap(features, cap) {
  if ((features ?? []).includes(cap)) return null;
  return cap === CAPS.browserLive ? 'msg.server.capBrowser' : cap === CAPS.vault ? 'msg.server.capVault' : 'msg.server.capOld';
}
