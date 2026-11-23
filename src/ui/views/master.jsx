// the master password in the window. MasterCreate: the welcome's step after the folder, and the one screen an Orb
// updated to 3.8 shows once (it cannot be skipped). MasterLocked: this PC cannot open Orb's keys by itself (another PC,
// another Windows user) or its file is missing. The dialog that asks for it before a guarded action (registered with
// lib/core-access.js), the card of Ajustes › Datos (change it, «He olvidado la contraseña»: with the backups' recovery
// code, or «Borrar secretos y empezar de cero») and a connector's keys.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { notifyError, notifyOk } from '@/lib/notify.js';
import { Copy, KeyRound, Lock, LockKeyhole, CircleAlert, Loader, ShieldQuestion, ShieldAlert, Trash2, Smartphone, LifeBuoy } from 'lucide-react';
import { WizardPage, WizardCard, WizardFoot, WizardText, WizardTitle, useBaseAppearance } from '@/components/wizard.jsx';
import { Scene } from '@/components/scene.jsx';
import { Robot } from '@/components/robot.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Field, FieldError, Input, Label, Textarea, Spinner } from '@/components/ui/basic.jsx';
import { needsApproval } from '@/lib/task-approval.js';
import { Checkbox } from '@/components/ui/overlay.jsx';
import { form, choose, confirm } from '@/components/dialogs.jsx';
import { call, bridge, getState, setState, act, useStore, robotSkin } from '@/lib/store.js';
import { Select } from '@/components/ui/overlay.jsx';
import { LOCK_MINUTES, lockMinutesOf } from '@/lib/idle-lock.js';
import { setMasterAsker, keepUnlock, heldUnlock, dropUnlock, unlockCore, canUseHello, passwordStrength, passwordShape, MASTER_MIN } from '@/lib/core-access.js';
import { helloMode, helloUsable } from '@/lib/hello.js';
import { useT, useLocale, t as tNow } from '@/lib/i18n.js';
import { cn, errorText } from '@/lib/utils.js';
import { quiet } from '@/lib/quiet.js';
import { Block, Panel, Setting } from './settings/rows.jsx';
import { HelloBox, HelloNotes, HelloPasswordOnly, HelloSetting, HelloOffer, helloOfferable } from './hello.jsx';
import { MobileBox } from './approve.jsx';
import { mobileReady, rebuildReadiness } from '@/lib/approve.js';
import { rebuildFlow } from './rebuild.jsx';

const MIN = MASTER_MIN;
const BAR = ['bg-destructive', 'bg-destructive', 'bg-warning', 'bg-success', 'bg-success'];

// The new password twice, its strength and, when asked, the box «Entiendo que…».
export function NewPassword({ v, set, ack = null, autoFocus = false }) {
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
        <label className="flex cursor-pointer items-start gap-2 text-control"><Checkbox checked={Boolean(v.ack)} onCheckedChange={(c) => set({ ack: c === true })} data-testid="master-ack" className="mt-0.5" /><span>{ack}</span></label>
      ) : null}
    </div>
  );
}
export const ready = (v, ack = true) => [...String(v.next ?? '')].length >= MIN && v.next === v.again && (!ack || v.ack === true);

// What «Si la olvidas no se puede recuperar» means, said where the password is made: plain grey text, its title leading it.
// recovery: false = the code is given right after creating it, true = Orb already has one (kept as it is), null = not known
// (the older words, which promise nothing about a code).
function Warning({ recovery = null }) {
  const t = useT();
  if (recovery === null) return <WizardText role="note" data-testid="master-warning"><span className="text-foreground font-medium">{t('master.warnTitle')}.</span> {t('master.warnBody')}</WizardText>;
  return <WizardText role="note" data-testid="master-warning">{t(recovery ? 'master.warnHave' : 'master.warnGive')}</WizardText>;
}

// The line under the strength bar (the badge already says the level), true for what was typed: what it holds and what would
// make it better.
function strengthLine(t, score, p) {
  if (score === 0) return t('master.shape.weak', { chars: t(p.chars === 1 ? 'master.shape.char1' : 'master.shape.chars', { n: p.chars }), min: MIN });
  const words = t(p.words === 1 ? 'master.shape.word1' : 'master.shape.words', { n: p.words });
  let what = t('master.shape.noWords');
  if (p.words) what = !p.numbers ? words : t(p.numbers === 1 ? 'master.shape.wordsNum1' : 'master.shape.wordsNums', { words, n: p.numbers });
  const chars = t('master.shape.chars', { n: p.chars });
  if (score >= 3) return t('master.shape.strong', { what, chars });
  return t(p.words >= 3 ? 'master.shape.fairLong' : 'master.shape.fairShort', { what, chars });
}

