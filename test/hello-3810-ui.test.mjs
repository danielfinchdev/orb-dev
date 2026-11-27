// 3.8.10, step 7 H5: Windows Hello and the recovery code in the window. The plain functions are run; the components, which need
// a window, are checked by their source (as the other UI tests do). What the engine refuses stays the engine's job (hello-3810.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setMasterAsker, keepUnlock, dropUnlock, heldUnlock, heldUntil, unlockCore, canUseHello, PASSWORD_ACTIONS, FRESH_ACTIONS } from '../src/ui/lib/core-access.js';
import { helloMode, helloUsable, waitSeconds, helloDoKey } from '../src/ui/lib/hello.js';
import { printCss } from '../src/ui/lib/print-code.js';
import { HELLO_PURPOSES, SECRET_PURPOSES, PASSWORD_ONLY_METHODS } from '../src/domain/security/permissions.mjs';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';

const read = (p) => fs.readFileSync(new URL(`../src/ui/${p}`, import.meta.url), 'utf8');
const hello = read('views/hello.jsx');
const recovery = read('views/recovery.jsx');
const master = read('views/master.jsx');
const data = read('views/data.jsx');
const soon = () => Date.now() + 5 * 60_000;

test('helloMode: every state of master.helloState reads as one thing', () => {
  assert.equal(helloMode(null), 'unknown');
  assert.equal(helloMode({ available: false, enabled: false }), 'none');
  assert.equal(helloMode({ available: true, enabled: false }), 'off');
  assert.equal(helloMode({ available: true, enabled: true, valid: true, tpm: true }), 'on');
  assert.equal(helloMode({ available: true, enabled: true, valid: true, tpm: false }), 'noChip');
  assert.equal(helloMode({ available: true, enabled: true, valid: false }), 'changed');
  assert.equal(helloMode({ available: true, enabled: true, changed: true, tpm: true }), 'changed');
  assert.equal(helloUsable({ available: true, enabled: true, valid: true, tpm: false }), true, 'no chip still works');
  assert.equal(helloUsable({ available: true, enabled: true, valid: false }), false, 'a changed Hello is not offered');
  assert.equal(helloUsable({ available: true, enabled: false }), false);
});

test('waitSeconds counts the 30 s wait down and ends at zero', () => {
  const now = Date.parse('2026-11-23T10:00:00Z');
  assert.equal(waitSeconds('2026-11-23T10:00:30Z', now), 30);
  assert.equal(waitSeconds('2026-11-23T10:00:00.400Z', now), 1);
  assert.equal(waitSeconds('2026-11-23T09:59:59Z', now), 0);
  assert.equal(waitSeconds(null, now), 0);
  assert.equal(waitSeconds('nonsense', now), 0);
});

test('the actions only the password opens are never offered Hello, and they match the engine', () => {
  for (const p of Object.values(SECRET_PURPOSES)) assert.ok(PASSWORD_ACTIONS.includes(p), p);
  for (const a of ['restore', 'secrets', 'connector', 'fullAccess', 'mcpExt', 'newKey']) assert.equal(canUseHello(a), false, a);
  // Of the actions that ask every time, Hello takes exactly the engine's HELLO_PURPOSES.
  for (const a of FRESH_ACTIONS) assert.equal(canUseHello(a), HELLO_PURPOSES.includes(a), a);
  for (const a of ['open', 'unlink', 'backupFolder', 'rules', 'androidPair', 'lock']) assert.equal(canUseHello(a), true, a);
  assert.ok(PASSWORD_ONLY_METHODS.has('backup.newKey'));
});

