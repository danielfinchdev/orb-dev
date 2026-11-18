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

test('the start-up preview (for the e2e tour) only opens with its variable, from a fixed list, inert and without calls', () => {
  // the page reads the variable and only accepts a name of the list; anything else starts Orb as usual
  assert.match(main, /const START_PREVIEWS = new Set\(\[[^\]]+\]\)/);
  assert.match(main, /typeof v === 'string' && START_PREVIEWS\.has\(v\) \? v : null/);
  assert.match(main, /name \? <StartPreview name=\{name\} \/> : <AppRoot \/>/);
  assert.match(main, /<div inert className="flex h-full flex-col" data-testid="start-preview" data-preview=\{name\}>/);
  assert.match(main, /data-testid="start-preview-tag"/);
  assert.equal((main.match(/__ORB_START_PREVIEW__/g) ?? []).length >= 1, true);
  // the sample data load only when asked, and the module holds data only
  assert.match(main, /import\('@\/lib\/start-preview\.js'\)/);
  assert.doesNotMatch(main, /^import .* from '@\/lib\/start-preview/m);
  const data = read('src/ui/lib/start-preview.js');
  assert.doesNotMatch(data, /\bcall\(|bridge\.|fetch\(|import\(/);
  const listed = [...main.match(/START_PREVIEWS = new Set\(\[([^\]]+)\]\)/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  const keys = [...data.matchAll(/^ {2}'?([a-z-]+)'?: \{ card:/gm)].map((m) => m[1]).sort();
  assert.deepEqual(listed, keys);
  // the migration card never asks the updater in a preview; the tour is the only one that sets the variable
  assert.match(main, /useUpdate\(!preview\)/);
  assert.match(read('src/ui/components/update-card.jsx'), /!enabled \|\| !bridge\?\.update/);
  const tour = read('test/explora.e2e.mjs');
  assert.match(tour, /ORB_EXPLORA_START/);
  assert.match(tour, /window\.__ORB_START_PREVIEW__ = m\[1\]/);
});

test('10C-a: the welcome wears the theme backdrop and veil, centres its block in the whole window and has the saved appearance', () => {
  const wizard = read('src/ui/components/wizard.jsx');
  const page = wizard.slice(wizard.indexOf('export function WizardPage'), wizard.indexOf('// The 640 px column'));
  assert.match(page, /<Scene \/>/);
  assert.match(page, /<main className="theme-scene h-full"/);
  assert.doesNotMatch(page, /bg-background/);
  // the strip that moves the window lies over the top: the same padding above and below, so the block sits where the mock-up puts it
  assert.match(page, /px-6 py-8/);
  assert.doesNotMatch(page, /pt-16/);
  assert.match(page, /useBaseAppearance\(\)/);
  // without data-font the body falls back to the title face; the hook applies the saved appearance (or the defaults) only then
  assert.match(wizard, /if \(document\.documentElement\.dataset\.font\) return;/);
  assert.match(wizard, /applyAppearance\(\{ \.\.\.APPEARANCE_DEFAULTS, \.\.\.getState\(\)\.app\?\.config\?\.ui \}\)/);
});

test('10C-a: the theme cards are 82 px tall and «Prepara tu equipo» is the mock-up\'s cards with the installer\'s own data', () => {
  assert.match(setup, /min-h-\[82px\]/);
  const prepare = setup.slice(setup.indexOf('export function Prepare'));
  assert.match(prepare, /<InstallCard progress=\{progress\} \/>/);
  assert.match(prepare, /<InstallRows items=\{inst\.items\}/);
  assert.match(prepare, /data-testid="setup-continue"/);
  // Continuar stays enabled while it installs (the e2e flows click it)
  assert.doesNotMatch(prepare.slice(prepare.indexOf('data-testid="setup-continue"') - 120, prepare.indexOf('data-testid="setup-continue"')), /disabled/);
  const installer = read('src/ui/components/installer.jsx');
  for (const c of ["call('installer.check')", "call('installer.progress')", "call('installer.start', { ids })", "bridge.on('installer:progress'"]) assert.ok(installer.includes(c), c);
  // the percent is the step count (finished + half of the one running): no finer figure is made up
  assert.match(installer, /ended \+ \(now \? 0\.5 : 0\)\) \/ steps\.length/);
  for (const lang of ['es', 'en']) {
    const text = read(`src/shared/locales/${lang}/install.mjs`);
    for (const k of ['install.optionals', 'install.readyDesc', 'install.stoppedDesc']) assert.ok(text.includes(`'${k}'`), `${lang}: ${k}`);
  }
});

test('10C-a: the master password step has 34 px fields, a 4-stretch bar and grey warning text, with the same call and checks', () => {
  const master = read('src/ui/views/master.jsx');
  const create = master.slice(master.indexOf('export function MasterCreate'), master.indexOf('// «He olvidado la contraseña» with'));
  assert.match(master, /h-\[calc\(var\(--ctl\)\+2px\)\]/);
  assert.match(create, /\[1, 2, 3, 4\]\.map/);
  assert.match(create, /<Badge variant=\{STRENGTH_TONE\[score\]\}>/);
  assert.match(create, /<Badge variant="success">\{t\('master\.match'\)\}<\/Badge>/);
  const warning = master.slice(master.indexOf('function Warning()'), master.indexOf('const PROTECTS'));
  assert.match(warning, /data-testid="master-warning"/);
  assert.match(warning, /master\.warnTitle/);
  assert.match(warning, /master\.warnBody/);
  assert.doesNotMatch(warning, /bg-warning|border-warning|TriangleAlert/);
  assert.match(create, /call\('master\.create', \{ password: v\.next \}\)/);
  assert.match(create, /const ready|!ready\(v\)/);
  assert.doesNotMatch(create, /type=\{|Mostrar|Atrás/);
});

test('11D: the key dialog has separate paragraphs, a placeholder and a button that waits for the word (onOk still checks it)', () => {
  const ask = main.slice(main.indexOf('async function askNewSecret'), main.indexOf('// fingerprint, to compare'));
  assert.match(ask, /paragraphs\.map\(\(p\) => <p key=\{p\}/);
  assert.match(ask, /placeholder=\{word\}/);
  assert.match(ask, /okDisabled: \(v\) => !typed\(v\)/);
  assert.match(ask, /onOk: \(v\) => \{ if \(!typed\(v\)\) throw new Error\(tNow\('app\.newSecretWrong'/);
  assert.match(ask, /v\.word\.trim\(\)\.toUpperCase\(\) === word\.toUpperCase\(\)/);
  assert.match(ask, /if \(startError\?\.recovery\) return confirm\(/);
  assert.match(main, /retryStart\(\{ newSecret: true \}\)/);
  assert.match(read('src/ui/components/dialogs.jsx'), /disabled=\{busy \|\| Boolean\(d\.okDisabled\?\.\(values\)\)\}/);
});

test('11D: the migration path is monospace, and the core card widens for four buttons without touching its red confirmation', () => {
  assert.match(read('src/ui/components/start-card.jsx'), /<code className="font-mono">\{path\}<\/code>/);
  assert.match(main, /<StartPath icon=\{Folder\} text=/);
  const core = read('src/ui/views/core-missing.jsx');
  assert.match(core, /width=\{fourButtons \? 'w-\[600px\]' : undefined\}/);
  assert.match(core, /\{ ok: t\('data\.core\.fresh'\), danger: true \}/);
  assert.match(core, /disabled=\{busy \|\| !code\.trim\(\)\}/, 'Restaurar stays off until the code is typed');
});

test('11D: «Ordenar carpetas» has the full kicker, the green badge, and the segment only for two options', () => {
  const layout = read('src/ui/views/layout.jsx');
  assert.match(layout, /layout\.kickReview/);
  assert.match(layout, /<Badge variant="success"[^>]*>\{t\('layout\.recommended'\)\}<\/Badge>/);
  assert.match(layout, /options\.length <= 2/);
  assert.match(layout, /bridge\.call\('app\.layoutApply', \{ choices: all \?\? choices \}\)/);
});
