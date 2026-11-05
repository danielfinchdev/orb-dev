// 3.7, Orb Server's administration: the fixed list of what the root-owned helper (src/server/admin-helper.sh, installed
// as /usr/local/libexec/orb-server-admin) does, and the same checks in JavaScript. The engine checks here before it
// calls the helper; the helper checks again by itself (it trusts nobody). test/server-admin-helper.test.mjs makes sure
// the expressions here and in the helper are the same, and runs the helper in its dry mode where there is a sh.
export const HELPER_PATH = '/usr/local/libexec/orb-server-admin';
export const UNITS_ALLOW = '/etc/orb-server/units.allow';
export const SUDOERS_FILE = '/etc/sudoers.d/orb-server';
export const VERBS = Object.freeze(['docker-restart', 'docker-pull', 'systemctl-restart', 'journal-vacuum', 'apt-clean']);
// POSIX extended expressions (grep -E in the helper): written the same in both files.
export const NAME_RE = '^[A-Za-z0-9][A-Za-z0-9_.@-]{0,99}$';
export const SIZE_RE = '^[1-9][0-9]{0,3}[MG]$';
export const IMAGE_RE = '^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,254}$';
export const USER_RE = '^[a-z_][a-z0-9_-]{0,31}$';
const re = (s) => new RegExp(s);
export const MAX_VACUUM_MB = 2048;

// The units the helper may restart: one name per line, exactly as written (lines starting with # are comments).
export const parseUnits = (text) => String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && re(NAME_RE).test(l));

// argv as the helper gets it → { ok: true, verb, args } or { ok: false, error }.
export function checkVerb(argv, { units = [] } = {}) {
  const [verb, ...args] = Array.isArray(argv) ? argv.map(String) : [];
  const bad = (error) => ({ ok: false, error });
  if (args.some((a) => /[\r\n]/.test(a))) return bad('bad value');
  const one = () => args.length === 1;
  switch (verb) {
    case 'docker-restart':
    case 'docker-pull':
      if (!one()) return bad('one name');
      if (!re(NAME_RE).test(args[0])) return bad('bad container name');
      return { ok: true, verb, args };
    case 'systemctl-restart':
      if (!one()) return bad('one unit');
      if (!re(NAME_RE).test(args[0])) return bad('bad unit name');
      if (!units.includes(args[0])) return bad('unit not allowed');
      return { ok: true, verb, args };
    case 'journal-vacuum': {
      if (!one()) return bad('one size');
      if (!re(SIZE_RE).test(args[0])) return bad('bad size');
      const n = Number(args[0].slice(0, -1)); const mb = args[0].endsWith('G') ? n * 1024 : n;
      if (mb > MAX_VACUUM_MB) return bad('at most 2G');
      return { ok: true, verb, args };
    }
    case 'apt-clean':
      if (args.length) return bad('no arguments');
      return { ok: true, verb, args };
    default: return bad('unknown action');
  }
}

// The sudoers drop-in (0440, checked with visudo -cf before it is put in place): the user may run the helper only.
export function sudoersLine(user) {
  if (!re(USER_RE).test(String(user ?? ''))) throw new Error(`usuario no válido: ${user}`);
  return `# Orb Server: ${user} may run the server's admin helper (fixed actions, each one approved on a card). Nothing else.\n${user} ALL=(root) NOPASSWD: ${HELPER_PATH}\n`;
}
