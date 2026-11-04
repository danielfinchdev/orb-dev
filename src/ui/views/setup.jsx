// First run: the assistant's name, what to call the user, their language and time zone, and where its folder goes.
// Everything lives in that folder. 3.6: then a short wizard (who will use this Orb, an optional template, reaching it from
// outside, backups), every step skippable; on Windows, installing what is missing comes last.
import { useEffect, useState } from 'react';
import { FolderOpen, ArrowRight, ArrowLeft, Plus, ExternalLink, KeyRound, HardDriveDownload, Truck } from 'lucide-react';
import { Robot } from '@/components/robot.jsx';
import { Installer, InstallProgress, useFunPhrase } from '@/components/installer.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input, Textarea, Field, Spinner } from '@/components/ui/basic.jsx';
import { Select, Checkbox } from '@/components/ui/overlay.jsx';
import { bridge, call, act, useStore, refresh } from '@/lib/store.js';
import { WIZARD_STEPS, nextStep, prevStep, templateSummary, templateEdits } from '@/lib/persons.js';
import { newRecoveryCode } from './data.jsx';
import { TzSelect } from './persons.jsx';
import { cn } from '@/lib/utils.js';
import { LANGUAGES } from '../../core/i18n.mjs';
import { useT } from '@/lib/i18n.js';
import { toast } from 'sonner';
import { errorText } from '@/lib/utils.js';
import { PRODUCT } from '../../core/product.mjs';

const hereTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

export function Setup({ onDone }) {
  const t = useT();
  const [name, setName] = useState(PRODUCT.assistant);
  const [user, setUser] = useState('');
  const [base, setBase] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mood, setMood] = useState('happy');
  const [step, setStep] = useState('datos'); // datos → quien → plantilla → fuera → copias → equipo (Windows) → app
  const [language, setLanguage] = useState(/^en/i.test(navigator.language ?? '') ? 'en' : 'es');
  const [tz, setTz] = useState(hereTz());
  const [win, setWin] = useState(false);
  const shown = name.trim() || PRODUCT.assistant;
  const sep = base?.includes('\\') ? '\\' : '/';
  // The same rule the app uses (homeFor): always <base>/Orb, whatever the assistant is called, unless the base already is it.
  const target = base ? (/^orb$/i.test(base.split(/[\\/]/).filter(Boolean).pop() ?? '') ? base : `${base}${base.endsWith(sep) ? '' : sep}${PRODUCT.folder}`) : null;
  const create = async (e) => {
    e.preventDefault();
    setBusy(true); setMood('thinking');
    try {
      await bridge.setup({ base, assistantName: shown, userName: user.trim() });
      setMood('happy');
      const info = await bridge.info();
      setWin(info.platform === 'win32');
      // 3.6: the owner's language and time zone (the engine is running in the new folder now).
      await call('config.save', { patch: { language } }).catch(() => {});
      await call('persons.update', { language, tz }).catch(() => {});
      await refresh().catch(() => {});
      setBusy(false); setStep('quien');
    }
    catch (error) { setMood('worried'); toast.error(errorText(error)); setBusy(false); }
  };
  if (step === 'equipo') return <Prepare name={shown} onDone={onDone} />;
  const move = (to) => setStep(to === 'fin' ? (win ? 'equipo' : 'fin') : to);
  if (step === 'fin') { setTimeout(onDone, 0); return null; }
  if (step === 'quien') return <WhoStep onNext={() => move(nextStep('quien'))} />;
  if (step === 'plantilla') return <TemplateStep onNext={() => move(nextStep('plantilla'))} onBack={() => setStep(prevStep('plantilla'))} />;
  if (step === 'fuera') return <OutsideStep onNext={() => move(nextStep('fuera'))} onBack={() => setStep(prevStep('fuera'))} />;
  if (step === 'copias') return <BackupStep onNext={() => move(nextStep('copias'))} onBack={() => setStep(prevStep('copias'))} />;
  return (
    <div className="brand-sky flex h-full overflow-auto px-6 pt-24 pb-6">
      <form onSubmit={create} className="bg-card/95 text-card-foreground m-auto grid w-full max-w-[460px] gap-5 rounded-3xl border border-white/40 p-8 shadow-2xl backdrop-blur">
        <div className="-mt-20 flex justify-center"><Robot size={128} mood={mood} title={shown} /></div>
        <div className="text-center">
          <h1 className="text-2xl">{t('setup.hello', { name: shown })}</h1>
          <p className="mt-1 text-sm font-medium" data-testid="setup-tagline">{t('setup.tagline')}</p>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{t('setup.intro')}</p>
        </div>
        <Field label={t('setup.nameLabel')}><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus /></Field>
        <Field label={t('setup.userLabel')}><Input value={user} onChange={(e) => setUser(e.target.value)} placeholder={t('setup.userPlaceholder')} maxLength={40} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('profile.language')}><Select className="w-full" value={language} onValueChange={setLanguage} options={Object.entries(LANGUAGES).map(([value, label]) => ({ value, label }))} title={t('profile.language')} data-testid="setup-language" /></Field>
          <Field label={t('profile.tz')}><TzSelect value={tz} onChange={setTz} testid="setup-tz" /></Field>
        </div>
        <div className="grid gap-2">
          <span className="text-[13px] font-medium">{t('setup.whereFolder')}</span>
          <Button type="button" variant="outline" className="justify-start" onClick={async () => { const f = await bridge.pickFolder(t('setup.whereFolder')); if (f) setBase(f); }}><FolderOpen />{base ? t('setup.changeLocation') : t('setup.pickLocation')}</Button>
          <div className="bg-muted rounded-lg px-3 py-2 font-mono text-xs break-all" data-testid="setup-target">{target ?? t('setup.example', { name: PRODUCT.folder })}</div>
          <p className="text-muted-foreground text-xs leading-relaxed">{t('setup.folderNote')}</p>
        </div>
        {/* 3.6: bringing an Orb from another PC: the copy made with Ajustes › Datos › «Mover a otro PC». */}
        <div className="text-muted-foreground flex items-start gap-2 rounded-xl border border-dashed px-3 py-2 text-xs" data-testid="setup-move-import"><Truck className="mt-0.5 size-4 shrink-0" /><span><b className="text-foreground font-medium">{t('wizard.moveTitle')}</b> · {t('wizard.moveUnavailable')}</span></div>
        <Button type="submit" size="lg" disabled={!base || busy} data-testid="setup-create">{busy ? <Spinner className="border-white/40 border-t-white" /> : null}{t('setup.create')}<ArrowRight /></Button>
      </form>
    </div>
  );
}

