// 3.8.8: the welcome's «Crea tu contraseña maestra» as mock-up 16 draws it (src/ui/views/master.jsx › MasterCreate, views/setup.jsx).
// Read as text, like the other UI tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { passwordShape, passwordStrength } from '../src/ui/lib/core-access.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => fs.readFileSync(root + f, 'utf8');
const master = read('src/ui/views/master.jsx');
const setup = read('src/ui/views/setup.jsx');
const box = master.slice(master.indexOf('function PasswordBox'), master.indexOf('function RecoveryCode'));
const code = master.slice(master.indexOf('function RecoveryCode'), master.indexOf('// wizard: one more step'));
const create = master.slice(master.indexOf('export function MasterCreate'), master.indexOf('// Whether a typed password is shown'));
const line = master.slice(master.indexOf('function strengthLine'), master.indexOf('const PROTECTS'));
const es = read('src/shared/locales/es/master.mjs');
const en = read('src/shared/locales/en/master.mjs');

test('passwordShape counts words (with a letter), digits, numbers and characters (NFC), and leaves the level alone', () => {
  assert.deepEqual(passwordShape('cuatro palabras 21'), { words: 2, digits: 2, numbers: 1, chars: 18 });
  assert.deepEqual(passwordShape('  una  frase   larga  de prueba '), { words: 5, digits: 0, numbers: 0, chars: 32 });
  assert.deepEqual(passwordShape(''), { words: 0, digits: 0, numbers: 0, chars: 0 });
  assert.deepEqual(passwordShape(undefined), { words: 0, digits: 0, numbers: 0, chars: 0 });
  assert.equal(passwordShape('a1 b22 c').numbers, 2);
  assert.equal(passwordShape('😀😀😀😀').chars, 4);
  // As the engine counts them: an e plus a combining accent is one character.
  assert.equal(passwordShape('café café').chars, 9);
  assert.equal(passwordStrength('corta'), 0);
});

test('1: «Mostrar» on each box, apart, with the same guarantees as the lock screen', () => {
  assert.match(box, /type=\{reveal\.shown \? 'text' : 'password'\} autoComplete="new-password" spellCheck=\{false\} autoCorrect="off" autoCapitalize="off"/);
  assert.match(box, /<RevealButton reveal=\{reveal\} \/>/);
  assert.match(create, /const revealNew = useReveal\(\);\s*const revealAgain = useReveal\(\);/);
  assert.match(create, /reveal=\{revealNew\}/);
  assert.match(create, /reveal=\{revealAgain\}/);
  assert.match(create, /revealNew\.hide\(\); revealAgain\.hide\(\);/);
  assert.doesNotMatch(master, /localStorage|sessionStorage/);
});

test('2: the strength line is built from what was typed, does not repeat the level and the badge stays', () => {
  assert.match(create, /strengthLine\(t, score, passwordShape\(v\.next\)\)/);
  assert.match(create, /<Badge variant=\{STRENGTH_TONE\[score\]\}>/);
  assert.doesNotMatch(line, /master\.strength/);
  assert.match(line, /p\.numbers === 1 \? 'master\.shape\.wordsNum1' : 'master\.shape\.wordsNums'/);
  assert.match(es, /'master\.shape\.strong': '\{what\}, \{chars\}\. Una frase es fácil de recordar y difícil de adivinar\.'/);
  assert.match(es, /'master\.shape\.weak': '\{chars\}\. Hacen falta al menos \{min\}\.'/);
  assert.match(es, /'master\.shape\.fairShort': '\{what\}, \{chars\}\. Mejor una frase de varias palabras\.'/);
  assert.match(es, /'master\.shape\.noWords': 'sin letras'/);
  assert.match(es, /'master\.shape\.wordsNum1': '\{words\} y un número'/);
  assert.match(es, /'master\.shape\.wordsNums': '\{words\} y \{n\} números'/);
  for (const key of ['strong', 'weak', 'fairShort', 'fairLong', 'wordsNum1', 'wordsNums', 'noWords', 'word1', 'words', 'char1', 'chars']) assert.ok(en.includes(`'master.shape.${key}'`), `en ${key}`);
});

