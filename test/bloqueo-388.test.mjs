// 3.8.8: «Orb está bloqueado» as mock-up 17 draws it (src/ui/views/master.jsx › MasterLocked). Read as text, like the other UI tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => fs.readFileSync(root + f, 'utf8');
const master = read('src/ui/views/master.jsx');
const locked = master.slice(master.indexOf('// Why the screen locked'), master.indexOf('// The 48 px mark of the lock card'));
const reveal = master.slice(master.indexOf('export const REVEAL_MS'), master.indexOf('// «He olvidado la contraseña» with the backups'));
const create = master.slice(master.indexOf('export function MasterCreate'), master.indexOf('// Whether a typed password is shown'));
const es = read('src/shared/locales/es/master.mjs');
const en = read('src/shared/locales/en/master.mjs');

test('1: the subtitle says when and why it locked, with the words of each case', () => {
  assert.match(locked, /LOCK_SUBS = \{ idle: 'master\.screenSubIdle', windows: 'master\.screenSubWindows', sleep: 'master\.screenSubSleep', manual: 'master\.screenSubManual' \}/);
  assert.match(locked, /call\('master\.state'\)/);
  assert.match(locked, /t\(LOCK_SUBS\[lockInfo\?\.reason\] \?\? 'master\.screenSubAt', \{ time \}\) : t\('master\.screenSub'\)/);
  assert.match(locked, /getHours\(\)\)\}:\$\{pad2\(d\.getMinutes\(\)\)/);
  assert.match(es, /'master\.screenSubIdle': 'Se bloqueó a las \{time\} por inactividad'/);
  assert.match(es, /'master\.screenSubWindows': 'Se bloqueó a las \{time\} al bloquear Windows'/);
  assert.match(es, /'master\.screenSubSleep': 'Se bloqueó a las \{time\} al suspender el PC'/);
  assert.match(es, /'master\.screenSubManual': 'Lo bloqueaste a las \{time\}'/);
  assert.match(es, /'master\.screenSubAt': 'Se bloqueó a las \{time\}'/);
  assert.match(es, /'master\.screenSub': 'Escribe tu contraseña maestra para seguir\.'/);
});