// Windows, after the folder: install what is missing. While it installs, the title is a light phrase that changes every
// few seconds, the bar goes under it and the explanation under the bar.
export function Prepare({ name, onDone }) {
  const t = useT();
  const [progress, setProgress] = useState(null);
  const running = Boolean(progress?.running);
  const { n, phrase } = useFunPhrase(running);
  const finished = progress?.finished && !progress.interrupted;
  const title = running ? `${phrase}…` : finished ? t('install.ready') : progress?.interrupted ? t('install.interrupted') : t('setup.prepareTitle');
  return (
    <div className="brand-sky flex h-full overflow-auto px-6 pt-24 pb-6">
      <div className="bg-card/95 text-card-foreground m-auto grid w-full max-w-[520px] gap-5 rounded-3xl border border-white/40 p-8 shadow-2xl backdrop-blur">
        <div className="-mt-20 flex justify-center"><Robot size={120} mood={running ? 'thinking' : finished ? 'happy' : 'hello'} title={name} live /></div>
        <div className="grid gap-3 text-center">
          <h1 key={running ? n : title} className="animate-in fade-in slide-in-from-bottom-1 text-2xl duration-500" aria-live="polite" data-testid="prepare-title">{title}</h1>
          {progress?.steps.length ? <InstallProgress progress={progress} fun={false} /> : null}
          <p className="text-muted-foreground text-sm">{t('setup.prepareDesc')}</p>
        </div>
        <Installer bar={false} onProgress={setProgress} />
        <Button size="lg" onClick={onDone}>{t('setup.continue')}<ArrowRight /></Button>
      </div>
    </div>
  );
}

// ---- 3.6: the welcome wizard after the folder: who will use this Orb, an optional template, reaching it from outside
// and backups. Every step can be skipped; nothing here is needed to start.
function Steps({ step }) {
  const t = useT();
  const i = WIZARD_STEPS.indexOf(step);
  return <div className="text-muted-foreground flex items-center justify-center gap-1.5 text-xs" data-testid="wizard-steps" aria-label={t('wizard.stepOf', { n: i + 1, total: WIZARD_STEPS.length })}>{WIZARD_STEPS.map((s, n) => <span key={s} className={cn('h-1.5 rounded-full transition-all', n <= i ? 'bg-primary w-6' : 'bg-muted w-3')} />)}</div>;
}
function Panel({ step, children, wide }) {
  return (
    <div className="brand-sky flex h-full overflow-auto px-6 pt-24 pb-6">
      <div className={cn('bg-card/95 text-card-foreground m-auto grid w-full gap-5 rounded-3xl border border-white/40 p-8 shadow-2xl backdrop-blur', wide ? 'max-w-[720px]' : 'max-w-[520px]')} data-testid={`wizard-${step}`}>
        <div className="-mt-20 flex justify-center"><Robot size={112} mood="happy" /></div>
        <Steps step={step} />
        {children}
      </div>
    </div>
  );
}
const Nav = ({ onNext, onBack, next, busy, skip, testid }) => {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      {onBack ? <Button type="button" variant="ghost" onClick={onBack}><ArrowLeft />{t('wizard.back')}</Button> : <span />}
      <div className="flex gap-2">
        {skip ? <Button type="button" variant="outline" onClick={skip}>{t('wizard.skip')}</Button> : null}
        <Button type="button" size="lg" onClick={onNext} disabled={busy} data-testid={testid ?? 'wizard-next'}>{busy ? <Spinner className="border-white/40 border-t-white" /> : null}{next ?? t('wizard.next')}<ArrowRight /></Button>
      </div>
    </div>
  );
};

