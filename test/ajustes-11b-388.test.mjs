// 3.8.8 paso 11b (tanda 7), Ajustes: el enlace con el móvil en la propia página, el freno semanal y «Uso de las cuentas».
// Lee el código como texto: lo que importa es qué llamadas hace cada pieza y cuándo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const link = read('src/ui/views/magic-link.jsx');
const tab = read('src/ui/views/settings/usage-tab.jsx');
const usage = read('src/ui/views/usage.jsx');
const index = read('src/ui/views/settings/index.jsx');
const general = read('src/ui/views/settings/general.jsx');

test('enlace en línea: sin diálogo, y el código solo se pide con un clic', () => {
  assert.doesNotMatch(link, /PairDialog|<Dialog/);
  assert.match(link, /data-testid="link-make"/);
  // the only call that makes a code is inside make(), and make() runs from the effect on a request or from a choice made while one shows
  assert.equal((link.match(/call\('link\.qr'/g) ?? []).length, 1);
  assert.match(link, /useEffect\(\(\) => \{\s*if \(!pair\) \{ setQr\(null\); return; \}[\s\S]*?make\(device, v\);\s*\}, \[pair\]\);/);
  assert.match(link, /const choose = \(v\) => \{ setVia\(v\); if \(pair\) make\(device, v\); \};/);
  // the page never asks by itself: PairCard starts with no code and MagicLinkPanel with no request
  assert.match(link, /const \[qr, setQr\] = useState\(null\);/);
  assert.match(link, /const \[pair, setPair\] = useState\(null\);/);
});

test('enlace en línea: no queda un código vivo al bloquear, caducar o salir', () => {
  assert.match(link, /bridge\.on\('master:locked', \(\) => \{ reqN\.current \+= 1; setQr\(null\); setBusy\(false\); onPair\(null\); \}\)/);
  assert.match(link, /const showing = qr && !expired;/);
  assert.match(link, /alive\.current = false/);
  // the code lives in the component's state only: nothing in storage
  assert.doesNotMatch(link, /localStorage|sessionStorage/);
});

test('enlace en línea: enseña lo mismo que el diálogo (QR, código, dirección, caducidad, huella) con los mismos ids', () => {
  for (const id of ['link-qr', 'link-code', 'link-countdown', 'link-copy', 'link-again', 'link-fp', 'link-pass-note', 'link-http-warn', 'link-android-note', 'link-pair-dialog', 'mobile-qr', 'link-via', 'link-for']) assert.ok(link.includes(id), id);
  assert.match(link, /qr\.address/); assert.match(link, /qr\.pc/); assert.match(link, /qr\.expiresAt/);
  assert.match(link, /link-relink/);
  // what the drawing does not show goes under «Más opciones»
  assert.match(link, /<PairMore device=\{device\} onDevice=\{pickDevice\} \/>/);
  assert.match(link, /<MoreOptions testid="link-more-options">/);
  for (const k of ['link.fpLabel', 'link.fpHint']) for (const l of [es, en]) assert.ok(l[k], k);
});

test('freno semanal: mismo camino que «Uso» y «Normas»', () => {
  assert.match(tab, /import \{ changeRail \} from '@\/lib\/rules-actions\.js';/);
  assert.match(tab, /import \{ confirmPauseRail, confirmResumeRail \} from '@\/views\/rules-dialogs\.jsx';/);
  assert.match(tab, /\(enabled \? confirmResumeRail\(rail\) : confirmPauseRail\(rail\)\)/);
  assert.match(tab, /changeRail\(rail\.id, \{ enabled \}, t\('rules\.railSaved'\)\)/);
  assert.match(tab, /call\('rails\.list', \{\}\)/);
  // no call of its own to the engine's rails or config: values go through save() (which asks the password every time for a rail's value)
  assert.doesNotMatch(tab, /call\('rails\.set'|call\('config\.save'|unlockCore/);
  assert.match(tab, /save\(\{ budget \}\)/);
  assert.match(tab, /weeklyStopAt: week \/ 100/);
  assert.match(tab, /stopAt: stop \/ 100/);
  // the same pattern as the Usage page
  assert.match(usage, /confirmResumeRail\(stopRail\) : confirmPauseRail\(stopRail\)/);
  assert.match(usage, /changeRail\('freno-uso', \{ enabled \}/);
  assert.match(tab, /id === 'freno-uso'/); assert.match(tab, /'freno-semanal'/);
  for (const id of ['brake-stop', 'brake-week', 'brakes-save', 'usage-stop-queue', 'usage-stop-week', 'usage-brakes', 'usage-accounts', 'usage-accounts-all']) assert.ok(tab.includes(`"${id}"`) || tab.includes(`'${id}'`), id);
});

test('el límite de uso sale de «Opciones avanzadas» de Tareas: la maqueta lo pone en «Aviso y frenos»', () => {
  assert.doesNotMatch(general, /numField\('stopAt'/);
  assert.match(tab, /t\('settings\.stopAt'\)/);
});

test('«Uso de las cuentas» reutiliza las tarjetas de la página Uso, sin duplicar su lógica', () => {
  assert.match(usage, /^export function Account\(/m);
  assert.match(tab, /import \{ Account \} from '@\/views\/usage\.jsx';/);
  assert.match(tab, /call\('usage\.get'\)/);
  assert.match(tab, /<Account key=\{u\.account\}/);
  assert.match(index, /<UsageAccounts c=\{c\} \/><ChatCard c=\{c\} \/><BrakesCard c=\{c\} \/><BrakeRails c=\{c\} \/>/);
  assert.match(index, /import \{ UsageAccounts, BrakesCard, BrakeRails \} from '\.\/usage-tab\.jsx';/);
});

test('textos de la tanda en es y en', () => {
  for (const k of ['settings.usageAccounts', 'settings.usageAccountsNote', 'settings.brakesTitle', 'settings.brakesNote', 'settings.weeklyStop', 'settings.weeklyStopHint', 'settings.weeklyRail', 'settings.weeklyRailHint']) for (const l of [es, en]) assert.ok(l[k], k);
  assert.match(es['settings.usageAccountsNote'], /\{stop\}.*\{hours\}.*\{week\}/);
  assert.match(en['settings.usageAccountsNote'], /\{stop\}.*\{hours\}.*\{week\}/);
});

test('revisión: freno solo lectura en el móvil, rangos, carrera del QR, código caducado y dirección fuera del interruptor', () => {
  const devices = read('src/ui/views/settings/devices.jsx');
  // 1: the linked phone only reads the values
  assert.match(tab, /const readOnly = !fullPc\(\);/);
  assert.match(tab, /if \(readOnly\) \{/);
  // 2: the advanced options of Tareas no longer send the brake
  assert.doesNotMatch(general, /windowHours: v\.windowHours, stopAt/);
  assert.doesNotMatch(general, /v\.stopAt/);
  // 3: empty or out-of-range values are not saved
  assert.match(tab, /stop: \[50, 100\], week: \[50, 100\]/);
  assert.match(tab, /disabled=\{!allValid\}/);
  assert.match(tab, /if \(!allValid\) return undefined;/);
  assert.ok(es['settings.brakeInvalid'] && en['settings.brakeInvalid']);
  // 4: request counter against the race with the lock
  assert.match(link, /const reqN = useRef\(0\);/);
  assert.match(link, /const n = \+\+reqN\.current;/);
  assert.match(link, /n !== reqN\.current/);
  assert.match(link, /master:locked', \(\) => \{ reqN\.current \+= 1;/);
  // 5: the code leaves the state when it expires and when a device links
  assert.match(link, /if \(expired\) \{ setWasExpired\(true\); setQr\(null\); \}/);
  assert.match(link, /event === 'link:devices'\) \{ reqN\.current \+= 1; setQr\(null\)/);
  // 6: selecting the address does not flip the switch of the row
  assert.match(devices, /select-text" onClick=\{\(e\) => e\.preventDefault\(\)\} data-testid=\{`mobile-\$\{kind\}-address`\}/);
});