const PROTECTS = [[KeyRound, 'master.protectsKeys'], [ShieldAlert, 'master.protectsFull'], [Trash2, 'master.protectsDelete'], [Smartphone, 'master.protectsLink']];
const STRENGTH_TONE = ['destructive', 'destructive', 'warning', 'success', 'success'];

// A password box as the welcome's mock-up draws it (.field.pw): a label, a 34 px box with a lock, the text and «Mostrar» at its
// right. Kept a password field unless the user shows it (reveal: useReveal, one per box). children go under the box.
function PasswordBox({ id, label, value, onChange, reveal, autoFocus = false, 'data-testid': testid, children = null, describedBy }) {
  return (
    <div className="grid min-w-0 content-start gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="bg-card border-border text-muted-foreground rounded-ctl focus-within:border-input flex h-[calc(var(--ctl)+2px)] items-center gap-2 border px-2.5 transition-[border-color]">
        <Lock className="size-4 flex-none" aria-hidden="true" />
        <input id={id} type={reveal.shown ? 'text' : 'password'} autoComplete="new-password" spellCheck={false} autoCorrect="off" autoCapitalize="off" autoFocus={autoFocus} value={value} onChange={onChange} aria-describedby={describedBy} data-testid={testid}
          className={cn('text-foreground min-w-0 flex-1 border-0 bg-transparent text-[15px] outline-none', !reveal.shown && 'tracking-[0.08em]')} />
        <RevealButton reveal={reveal} />
      </div>
      {children}
    </div>
  );
}

// The recovery code, shown once in the card of the password just made; when it could not be made, the same card says so and
// the user chooses (try again, or make it later in Ajustes › Datos). It lives in this component's state only: nothing stores it.
function RecoveryCode({ code = null, error = null, busy = false, wizard = false, onRetry, onLater, onDone }) {
  const t = useT();
  const [kept, setKept] = useState(false);
  return (
    <WizardPage step={wizard ? 'maestra' : undefined}>
      <WizardCard kick={wizard ? t('setup.kick', { n: 4 }) : null} data-testid="master-code-card">
        <WizardTitle>{t('master.codeTitle')}</WizardTitle>
        {code ? (<>
          <WizardText>{t('master.codeIntro')}</WizardText>
          <div className="bg-muted rounded-ctl px-3 py-3 text-center font-mono text-lg font-semibold tracking-wider break-all select-all" data-testid="master-code-value">{code}</div>
          {navigator.clipboard ? <Button type="button" size="sm" variant="ghost" className="w-fit" onClick={() => navigator.clipboard.writeText(code).then(() => notifyOk(tNow('datos.copied'))).catch(quiet)} data-testid="master-code-copy"><Copy />{t('datos.copy')}</Button> : null}
          <label className="flex cursor-pointer items-start gap-2 text-control"><Checkbox checked={kept} onCheckedChange={(c) => setKept(c === true)} data-testid="master-code-kept" className="mt-0.5" /><span>{t('master.codeKept')}</span></label>
          <WizardFoot><Button type="button" disabled={!kept || busy} onClick={onDone} data-testid="master-code-continue">{t('setup.continue')}</Button></WizardFoot>
        </>) : (<>
          <FieldError>{t('master.codeError')}</FieldError>
          {error === 'expired' ? <WizardText>{t('master.codeExpired')}</WizardText> : null}
          <WizardFoot>
            <Button type="button" variant="outline" disabled={busy} onClick={onLater} data-testid="master-code-later">{t('master.codeLater')}</Button>
            {error === 'expired' ? null : <Button type="button" disabled={busy} onClick={onRetry} data-testid="master-code-retry">{busy ? <Spinner className="border-primary-foreground/40 border-t-primary-foreground" /> : null}{t('master.codeRetry')}</Button>}
          </WizardFoot>
        </>)}
      </WizardCard>
    </WizardPage>
  );
}