test('3: the words promise nothing false (no «al abrir Orb», the code is not the only way in)', () => {
  assert.match(es, /'master\.createIntro': [^\n]*Te la pedimos cuando Orb se bloquea y antes de acciones delicadas, como enlazar un móvil, restaurar una copia o abrir la carpeta core\./);
  assert.doesNotMatch(es, /'master\.createIntro'[^\n]*al abrir Orb/);
  assert.match(es, /'master\.warnGive': 'Si la olvidas, podrás poner otra con el código de recuperación; sin él, habrá que borrar los secretos y empezar de cero\. Te lo damos al crearla: guárdalo fuera de este PC\.'/);
  assert.match(es, /'master\.ackCode': 'Entiendo que, si la olvido, necesitaré el código de recuperación para no perder los secretos'/);
  assert.doesNotMatch(es, /solo podrás entrar con el código|solo podré entrar con el código/);
  assert.match(es, /'master\.warnHave': [^\n]*que creaste para tus copias[^\n]*Si no lo encuentras, crea otro en Ajustes › Datos\./);
  assert.match(es, /'master\.manager': 'Puedes pegarla y usar tu gestor de contraseñas \(Bitwarden, 1Password…\)\.'/);
  assert.match(create, /<WizardText>\{t\('master\.manager'\)\}<\/WizardText>/);
  for (const key of ['createIntro', 'warnGive', 'warnHave', 'ackCode', 'ackHave', 'codeError', 'codeRetry', 'codeLater', 'codeExpired']) assert.ok(en.includes(`'master.${key}'`), `en ${key}`);
});

test('4: the recovery code is made only when there is none, shown once, kept nowhere, and a failure asks the user', () => {
  assert.match(create, /call\('backup\.status'\)\.then\(\(s\) => setHasCode\(Boolean\(s\?\.recovery\)\)\)/);
  assert.match(create, /if \(hasCode !== false\) \{ onDone\?\.\(\); return; \}/);
  assert.match(create, /\(await call\('master\.state'\)\)\?\.canForget\) return \{ have: true \}/);
  assert.match(create, /call\('backup\.recovery', \{ unlock \}\)/);
  assert.match(create, /const unlock = heldUnlock\(\);\s*if \(!unlock\) return \{ error: 'expired' \};/);
  assert.match(create, /catch \{ return \{ error: 'failed' \}; \}/);
  // A failed code is no toast: the card says so and the user retries or goes on.
  assert.doesNotMatch(create, /notifyWarn/);
  assert.match(create, /const retry = async \(\) => \{ setBusy\(true\); showIssue\(await issue\(\)\); \};/);
  assert.match(create, /onRetry=\{retry\} onLater=\{\(\) => onDone\?\.\(\)\} onDone=\{\(\) => onDone\?\.\(\)\}/);
  assert.match(code, /master\.codeError[\s\S]*master-code-later[\s\S]*master-code-retry/);
  assert.match(code, /error === 'expired' \? null :/);
  assert.match(es, /'master\.codeError': 'No se ha podido crear el código de recuperación\.'/);
  assert.match(es, /'master\.codeRetry': 'Reintentar'/);
  assert.match(es, /'master\.codeLater': 'Crearlo luego en Ajustes › Datos'/);
  assert.match(code, /font-mono[^\n]*select-all/);
  assert.match(code, /navigator\.clipboard\.writeText\(code\)\.then\(\(\) => notifyOk\(tNow\('datos\.copied'\)\)\)\.catch\(quiet\)/);
  assert.match(code, /disabled=\{!kept \|\| busy\}/);
  assert.doesNotMatch(code, /onBack|setup\.back/);
  assert.doesNotMatch(code + create, /setState|localStorage|sessionStorage|console\./);
  // Continuing only hands over to onDone: the form never shows again for an instant.
  assert.doesNotMatch(create, /setCode\(null\)/);
  // The lone screen of an updated Orb has no row of steps and no «Paso 4».
  assert.match(code, /step=\{wizard \? 'maestra' : undefined\}/);
  assert.match(code, /kick=\{wizard \? t\('setup\.kick', \{ n: 4 \}\) : null\}/);
  assert.match(create, /<RecoveryCode [^\n]*wizard=\{wizard\}/);
});

test('5: «Atrás» only where going back repeats nothing', () => {
  assert.match(create, /\{onBack \? <Button type="button" variant="outline" disabled=\{busy\} onClick=\{onBack\} data-testid="master-back">\{t\('setup\.back'\)\}<\/Button> : null\}/);
  assert.match(setup, /<MasterCreate wizard onDone=\{afterMaster\} onBack=\{\(\) => setStep\('tema'\)\} \/>/);
  assert.match(setup, /setStep\(plan\?\.pending && !foldersDone \? 'carpetas' : 'maestra'\)/);
  assert.match(setup, /const afterFolders = async \(\) => \{ setFoldersDone\(true\);/);
  assert.doesNotMatch(setup, /setStep\('datos'\)/);
  assert.doesNotMatch(read('src/ui/main.jsx'), /<MasterCreate[^\n]*onBack/);
  assert.match(read('src/shared/locales/es/setup.mjs'), /'setup\.back': 'Atrás'/);
  assert.match(read('src/shared/locales/en/setup.mjs'), /'setup\.back': 'Back'/);
});
