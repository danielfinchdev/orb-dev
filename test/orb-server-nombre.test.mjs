// 3.7 (WS0): the Linux product is called «Orb Server». No user-facing text (locales, docs, the CLI and the scripts, the
// interface) keeps its old name, the CLI is `orb-server` and `orb-nucleo` still works, hidden, for older installs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])) : []);
// The old product name (CPU «núcleos» are fine) and the old command used as a command.
const OLD_NAME = /\bN[uú]cleo\b|\bNÚCLEO\b|\bnúcleo\b(?!s)/u;
const OLD_COMMAND = /\borb-nucleo\s+(estado|status|entrar|enlazar|dispositivos|quitar|copia|mover|usuarios|usuario|pin-reset|personas|persona|--help|--version)\b/;
const SHIM = path.join(ROOT, 'src', 'server', 'orb-nucleo.mjs');

// The CHANGELOG keeps what older versions shipped under their name: only the download list and 3.7+ count.
function changelogNow(text) {
  const parts = text.split(/^(?=## What's new in )/m);
  return parts.filter((p) => { const m = p.match(/^## What's new in (\d+)\.(\d+)/); return !m || Number(m[1]) > 3 || (Number(m[1]) === 3 && Number(m[2]) >= 7); }).join('\n');
}

function userFacingFiles() {
  const files = [
    ...walk(path.join(ROOT, 'src', 'core', 'locales')),
    ...walk(path.join(ROOT, 'src', 'server')),
    ...walk(path.join(ROOT, 'src', 'ui')),
    ...walk(path.join(ROOT, 'scripts')),
    ...walk(path.join(ROOT, 'docs')).filter((f) => !f.includes(`${path.sep}historico${path.sep}`)),
    path.join(ROOT, 'README.md')
  ];
  return files.filter((f) => /\.(m?js|jsx|cjs|md|json|html)$/.test(f) && f !== SHIM);
}

test('ningún texto que ve el usuario dice el nombre antiguo del servidor', () => {
  const bad = [];
  for (const f of userFacingFiles()) {
    let text = fs.readFileSync(f, 'utf8');
    if (path.basename(f) === 'CHANGELOG.md') text = changelogNow(text);
    text.split(/\r?\n/).forEach((line, i) => { if (OLD_NAME.test(line) || OLD_COMMAND.test(line)) bad.push(`${path.relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 120)}`); });
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('los textos de es y en no nombran el producto antiguo', async () => {
  const es = (await import('../src/core/locales/es.mjs')).default;
  const en = (await import('../src/core/locales/en.mjs')).default;
  for (const dict of [es, en]) for (const [k, v] of Object.entries(dict)) {
    assert.doesNotMatch(String(v), OLD_NAME, k);
    assert.doesNotMatch(String(v), OLD_COMMAND, k);
    assert.ok(!k.includes('.nucleo.'), `clave antigua: ${k}`);
  }
});

test('orb-server es el comando; orb-nucleo sigue funcionando como alias oculto', () => {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const run = (file, args) => spawnSync(process.execPath, [path.join(ROOT, 'src', 'server', file), ...args], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  for (const file of ['orb-server.mjs', 'orb-nucleo.mjs']) {
    const v = run(file, ['--version']);
    assert.equal(v.status, 0, v.stderr);
    assert.equal(v.stdout.trim(), version, file);
    const h = run(file, ['--help']);
    assert.equal(h.status, 0, h.stderr);
    assert.match(h.stdout, /^orb-server /, file);
    assert.doesNotMatch(h.stdout, /nucleo/i, `${file}: la ayuda no enseña el alias`);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.server, 'node src/server/orb-server.mjs');
  assert.equal(pkg.scripts.nucleo, pkg.scripts.server, 'npm run nucleo sigue funcionando');
});
