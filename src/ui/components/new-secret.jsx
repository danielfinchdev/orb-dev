// «Empezar con una clave nueva» says what is lost (startError: recovery, master = the recovery code and the master
// password exist in core). Without a recovery code the backups made until now will not open any more: the word EMPEZAR
// must be typed. Shared by the start-up notice (the key cannot be opened) and Ajustes › Datos (the key opens fine).
import { Field, Input } from '@/components/ui/basic.jsx';
import { confirm, form } from '@/components/dialogs.jsx';
import { t as tNow } from '@/lib/i18n.js';

// readable: the key opens now (Ajustes › Datos), so the old one stays and can be gone back to; typed: the word is asked
// even with a recovery code.
export async function askNewSecret(startError, { readable = false, typed: always = false } = {}) {
  // not a component: the module's own translator (there is no `t` in scope here)
  const paragraphs = [tNow(readable ? 'app.newSecretIntroKept' : 'app.newSecretIntro'), startError?.master ? tNow('app.newSecretMaster') : startError?.vault ? tNow('app.newSecretVault') : null, startError?.recovery ? tNow('app.newSecretRecovery') : tNow('app.newSecretNoRecovery'), tNow(readable ? 'app.newSecretBackReadable' : 'app.newSecretBack')].filter(Boolean);
  if (startError?.recovery && !always) return confirm(tNow('app.newSecretTitle'), paragraphs.join('\n\n'), { ok: tNow('app.newSecretOk'), danger: true, noClose: true });
  const word = tNow('app.newSecretWord');
  const typed = (v) => v.word.trim().toUpperCase() === word.toUpperCase();
  return Boolean(await form(tNow('app.newSecretTitle'), {
    initial: { word: '' },
    body: (v, set) => (
      <>
        <div className="grid gap-2">{paragraphs.map((p) => <p key={p} className="text-muted-foreground m-0 text-control leading-[1.45]">{p}</p>)}</div>
        <Field label={tNow('app.newSecretType', { word })}><Input autoComplete="off" placeholder={word} value={v.word} onChange={(e) => set({ word: e.target.value })} data-testid="new-secret-word" /></Field>
      </>
    ),
    ok: tNow('app.newSecretOk'),
    okDanger: true,
    noClose: true,
    // the button waits for the word; onOk below still checks it, whatever the button says
    okDisabled: (v) => !typed(v),
    onOk: (v) => { if (!typed(v)) throw new Error(tNow('app.newSecretWrong', { word })); return true; }
  }));
}