// wizard: one more step of the welcome (its row of steps on top); without it, the screen an updated Orb shows alone.
// onBack: the welcome's way back (never given to the lone screen).
export function MasterCreate({ onDone, upgrade = false, wizard = false, onBack = null }) {
  const t = useT();
  const uid = useId();
  const [v, setV] = useState({ next: '', again: '', ack: false });
  const [busy, setBusy] = useState(false);
  // Whether Orb already has the backups' recovery code (null: not known). One is given only when there is none: a new one
  // would leave the one the user wrote down useless.
  const [hasCode, setHasCode] = useState(null);
  const [code, setCode] = useState(null);
  // The password just typed, kept only until the offer of Windows Hello is answered (it proves turning Hello on).
  const typed = useRef('');
  const [offer, setOffer] = useState(false);
  const revealNew = useReveal();
  const revealAgain = useReveal();
  useEffect(() => { call('backup.status').then((s) => setHasCode(Boolean(s?.recovery))).catch(quiet); }, []);
  const set = (patch) => setV((x) => ({ ...x, ...patch }));
  const score = passwordStrength(v.next, MIN);
  // The recovery code: → { code } | { have: true } (Orb already has one) | { error: 'failed' | 'expired' }.
  const issue = async () => {
    const unlock = heldUnlock();
    if (!unlock) return { error: 'expired' };
    try {
      if ((await call('master.state'))?.canForget) return { have: true };
      const made = (await call('backup.recovery', { unlock, password: v.next }))?.code;
      return made ? { code: made } : { error: 'failed' };
    } catch { return { error: 'failed' }; }
  };
  // The welcome's last word on the password: Windows Hello is offered when this PC has it and it is off.
  const finish = async () => {
    if (typed.current && !bridge.mobile && await helloOfferable()) { setOffer(true); return; }
    typed.current = '';
    onDone?.();
  };
  const showIssue = (r) => { if (r.have) finish(); else { setCode(r); setBusy(false); } };
  const submit = async (e) => {
    e.preventDefault();
    if (!ready(v)) return;
    revealNew.hide(); revealAgain.hide();
    setBusy(true);
    try {
      keepUnlock(await call('master.create', { password: v.next }));
      notifyOk(t('master.created'));
      typed.current = v.next;
      set({ next: '', again: '' });
      if (hasCode === true) { finish(); return; }
      showIssue(await issue());
    }
    catch (error) { notifyError(error); setBusy(false); }
  };
  const retry = async () => { setBusy(true); showIssue(await issue()); };
  if (offer) return <HelloOffer password={typed.current} wizard={wizard} onDone={() => { typed.current = ''; onDone?.(); }} />;
  if (code) return <RecoveryCode code={code.code} error={code.error} busy={busy} wizard={wizard} onRetry={retry} onLater={finish} onDone={finish} />;
  return (
    <WizardPage step={wizard ? 'maestra' : undefined}>
      <WizardCard as="form" onSubmit={submit} data-testid="master-create" kick={wizard ? t('setup.kick', { n: 4 }) : null}>
        <WizardTitle>{t('master.createTitle')}</WizardTitle>
        <WizardText>{t(upgrade ? 'master.upgradeIntro' : 'master.createIntro')}</WizardText>
        <PasswordBox id={`${uid}-new`} label={t('master.password')} value={v.next} onChange={(e) => set({ next: e.target.value })} reveal={revealNew} describedBy={`${uid}-hint`} autoFocus data-testid="master-new">
          <div className="grid gap-1.5" data-testid="master-strength">
            <div className="flex gap-1" aria-hidden="true">{[1, 2, 3, 4].map((i) => <span key={i} className={cn('h-1 flex-1 rounded-full', v.next && i <= score ? BAR[score] : 'bg-border')} />)}</div>
            <p id={`${uid}-hint`} className="text-muted-foreground m-0 text-control">{v.next ? <><Badge variant={STRENGTH_TONE[score]}>{t(`master.strength.${score}`)}</Badge>{' '}{strengthLine(t, score, passwordShape(v.next))}</> : t('master.hint', { n: MIN })}</p>
          </div>
        </PasswordBox>
        <PasswordBox id={`${uid}-again`} label={t('master.repeat')} value={v.again} onChange={(e) => set({ again: e.target.value })} reveal={revealAgain} data-testid="master-again">
          {v.again && v.again !== v.next ? <FieldError>{t('master.mismatch')}</FieldError> : null}
          {v.again && v.again === v.next ? <p className="text-muted-foreground m-0 text-control"><Badge variant="success">{t('master.match')}</Badge></p> : null}
        </PasswordBox>
        <div className="bg-card border-border rounded-card my-2 border px-3 py-2.5">
          <span className="text-faint-foreground text-micro font-semibold tracking-[0.06em] uppercase">{t('master.protects')}</span>
          <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0 text-control">
            {PROTECTS.map(([Icon, key]) => <li key={key} className="flex items-center gap-2"><Icon className="text-muted-foreground size-4 flex-none" aria-hidden="true" />{t(key)}</li>)}
          </ul>
        </div>
        <Warning recovery={hasCode} />
        <label className="flex cursor-pointer items-start gap-2 text-control"><Checkbox checked={Boolean(v.ack)} onCheckedChange={(c) => set({ ack: c === true })} data-testid="master-ack" className="mt-0.5" /><span>{t(hasCode === null ? 'master.ack' : hasCode ? 'master.ackHave' : 'master.ackCode')}</span></label>
        <WizardText>{t('master.manager')}</WizardText>
        <WizardFoot>
          {onBack ? <Button type="button" variant="outline" disabled={busy} onClick={onBack} data-testid="master-back">{t('setup.back')}</Button> : null}
          <Button type="submit" disabled={!ready(v) || busy} data-testid="master-create-ok">{busy ? <Spinner className="border-primary-foreground/40 border-t-primary-foreground" /> : null}{t('master.create')}</Button>
        </WizardFoot>
      </WizardCard>
    </WizardPage>
  );
}

