// 3.7 (WS2): «Añadir Orb Server»: the ONE command the app shows to paste in the server's terminal, and how to do it by
// hand. The command downloads install.sh from the official release, checks its SHA-256 (the app knows it) and runs it
// with the one-time pairing code of this app (code@address#fingerprint of the app's key):
//   curl -fsSL <release>/install.sh -o /tmp/orb-install.sh && echo "<sha256>  /tmp/orb-install.sh" | sha256sum -c && bash /tmp/orb-install.sh --pair '<code>@<address>#<fp>'
// install.sh itself carries the sums of Node and of the Orb Server package (scripts/install.sh.tmpl, WS1).
//
// Contract with WS1 (packaging): the release step writes SERVER_RELEASE in ./server-release.mjs (version, url of
// install.sh, its sha256). Until it does (a development build) the hash is a placeholder that sha256sum refuses, and
// `ready` says so. ORB_SERVER_INSTALL_SHA256 / ORB_SERVER_INSTALL_URL override it (tests, a local release).
// No engine imports: pure strings.
import { SERVER_RELEASE } from './server-release.mjs';
import { AUTHOR } from './product.mjs';

export const PLACEHOLDER_SHA256 = '0'.repeat(64);
const TMP = '/tmp/orb-install.sh';
const isSha = (s) => /^[0-9a-f]{64}$/.test(String(s ?? ''));

// Where install.sh of a version lives (the official GitHub release of that version).
export const installUrlFor = (version) => `https://github.com/${AUTHOR.repo}/releases/download/v${String(version ?? '').replace(/^v/, '')}/install.sh`;

// What the app knows of the Orb Server release it installs: { version, url, sha256, ready }.
export function serverRelease({ version = null, env = process.env } = {}) {
  const sha = String(env.ORB_SERVER_INSTALL_SHA256 ?? SERVER_RELEASE.sha256 ?? '').toLowerCase();
  const v = SERVER_RELEASE.version ?? version ?? null;
  const url = env.ORB_SERVER_INSTALL_URL || SERVER_RELEASE.url || (v && /^\d+\.\d+/.test(v) ? installUrlFor(v) : `https://github.com/${AUTHOR.repo}/releases/latest/download/install.sh`);
  return { version: v, url, sha256: isSha(sha) ? sha : PLACEHOLDER_SHA256, ready: isSha(sha) && sha !== PLACEHOLDER_SHA256 };
}

// «código@dirección#huella», what install.sh --pair and `orb-server emparejar` take (src/server/orb-server.mjs › parsePair).
export function pairTarget({ code, address, fp }) {
  const c = String(code ?? '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const a = String(address ?? '').trim().replace(/\/+$/, '');
  const f = String(fp ?? '').trim().toLowerCase();
  if (c.length < 4 || !a || /[\s#'"]/.test(a) || !/^[0-9a-f:_-]{6,128}$/.test(f)) throw new Error('faltan el código, la dirección o la huella');
  return `${c}@${a}#${f}`;
}
// The pair target back to its parts (the same rule as WS1's parsePair, kept here for the engine).
export function parsePairTarget(text) {
  const m = /^([A-Za-z0-9-]{4,40})@([^#\s]{3,300})#([A-Za-z0-9:_-]{6,128})$/.exec(String(text ?? '').trim());
  if (!m) throw new Error('el emparejado va así: <código>@<dirección>#<huella>');
  return { code: m[1], address: m[2], fp: m[3] };
}

// The one-line command. code/address/fp: this app's pairing (link.server.code); without them, the plain install (an
// upgrade of an existing Orb Server, or one paired later with the short code it prints).
export function serverInstallCommand({ code = null, address = null, fp = null, version = null, env = process.env } = {}) {
  const r = serverRelease({ version, env });
  const pair = code ? ` --pair '${pairTarget({ code, address, fp })}'` : '';
  const command = `curl -fsSL ${r.url} -o ${TMP} && echo "${r.sha256}  ${TMP}" | sha256sum -c && bash ${TMP}${pair}`;
  return { command, url: r.url, sha256: r.sha256, version: r.version, ready: r.ready, pair: code ? pairTarget({ code, address, fp }) : null };
}
// The same, step by step (Magic Link › «Hacerlo a mano»): each step is { key, cmd? } for the interface's texts.
export function serverInstallSteps(opts = {}) {
  const c = serverInstallCommand(opts);
  return [
    { key: 'msg.server.step.download', cmd: `curl -fsSL ${c.url} -o ${TMP}` },
    { key: 'msg.server.step.check', cmd: `echo "${c.sha256}  ${TMP}" | sha256sum -c` },
    { key: 'msg.server.step.run', cmd: `bash ${TMP}${c.pair ? ` --pair '${c.pair}'` : ''}` },
    { key: 'msg.server.step.fallback' }
  ];
}