function WhoStep({ onNext }) {
  const t = useT();
  const [many, setMany] = useState(false);
  const [names, setNames] = useState(['']);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!many) return onNext();
    setBusy(true);
    try {
      for (const n of names.map((x) => x.trim()).filter(Boolean)) await call('persons.create', { name: n, tz: hereTz() });
      onNext();
    } catch (error) { toast.error(errorText(error)); }
    finally { setBusy(false); }
  };
  const choice = (on, title, body, testid) => (
    <button type="button" onClick={() => setMany(on)} aria-pressed={many === on} data-testid={testid}
      className={cn('grid cursor-pointer gap-1 rounded-2xl border p-4 text-left', many === on ? 'border-primary bg-primary/5' : 'hover:bg-accent/50')}>
      <span className="font-medium">{title}</span><span className="text-muted-foreground text-xs">{body}</span>
    </button>
  );
  return (
    <Panel step="quien">
      <div className="text-center"><h1 className="text-2xl">{t('wizard.whoTitle')}</h1><p className="text-muted-foreground mt-1 text-sm">{t('wizard.whoIntro')}</p></div>
      <div className="grid gap-2 sm:grid-cols-2">{choice(false, t('wizard.onlyMe'), t('wizard.onlyMeHint'), 'wizard-only-me')}{choice(true, t('wizard.morePeople'), t('wizard.morePeopleHint'), 'wizard-more-people')}</div>
      {many ? (
        <div className="grid gap-2">
          {names.map((n, i) => <Input key={i} value={n} maxLength={40} onChange={(e) => setNames(names.map((x, j) => (j === i ? e.target.value : x)))} placeholder={t('wizard.personPh')} aria-label={t('wizard.personPh')} data-testid={`wizard-person-${i}`} />)}
          <Button type="button" size="sm" variant="ghost" className="w-fit" onClick={() => setNames([...names, ''])}><Plus />{t('wizard.addPerson')}</Button>
          <p className="text-muted-foreground text-xs">{t('wizard.peopleNote')}</p>
        </div>
      ) : null}
      <Nav onNext={go} busy={busy} />
    </Panel>
  );
}

