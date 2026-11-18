// 3.8.8 (step 10A): the start-up notices (maqueta 15-arranque) and the welcome (16-bienvenida). Reads the files as text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SKINS } from '../src/shared/appearance.mjs';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const setup = read('src/ui/views/setup.jsx');
const main = read('src/ui/main.jsx');

// The test ids the e2e flows and the e2e scripts use, per file (as they were before this step).
const TESTIDS = {
  'src/ui/views/setup.jsx': ['prepare-title', 'setup-agents', 'setup-assistant', 'setup-continue', 'setup-create', 'setup-datos', 'setup-folder', 'setup-prepare', 'setup-tagline', 'setup-target', 'setup-user'],
  'src/ui/views/core-missing.jsx': ['core-code', 'core-fresh', 'core-missing', 'core-no-code', 'core-pick', 'core-restore'],
  'src/ui/components/update-needed.jsx': ['update-needed', 'update-open'],
  'src/ui/views/layout.jsx': ['layout-apply', 'layout-error', 'layout-keep-all', 'layout-logs-moved', 'layout-logs-note', 'layout-logs-ok', 'layout-logs-readonly', 'layout-review', 'layout-servers-moved', 'layout-logs-path', 'layout-server-path'],
  'src/ui/components/error-boundary.jsx': ['screen-failed', 'screen-failed-home', 'screen-offline', 'screen-offline-retry'],
  'src/ui/main.jsx': ['app-error', 'app-error-new-secret', 'app-error-relink', 'app-error-retry', 'migration-failed', 'migration-retry', 'migration-update']
};

test('every test id of the welcome and the start-up notices is still there', () => {
  for (const [file, ids] of Object.entries(TESTIDS)) {
    const text = read(file);
    for (const id of ids) assert.ok(text.includes(`"${id}"`) || text.includes(`testid="${id}"`) || text.includes(`testid: '${id}'`), `${file}: ${id}`);
  }
  const layout = read('src/ui/views/layout.jsx');
  assert.match(layout, /data-testid=\{`layout-item-\$\{it\.id\}`\}/);
  assert.match(layout, /data-testid=\{`layout-choice-\$\{it\.id\}`\}/);
});

test('the welcome has «Tu tema» with the six themes, saved with the same ui.skin as Ajustes', () => {
  assert.equal(SKINS.length, 6);
  assert.match(setup, /SKINS\.map\(\(skin\) =>/);
  assert.match(setup, /setup-skin-\$\{skin\}/);
  for (const skin of SKINS) assert.ok(new RegExp(`\\b${skin}: \\w+`).test(setup), `icon of ${skin}`);
  assert.match(setup, /call\('config\.save', \{ patch: \{ ui: patch \} \}\)/);
  assert.match(setup, /applyAppearance\(config\.ui\)/);
  assert.match(setup, /appearance\.skin\.\$\{skin\}/);
  assert.match(setup, /appearance\.skinDesc\.\$\{skin\}/);
  // the order of the steps: datos → tema → carpetas → maestra → equipo
  assert.match(setup, /setStep\('tema'\)/);
  assert.match(setup, /setStep\(plan\?\.pending \? 'carpetas' : 'maestra'\)/);
  assert.match(read('src/ui/components/wizard.jsx'), /WIZARD_STEPS = \['datos', 'tema', 'carpetas', 'maestra', 'equipo'\]/);
  assert.match(read('test/fixtures/e2e-flows.mjs'), /setup-theme-continue/);
});

test('the folder of Orb is asked once: in the first step, never again in «Ordenar carpetas»', () => {
  assert.equal((setup.match(/bridge\.pickFolder\(/g) ?? []).length, 1);
  assert.equal((setup.match(/bridge\.setup\(/g) ?? []).length, 1);
  assert.doesNotMatch(read('src/ui/views/layout.jsx'), /pickFolder|bridge\.setup/);
});

test('the master password and the recovery key keep their calls and their warnings', () => {
  assert.match(setup, /<MasterCreate wizard onDone=\{afterMaster\} \/>/);
  const master = read('src/ui/views/master.jsx');
  assert.match(master, /call\('master\.create', \{ password: v\.next \}\)/);
  assert.match(master, /type="password" autoComplete="new-password"/);
  assert.ok(master.includes("<WizardPage step={wizard ? 'maestra' : undefined}>"));
  assert.doesNotMatch(read('src/ui/app.css'), /wz-master/);
  for (const key of ['master.warnTitle', 'master.warnBody', 'master.ack', 'master.protects', 'master.match']) assert.ok(master.includes(key), key);
  for (const lang of ['es', 'en']) assert.ok(read(`src/shared/locales/${lang}/master.mjs`).includes('master.warnBody'), `${lang}: master.warnBody`);
});

test('the dangerous start-up actions keep their calls and their confirmations', () => {
  const core = read('src/ui/views/core-missing.jsx');
  assert.match(core, /bridge\.call\('app\.coreRepair', params\)/);
  assert.match(core, /repair\(\{ passphrase: code \}\)/);
  assert.match(core, /repair\(\{ file, passphrase: code \|\| null \}\)/);
  assert.match(core, /await confirm\(t\('data\.core\.fresh'\), t\('data\.core\.freshConfirm'\), \{ ok: t\('data\.core\.fresh'\), danger: true \}\)\) repair\(\{ fresh: true,/);
  assert.match(core, /onClick=\{fresh\}/);
  assert.match(main, /bridge\.call\('app\.migrationRetry'\)/);
  assert.match(main, /bridge\.retryStart\(\{ newSecret: true \}\)/);
  assert.match(main, /askNewSecret\(startError\)/);
  const needed = read('src/ui/components/update-needed.jsx');
  assert.match(needed, /releases\/latest/);
  assert.match(needed, /u\.app \?/);
});

test('the start-up notices share one card; the colours are tokens', () => {
  const card = read('src/ui/components/start-card.jsx');
  assert.match(card, /role = 'alertdialog'/);
  for (const file of ['src/ui/views/core-missing.jsx', 'src/ui/components/update-needed.jsx', 'src/ui/components/error-boundary.jsx']) assert.match(read(file), /StartNotice/, file);
  assert.match(main, /<StartNotice testid="migration-failed"/);
  assert.match(main, /<StartNotice testid="app-error"/);
  for (const file of ['src/ui/components/start-card.jsx', 'src/ui/components/wizard.jsx', 'src/ui/views/setup.jsx', 'src/ui/views/layout.jsx']) {
    const text = read(file);
    assert.doesNotMatch(text, /text-primary(?![-\w])/, `${file}: text-primary`);
    assert.doesNotMatch(text, /#[0-9a-f]{3,6}\b/i, `${file}: a colour written by hand`);
  }
  assert.match(card, /primary-soft|StartMark/);
});

test('the texts of the welcome and the notices exist in Spanish and English', () => {
  const keys = ['setup.stepsLabel', 'setup.step.welcome', 'setup.step.theme', 'setup.step.folders', 'setup.step.master', 'setup.step.equipo', 'setup.kick', 'setup.themeTitle', 'setup.themeDesc', 'setup.themeLabel'];
  const appKeys = ['app.errorHint', 'app.crashHint', 'app.loadOfflineNote'];
  for (const lang of ['es', 'en']) {
    const s = read(`src/shared/locales/${lang}/setup.mjs`);
    for (const k of keys) assert.ok(s.includes(`'${k}'`), `${lang}: ${k}`);
    const a = read(`src/shared/locales/${lang}/app.mjs`);
    for (const k of appKeys) assert.ok(a.includes(`"${k}"`), `${lang}: ${k}`);
  }
});