test('a token made with Hello is not reused for what needs the password, and asks for it again', async () => {
  dropUnlock();
  const asked = [];
  setMasterAsker(async (action, opts) => { asked.push([action, opts.fresh, opts.what]); return { unlock: `pw-${action}`, until: soon() }; });
  keepUnlock({ unlock: 'hello-token', until: soon(), strength: 'hello' });
  assert.equal(heldUnlock(), 'hello-token');
  assert.equal(heldUnlock(Date.now(), { needsPassword: true }), null);
  assert.equal(await unlockCore('open'), 'hello-token', 'the usual actions take it');
  assert.deepEqual(asked, []);
  assert.equal(await unlockCore('restore'), 'pw-restore', 'a restore asks for the password');
  assert.equal(heldUnlock(), 'pw-restore', 'the password token replaces it');
  assert.equal(await unlockCore('secrets'), 'pw-restore', 'and now serves the others without asking');
  assert.equal(asked.length, 1);
  dropUnlock();
  keepUnlock({ unlock: 'plain', until: soon() });
  assert.equal(heldUnlock(Date.now(), { needsPassword: true }), 'plain', 'a token without a strength is the password\'s');
  assert.ok(heldUntil() > Date.now());
  dropUnlock();
});

test('an action that asks every time is told what it is about, and its token is not kept', async () => {
  dropUnlock();
  const asked = [];
  setMasterAsker(async (action, opts) => { asked.push([action, opts.fresh, opts.what]); return { unlock: 'once', until: soon(), strength: 'hello' }; });
  assert.equal(await unlockCore('deleteProject', { what: 'Tienda' }), 'once');
  assert.deepEqual(asked, [['deleteProject', true, 'Tienda']]);
  assert.equal(heldUnlock(), null);
  assert.equal(await unlockCore('deleteProject'), 'once', 'asked again');
  assert.equal(asked.length, 2);
});

test('the words before Windows\' own notice exist in both languages for every action Hello may approve', () => {
  assert.equal(helloDoKey('deleteProject', 'Tienda'), 'hello.do.deleteProjectNamed');
  assert.equal(helloDoKey('deleteProject'), 'hello.do.deleteProject');
  assert.equal(helloDoKey('somethingNew'), 'hello.do.other');
  const actions = ['open', 'backupFolder', 'legacy', 'protected', 'unlink', 'deleteProject', 'previousKey', 'removeExtension', 'rails', 'ruleSeed', 'rules', 'android', 'androidPair', 'androidEmulator', 'lock'];
  for (const a of actions) for (const d of [es, en]) assert.ok(d[helloDoKey(a)], `${a}`);
  for (const d of [es, en]) assert.ok(d['hello.do.other'] && d['hello.do.deleteProjectNamed'].includes('{what}'));
  // The password dialog's own line of every action that can say «Vas a …» exists too.
  for (const a of ['helloOff']) assert.ok(es[`master.ask.${a}`] && en[`master.ask.${a}`], a);
  assert.match(es['hello.confirm'], /Confírmalo con Windows Hello/);
  assert.match(en['hello.confirm'], /Confirm with Windows Hello/);
});

