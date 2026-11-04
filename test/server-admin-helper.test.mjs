// 3.7 (WS1): the server's root-owned admin helper does a fixed list of actions and checks every value itself. Its
// expressions are the same in the shell file and in JavaScript (src/server/admin-verbs.mjs); where there is a sh (Git's
// on Windows, any on Linux) the helper itself runs in its dry mode (never as root).
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';
import { checkVerb, parseUnits, sudoersLine, NAME_RE, SIZE_RE, IMAGE_RE, VERBS, HELPER_PATH } from '../src/server/admin-verbs.mjs';
import { adminSetup } from '../scripts/dist-servidor.mjs';

const HELPER = path.join(ROOT, 'src', 'server', 'admin-helper.sh');
const units = ['nginx.service', 'home-assistant'];
const CASES = [
  [['docker-restart', 'vaultwarden'], true], [['docker-restart', 'web_1'], true], [['docker-pull', 'immich-server'], true],
  [['docker-restart', '-rf'], false], [['docker-restart', 'a;rm -rf /'], false], [['docker-restart', 'a b'], false], [['docker-restart'], false], [['docker-restart', 'a', 'b'], false],
  [['docker-restart', `a${'b'.repeat(100)}`], false], [['docker-restart', 'nginx\nreboot'], false], [['docker-restart', '$(id)'], false],
  [['systemctl-restart', 'nginx.service'], true], [['systemctl-restart', 'home-assistant'], true], [['systemctl-restart', 'sshd'], false], [['systemctl-restart', '--now'], false],
  [['journal-vacuum', '500M'], true], [['journal-vacuum', '2G'], true], [['journal-vacuum', '2048M'], true], [['journal-vacuum', '3G'], false], [['journal-vacuum', '2049M'], false], [['journal-vacuum', '0M'], false], [['journal-vacuum', '1T'], false], [['journal-vacuum', '--rotate'], false],
  [['apt-clean'], true], [['apt-clean', 'x'], false],
  [['apt-get', 'install'], false], [['reboot'], false], [[], false], [['sh', '-c', 'id'], false]
];

test('las acciones del ayudante: solo las de la lista, con valores que pasan su expresión', () => {
  for (const [argv, ok] of CASES) assert.equal(checkVerb(argv, { units }).ok, ok, JSON.stringify(argv));
  assert.deepEqual(VERBS, ['docker-restart', 'docker-pull', 'systemctl-restart', 'journal-vacuum', 'apt-clean']);
  assert.deepEqual(parseUnits('# comentario\nnginx.service\n\n bad name \nhome-assistant\r\n'), ['nginx.service', 'home-assistant']);
});

test('el ayudante de shell y el de JavaScript usan las mismas expresiones y la misma lista', () => {
  const sh = fs.readFileSync(HELPER, 'utf8');
  assert.ok(sh.includes(`NAME_RE='${NAME_RE}'`)); assert.ok(sh.includes(`SIZE_RE='${SIZE_RE}'`)); assert.ok(sh.includes(`IMAGE_RE='${IMAGE_RE}'`));
  for (const v of VERBS) assert.match(sh, new RegExp(`^  ${v}\\)$`, 'm'), v);
  assert.match(sh, /^UNITS_ALLOW=\/etc\/orb-server\/units\.allow$/m);
  assert.match(sh, /^PATH=\/usr\/local\/sbin:/m, 'su propio PATH: nunca el de quien lo llama');
  assert.doesNotMatch(sh, /\beval\b/);
  assert.match(sh, /exec "\$@"/);
  assert.match(sh, /id -u/, 'el modo de prueba nunca como root');
});

test('sudoers: el usuario solo puede ejecutar el ayudante, y se comprueba con visudo antes de ponerlo', () => {
  assert.equal(sudoersLine('ana').split('\n')[1], `ana ALL=(root) NOPASSWD: ${HELPER_PATH}`);
  for (const bad of ['root ALL', 'ana,bob', '', '../x', 'Ana']) assert.throws(() => sudoersLine(bad), /usuario/, bad);
  const setup = adminSetup();
  assert.match(setup, /visudo -cf "\$T"/);
  assert.ok(setup.indexOf('visudo -cf') < setup.indexOf('/etc/sudoers.d/orb-server'), 'comprobado antes de instalarlo');
  assert.match(setup, /-m 0440 "\$T" \/etc\/sudoers\.d\/orb-server/);
  assert.match(setup, /install -o root -g root -m 0755 "\$D\/src\/server\/admin-helper\.sh" \/usr\/local\/libexec\/orb-server-admin/);
  assert.match(setup, /loginctl enable-linger/);
  assert.doesNotMatch(setup, /usermod|docker group|-aG docker/, 'el usuario nunca entra en el grupo docker');
});

// A POSIX sh to run the helper with: the system's, or Git's on Windows.
function findSh() {
  const list = process.platform === 'win32'
    ? [process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Git', 'bin', 'sh.exe'), 'C:\\Program Files\\Git\\bin\\sh.exe', 'C:\\Program Files\\Git\\usr\\bin\\sh.exe']
    : ['/bin/sh'];
  return list.filter(Boolean).find((f) => fs.existsSync(f)) ?? null;
}

test('el ayudante de verdad (modo de prueba): hace lo de la lista y rechaza lo demás', { skip: !findSh() && 'sin sh' }, () => {
  const sh = findSh();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-helper-'));
  try {
    const allow = path.join(dir, 'units.allow');
    fs.writeFileSync(allow, `# ok\n${units.join('\n')}\n`);
    const run = (args) => spawnSync(sh, [HELPER.replace(/\\/g, '/'), ...args], { encoding: 'utf8', windowsHide: true, env: { ...process.env, ORB_ADMIN_DRY: '1', ORB_ADMIN_UNITS: allow.replace(/\\/g, '/') } });
    for (const [argv, ok] of CASES) {
      if (argv.some((a) => a.includes('\n'))) continue; // a newline cannot reach it as one argument through sudo
      const r = run(argv);
      assert.equal(r.status === 0, ok, `${JSON.stringify(argv)}: ${r.status} ${r.stderr}`);
      if (!ok) assert.equal(r.status, 64, `${JSON.stringify(argv)}: ${r.stderr}`);
    }
    assert.equal(run(['docker-restart', 'vaultwarden']).stdout.trim(), 'docker restart -- vaultwarden');
    assert.equal(run(['systemctl-restart', 'nginx.service']).stdout.trim(), 'systemctl restart -- nginx.service');
    assert.equal(run(['journal-vacuum', '500M']).stdout.trim(), 'journalctl --vacuum-size=500M');
    assert.equal(run(['apt-clean']).stdout.trim(), 'apt-get clean');
    assert.equal(run(['docker-pull', 'immich']).stdout.trim(), 'docker pull -- image-of-immich');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
