// 3.8.11 paso 4: Ajustes en diez pestañas, guardado al cambiar y letras nuevas.
// Lee el código como texto: lo que importa es qué pestañas hay, dónde queda cada ajuste y que nada pide «Guardar».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';
import { FONTS, CODE_FONTS } from '../src/shared/appearance.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const index = read('src/ui/views/settings/index.jsx');
const general = read('src/ui/views/settings/general.jsx');
const usage = read('src/ui/views/settings/usage-tab.jsx');
const rows = read('src/ui/views/settings/rows.jsx');
const data = read('src/ui/views/data.jsx');
const agents = read('src/ui/views/agents.jsx');
const fontsCss = read('src/ui/fonts.css');
const settingsDir = 'src/ui/views/settings/';

const IDS = ['general', 'apariencia', 'agentes', 'permisos', 'magiclink', 'extensiones', 'atajos', 'datos', 'avanzado', 'acerca'];

test('las diez pestañas, en el orden de la maqueta, con nombre y descripción en es y en', () => {
  const found = [...index.matchAll(/^  \{ id: '(\w+)'/gm)].map((m) => m[1]);
  assert.deepEqual(found, IDS);
  for (const id of IDS) {
    for (const [lang, dict] of [['es', es], ['en', en]]) {
      assert.ok(dict[`settings.section.${id}`], `${lang} settings.section.${id}`);
      assert.ok(dict[`settings.sectionDesc.${id}`], `${lang} settings.sectionDesc.${id}`);
    }
  }
  assert.equal(es['settings.section.agentes'], 'Agentes y cuentas');
  assert.equal(es['settings.section.permisos'], 'Permisos y seguridad');
  assert.equal(es['settings.section.atajos'], 'Atajos de teclado');
  // the heading of the section is its name (no «Skills y servidores MCP» as a title)
  assert.match(index, /<Block title=\{t\(`settings\.section\.\$\{section\.id\}`\)\}/);
});

test('guardado igual en todas: ningún botón «Guardar» en los bloques y un «Guardado» en la cabecera', () => {
  for (const file of fs.readdirSync(new URL(`../${settingsDir}`, import.meta.url))) {
    assert.doesNotMatch(read(settingsDir + file), /t\('settings\.save'\)/, `${file} still has a Save button`);
  }
  assert.doesNotMatch(data, /t\('settings\.save'\)/);
  assert.match(index, /<SavedNotice \/>/);
  assert.match(rows, /export function markSaved/);
  // every save() through the shared helper shows the notice, and no longer a toast on top of it
  assert.match(rows, /export async function save\(patch, ok = null, unlock = null\)/);
  assert.match(rows, /if \(config\) \{ markSaved\(\);/);
});

test('los campos de texto y de número guardan al salir del campo, y solo si cambiaron', () => {
  assert.match(general, /onBlur=\{\(\) => keep\('assistantName'\)\}/);
  assert.match(general, /onBlur=\{\(\) => keep\('userName'\)\}/);
  assert.match(general, /const keep = \(key\) => \{ const val = v\[key\]\.trim\(\); if \(val !== \(c\[key\] \?\? ''\)\) save/);
  assert.match(general, /onBlur=\{keepRoots\}/);
  assert.match(general, /if \(JSON\.stringify\(list\) !== JSON\.stringify\(c\.projectRoots \?\? \[\]\)\) save\(\{ projectRoots: list \}\)/);
  assert.match(general, /onBlur=\{keepTurns\}/);
  assert.match(general, /if \(next !== saved\) save\(\{ approvalWaitMinutes: next \}\)/);
  assert.match(general, /if \(v\[key\] !== base\.current\[key\]\) saveAdvanced\(\)/);
  assert.match(general, /JSON\.stringify\(now\) !== JSON\.stringify\(base\.current\.caps\)/);
  assert.match(general, /onBlur=\{keepText\}/);
  // the brakes keep asking the master password through save() (a rail value), now when the field is left
  assert.match(usage, /onBlur=\{apply\}/);
  assert.match(usage, /return save\(\{ budget \}\)\.then/);
});

test('apariencia: tema, letra, tamaño, chats, sonido y música, cada uno en su bloque', () => {
  const sec = index.match(/\{ id: 'apariencia'[^\n]*\n/)[0];
  for (const card of ['ThemeCard', 'FontCard', 'SizeCard', 'ChatsLookCard', 'SoundCard', 'MusicCard']) assert.ok(sec.includes(`<${card}`), card);
  // nothing of the old appearance block is lost
  for (const id of ['skin-picker', 'palette-picker', 'font-select', 'code-font-select', 'tabs-switch', 'usage-line-switch', 'zoom-in', 'zoom-out', 'music-settings', 'more-options-music']) assert.ok(general.includes(id), id);
  for (const key of ['settings.companion', 'settings.motion', 'settings.sounds', 'settings.volume', 'appearance.codeTheme', 'appearance.codeSample', 'appearance.musicTheme', 'appearance.musicReactive', 'appearance.musicIntensity', 'appearance.musicVolume']) assert.ok(general.includes(`t('${key}')`), key);
  assert.doesNotMatch(general, /AppearanceCard|InterfaceCard|ZoomFineCard/);
});

test('general: asistente, carpeta, terminal, git y actualizaciones; lo demás se fue a su pestaña', () => {
  const sec = index.match(/\{ id: 'general'[^\n]*\n[^\n]*\n/)[0];
  for (const card of ['AssistantCard', 'FolderCard', 'TerminalCard', 'GitCard', 'UpdatesCard']) assert.ok(sec.includes(`<${card}`), card);
  assert.match(index, /\{ id: 'atajos', icon: Keyboard, cards: \(\) => <ShortcutsCard \/> \}/);
});

test('«Mensajes de commit» pasa de Agentes a Ajustes › General › Git, sin duplicarse y con el mismo guardado', () => {
  assert.doesNotMatch(agents, /CommitStyleCard|agents\.commit/);
  assert.match(general, /export function GitCard/);
  assert.match(general, /save\(\{ git: \{ commitStyle \} \}\)/);
  assert.match(general, /save\(\{ git: \{ commitInstructions: text \} \}\)/);
  assert.equal(es['settings.gitTitle'], 'Git');
});

test('permisos y seguridad: permisos, espera, rutas, contraseña maestra con Windows Hello y scripts; la contraseña ya no está en Datos', () => {
  const sec = index.match(/\{ id: 'permisos'[^\n]*\n/)[0];
  const order = ['PermissionsCard', 'ApprovalWaitCard', 'ProtectedCard', 'MasterCard', 'ProjectScriptsCard'].map((n) => sec.indexOf(`<${n}`));
  assert.ok(order.every((n, i) => n > 0 && (i === 0 || n > order[i - 1])), order.join());
  assert.doesNotMatch(data, /MasterCard/);
  assert.match(read('src/ui/views/master.jsx'), /<HelloSetting canCode=/);
});

test('datos: copias, clave, datos 3.7, papelera, copias de chats y carpeta core', () => {
  assert.match(data, /export function DataCards\(\) \{ return <><BackupsCard \/><KeyCard \/><LegacyCard \/><TrashCard \/><WorktreesCard \/><CoreCard \/><\/>; \}/);
});

test('avanzado: navegador (con la ventana en directo), modo experto (con sus paneles), Android y agentes de fuera', () => {
  const sec = index.slice(index.indexOf("{ id: 'avanzado'"), index.indexOf("{ id: 'acerca'"));
  for (const card of ['BrowserCard', 'ExpertCard', 'AndroidCard', 'McpExtCard']) assert.ok(sec.includes(`<${card}`), card);
  assert.doesNotMatch(sec, /MoreOptions|LiveWindowCard|ExpertPanelsCard/);
  assert.match(read(settingsDir + 'devices.jsx'), /data-testid="live-window"/);
  assert.match(general, /data-testid="expert-panels"/);
});

test('los enlaces antiguos llevan a las pestañas nuevas', () => {
  assert.match(index, /apariencia/);
  assert.doesNotMatch(index, /apariencia: \['general'/);
  for (const alias of ["tareas: ['agentes']", "uso: ['agentes']", "teclado: ['atajos']", "mcp: ['extensiones']", "experto: ['avanzado', 'experto']", "movil: ['magiclink', 'dispositivos']"]) assert.ok(index.includes(alias), alias);
});

test('letras nuevas: Inter, Geist e IBM Plex Sans para la interfaz e IBM Plex Mono para el código, con licencia y sin descargar nada al arrancar', () => {
  for (const f of ['inter', 'geist', 'ibm-plex-sans']) assert.ok(FONTS.includes(f), f);
  assert.ok(CODE_FONTS.includes('ibm-plex-mono'));
  for (const f of ['inter', 'geist', 'ibm-plex-sans']) { assert.ok(es[`appearance.font.${f}`]); assert.ok(en[`appearance.font.${f}`]); }
  assert.ok(es['appearance.codeFont.ibm-plex-mono'] && en['appearance.codeFont.ibm-plex-mono']);
  const files = [...fontsCss.matchAll(/url\("\.\/fonts\/([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(files.length >= 7);
  for (const f of files) assert.ok(fs.existsSync(new URL(`../src/ui/fonts/${f}`, import.meta.url)), f);
  for (const lic of ['inter', 'geist', 'ibm-plex-sans', 'ibm-plex-mono']) assert.match(read(`src/ui/fonts/LICENSE-${lic}.txt`), /SIL Open Font License/);
  // font-display: swap on each face, and the letter is only chosen through the attribute (the browser fetches a face when a text uses it)
  const faces = fontsCss.match(/@font-face[^}]*\.\/fonts\/[^}]*\}/g);
  assert.ok(faces.every((f) => f.includes('font-display: swap')));
  for (const sel of ['html[data-font="inter"]', 'html[data-font="geist"]', 'html[data-font="ibm-plex-sans"]', 'html[data-code-font="ibm-plex-mono"]']) assert.ok(fontsCss.includes(sel), sel);
});
