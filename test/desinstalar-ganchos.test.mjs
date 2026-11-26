// The installer hooks of «Desinstalar» (src-tauri/nsis/hooks.nsh): their structure is checked here on the text (the rules of the
// design, 1.5 step 7), and the hooks and a test installer with them are compiled when NSIS is on this PC. They are run for real
// in a temporary folder by test/desinstalar-ganchos.e2e.mjs; the real installer and any real data are never touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';

const hooks = fs.readFileSync(path.join(ROOT, 'src-tauri', 'nsis', 'hooks.nsh'), 'utf8');
const macro = (name) => { const m = new RegExp(`!macro ${name}\\n([\\s\\S]*?)\\n!macroend`).exec(hooks); assert.ok(m, name); return m[1]; };

test('POSTUNINSTALL purges only with /ORBPURGE and its code, never in an update, and keeps claves when the mark says so', () => {
  const post = macro('NSIS_HOOK_POSTUNINSTALL');
  assert.match(post, /un\.OrbPurgeCode/);
  assert.match(post, /\$R0 != ""/);
  assert.match(post, /\$\{ORB_UPDATE_VAR\} != 1/);
  assert.match(post, /un\.OrbPurgeAllowed/);
  assert.match(post, /\$R0 == 1/);
  assert.match(hooks, /!define ORB_UPDATE_VAR \$UpdateMode/, 'Tauri\'s own $UpdateMode');
  const code = /Function un\.OrbPurgeCode[\s\S]*?FunctionEnd/.exec(hooks)[0];
  assert.match(code, /\/ORBPURGE=/); assert.match(code, /StrLen \$2 \$1\n\s+\$\{If\} \$2 == 32/); assert.match(code, /0123456789abcdef/);
  const allowed = /Function un\.OrbPurgeAllowed[\s\S]*?FunctionEnd/.exec(hooks)[0];
  assert.match(allowed, /"code":"/); assert.match(allowed, /"expires":/); assert.match(allowed, /Int64Op \$3 > \$0/);
  assert.match(allowed, /"encrypted":true/); assert.match(allowed, /"games":true/);
  const purge = /Function un\.OrbPurge\n[\s\S]*?FunctionEnd/.exec(hooks)[0];
  assert.match(purge, /\$OrbKeepClaves == 1/); assert.match(purge, /\$1 != "claves"/);
  assert.match(purge, /ORB_LOCAL_DIR/); assert.match(purge, /\$OrbKeepGames != 1/);
  // only the two folders of the app's data are ever named
  assert.deepEqual([...new Set([...purge.matchAll(/\$\{(ORB_\w+)\}/g)].map((m) => m[1]))].sort(), ['ORB_DATA_DIR', 'ORB_LOCAL_DIR']);
  // a link is removed as a link: the reparse attribute is checked, and RMDir /r is never used
  const entry = /Function un\.OrbRemoveEntry[\s\S]*?FunctionEnd/.exec(hooks)[0];
  assert.match(entry, /0x400/); assert.ok(!/RMDir \/r/.test(entry));
});

test('PREUNINSTALL writes the mark only when nothing asked for a purge, it is not an update and there is no mark yet', () => {
  const pre = macro('NSIS_HOOK_PREUNINSTALL');
  assert.match(pre, /\$\{ORB_UPDATE_VAR\} != 1/);
  assert.match(pre, /\$R0 == ""/);
  assert.match(pre, /\$\{AndIfNot\} \$\{FileExists\} "\$\{ORB_DATA_DIR\}\\desinstalado\.json"/);
  assert.match(pre, /"code":"","expires":0/, 'no usable code');
});

test('POSTINSTALL removes a mark written during its own run; PREINSTALL remembers whether there was one', () => {
  assert.match(macro('NSIS_HOOK_PREINSTALL'), /StrCpy \$OrbHadMark 1/);
  assert.match(macro('NSIS_HOOK_POSTINSTALL'), /\$OrbHadMark != 1[\s\S]*Delete "\$\{ORB_DATA_DIR\}\\desinstalado\.json"/);
});

test('the hooks and a test installer with them compile', { skip: !process.env.LOCALAPPDATA || !fs.existsSync(path.join(process.env.LOCALAPPDATA ?? '', 'tauri', 'NSIS', 'makensis.exe')) }, () => {
  const L = process.env.LOCALAPPDATA;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-ganchos-compila-'));
  try {
    const out = execFileSync(path.join(L, 'tauri', 'NSIS', 'makensis.exe'), ['/V2', `/DOUT=${path.join(tmp, 'g.exe')}`, `/DHOOKS=${path.join(ROOT, 'src-tauri', 'nsis', 'hooks.nsh')}`,
      `/DTAURI_PLUGINS=${path.join(L, 'tauri', 'NSIS', 'Plugins', 'x86-unicode', 'additional')}`, '/DUNINSTKEY=Software\\OrbPruebaCompila', `/DDEFAULT_DIR=${path.join(tmp, 'nada')}`,
      `/DDATA_DIR=${path.join(tmp, 'd')}`, `/DLOCAL_DIR=${path.join(tmp, 'l')}`, `/DTARGET=${path.join(tmp, 't')}`, path.join(ROOT, 'test', 'fixtures', 'puente', 'ganchos-desinstalar.nsi')], { encoding: 'utf8' });
    assert.ok(!/warning/i.test(out), out);
    assert.ok(fs.existsSync(path.join(tmp, 'g.exe')));
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp folder */ } }
});
