// 3.8.8: Ajustes as the Orb UI 2.0 mock-up draws it (desarrollo/orb-ui-2.0/pantallas/08-ajustes.html): a dialog over the app
// with eight sections, the six themes with their sentence, the six palettes, «La del tema», the robot's note, the shared
// pieces instead of the system's controls, and every test id and guarded call of before. Read as source.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { SKINS, PALETTES, FONTS } from '../src/shared/appearance.mjs';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';

const view = (...p) => fs.readFileSync(path.join(ROOT, 'src', 'ui', 'views', ...p), 'utf8');
const SETTINGS = ['index', 'general', 'about', 'devices', 'mcp-ext', 'rows', 'shortcuts', 'trash', 'worktrees'].map((f) => view('settings', `${f}.jsx`));
const SECTIONS = ['magic-link', 'extensions', 'data', 'master'].map((f) => view(`${f}.jsx`));
const ALL = [...SETTINGS, ...SECTIONS, fs.readFileSync(path.join(ROOT, 'src', 'ui', 'components', 'skin-preview.jsx'), 'utf8')].join('\n');
const general = view('settings', 'general.jsx');

test('the eight sections of the menu, as the mock-up names and orders them', () => {
  const index = view('settings', 'index.jsx');
  const ids = [...index.matchAll(/^\s*\{ id: '(\w+)', icon: (\w+)/gm)].map((m) => [m[1], m[2]]);
  assert.deepEqual(ids, [['general', 'Settings'], ['magiclink', 'Smartphone'], ['agentes', 'Bot'], ['permisos', 'ShieldCheck'], ['extensiones', 'Puzzle'], ['datos', 'Database'], ['avanzado', 'SlidersHorizontal'], ['acerca', 'Info']]);
  assert.deepEqual(['general', 'magiclink', 'agentes', 'permisos', 'extensiones', 'datos', 'avanzado', 'acerca'].map((id) => es[`settings.section.${id}`]), ['General', 'Dispositivos', 'Agentes y uso', 'Permisos', 'Skills y MCP', 'Datos', 'Avanzado', 'Acerca de']);
  assert.match(index, /data-testid="settings-dialog"/);
  assert.match(index, /h-\[min\(780px,90vh\)\] w-\[min\(1080px,94vw\)\]/, 'the mock-up\'s 1080 × 780 dialog');
  assert.match(index, /w-\[220px\]/, 'the 220 px menu');
  assert.match(index, /bg-accent text-foreground/, 'the active entry');
});

test('the six themes, each with the sentence of the mock-up, in both languages', () => {
  assert.deepEqual([...SKINS].sort(), ['candy', 'cristal', 'orb', 'predeterminado', 'retro', 'vaporwave']);
  const phrases = {
    predeterminado: ['Predeterminado', 'Orb UI 2.0, con 6 paletas'], cristal: ['Cristal', 'Cristal como en iOS, solo claro'], orb: ['Orb', 'El robot y sus animaciones'],
    vaporwave: ['Vaporwave', 'Fondo animado y su música'], candy: ['Candy', 'Colores dulces y redondos'], retro: ['Retro', 'Terminal verde, solo oscuro']
  };
  for (const [skin, [name, phrase]] of Object.entries(phrases)) {
    assert.equal(es[`appearance.skin.${skin}`], name);
    assert.equal(es[`appearance.skinDesc.${skin}`], phrase);
    assert.ok(en[`appearance.skinDesc.${skin}`], `${skin} in English`);
  }
  assert.match(general, /t\(`appearance\.skinDesc\.\$\{skin\}`\)/);
  assert.doesNotMatch(general, /SkinPreview/, 'icon, name and sentence: no thumbnail');
  assert.match(general, /const SKIN_ICON = \{ predeterminado: LayoutDashboard, cristal: Gem, orb: Bot, vaporwave: Waves, candy: Candy, retro: Terminal \}/);
  assert.match(general, /data-testid=\{`skin-\$\{skin\}`\}/);
});

test('the six palettes with their swatch, and «Los colores de los temas Predeterminado y Cristal»', () => {
  assert.deepEqual([...PALETTES], ['grafito', 'oceano', 'bosque', 'uva', 'rubi', 'arena']);
  assert.equal(es['appearance.paletteHint'], 'Los colores de los temas Predeterminado y Cristal.');
  for (const id of PALETTES) assert.match(general, new RegExp(`${id}: 'oklch\\(`), `${id} has its swatch`);
  assert.match(general, /data-testid=\{`palette-\$\{id\}`\}/);
  assert.match(general, /data-testid="palette-picker"/);
});

test('«La del tema» for the default letter, «Sistema» for the system\'s, and the other letters still offered', () => {
  assert.equal(es['appearance.font.outfit'], 'La del tema');
  assert.equal(es['appearance.font.system'], 'Sistema');
  assert.match(general, /options=\{opts\(FONTS, 'appearance\.font'\)\}/);
  assert.deepEqual(FONTS, ['outfit', 'system', 'outfit-fija']);
  assert.equal(es['appearance.font.outfit-fija'], 'Outfit');
  for (const f of FONTS) assert.ok(es[`appearance.font.${f}`], f);
});

test('the robot\'s note, the reply line and the music with its volume', () => {
  assert.equal(es['appearance.noRobot'], 'Solo el tema Orb muestra el robot y sus animaciones.');
  assert.match(general, /<Block title=\{t\('appearance\.robotTitle'\)\} note=\{t\('appearance\.noRobot'\)\}>/);
  assert.equal(es['appearance.robotTitle'], 'Robot y sonidos');
  assert.equal(es['appearance.repliesTitle'], 'Respuestas de los agentes');
  assert.equal(es['appearance.musicHint'], 'El reproductor está al pie de la barra lateral.');
  // only the generated music is offered: the tracks' source shows up just for a value an earlier version left
  assert.match(general, /\{prefs\.mode !== 'adaptive' \? \(/);
  assert.match(general, /MUSIC_MODES\.filter\(\(value\) => value === 'adaptive' \|\| value === prefs\.mode\)/);
  assert.match(general, /data-testid="music-on"/);
});

test('the shared pieces (Range, Select, Switch) and no control of the system', () => {
  for (const src of [...SETTINGS, ...SECTIONS]) {
    assert.doesNotMatch(src, /<select[\s>]/, 'no <select> of the system');
    assert.doesNotMatch(src, /<input[^>]*type="range"/);
  }
  assert.match(general, /<Range /);
  assert.match(general, /<Select /);
  assert.match(general, /<Switch /);
  assert.match(general, /import \{[^}]*\bRange\b[^}]*\} from '@\/components\/ui\/overlay\.jsx'/);
  // colours with the tokens: the accent is --primary-text, never text-primary
  for (const src of [...SETTINGS, ...SECTIONS]) assert.doesNotMatch(src, /\btext-primary\b(?!-)/);
});

test('every test id of before is still there', () => {
  const ids = ['about-github', 'about-icon', 'about-music', 'about-music-adaptive', 'android-card', 'android-emulators', 'android-pair', 'android-pair-address', 'android-pair-code', 'android-pair-manual', 'android-pair-qr', 'android-pair-state', 'android-phones',
    'approval-wait', 'approval-wait-save', 'auto-model', 'backup-code', 'backup-folder', 'backup-folder-change', 'backup-last', 'backup-list', 'backup-now', 'backups-card', 'connector-keys', 'contribute-paypal', 'core-card', 'core-open', 'dev-tool', 'dev-tools',
    'expert-switch', 'ext-adopt', 'ext-approve', 'ext-editing', 'ext-files', 'ext-files-more', 'ext-import', 'ext-menu', 'ext-note', 'ext-pending', 'ext-project', 'ext-reject', 'ext-toggle', 'extensions',
    'feedback-capture', 'feedback-message', 'feedback-send', 'legacy-backups', 'legacy-card', 'legacy-delete', 'legacy-keys', 'link-again', 'link-device', 'link-devices', 'link-make', 'link-pair', 'link-pair-dialog', 'link-qr', 'link-relink', 'link-revoke', 'magic-link',
    'master-card', 'master-change', 'master-forgot', 'master-lock-minutes', 'master-lock-now', 'mcp-keys', 'mcpext-card', 'mcpext-create', 'mcpext-switch', 'mcpext-token', 'mcpext-url', 'mobile-card', 'mobile-preview', 'mobile-screenshot',
    'music-intensity', 'music-mode', 'music-reactive', 'music-settings', 'music-theme', 'music-volume', 'one-at-a-time', 'palette-picker', 'palette-settings', 'parallel-chats', 'phone-card', 'previous-key', 'previous-key-more', 'previous-key-use',
    'protected-card', 'protected-defaults', 'protected-input', 'protected-item', 'protected-remove', 'settings-about', 'settings-dialog', 'settings-foot', 'settings-foot-github', 'settings-foot-version', 'settings-test', 'shortcuts-card', 'skin-picker',
    'spend-advanced', 'spend-profile', 'spend-save', 'spend-slider', 'suggest-next', 'tabs-switch', 'trash-card', 'trash-empty', 'trash-restore', 'updates-card', 'usage-line-switch', 'worktree-remove', 'worktrees-card'];
  const missing = ids.filter((id) => !ALL.includes(`data-testid="${id}"`) && !ALL.includes(`'data-testid': '${id}'`));
  assert.deepEqual(missing, []);
  for (const dynamic of ['settings-nav-${id}', 'settings-group-${id}', 'mobile-${kind}', 'app-${a.id}', 'shortcut-${cmd.id}']) assert.ok(ALL.includes(`data-testid={\`${dynamic}\`}`), dynamic);
  assert.match(ALL, /testid="settings-autonomy"/);
});

test('what asks for a confirmation or the master password still does, with the same calls', () => {
  const data = view('data.jsx'); const link = view('magic-link.jsx'); const ext = view('extensions.jsx'); const rows = view('settings', 'rows.jsx'); const dev = view('settings', 'devices.jsx'); const mcp = view('settings', 'mcp-ext.jsx');
  assert.match(rows, /unlockCore\('rails'\)/, 'a rail\'s value asks every time');
  assert.match(general, /confirm\(t\('settings\.protectedRemoveTitle', \{ name: x \}\), t\('settings\.protectedRemoveBody'\)/);
  assert.match(general, /confirm\(t\('settings\.switchTitle'\)/);
  assert.match(data, /unlockCore\('restore'\)[\s\S]*call\('backup\.verify'[\s\S]*call\('backup\.restore'/);
  assert.match(data, /unlockCore\('recovery'\)/); assert.match(data, /unlockCore\('backupFolder'\)/); assert.match(data, /unlockCore\('previousKey'\)/);
  assert.match(data, /confirm\(t\('datos\.legacyConfirmTitle'\)[\s\S]*unlockCore\('legacy'\)[\s\S]*call\('legacy\.delete', \{ unlock \}\)/);
  assert.match(data, /unlockCore\('open'\)/);
  assert.match(link, /confirm\(t\('link\.revokeTitle'[\s\S]*unlockCore\('unlink'\)[\s\S]*call\('link\.revoke', \{ id: d\.id, unlock \}\)/);
  assert.match(ext, /unlockCore\('removeExtension'\)/);
  assert.match(dev, /unlockCore\('androidPair'\)/); assert.match(dev, /unlockCore\('androidEmulator'\)/);
  assert.match(dev, /confirm\(t\('settings\.android\.forget'\)[\s\S]*call\('android\.forget'/);
  assert.match(mcp, /unlockCore\('mcpExt'\)/); assert.match(mcp, /confirm\(t\('mcpext\.revoke'\)/);
  assert.match(view('master.jsx'), /act\(call\('master\.lock', \{ reason: 'hand' \}\)\)/);
});

test('Ajustes keeps «Enviar comentarios» and the phone and linked browser keep their layout', () => {
  const about = view('settings', 'about.jsx');
  assert.match(about, /export function FeedbackCard/);
  assert.match(view('settings', 'index.jsx'), /<FeedbackCard \/>/);
  assert.match(view('settings', 'devices.jsx'), /<Card data-testid="phone-card">/, 'the phone\'s own screen is untouched');
  assert.match(view('settings', 'index.jsx'), /fullPc\(\)/);
});

test('«Agentes y uso» has the two tabs of the mock-up, kept in memory only', () => {
  const index = view('settings', 'index.jsx');
  assert.match(index, /<TabsList variant="line"/);
  assert.match(index, /data-testid="agents-tab-tareas"/); assert.match(index, /data-testid="agents-tab-uso"/);
  assert.match(index, /\{tab === 'tareas' \? <TasksCard c=\{c\} \/> : <ChatCard c=\{c\} \/>\}/);
  assert.match(index, /^let agentsTab = 'tareas';/m);
  assert.doesNotMatch(index, /localStorage/);
  assert.equal(es['settings.tabUsage'], 'Uso y agentes');
});

test('«Datos de Orb 3.7» is its own card, not a child of the backups, with its warning colour', () => {
  const data = view('data.jsx');
  assert.match(data, /<LegacyCard \/><BackupsCard \/>/);
  assert.doesNotMatch(data, /between/);
  assert.match(data, /className="text-warning-ink" data-testid="legacy-keys"/);
});

test('the menu of Ajustes only has its eight sections: no entries of a block under the open one', () => {
  const index = view('settings', 'index.jsx');
  assert.doesNotMatch(index, /settings-sub-/);
  // a link to a block (from the welcome, a notice, a tutorial) still lands on it
  assert.match(index, /document\.getElementById\(`settings-\$\{part\}`\)\?\.scrollIntoView/);
});

test('8C-a: Ajustes follows the mock-up where it was out of order, and nothing it lacks is lost', () => {
  const index = view('settings', 'index.jsx');
  // General: Asistente, Carpeta, Interfaz, Apariencia (with Respuestas and Robot), then what the mock-up lacks, Actualizaciones
  assert.match(index, /<AssistantCard c=\{c\} \/><FolderCard c=\{c\} home=\{app\.home\} \/><InterfaceCard c=\{c\} \/><SubSection id="apariencia"/);
  assert.ok(index.indexOf('<TabsCard') > index.indexOf('<AppearanceCard') && index.indexOf('<UpdatesCard') > index.indexOf('<ShortcutsCard'));
  // Apariencia: only the mock-up's rows (no density, chat width or text size)
  for (const gone of ['appearance.density', 'appearance.chatWidth', 'appearance.fontSize']) assert.ok(!general.includes(`'${gone}'`), gone);
  // Robot y sonidos: on and volume of the music first, its style and reactivity after
  const music = general.slice(general.indexOf('function MusicSettings'));
  assert.ok(music.indexOf("'appearance.musicVolume'") < music.indexOf("'appearance.musicTheme'"));
  for (const id of ['music-mode', 'music-theme', 'music-reactive', 'music-intensity', 'music-volume', 'music-on']) assert.ok(music.includes(`data-testid="${id}"`), id);
  // Permisos: Auto / Preguntar, waiting, protected paths; the two buttons make the same call
  assert.match(index, /<PermissionsCard c=\{c\} \/><ApprovalWaitCard c=\{c\} \/><ProtectedCard c=\{c\} \/>/);
  assert.match(general, /<Segmented value=\{mode\} data-testid="settings-autonomy"[^\n]*call\('permissions\.setMode', \{ mode: p === 'auto' \? 'auto' : 'preguntar' \}\)/);
  // Datos: the core folder before the extras
  assert.match(view('data.jsx'), /<LegacyCard \/><BackupsCard \/><CoreCard \/><TrashCard \/><WorktreesCard \/>/);
});

test('8C-a: «Ahorro o potencia» is three buttons (levels 0, 2, 4); levels 1 and 3 stay in the advanced options', () => {
  assert.match(general, /const SPEND_LEVEL = \{ low: 0, recommended: 2, high: 4 \};/);
  for (const id of ['spend-low', 'spend-recommended', 'spend-high']) assert.ok(general.includes(`testid: '${id}'`), id);
  const tasks = general.slice(general.indexOf('export function TasksCard'), general.indexOf('const SPEND_LEVEL'));
  assert.ok(tasks.indexOf('data-testid="spend-slider"') > tasks.indexOf('<CollapsibleContent>'), 'the exact-level slider is under the advanced options');
  // the mock-up's rows come before the guide of models
  assert.ok(tasks.indexOf("'settings.delegation'") < tasks.indexOf('<ModelGuide'));
  for (const l of [es, en]) for (const k of ['settings.spendFine', 'settings.spendFineHint', 'settings.spendLow', 'settings.spendRecommended', 'settings.spendHigh']) assert.ok(l[k], k);
});

test('8C-a: the dropdowns of Ajustes draw the solid triangle, the rest of the app keeps the thin chevron', () => {
  const overlay = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'components', 'ui', 'overlay.jsx'), 'utf8');
  assert.match(overlay, /caret = 'thin'/);
  assert.match(overlay, /caret === 'solid'/);
  assert.equal([...general.matchAll(/<Select (?!caret)/g)].length, 0, 'every Select of general.jsx asks for the solid caret');
  assert.match(view('master.jsx'), /<Select caret="solid"/);
});

test('8C-a: the scrolling content of a section ends where an overlay bar would leave it', () => {
  const index = view('settings', 'index.jsx');
  assert.match(index, /\[scrollbar-gutter:stable\] pt-\[18px\] pr-\[calc\(1\.5rem-var\(--sb-w\)\)\]/);
  const css = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'app.css'), 'utf8');
  assert.match(css, /:root \{ --sb-w: 10px; \}/);
  assert.match(css, /pointer: coarse\) \{[^\n]*:root \{ --sb-w: 0px; \}/);
  // headings and rows use the mock-up's 1.45 line height, so a row is 63 px and a title 22 px
  assert.match(view('settings', 'rows.jsx'), /text-card-title leading-\[1\.45\] font-semibold/);
  assert.doesNotMatch(index, /className="mt-0"/);
});

test('8C-a: the glass dialog is the mock-up\'s near-opaque white', () => {
  const skins = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'themes', 'skins.css'), 'utf8');
  assert.match(skins, /\[data-slot="dialog-content"\]\) \{ background-color: var\(--g-fill-strong\); background-image: linear-gradient\(170deg, oklch\(1 0 0 \/ 0\.86\), oklch\(1 0 0 \/ 0\.68\)\);/);
  const pieces = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'themes', 'pieces.css'), 'utf8');
  assert.doesNotMatch(pieces, /html\[data-skin="cristal"\] \[data-slot="dialog-content"\] \{[^}]*position: relative/);
});

test('9C-b: the solid caret is drawn 10 x 5 and not rescaled by the trigger\'s svg size rule', () => {
  const overlay = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'components', 'ui', 'overlay.jsx'), 'utf8');
  // «size-» in the class opts the svg out of [&_svg:not([class*='size-'])]:size-4, which would draw it 16 px wide
  assert.match(overlay, /size-auto h-\[5px\] w-\[10px\][^"]*" viewBox="0 0 10 5"/);
  assert.match(overlay, /caret === 'solid' && 'pr-2\.5'/);
});

test('9C-b: the explanations of Permisos name Auto and Preguntar in bold, from two keys without the labels', () => {
  assert.match(general, /<b className="text-control font-medium">\{t\('session\.autoMode'\)\}:<\/b> \{t\('settings\.autonomyHintAuto'\)\}/);
  assert.match(general, /<b className="text-control font-medium">\{t\('session\.askMode'\)\}:<\/b> \{t\('settings\.autonomyHintAsk'\)\}/);
  for (const lang of ['es', 'en']) {
    const auto = fs.readFileSync(path.join(ROOT, 'src', 'shared', 'locales', lang, 'auto.mjs'), 'utf8');
    assert.ok(auto.includes("'settings.autonomyHintAuto'") && auto.includes("'settings.autonomyHintAsk'"), lang);
    assert.ok(!auto.includes("'settings.autonomyHint'"), `${lang}: the old whole-sentence key is gone`);
  }
});

test('9C-b: the foot of the navigation starts 18 px in, like the mock-up (8 + 10)', () => {
  assert.match(view('settings', 'index.jsx'), /text-faint-foreground mb-2\.5 px-\[18px\] py-2 text-caption/);
});

test('9C-b: a notice beside a dialog is placed by its real height and falls back to the window corner', () => {
  const main = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'main.jsx'), 'utf8');
  assert.match(main, /\[data-sonner-toast\], \$\{BOARD_BAR\}/);
  assert.match(main, /\.height \?\? TOAST_H/);
  assert.match(main, /else next = \{ bottom: 4, right: 4 \};/);
  assert.doesNotMatch(main, /dialog-footer/);
});

test('10C-b Ajustes: sliders of 120 px that win over .range, theme cards of 82 px, no divider in the permissions card', () => {
  const g = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'views', 'settings', 'general.jsx'), 'utf8');
  assert.equal((g.match(/<Range [^\n]*className="w-\[120px\]! cursor-pointer"/g) ?? []).length, 4);
  assert.doesNotMatch(g, /className="w-\[120px\] cursor-pointer"/);
  assert.match(g, /text-control leading-\[1\.45\] font-medium">\{t\(`appearance\.skin\.\$\{skin\}`\)\}/);
  assert.match(g, /<Stack><Hint className="leading-\[1\.45\]">\{t\('settings\.autonomyAlways'\)\}/);
});