// Whether a typed password is shown in clear. It is never kept (no store, no storage) and goes back to hidden by itself:
// the window loses focus or is hidden, the form is sent (hide()), the engine locks, 30 s pass, or the box goes away.
export const REVEAL_MS = 30_000;
export function useReveal() {
  const [shown, setShown] = useState(false);
  const hide = useCallback(() => setShown(false), []);
  useEffect(() => {
    if (!shown) return undefined;
    const onHidden = () => { if (document.hidden) hide(); };
    const timer = setTimeout(hide, REVEAL_MS);
    window.addEventListener('blur', hide);
    document.addEventListener('visibilitychange', onHidden);
    const off = bridge.on?.('master:locked', hide);
    return () => { clearTimeout(timer); window.removeEventListener('blur', hide); document.removeEventListener('visibilitychange', onHidden); if (typeof off === 'function') off(); };
  }, [shown, hide]);
  return { shown, toggle: () => setShown((v) => !v), hide };
}
// The «Mostrar» / «Ocultar» text button that sits inside a password box, at its right.
function RevealButton({ reveal }) {
  const t = useT();
  return <button type="button" onClick={reveal.toggle} aria-pressed={reveal.shown} data-testid="master-reveal" className="text-muted-foreground hover:text-foreground rounded-ctl hover:bg-accent focus-visible:ring-ring h-6 shrink-0 px-2 text-[13px] font-normal outline-none focus-visible:ring-2">{t(reveal.shown ? 'master.hide' : 'master.show')}</button>;
}