function TemplateStep({ onNext, onBack }) {
  const t = useT();
  const lang = useStore((s) => s.app?.config?.language) ?? 'es';
  const [list, setList] = useState(null);
  const [pick, setPick] = useState(null);
  const [edit, setEdit] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { call('templates.list', { lang }).then(setList).catch(() => setList([])); }, [lang]);
  const tpl = list?.find((x) => x.id === pick) ?? null;
  const apply = async () => {
    if (!tpl || templateSummary(tpl).empty) return onNext();
    setBusy(true);
    try { await call('templates.apply', { id: tpl.id, edits: templateEdits(tpl, edit), tz: hereTz() }); toast.success(t('wizard.applied', { name: tpl.name })); onNext(); }
    catch (error) { toast.error(errorText(error)); }
    finally { setBusy(false); }
  };
  const field = (k, fallback) => ({ value: edit[k] ?? fallback ?? '', onChange: (e) => setEdit({ ...edit, [k]: e.target.value }) });
  return (
    <Panel step="plantilla" wide>
      <div className="text-center"><h1 className="text-2xl">{t('wizard.tplTitle')}</h1><p className="text-muted-foreground mt-1 text-sm">{t('wizard.tplIntro')}</p></div>
      {list == null ? <Spinner className="mx-auto" /> : (
        <div className="grid gap-2 sm:grid-cols-2">
          {list.map((x) => (
            <button key={x.id} type="button" onClick={() => { setPick(x.id); setEdit({}); }} aria-pressed={pick === x.id} data-testid={`wizard-tpl-${x.id}`}
              className={cn('grid cursor-pointer gap-1 rounded-2xl border p-4 text-left', pick === x.id ? 'border-primary bg-primary/5' : 'hover:bg-accent/50')}>
              <span className="font-medium">{x.icon ? `${x.icon} ` : ''}{x.name}</span><span className="text-muted-foreground text-xs">{x.description}</span>
            </button>
          ))}
        </div>
      )}
      {tpl && !templateSummary(tpl).empty ? (
        <div className="grid gap-3 rounded-2xl border p-4" data-testid="wizard-tpl-preview">
          <p className="text-sm font-medium">{t('wizard.tplPreview', { bots: tpl.bots.length, reminders: tpl.reminders?.length ?? 0 })}</p>
          {tpl.bots.map((b, i) => (
            <div key={b.key ?? i} className={cn('grid gap-1.5', edit[`skip${i}`] && 'opacity-50')}>
              <div className="flex items-center gap-2">
                <Checkbox checked={!edit[`skip${i}`]} onCheckedChange={(on) => setEdit({ ...edit, [`skip${i}`]: !on })} aria-label={t('wizard.tplKeep')} />
                <span className="text-lg">{b.icon}</span>
                <Input className="flex-1" maxLength={40} {...field(`name${i}`, b.name)} aria-label={t('wizard.tplBotName')} data-testid={`wizard-bot-name-${i}`} />
              </div>
              <Textarea rows={2} maxLength={4000} className="text-[13px]" {...field(`role${i}`, b.role_text)} aria-label={t('wizard.tplBotRole')} />
            </div>
          ))}
          {(tpl.reminders ?? []).length ? <div className="grid gap-1.5"><span className="text-muted-foreground text-xs">{t('wizard.tplReminders')}</span>
            {tpl.reminders.map((r, i) => <div key={i} className="flex items-center gap-2"><Checkbox checked={!edit[`remSkip${i}`]} onCheckedChange={(on) => setEdit({ ...edit, [`remSkip${i}`]: !on })} aria-label={t('wizard.tplKeep')} /><Input className="flex-1 text-[13px]" maxLength={300} {...field(`rem${i}`, r.text)} /></div>)}
          </div> : null}
          <p className="text-muted-foreground text-xs">{t('wizard.tplLater')}</p>
        </div>
      ) : null}
      <Nav onBack={onBack} onNext={apply} busy={busy} skip={onNext} next={tpl && !templateSummary(tpl).empty ? t('wizard.tplApply') : undefined} testid="wizard-tpl-apply" />
    </Panel>
  );
}

function OutsideStep({ onNext, onBack }) {
  const t = useT();
  return (
    <Panel step="fuera">
      <div className="text-center"><h1 className="text-2xl">{t('wizard.outTitle')}</h1><p className="text-muted-foreground mt-1 text-sm">{t('wizard.outIntro')}</p></div>
      <ol className="grid list-decimal gap-1.5 pl-5 text-sm">
        <li>{t('wizard.out1')}</li><li>{t('wizard.out2')}</li><li>{t('wizard.out3')}</li>
      </ol>
      <Button type="button" variant="outline" className="w-fit" onClick={() => bridge.openExternal('https://tailscale.com/download')}><ExternalLink />{t('wizard.outGet')}</Button>
      <p className="bg-muted rounded-xl px-3 py-2 text-xs" data-testid="wizard-pc-on">{t('wizard.outPcOn')}</p>
      <Nav onBack={onBack} onNext={onNext} />
    </Panel>
  );
}

function BackupStep({ onNext, onBack }) {
  const t = useT();
  const [st, setSt] = useState(null);
  const [made, setMade] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => call('backup.status').then(setSt).catch(() => setSt(null));
  useEffect(() => { load(); }, []);
  const first = async () => { setBusy(true); const r = await act(call('backup.now', {}), t('datos.made')); setBusy(false); if (r) setMade(true); };
  return (
    <Panel step="copias">
      <div className="text-center"><h1 className="text-2xl">{t('wizard.bakTitle')}</h1><p className="text-muted-foreground mt-1 text-sm">{t('wizard.bakIntro')}</p></div>
      {st ? <div className="bg-muted rounded-lg px-3 py-2 font-mono text-xs break-all">{st.folder}</div> : null}
      <div className="grid gap-2">
        <Button type="button" variant="outline" onClick={async () => { if (await newRecoveryCode()) load(); }} data-testid="wizard-code"><KeyRound />{st?.recovery ? t('datos.codeAgain') : t('datos.codeMake')}</Button>
        <p className="text-muted-foreground text-xs">{t('wizard.bakCodeNote')}</p>
        <Button type="button" variant="outline" onClick={first} disabled={busy || made} data-testid="wizard-first-backup">{busy ? <Spinner /> : <HardDriveDownload />}{made ? t('wizard.bakMade') : t('wizard.bakFirst')}</Button>
      </div>
      <Nav onBack={onBack} onNext={onNext} next={t('wizard.finish')} testid="wizard-finish" />
    </Panel>
  );
}
