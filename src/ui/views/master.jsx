// 3.8: the master password in the window. MasterCreate: the welcome's step after the folder, and the one screen an Orb
// updated to 3.8 shows once (it cannot be skipped). MasterLocked: this PC cannot open Orb's keys by itself (another PC,
// another Windows user) or its file is missing. The dialog that asks for it before a guarded action (registered with
// lib/core-access.js), the card of Ajustes › Datos (change it, «He olvidado la contraseña»: with the backups' recovery
// code, or «Borrar secretos y empezar de cero») and a connector's keys.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { KeyRound, LockKeyhole, TriangleAlert, ArrowRight } from 'lucide-react';
import { Robot } from '@/components/robot.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter, Field, Input, Textarea, Spinner } from '@/components/ui/basic.jsx';
import { Checkbox } from '@/components/ui/overlay.jsx';
import { form, choose } from '@/components/dialogs.jsx';
import { call, bridge, getState, setState } from '@/lib/store.js';
import { setMasterAsker, keepUnlock, dropUnlock, unlockCore, passwordStrength, MASTER_MIN } from '@/lib/core-access.js';
import { useT, useLocale, t as tNow } from '@/lib/i18n.js';
import { errorText, cn } from '@/lib/utils.js';

const MIN = MASTER_MIN;
const BAR = ['bg-destructive', 'bg-destructive', 'bg-warning', 'bg-success', 'bg-success'];

// The new password twice, its strength and, when asked, the box «Entiendo que…».
function NewPassword({ v, set, ack = null, autoFocus = false }) {
  const t = useT();
  const score = passwordStrength(v.next, MIN);
  return (
    <div className="grid gap-3">
      <Field label={t('master.password')} hint={t('master.hint', { n: MIN })}>
        <Input type="password" autoComplete="new-password" autoFocus={autoFocus} value={v.next} onChange={(e) => set({ next: e.target.value })} data-testid="master-new" />
      </Field>
      {v.next ? (
        <div className="grid gap-1" data-testid="master-strength">
          <div className="flex gap-1">{[1, 2, 3, 4].map((i) => <span key={i} className={cn('h-1 flex-1 rounded-full', i <= score ? BAR[score] : 'bg-muted')} />)}</div>
          <span className="text-muted-foreground text-xs">{t(`master.strength.${score}`)}</span>
        </div>
      ) : null}
      <Field label={t('master.repeat')}><Input type="password" autoComplete="new-password" value={v.again} onChange={(e) => set({ again: e.target.value })} data-testid="master-again" /></Field>
      {v.again && v.again !== v.next ? <p className="text-destructive text-xs" role="alert">{t('master.mismatch')}</p> : null}
      {ack ? (
        <label className="flex cursor-pointer items-start gap-2 text-[13px]"><Checkbox checked={Boolean(v.ack)} onCheckedChange={(c) => set({ ack: c === true })} data-testid="master-ack" className="mt-0.5" /><span>{ack}</span></label>
      ) : null}
    </div>
  );
}
const ready = (v, ack = true) => [...String(v.next ?? '')].length >= MIN && v.next === v.again && (!ack || v.ack === true);

// What «Si la olvidas no se puede recuperar» means, said where the password is made.
function Warning() {
  const t = useT();
  return (
    <div className="border-warning/50 bg-warning/10 grid gap-1 rounded-xl border px-4 py-3 text-left" role="note" data-testid="master-warning">
      <span className="flex items-center gap-1.5 text-[13px] font-medium"><TriangleAlert className="text-warning size-4 shrink-0" />{t('master.warnTitle')}</span>
      <span className="text-muted-foreground text-xs leading-relaxed">{t('master.warnBody')}</span>
    </div>
  );
}

export function MasterCreate({ onDone, upgrade = false }) {
  const t = useT();
  const [v, setV] = useState({ next: '', again: '', ack: false });
  const [busy, setBusy] = useState(false);
  const set = (patch) => setV((x) => ({ ...x, ...patch }));
  const submit = async (e) => {
    e.preventDefault();
    if (!ready(v)) return;
    setBusy(true);
    try { keepUnlock(await call('master.create', { password: v.next })); toast.success(t('master.created')); onDone?.(); }
    catch (error) { toast.error(errorText(error)); setBusy(false); }
  };
  return (
    <div className="brand-sky flex h-full overflow-auto px-6 pt-24 pb-6">
      <form onSubmit={submit} className="bg-card/95 text-card-foreground m-auto grid w-full max-w-[460px] gap-5 rounded-3xl border border-white/40 p-8 shadow-2xl backdrop-blur" data-testid="master-create">
        <div className="-mt-20 flex justify-center"><Robot size={120} mood={busy ? 'thinking' : 'hello'} /></div>
        <div className="text-center">
          <h1 className="text-2xl">{t('master.createTitle')}</h1>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{t(upgrade ? 'master.upgradeIntro' : 'master.createIntro')}</p>
        </div>
        <NewPassword v={v} set={set} ack={t('master.ack')} autoFocus />
        <Warning />
        <Button type="submit" size="lg" disabled={!ready(v) || busy} data-testid="master-create-ok">{busy ? <Spinner className="border-white/40 border-t-white" /> : <KeyRound />}{t('master.create')}<ArrowRight /></Button>
      </form>
    </div>
  );
}

