// The Android app tells some refusals of the PC apart by their words (ChatErrors in OrbeChatBackend.kt and the pull
// request page): the engine sends them without a code. Rewording one of these sentences here, in either language,
// would silently stop the phone from recognising the case, so the fragments it looks for are pinned to the locales.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';

const CASES = [
  { key: 'msg.queue.changed', es: 'ha cambiado desde que lo viste', en: 'has changed since you saw it' },
  { key: 'msg.sessions.noConversation', es: 'ya no existe', en: 'no longer exists' },
  { key: 'msg.board.noConversation', es: 'ya no existe', en: 'no longer exists' },
  { key: 'msg.trash.inTrash', es: 'en la papelera', en: 'in the trash' },
  { key: 'msg.github.prHeadChanged', es: 'rama del pull request cambió', en: 'pull request branch changed' }
];

const kotlin = ['ui/chats/OrbeChatBackend.kt', 'ui/projects/PrViewModels.kt']
  .map((f) => fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/dev/orb/app', f), 'utf8')).join('\n');

for (const c of CASES) {
  test(`the phone recognises ${c.key} in Spanish and in English`, () => {
    assert.ok(es[c.key].includes(c.es), `es: ${es[c.key]}`);
    assert.ok(en[c.key].toLowerCase().includes(c.en), `en: ${en[c.key]}`);
    assert.ok(kotlin.includes(`"${c.es}"`), `the app no longer looks for «${c.es}»`);
    assert.ok(kotlin.includes(`"${c.en}"`), `the app no longer looks for «${c.en}»`);
  });
}