test('the words are plain: no key, token or wrap jargon in what the user reads, and the risk is said', () => {
  const keys = Object.keys(es).filter((k) => /^(hello|recovery)\./.test(k));
  assert.ok(keys.length > 40);
  for (const k of keys) for (const [name, d] of [['es', es], ['en', en]]) assert.doesNotMatch(d[k], /\b(DEK|KEK|token|tokens|HKDF|nonce)\b/i, `${name} ${k}`);
  assert.match(es['hello.risk'], /cualquiera que sepa el PIN de Windows/i);
  assert.match(en['hello.risk'], /anyone who knows this PC's Windows PIN/i);
  for (const m of ['on', 'off', 'noChip', 'changed', 'none']) assert.ok(es[`hello.state.${m}`] && en[`hello.state.${m}`], m);
  assert.match(es['hello.state.noChip'], /sin chip de seguridad/);
  assert.match(es['hello.state.changed'], /Windows Hello ha cambiado/);
  assert.match(es['hello.waitLeft'], /30|\{s\}/);
  // The honest warning of clearing «Cambiar también la clave de datos» is the design's.
  assert.match(es['recovery.keepWarning'], /cualquier copia hecha antes sigue llevando la envoltura vieja/);
  assert.match(es['recovery.rekey'], /^Cambiar también la clave de datos/);
  assert.match(en['recovery.rekey'], /^Also change the data key/);
});

test('the recovery code: asks for the password or the current code, the box is ticked by default, nothing goes by token', () => {
  assert.doesNotMatch(recovery, /unlockCore/);
  assert.match(recovery, /initial: \{[^}]*rekey: true/);
  assert.match(recovery, /proofParams\(v, 'current'\)/);
  assert.match(recovery, /call\('backup\.recovery', \{ \.\.\.proof, \.\.\.\(replaces \? \{ rekey: v\.rekey \} : \{\}\) \}\)/);
  assert.match(recovery, /recovery-keep-warning/);
  assert.match(recovery, /r\.warn/);
  assert.match(recovery, /r\.copyWrapFailed/);
  assert.match(recovery, /if \(r\.rekeyed\) keepUnlock\(r\)/);
  assert.match(recovery, /confirm: true/, 'a phrase over a generated code is confirmed');
  assert.match(recovery, /recovery\.phraseDrops/);
  assert.match(recovery, /printCode\(r\.code/);
  assert.match(recovery, /noClose: true/, 'the code is shown once: no click outside loses it');
  assert.match(data, /import \{ newRecoveryCode \} from '@\/views\/recovery\.jsx'/);
  assert.doesNotMatch(data, /call\('backup\.recovery'/);
});

test('restoring: the copy\'s code and the master password are asked, and a kept-secrets answer is told', () => {
  assert.match(data, /password: v\.password \|\| undefined/);
  assert.match(data, /r\.secretsKept \? 'datos\.restoreKept' : 'datos\.restoreReady'/);
  assert.match(data, /unlockCore\('restore', \{ request: \{ method: 'backup\.restore', params \}/);
});

test('the print sheet hides everything else and stays off the screen', () => {
  const css = printCss();
  assert.match(css, /@media screen\{#orb-print-code\{display:none!important\}\}/);
  assert.match(css, /@media print\{body>\*:not\(#orb-print-code\)\{display:none!important\}/);
});

test('the dialog before a protected action: Hello box for the actions it may approve, a note for the others, the password always', () => {
  const asker = master.slice(master.indexOf('setMasterAsker('), master.indexOf('// The window locked'));
  assert.match(asker, /call\('master\.helloState'\)/);
  assert.match(asker, /canUseHello\(action\)/);
  assert.match(asker, /<HelloBox action=\{action\} what=\{what\} purpose=\{fresh \? action : null\}/);
  assert.match(asker, /<HelloPasswordOnly \/>/);
  assert.match(asker, /onOk: \(v\) => got \?\? call\('master\.unlock'/);
  assert.match(asker, /data-testid="master-ask"/);
  assert.match(hello, /call\('master\.unlockHello', purpose \? \{ purpose \} : \{\}\)/);
  // The state is read again after a refusal: over the desktop bridge only the text of an error arrives.
  assert.match(hello, /call\('master\.helloState'\)\.catch/);
  assert.match(hello, /hello-confirm/);
  assert.match(hello, /hello-wait/);
});

test('the lock screen: a Hello button only while the screen is locked, it never submits the password form', () => {
  const locked = master.slice(master.indexOf('export function MasterLocked'), master.indexOf('// Before a guarded action'));
  assert.match(locked, /<HelloBox action="lock"[^>]*submit=\{false\}[^>]*onToken=\{\(r\) => finish\(r\)\}/);
  assert.match(locked, /helloMark = screen && !inCode/);
  assert.match(locked, /helloMark === 'changed'/);
});

test('Ajustes › Datos turns Hello on with the password and off with a token; the welcome offers it once', () => {
  assert.match(master, /<HelloSetting canCode=\{st\.canForget === true\} \/>/);
  assert.match(hello, /call\('master\.helloEnable', params\)|call\('master\.helloEnable'/);
  assert.match(hello, /call\('master\.helloDisable', \{ unlock \}\)/);
  assert.match(hello, /unlockCore\('helloOff'\)/);
  assert.match(master, /if \(offer\) return <HelloOffer password=\{typed\.current\}/);
  assert.match(master, /typed\.current && !bridge\.mobile && await helloOfferable\(\)/);
  assert.match(hello, /hello-offer-skip/);
  // The password typed for the welcome is wiped as soon as the offer is answered.
  assert.match(master, /typed\.current = ''/);
});