// «He olvidado la contraseña» with the backups' recovery code: the secrets stay (a new data key), every phone is unlinked.
async function forgotWithCode() {
  return form(tNow('master.forgotTitle'), {
    description: tNow('master.forgotDesc'),
    initial: { code: '', next: '', again: '', ack: false },
    body: (v, set) => (<>
      <Field label={tNow('master.forgotCode')}><Input autoFocus autoComplete="off" spellCheck={false} autoCapitalize="characters" className="font-mono" value={v.code} onChange={(e) => set({ code: e.target.value })} placeholder="XXXX-XXXX-…" data-testid="master-code" /></Field>
      <NewPassword v={v} set={set} ack={tNow('master.forgotAck')} />
    </>),
    ok: tNow('master.forgotOk'),
    onOk: async (v) => { if (!v.code.trim() || !ready(v)) throw new Error(tNow(v.next !== v.again ? 'master.mismatch' : 'master.fillAll')); return call('master.forgot', { code: v.code, password: v.next, confirm: true }); }
  });
}
// «Borrar secretos y empezar de cero»: without the code (or on a PC that cannot open them). Backups are never touched.
async function resetFlow() {
  return form(tNow('master.reset'), {
    description: tNow('master.resetDesc'),
    initial: { next: '', again: '', ack: false },
    body: (v, set) => <NewPassword v={v} set={set} ack={tNow('master.resetAck')} autoFocus />,
    ok: tNow('master.resetOk'),
    onOk: async (v) => { if (!ready(v)) throw new Error(tNow(v.next !== v.again ? 'master.mismatch' : 'master.fillAll')); return call('master.reset', { password: v.next, confirm: true }); }
  });
}
// canForget: this PC can keep the secrets (it opened them and has a recovery code); otherwise only starting from scratch.
export async function forgotFlow({ canForget = false } = {}) {
  let r = null;
  if (!canForget) r = await resetFlow();
  else {
    const how = await choose(tNow('master.forgot'), tNow('master.forgotChoose'), [
      { value: 'code', label: tNow('master.forgotWithCode'), hint: tNow('master.forgotWithCodeHint') },
      { value: 'reset', label: tNow('master.reset'), hint: tNow('master.resetHint'), variant: 'danger' }
    ], { testid: 'master-forgot-choice' });
    if (how === 'code') r = await forgotWithCode();
    else if (how === 'reset') r = await resetFlow();
  }
  if (r?.unlock) keepUnlock(r);
  return r;
}

// This PC cannot open the keys by itself (the password opens them), or the password's file is missing (lost: no
// password to type; the recovery code, or starting from scratch).
export function MasterLocked({ onDone, state = null }) {
  const t = useT();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const lost = Boolean(state?.lost);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { keepUnlock(await call('master.unlock', { password })); onDone?.(); }
    catch (error) { toast.error(errorText(error)); setBusy(false); }
  };
  const forgot = async () => { if (await forgotFlow({ canForget: Boolean(state?.canForget) })) onDone?.(); };
  return (
    <div className="brand-sky flex h-full overflow-auto px-6 pt-24 pb-6">
      <form onSubmit={submit} className="bg-card/95 text-card-foreground m-auto grid w-full max-w-[420px] gap-4 rounded-3xl border border-white/40 p-8 shadow-2xl backdrop-blur" data-testid="master-locked">
        <div className="-mt-20 flex justify-center"><Robot size={110} mood={busy ? 'thinking' : lost ? 'worried' : 'idle'} /></div>
        <div className="text-center"><h1 className="text-xl">{t(lost ? 'master.lostTitle' : 'master.lockedTitle')}</h1><p className="text-muted-foreground mt-2 text-sm leading-relaxed">{t(lost ? 'master.lostBody' : 'master.lockedBody')}</p></div>
        {lost ? null : (<>
          <Field label={t('master.password')}><Input type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} data-testid="master-password" /></Field>
          <Button type="submit" size="lg" disabled={!password || busy}>{busy ? <Spinner className="border-white/40 border-t-white" /> : <LockKeyhole />}{t('master.unlock')}</Button>
        </>)}
        <Button type="button" variant={lost ? 'default' : 'ghost'} size="sm" onClick={forgot} data-testid="master-forgot">{t('master.forgot')}</Button>
      </form>
    </div>
  );
}

