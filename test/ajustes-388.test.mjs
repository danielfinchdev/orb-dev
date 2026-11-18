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
  assert.match(general, /const FONT_ORDER = \['outfit', 'system', \.\.\.FONTS\.filter/);
  assert.ok(FONTS.includes('outfit') && FONTS.includes('system'));
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
    'protected-card', 'protected-defaults', 'protected-input', 'protected-item', 'protected-remove', 'settings-about', 'settings-dialog', 'settings-foot', 'settings-foot-github', 'settings-foot-version', 'settings-test', 'shortcuts-card', 'size-settings', 'skin-picker',
    'spend-advanced', 'spend-profile', 'spend-save', 'spend-slider', 'suggest-next', 'tabs-switch', 'trash-card', 'trash-empty', 'trash-restore', 'updates-card', 'usage-line-switch', 'worktree-remove', 'worktrees-card'];
  const missing = ids.filter((id) => !ALL.includes(`data-testid="${id}"`) && !ALL.includes(`'data-testid': '${id}'`));
  assert.deepEqual(missing, []);
  for (const dynamic of ['settings-nav-${id}', 'settings-sub-${g}', 'settings-group-${id}', 'mobile-${kind}', 'app-${a.id}', 'shortcut-${cmd.id}']) assert.ok(ALL.includes(`data-testid={\`${dynamic}\`}`), dynamic);
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