test('2: «Mostrar» goes back to hidden on blur, hiding the window, sending, locking, 30 s and unmounting', () => {
  assert.match(reveal, /REVEAL_MS = 30_000/);
  assert.match(reveal, /setTimeout\(hide, REVEAL_MS\)/);
  assert.match(reveal, /addEventListener\('blur', hide\)/);
  assert.match(reveal, /addEventListener\('visibilitychange', onHidden\)/);
  assert.match(reveal, /document\.hidden/);
  assert.match(reveal, /bridge\.on\?\.\('master:locked', hide\)/);
  // every listener and the timer go with the effect, which also runs when the box unmounts
  assert.match(reveal, /clearTimeout\(timer\); window\.removeEventListener\('blur', hide\); document\.removeEventListener\('visibilitychange', onHidden\)/);
  assert.match(reveal, /useState\(false\)/, 'it never starts shown');
  assert.doesNotMatch(reveal, /localStorage|sessionStorage|setState\(|useStore/);
  assert.match(locked, /e\.preventDefault\(\); reveal\.hide\(\);/, 'sending hides it');
});

test('2: the field keeps its autocomplete and is not corrected or capitalised while the text is visible', () => {
  assert.match(locked, /type=\{reveal\.shown \? 'text' : 'password'\} autoComplete="current-password"/);
  assert.match(locked, /spellCheck=\{false\} autoCorrect="off" autoCapitalize="off"/);
  assert.match(locked, /<RevealButton reveal=\{reveal\} \/>/);
  assert.match(master, /t\(reveal\.shown \? 'master\.hide' : 'master\.show'\)/);
  assert.match(es, /'master\.show': 'Mostrar'/);
  assert.match(es, /'master\.hide': 'Ocultar'/);
});

test('2: the reveal is reusable and is not applied to the creation screen or PasswordBox', () => {
  assert.match(master, /export function useReveal\(\)/);
  assert.doesNotMatch(create, /useReveal|RevealButton/);
  const box = master.slice(master.indexOf('function PasswordBox'), master.indexOf('// wizard: one more step'));
  assert.doesNotMatch(box, /useReveal|RevealButton/);
});

test('review: canForget comes from master.state, one dialog at a time, hidden password under dialogs, no switching while busy', () => {
  assert.match(locked, /useState\(Boolean\(state\?\.canForget\)\)/);
  assert.match(locked, /setCanForget\(Boolean\(s\?\.canForget\)\)/);
  assert.match(locked, /const withCode = !lost && canForget;/);
  assert.match(locked, /forgotFlow\(\{ canForget \}\)/);
  assert.match(locked, /if \(dialog\.current\) return;\s*dialog\.current = true; reveal\.hide\(\);/);
  assert.match(locked, /finally \{ dialog\.current = false; \}/);
  assert.match(locked, /openDialog\(\(\) => forgotWithCode\(code\.trim\(\)\)\)/);
  assert.match(locked, /openDialog\(resetFlow\)/);
  assert.match(locked, /const switchTo = \(next\) => \{ if \(busy\) return; reveal\.hide\(\);/);
  assert.equal([...locked.matchAll(/disabled=\{busy\} onClick=\{\(\) => switchTo/g)].length, 2);
  // the reveal's master:locked listener is removed on cleanup
  assert.match(reveal, /if \(typeof off === 'function'\) off\(\)/);
  // the only dynamic input type of the card is the password field's
  const body = locked.slice(locked.indexOf('export function MasterLocked'), locked.indexOf('function LockBackdrop'));
  assert.equal([...body.matchAll(/type=\{/g)].length, 1);
  assert.match(body, /type=\{reveal\.shown \? 'text' : 'password'\}/);
});

test('3: «Desbloquear» is not disabled by an empty field; empty it only focuses the field', () => {
  assert.doesNotMatch(locked, /disabled=\{!password/);
  assert.match(locked, /disabled=\{busy\}/);
  assert.match(locked, /if \(!password\) \{ fieldRef\.current\?\.focus\(\); return; \}/);
  // the empty check comes before any call to the engine
  assert.ok(locked.indexOf("if (!password) { fieldRef") < locked.indexOf("call('master.unlock'"));
});

test('4: the error says how many tries are left and the real wait', () => {
  const engine = read('src/engine/api/master.mjs');
  assert.match(engine, /nextWait: next/);
  assert.match(es, /'msg\.master\.wrongNext': 'Contraseña incorrecta\. Te quedan \{n\} intentos antes de esperar \{wait\}\.'/);
  assert.match(es, /'msg\.master\.wrongNextOne': 'Contraseña incorrecta\. Te queda 1 intento antes de esperar \{wait\}\.'/);
  assert.match(es, /'msg\.master\.codeWrongNext': 'Código de recuperación incorrecto\./);
  assert.match(es, /'msg\.master\.waitSeconds': '\{n\} segundos'/);
  assert.match(es, /'msg\.master\.waitMinute': '1 minuto'/);
  assert.match(es, /'msg\.master\.waitMinutes': '\{n\} minutos'/);
  // the wait comes from the vault's table, not from a copy in the window
  const vault = read('src-tauri/vault/src/vault.rs');
  assert.match(vault, /None => v\["nextWait"\] = json!\(wait_seconds\(FREE_TRIES\)\)/);
  assert.doesNotMatch(locked, /nextWait/);
});

test('5: the link «Usar código de recuperación» leads to the code card, which only opens the new-password dialog', () => {
  assert.match(locked, /const withCode = !lost && canForget/);
  assert.match(locked, /t\('master\.forgotAsk'\)\} <button[^>]*onClick=\{\(\) => switchTo\('code'\)\}[^>]*>\{t\('master\.useCode'\)\}/);
  assert.match(locked, /t\(inCode \? 'master\.unlockWithCode' : 'master\.unlock'\)/);
  assert.match(locked, /t\('master\.useMaster'\)/);
  assert.match(locked, /\{inCode \? <p[^>]*>\{t\('master\.codeNote'\)\}<\/p> : null\}/);
  assert.match(es, /'master\.codeNote': 'Con el código pondrás una contraseña nueva\. Se desenlazarán tus móviles y navegadores\.'/);
  // no new method: the code goes into the dialog that already exists
  assert.match(locked, /openDialog\(\(\) => forgotWithCode\(code\.trim\(\)\)\)/);
  assert.match(master, /async function forgotWithCode\(code = ''\)/);
  assert.match(master, /initial: \{ code, next: '', again: '', ack: false \}/);
  const calls = [...locked.matchAll(/call\('(master\.[a-z]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(calls, ['master.state', 'master.unlock']);
  assert.match(master, /call\('master\.forgot', \{ code: v\.code, password: v\.next, confirm: true \}\)/);
});

test('5: without canForget (or when lost) the old button and its flow stay; with it «Borrar secretos» is still reachable', () => {
  assert.match(locked, /data-testid="master-forgot">\{t\('master\.forgot'\)\}/);
  assert.match(locked, /forgotFlow\(\{ canForget \}\)/);
  assert.match(locked, /onClick=\{\(\) => openDialog\(resetFlow\)\}[^>]*>\{t\('master\.noCode'\)\}/);
  assert.match(es, /'master\.noCode': 'No tengo el código'/);
  assert.match(master, /async function resetFlow\(\)/);
});

test('6: behind the card there is a static outline with no text and no store data, and the app is not mounted', () => {
  const backdrop = master.slice(master.indexOf('function LockBackdrop'), master.indexOf('// The 48 px mark of the lock card'));
  assert.ok(backdrop.length > 100);
  assert.match(backdrop, /aria-hidden="true" inert/);
  assert.doesNotMatch(backdrop, /useStore|getState|useT|t\(|call\(|wordmark|<img|Robot/);
  assert.doesNotMatch(backdrop, />[A-Za-zÀ-ÿ0-9][^<{]*</, 'no text between tags');
  assert.match(locked, /<Scene \/>\s*<LockBackdrop \/>/);
  assert.match(locked, /bg-black\/32 backdrop-blur-\[10px\]/);
  assert.doesNotMatch(locked, /<main className="theme-scene h-full"/);
  // nothing of the store on this screen but the two counters
  assert.deepEqual([...locked.matchAll(/useStore\(/g)].length, 0);
  assert.equal([...master.slice(master.indexOf('function LockStatus'), master.indexOf('// Before a guarded action')).matchAll(/useStore\(/g)].length, 2);
});

test('the English locale has every new key', () => {
  for (const k of ['master.screenSubAt', 'master.screenSubIdle', 'master.screenSubWindows', 'master.screenSubSleep', 'master.screenSubManual', 'master.show', 'master.hide', 'master.forgotAsk', 'master.useCode', 'master.useMaster', 'master.codePlaceholder', 'master.unlockWithCode', 'master.codeNote', 'master.noCode', 'msg.master.wrongNext', 'msg.master.wrongNextOne', 'msg.master.codeWrongNext', 'msg.master.codeWrongNextOne', 'msg.master.waitSeconds', 'msg.master.waitMinute', 'msg.master.waitMinutes']) {
    assert.ok(es.includes(`'${k}'`), `es ${k}`);
    assert.ok(en.includes(`'${k}'`), `en ${k}`);
  }
});
