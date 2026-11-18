// 3.8.8: «Empezar con una clave nueva» in Ajustes › Datos (the interface, read as text): the card is always on the PC, the
// dialog is the start-up one (shared), then the master password every time, then backup.newKey and the restart notice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const data = read('src/ui/views/data.jsx');
const card = data.slice(data.indexOf('function KeyCard()'), data.indexOf('function BackupsCard()'));

test('the key card is always on the PC, with the way back kept when it applies', () => {
  assert.match(card, /if \(bridge\.mobile\) return null;/);
  assert.doesNotMatch(card, /if \(!st\?\.previousKey\) return null/);
  assert.match(card, /st\?\.previousKey \? \(/);
  assert.match(card, /unlockCore\('previousKey'\)/);
  assert.match(card, /call\('backup\.previousKey', \{ unlock \}\)/);
});

test('the red button asks the shared dialog (EMPEZAR), then the password every time, then backup.newKey', () => {
  const at = (re) => card.search(re);
  assert.ok(at(/askNewSecret\(/) > 0 && at(/askNewSecret\(/) < at(/unlockCore\('newKey'\)/) && at(/unlockCore\('newKey'\)/) < at(/call\('backup\.newKey', \{ unlock \}\)/));
  assert.match(card, /askNewSecret\(\{ master: true, recovery: st\?\.recovery === true \}, \{ readable: true, typed: true \}\)/);
  assert.match(card, /variant="danger"[^>]*data-testid="new-key-start"/);
  assert.match(card, /notifyOk\(t\('datos\.startKeyReady'\)/);
  assert.match(read('src/ui/lib/core-access.js'), /FRESH_ACTIONS = Object\.freeze\(\[[^\]]*'newKey'/);
});

test('the card reloads after both actions, blocks both while one waits, and does not offer the button without a master password or a status', () => {
  assert.equal(card.split('load();').length - 1, 4);
  assert.match(card, /const pending = Boolean\(st\?\.pendingKey\)/);
  assert.match(card, /disabled=\{pending\} data-testid="previous-key-use"/);
  assert.match(card, /disabled=\{!can\}/);
  assert.match(card, /const can = Boolean\(st\) && !failed && master === true && !pending/);
  assert.match(card, /call\('master\.state'\)/);
  assert.match(card, /datos\.keyPending/);
  assert.match(card, /call\('backup\.cancelKey'\)/);
  assert.match(card, /data-testid="key-cancel"/);
});

test('the dialog lives in one shared file; the start-up keeps its own call', () => {
  const main = read('src/ui/main.jsx');
  assert.match(main, /import \{ askNewSecret \} from '@\/components\/new-secret\.jsx';/);
  assert.doesNotMatch(main, /function askNewSecret/);
  assert.match(data, /import \{ askNewSecret \} from '@\/components\/new-secret\.jsx';/);
  const ask = read('src/ui/components/new-secret.jsx');
  assert.match(ask, /export async function askNewSecret\(startError, \{ readable = false, typed: always = false \} = \{\}\)/);
  assert.match(ask, /readable \? 'app\.newSecretBackReadable' : 'app\.newSecretBack'/);
  assert.match(ask, /if \(startError\?\.recovery && !always\) return confirm\(/);
});

test('texts in es and en, none of them saying that Windows cannot open the key', () => {
  for (const lang of ['es', 'en']) {
    const ws6 = read(`src/shared/locales/${lang}/ws6.mjs`);
    for (const k of ['datos.startKeyName', 'datos.startKeyHint', 'datos.startKeyReady', 'datos.startKeyNoMaster', 'datos.startKeyNoStatus', 'datos.keyPending', 'datos.keyCancel']) assert.ok(ws6.includes(`'${k}'`), `${lang} ${k}`);
    assert.ok(read(`src/shared/locales/${lang}/master.mjs`).includes("'master.ask.newKey'"), `${lang} master.ask.newKey`);
    const app = read(`src/shared/locales/${lang}/app.mjs`);
    assert.ok(app.includes('"app.newSecretBackReadable"') && app.includes('"app.newSecretIntroKept"'), `${lang} newSecretBackReadable`);
    assert.ok(read(`src/shared/locales/${lang}/sys.mjs`).includes("'sys.engine.newKeyDone'") && read(`src/shared/locales/${lang}/sys.mjs`).includes("'sys.engine.newKeyFailed'"));
    assert.doesNotMatch(app.match(/"app\.newSecretBackReadable": "[^"]*"/)[0], /Windows/);
    assert.doesNotMatch(ws6.match(/'datos\.startKey(Hint|Ready)': '[^']*'/g).join(' '), /Windows/);
  }
});