// Before a guarded action: the password, once every 5 minutes. → { unlock, until } or null.
// 3.8.1: an action that asks every time (fresh: deleting a project) says so instead, and its token is for it alone.
setMasterAsker((action, { fresh = false } = {}) => form(tNow('master.askTitle'), {
  description: `${tNow(`master.ask.${action}`)} ${fresh ? tNow('master.askEveryTime') : tNow('master.askNote', { n: 5 })}`,
  initial: { password: '' },
  body: (v, set) => <Field label={tNow('master.password')}><Input type="password" autoComplete="current-password" autoFocus value={v.password} onChange={(e) => set({ password: e.target.value })} data-testid="master-ask" /></Field>,
  ok: tNow('master.unlock'),
  onOk: (v) => call('master.unlock', { password: v.password, ...(fresh ? { purpose: action } : {}) })
}));
// The window locked (Windows' lock screen), the password changed, or the engine says so: the unlock goes.
if (typeof window !== 'undefined') bridge.on?.('master:locked', () => dropUnlock());

// Ajustes › Datos: the master password.
export function MasterCard() {
  const t = useT();
  const locale = useLocale();
  const [st, setSt] = useState(null);
  const load = () => call('master.state').then(setSt).catch(() => setSt(null));
  useEffect(() => { load(); }, []);
  if (!st?.exists) return null;
  const change = async () => {
    const r = await form(t('master.changeTitle'), {
      initial: { current: '', next: '', again: '' },
      body: (v, set) => (<>
        <Field label={t('master.current')}><Input type="password" autoComplete="current-password" autoFocus value={v.current} onChange={(e) => set({ current: e.target.value })} data-testid="master-current" /></Field>
        <NewPassword v={v} set={set} />
      </>),
      ok: t('master.change'),
      onOk: async (v) => { if (!v.current || !ready(v, false)) throw new Error(t(v.next !== v.again ? 'master.mismatch' : 'master.fillAll')); return call('master.change', { current: v.current, next: v.next }); }
    });
    if (r?.unlock) { keepUnlock(r); toast.success(t('master.changed')); load(); }
  };
  const forgot = async () => { if (await forgotFlow({ canForget: st.canForget })) load(); };
  const when = st.changedAt ? new Date(st.changedAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) : null;
  return (
    <Card data-testid="master-card">
      <CardHeader className="flex-row items-start gap-3"><KeyRound className="text-primary mt-0.5 size-5 shrink-0" /><div><CardTitle>{t('master.cardTitle')}</CardTitle><CardDescription>{t('master.cardDesc')}</CardDescription></div></CardHeader>
      {when ? <CardContent><p className="text-muted-foreground text-xs">{t('master.since', { when })}</p></CardContent> : null}
      <CardFooter className="flex-wrap">
        <Button size="sm" variant="outline" onClick={change} data-testid="master-change"><KeyRound />{t('master.change')}</Button>
        <Button size="sm" variant="ghost" onClick={forgot} data-testid="master-forgot">{t('master.forgot')}</Button>
      </CardFooter>
    </Card>
  );
}

// A connector's keys (Ajustes › Conectores): seen and changed after the password; one «NAME=value» per line.
const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_]{0,99})=(.*)$/;
export async function connectorKeys(server) {
  const unlock = await unlockCore('secrets');
  if (!unlock) return;
  let current; try { current = await call('secrets.connector', { name: server.name, unlock }); } catch (error) { toast.error(errorText(error)); return; }
  const text = Object.entries(current.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n');
  const r = await form(tNow('master.keysTitle', { name: server.name }), {
    description: tNow('master.keysDesc'),
    initial: { text },
    wide: true,
    body: (v, set) => <Textarea rows={6} className="font-mono text-xs" spellCheck={false} autoComplete="off" value={v.text} onChange={(e) => set({ text: e.target.value })} placeholder="GITHUB_TOKEN=…" data-testid="connector-keys" />,
    ok: tNow('settings.save'),
    onOk: async (v) => {
      const env = {};
      for (const line of v.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) { const m = KEY_LINE.exec(line); if (!m) throw new Error(tNow('master.keysBad')); env[m[1]] = m[2]; }
      return call('secrets.saveConnector', { name: server.name, env, unlock });
    }
  });
  if (!r) return;
  toast.success(tNow('master.keysSaved'));
  const app = await call('app.state').catch(() => null);
  if (app) setState({ app: { ...getState().app, config: app.config } });
}