// «He olvidado la contraseña» with the backups' recovery code: the secrets stay (a new data key), every phone is unlinked.
// code: what was already typed on the lock screen.
async function forgotWithCode(code = '') {
  return form(tNow('master.forgotTitle'), {
    description: tNow('master.forgotDesc'),
    initial: { code, next: '', again: '', ack: false },
    body: (v, set) => (<>
      <Field label={tNow('master.forgotCode')}><Input autoFocus={!code} autoComplete="off" spellCheck={false} autoCapitalize="characters" className="font-mono" value={v.code} onChange={(e) => set({ code: e.target.value })} placeholder="XXXX-XXXX-…" data-testid="master-code" /></Field>
      <NewPassword v={v} set={set} ack={tNow('master.forgotAck')} autoFocus={Boolean(code)} />
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
// «Lo he olvidado todo» when it cannot be done (no phone that approves, no Windows Hello, no password file): what is missing and that
// starting from scratch is what is left. → the reset's answer or null.
async function noRebuild(rb, lost) {
  const why = lost ? 'rebuild.no.lost' : rb.reason === 'noHello' ? 'rebuild.no.noHello' : 'rebuild.no.noPhone';
  if (!(await confirm(tNow('rebuild.noTitle'), `${tNow(why)} ${tNow('rebuild.noEnd')}`, { ok: tNow('master.reset'), danger: true }))) return null;
  return resetFlow();
}
// canForget: this PC can keep the secrets (it opened them and has a recovery code). Without the code, a phone that approves and
// Windows Hello can still make a new password and code («Lo he olvidado todo»); otherwise only starting from scratch.
async function forgotFlow({ canForget = false, lost = false } = {}) {
  let r = null;
  const rb = bridge.mobile ? { ok: false } : lost ? { ok: false } : await rebuildReadiness(call);
  const how = await choose(tNow('master.forgot'), tNow(canForget ? 'master.forgotChoose' : 'master.forgotChooseNo'), [
    ...(canForget ? [{ value: 'code', label: tNow('master.forgotWithCode'), hint: tNow('master.forgotWithCodeHint') }] : []),
    ...(bridge.mobile ? [] : [{ value: 'all', label: tNow('master.forgotAll'), hint: tNow('master.forgotAllHint') }]),
    { value: 'reset', label: tNow('master.reset'), hint: tNow('master.resetHint'), variant: 'danger' }
  ], { testid: 'master-forgot-choice' });
  if (how === 'code') r = await forgotWithCode();
  else if (how === 'all') r = rb.ok ? await rebuildFlow(rb) : await noRebuild(rb, lost);
  else if (how === 'reset') r = await resetFlow();
  if (r?.unlock) keepUnlock(r);
  return r;
}

// Why the screen locked, as the engine says it (master.state › lockReason); anything else only says when.
const LOCK_SUBS = { idle: 'master.screenSubIdle', windows: 'master.screenSubWindows', sleep: 'master.screenSubSleep', manual: 'master.screenSubManual' };
const pad2 = (n) => String(n).padStart(2, '0');
// The PC's local time, HH:MM, or null when there is no (valid) time.
const clockOf = (iso) => { const d = new Date(iso ?? ''); return Number.isNaN(d.getTime()) ? null : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

// This PC cannot open the keys by itself (the password opens them), or the password's file is missing (lost: no
// password to type; the recovery code, or starting from scratch). also Orb's lock screen (screenLocked: Windows
// locked, the PC asleep, «Bloquear» or Orb unused for a while; the agents keep working meanwhile).
export function MasterLocked({ onDone, state = null }) {
  const t = useT();
  useBaseAppearance();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState('password'); // 'password' | 'code' (the recovery code: it only leads to a new password)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [lockInfo, setLockInfo] = useState(null);
  const [canForget, setCanForget] = useState(Boolean(state?.canForget)); // the lock event's state has none: master.state says
  const dialog = useRef(false); // a dialog opened from this card is on screen: no second one
  const reveal = useReveal();
  const fieldRef = useRef(null);
  const fieldId = useId();
  const [hello, setHello] = useState(null); // master.helloState, read while the screen is locked
  const lost = Boolean(state?.lost);
  const screen = !lost && !state?.locked && Boolean(state?.screenLocked);
  const withCode = !lost && canForget;
  const inCode = withCode && mode === 'code';
  // When and why it locked is asked of the engine each time (the state this card was given may be from an earlier lock).
  useEffect(() => {
    if (!screen) return undefined;
    let live = true;
    call('master.state').then((s) => { if (!live) return; setLockInfo({ at: s?.lockedAt ?? null, reason: s?.lockReason ?? null }); setCanForget(Boolean(s?.canForget)); }).catch(quiet);
    if (!bridge.mobile) call('master.helloState').then((s) => { if (live) setHello(s); }).catch(quiet);
    return () => { live = false; };
  }, [screen]);
  const time = screen ? clockOf(lockInfo?.at) : null;
  const sub = lost ? t('master.lostBody') : screen ? (time ? t(LOCK_SUBS[lockInfo?.reason] ?? 'master.screenSubAt', { time }) : t('master.screenSub')) : t('master.lockedBody');
  const finish = (r) => { if (!r) return; if (r.unlock) keepUnlock(r); onDone?.(); };
  // One dialog at a time, and never over a password that is shown.
  const openDialog = async (open) => {
    if (dialog.current) return;
    dialog.current = true; reveal.hide();
    try { finish(await open()); } finally { dialog.current = false; }
  };
  const submit = async (e) => {
    e.preventDefault(); reveal.hide();
    if (busy) return;
    if (inCode) {
      if (!code.trim()) { fieldRef.current?.focus(); return; }
      await openDialog(() => forgotWithCode(code.trim()));
      return;
    }
    if (!password) { fieldRef.current?.focus(); return; }
    setBusy(true); setError(null);
    try { keepUnlock(await call('master.unlock', { password })); onDone?.(); }
    catch (err) { setError(errorText(err)); setBusy(false); }
  };
  const forgot = () => openDialog(() => forgotFlow({ canForget, lost }));
  const helloMark = screen && !inCode ? helloMode(hello) : 'off';
  const switchTo = (next) => { if (busy) return; reveal.hide(); setError(null); setMode(next); };
  // Grey, 24 px tall with 12 px of side padding, as the mock-up's ghost button inside the «¿La olvidaste?» line.
  const linkClass = 'text-muted-foreground hover:text-foreground hover:underline focus-visible:ring-ring rounded-ctl inline-flex h-6 items-center px-3 align-middle text-[13px] outline-none focus-visible:ring-2';
  // Nothing of the app is drawn while it is locked: behind the veil there is only a static drawing of its outline
  // (LockBackdrop: no text, no data), blurred. The veil and the card are siblings of the backdrop (not inside it) so the
  // window's own buttons, which stay usable (the pointer goes through the veil), sit under the veil as in the mock-up:
  // app.css lowers them while this card is shown.
  return (
    <>
      <div className="relative isolate h-full">
        <Scene />
        <LockBackdrop />
      </div>
      <div className="pointer-events-none fixed inset-0 z-[46] bg-black/32 backdrop-blur-[10px]" aria-hidden="true" />
      <div className="pointer-events-none fixed inset-0 z-[47] flex overflow-auto p-6">
        <form onSubmit={submit} data-slot="dialog-content" className="dialog bg-background text-foreground rounded-card border-border pointer-events-auto m-auto grid w-[440px] max-w-full shrink-0 gap-3 border p-[18px]" data-testid="master-locked" data-screen={screen ? '1' : undefined} data-mode={inCode ? 'code' : undefined}>
            <div className="flex h-12 items-center gap-4">
              <LockMark busy={busy} lost={lost} />
              <div className="min-w-0">
                <h1 className="font-(family-name:--title) text-lg leading-tight font-semibold">{t(lost ? 'master.lostTitle' : screen ? 'master.screenTitle' : 'master.lockedTitle')}</h1>
                <p className="text-muted-foreground mt-0.5 text-xs leading-snug" data-testid="master-sub">{sub}</p>
              </div>
            </div>
            {lost ? null : (<>
              <div className="grid gap-1.5">
                <Label htmlFor={fieldId} className="text-[13px] leading-[1.45]">{t(inCode ? 'master.forgotCode' : 'master.password')}</Label>
                <div className="border-border bg-card text-muted-foreground rounded-ctl focus-within:border-input flex h-[calc(var(--ctl)+2px)] items-center gap-2 border px-2.5 transition-[border-color]">
                  {inCode ? <LifeBuoy className="size-3.5 shrink-0" /> : <Lock className="size-3.5 shrink-0" />}
                  {inCode
                    ? <input key="code" ref={fieldRef} id={fieldId} type="text" autoComplete="off" autoFocus spellCheck={false} autoCapitalize="characters" value={code} onChange={(e) => { setCode(e.target.value); setError(null); }} placeholder={t('master.codePlaceholder')} data-testid="master-code-field" className="placeholder:text-faint-foreground text-foreground min-w-0 flex-1 bg-transparent font-mono text-[15px] outline-none" />
                    : <input key="password" ref={fieldRef} id={fieldId} type={reveal.shown ? 'text' : 'password'} autoComplete="current-password" autoFocus spellCheck={false} autoCorrect="off" autoCapitalize="off" value={password} onChange={(e) => { setPassword(e.target.value); setError(null); }} placeholder={t('master.password')} data-testid="master-password" aria-invalid={error ? true : undefined} className="placeholder:text-faint-foreground text-foreground min-w-0 flex-1 bg-transparent text-[15px] tracking-[.08em] outline-none" />}
                  {inCode ? null : <RevealButton reveal={reveal} />}
                </div>
                {inCode ? <p className="text-muted-foreground m-0 text-xs leading-snug" data-testid="master-code-note">{t('master.codeNote')}</p> : null}
              </div>
              {error ? <p className="text-destructive flex items-center gap-1.5 text-xs" role="alert" data-testid="master-error"><CircleAlert className="size-3.5 shrink-0" />{error}</p> : null}
              <Button type="submit" className="h-(--ctl) w-full" disabled={busy} data-testid="master-unlock">{busy ? <Spinner className="border-white/40 border-t-white" /> : null}{t(inCode ? 'master.unlockWithCode' : 'master.unlock')}</Button>
            </>)}
            {helloMark === 'on' || helloMark === 'noChip' ? <HelloBox action="lock" wait={hello?.waitUntil} submit={false} onToken={(r) => finish(r)} data-testid="master-hello" /> : null}
            {helloMark === 'changed' ? <HelloNotes changed /> : null}
            {withCode ? (
              <div className="text-muted-foreground grid justify-items-center gap-1 text-center text-xs">
                {inCode ? (<>
                  <button type="button" className={linkClass} disabled={busy} onClick={() => switchTo('password')} data-testid="master-use-password">{t('master.useMaster')}</button>
                  <button type="button" className={linkClass} onClick={() => openDialog(resetFlow)} data-testid="master-no-code">{t('master.noCode')}</button>
                </>) : (
                  <span className="flex h-6 items-center gap-1">{t('master.forgotAsk')} <button type="button" className={linkClass} disabled={busy} onClick={() => switchTo('code')} data-testid="master-use-code">{t('master.useCode')}</button></span>
                )}
              </div>
            ) : (
              <div className="text-center"><Button type="button" variant={lost ? 'default' : 'ghost'} size="sm" onClick={forgot} data-testid="master-forgot">{t('master.forgot')}</Button></div>
            )}
            {screen ? <LockStatus /> : null}
            {screen ? <p className="text-muted-foreground text-xs leading-[1.45]" data-testid="master-screen-note">{t('master.screenNote')}</p> : null}
          </form>
      </div>
    </>
  );
}

// A static outline of the app (sidebar, top bar, a few conversation blocks) drawn with the theme's colours. It holds no
// text and reads nothing from the store: the app is neither mounted nor captured under the lock, so nothing of it can leak.
function LockBackdrop() {
  return (
    <main className="theme-scene flex h-full" aria-hidden="true" inert data-testid="lock-backdrop">
      <aside className="bg-sidebar border-border flex h-full w-[260px] shrink-0 flex-col gap-3 border-r p-3">
        <span className="bg-muted mt-1 h-5 w-16 rounded" />
        <span className="bg-muted h-[var(--ctl)] rounded-ctl" />
        <div className="grid grid-cols-4 gap-2 py-1">{[0, 1, 2, 3].map((i) => <span key={i} className="bg-muted h-9 rounded-ctl" />)}</div>
        {[72, 58, 66, 50, 62].map((w) => (
          <div key={w} className="flex items-center gap-3 px-1 py-1.5"><span className="bg-muted size-9 shrink-0 rounded-full" /><span className="flex flex-1 flex-col gap-1.5"><span className="bg-muted h-2.5 rounded" style={{ width: `${w}%` }} /><span className="bg-muted/60 h-2 w-4/5 rounded" /></span></div>
        ))}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-border flex h-14 shrink-0 items-center justify-center gap-2 border-b"><span className="bg-muted h-3 w-40 rounded" /></div>
        <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-4 overflow-hidden p-6">
          <span className="bg-muted/70 h-16 w-3/5 self-end rounded-[14px]" />
          <span className="bg-card border-border h-28 w-4/5 rounded-[14px] border" />
          <span className="bg-muted/70 h-12 w-2/5 self-end rounded-[14px]" />
          <span className="bg-card border-border h-36 w-full rounded-[14px] border" />
        </div>
        <div className="border-border mx-auto mb-4 h-[var(--ctl)] w-full max-w-[720px] rounded-ctl border" />
      </div>
    </main>
  );
}

// The 48 px mark of the lock card: Orb's head in the Orb theme only, a lock in every other one.
function LockMark({ busy, lost }) {
  const skin = useStore((s) => s.app?.config?.ui?.skin);
  if (robotSkin(skin)) return <Robot size={48} mood={busy ? 'thinking' : lost ? 'worried' : 'idle'} />;
  return <span className="bg-primary-soft text-primary-text rounded-big grid size-12 shrink-0 place-items-center"><Lock className="size-6" /></span>;
}

// What goes on behind the lock screen, only when the window has the app's tasks (a start without keys has none yet).
function LockStatus() {
  const t = useT();
  const working = useStore((s) => (s.tasks ?? []).filter((x) => x.status === 'running').length);
  const asking = useStore((s) => (s.tasks ?? []).filter(needsApproval).length);
  if (!working && !asking) return null;
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="master-screen-status">
      {working ? <Badge className="h-5"><Loader />{t('master.screenWorking', { n: working })}</Badge> : null}
      {asking ? <Badge variant="warning" className="h-5"><ShieldQuestion />{t(asking === 1 ? 'master.screenAskingOne' : 'master.screenAsking', { n: asking })}</Badge> : null}
    </div>
  );
}

// Before a guarded action: the password, once every 5 minutes. → { unlock, until } or null.
// an action that asks every time (fresh: deleting a project) says so instead, and its token is for it alone.
// With Windows Hello on, the dialog first says in Orb's own words what is being approved (Windows' notice is generic) and offers
// Hello; an action Hello never opens (what shows or saves a secret) says it needs the password instead.
setMasterAsker(async (action, { fresh = false, what = null, request = null } = {}) => {
  const state = bridge.mobile ? null : await call('master.helloState').catch(() => null);
  const withPhone = !bridge.mobile && await mobileReady(call, request);
  const usable = helloUsable(state);
  const offerHello = usable && canUseHello(action);
  let got = null; // the token Hello gave: the dialog's submit hands it back
  return form(tNow('master.askTitle'), {
    description: `${tNow(`master.ask.${action}`)} ${fresh ? tNow('master.askEveryTime') : tNow('master.askNote', { n: 5 })}`,
    initial: { password: '' },
    body: (v, set) => (<>
      {offerHello ? <HelloBox action={action} what={what} purpose={fresh ? action : null} wait={state.waitUntil} onToken={(r) => { got = r; }} /> : null}
      {helloMode(state) === 'changed' ? <HelloNotes changed /> : null}
      {withPhone ? <MobileBox request={request} onToken={(r) => { got = r; }} /> : null}
      <Field label={tNow('master.password')}><Input type="password" autoComplete="current-password" autoFocus={!offerHello} value={v.password} onChange={(e) => set({ password: e.target.value })} data-testid="master-ask" /></Field>
      {usable && !offerHello ? <HelloPasswordOnly /> : null}
    </>),
    ok: tNow('master.unlock'),
    onOk: (v) => got ?? call('master.unlock', { password: v.password, ...(fresh ? { purpose: action } : {}) })
  });
});
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
    if (r?.unlock) { keepUnlock(r); notifyOk(t('master.changed')); load(); }
  };
  const forgot = async () => { if (await forgotFlow({ canForget: st.canForget })) load(); };
  const when = st.changedAt ? new Date(st.changedAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) : null;
  return (
    <Block title={t('master.cardTitle')} note={t('master.cardDesc')} data-testid="master-card">
      <Panel>
        <Setting label={t('master.cardTitle')} hint={when ? t('master.since', { when }) : t('master.cardHint')}>
          <Button size="sm" variant="ghost" onClick={forgot} data-testid="master-forgot">{t('master.forgot')}</Button>
          {bridge.mobile ? null : <Button size="sm" variant="outline" onClick={() => act(call('master.lock', { reason: 'hand' }))} data-testid="master-lock-now"><LockKeyhole />{t('master.lockNow')}</Button>}
          <Button size="sm" variant="outline" onClick={change} data-testid="master-change"><KeyRound />{t('master.change')}</Button>
        </Setting>
        {bridge.mobile ? null : <LockMinutes />}
        {bridge.mobile ? null : <HelloSetting canCode={st.canForget === true} />}
      </Panel>
    </Block>
  );
}

// after how long without use Orb locks itself (config.ui.lockMinutes; 15 by default).
function LockMinutes() {
  const t = useT();
  const config = useStore((s) => s.app?.config);
  const value = String(lockMinutesOf(config));
  const pick = async (v) => {
    const next = await act(call('config.save', { patch: { ui: { lockMinutes: Number(v) } } }), t('settings.saved'));
    if (next) setState({ app: { ...getState().app, config: next } });
  };
  return (
    <Setting label={t('master.lockAfter')} hint={t('master.lockAfterHint')}>
      <Select caret="solid" value={value} onValueChange={pick} title={t('master.lockAfter')} options={LOCK_MINUTES.map((n) => ({ value: String(n), label: t('master.lockMinutes', { n }) }))} data-testid="master-lock-minutes" />
      <span className="text-muted-foreground text-control whitespace-nowrap">{t('master.lockUnused')}</span>
    </Setting>
  );
}

// A connector's keys (Ajustes › Conectores): seen and changed after the password; one «NAME=value» per line.
const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_]{0,99})=(.*)$/;
export async function connectorKeys(server) {
  const unlock = await unlockCore('secrets', { request: { method: 'secrets.connector', params: { name: server.name } } });
  if (!unlock) return;
  let current; try { current = await call('secrets.connector', { name: server.name, unlock }); } catch (error) { notifyError(error); return; }
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
      // What was seen used the first token (a phone's is for one call): saving asks again, now for exactly these keys.
      const params = { name: server.name, env };
      const again = await unlockCore('secrets', { request: { method: 'secrets.saveConnector', params } });
      if (!again) return false;
      return call('secrets.saveConnector', { ...params, unlock: again });
    }
  });
  if (!r) return;
  notifyOk(tNow('master.keysSaved'));
  const app = await call('app.state').catch(() => null);
  if (app) setState({ app: { ...getState().app, config: app.config } });
}
