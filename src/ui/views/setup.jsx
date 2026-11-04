// First run: three screens, one question each. 1) «¿Cómo te llamas?» (the folder goes in Documents; language and time
// zone are this PC's: both change later in Ajustes), 2) «¿Lo usará alguien más?» and 3) «¿Para qué lo quieres?» (a
// template, applied as it is: its bots change later in Bots). Then straight into the app. Backups are on from the start;
// the recovery code is suggested later in the app; reaching Orb from outside is explained when linking a phone.
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowLeft, Plus, FolderOpen, Code, Briefcase, House, Compass } from 'lucide-react';
import { Robot } from '@/components/robot.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input, Spinner } from '@/components/ui/basic.jsx';
import { bridge, call, refresh } from '@/lib/store.js';
import { WIZARD_STEPS, WIZARD_USES } from '@/lib/persons.js';
import { cn, errorText } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { toast } from 'sonner';
import { PRODUCT } from '../../core/product.mjs';

const hereTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
const hereLanguage = () => (/^en/i.test(navigator.language ?? '') ? 'en' : 'es');
const ICONS = { dev: Code, business: Briefcase, home: House, later: Compass };

export function Setup({ onDone }) {
  const [step, setStep] = useState(WIZARD_STEPS[0]);
  const [made, setMade] = useState(false); // the Orb folder exists (going back to the first screen only renames)
  const go = (to) => setStep(to);
  if (step === 'quien') return <WhoStep onNext={() => go('para')} onBack={() => go('nombre')} />;
  if (step === 'para') return <UseStep onDone={onDone} onBack={() => go('quien')} />;
  return <NameStep made={made} onNext={() => { setMade(true); go('quien'); }} />;
}

// The frame of every screen: the robot, the progress dots, one question and its answer.
function Panel({ step, title, children, mood = 'happy' }) {
  const t = useT();
  const i = WIZARD_STEPS.indexOf(step);
  return (
    <div className="brand-sky flex h-full overflow-auto px-6 pt-24 pb-6">
      <div className="bg-card/95 text-card-foreground animate-in fade-in-0 zoom-in-95 m-auto grid w-full max-w-[480px] gap-6 rounded-3xl border border-white/40 p-8 shadow-2xl backdrop-blur duration-300" data-testid={`wizard-${step}`}>
        <div className="-mt-20 flex justify-center"><Robot size={120} mood={mood} /></div>
        <div className="flex items-center justify-center gap-1.5" data-testid="wizard-steps" role="img" aria-label={t('wizard.stepOf', { n: i + 1, total: WIZARD_STEPS.length })}>
          {WIZARD_STEPS.map((s, n) => <span key={s} className={cn('h-1.5 rounded-full transition-[width,background-color] duration-200', n <= i ? 'bg-primary w-6' : 'bg-muted w-3')} />)}
        </div>
        <h1 className="text-center text-[26px] leading-tight">{title}</h1>
        {children}
      </div>
    </div>
  );
}
const Back = ({ onBack }) => { const t = useT(); return <Button type="button" variant="ghost" onClick={onBack} data-testid="wizard-back"><ArrowLeft />{t('wizard.back')}</Button>; };

// 1. The name. The folder is <Documents>/Orb; only if that cannot be used is a folder asked for.
function NameStep({ made, onNext }) {
  const t = useT();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [base, setBase] = useState(null);
  const [needFolder, setNeedFolder] = useState(false);
  useEffect(() => { if (!made) bridge.info().then((i) => setBase(i?.defaultBase ?? null)).catch(() => {}); }, [made]);
  const next = async (e) => {
    e.preventDefault();
    const user = name.trim(); if (!user) return;
    setBusy(true);
    try {
      if (made) await call('config.save', { patch: { userName: user } });
      else {
        const folder = base ?? await bridge.pickFolder(t('setup.whereFolder'));
        if (!folder) { setNeedFolder(true); return; }
        await bridge.setup({ base: folder, assistantName: PRODUCT.assistant, userName: user });
        // The engine runs in the new folder now: this PC's language and time zone for the admin.
        const language = hereLanguage();
        await call('config.save', { patch: { language } }).catch(() => {});
        await call('persons.update', { language, tz: hereTz() }).catch(() => {});
        await refresh().catch(() => {});
      }
      onNext();
    } catch (error) { toast.error(errorText(error)); setNeedFolder(true); setBase(null); }
    finally { setBusy(false); }
  };
  const pick = async () => { const f = await bridge.pickFolder(t('setup.whereFolder')); if (f) { setBase(f); setNeedFolder(false); } };
  return (
    <Panel step="nombre" title={t('wizard.nameTitle')} mood="hello">
      <form onSubmit={next} className="grid gap-4">
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={t('wizard.namePh')} aria-label={t('wizard.namePh')} autoComplete="given-name" enterKeyHint="next" className="h-12 text-center text-lg" data-testid="setup-name" />
        {needFolder ? <Button type="button" variant="outline" onClick={pick} data-testid="setup-folder"><FolderOpen />{base ?? t('setup.pickLocation')}</Button> : null}
        <Button type="submit" size="lg" disabled={!name.trim() || busy || (needFolder && !base)} data-testid="setup-create">{busy ? <Spinner className="border-white/40 border-t-white" /> : null}{t('wizard.next')}<ArrowRight /></Button>
      </form>
    </Panel>
  );
}

// 2. Anyone else? «Solo yo» goes on; «Sí» asks their names.
function WhoStep({ onNext, onBack }) {
  const t = useT();
  const [many, setMany] = useState(false);
  const [names, setNames] = useState(['']);
  const [busy, setBusy] = useState(false);
  const created = useRef(new Set()); // going back and on again does not add them twice
  const last = useRef(null);
  const go = async () => {
    setBusy(true);
    try {
      for (const n of names.map((x) => x.trim()).filter(Boolean)) {
        if (created.current.has(n.toLowerCase())) continue;
        await call('persons.create', { name: n, tz: hereTz(), language: hereLanguage() });
        created.current.add(n.toLowerCase());
      }
      await refresh().catch(() => {});
      onNext();
    } catch (error) { toast.error(errorText(error)); }
    finally { setBusy(false); }
  };
  const add = () => { setNames([...names, '']); setTimeout(() => last.current?.focus(), 0); };
  const choice = (on, label, testid) => (
    <button type="button" onClick={() => (on ? setMany(true) : onNext())} aria-pressed={many === on && on} data-testid={testid}
      className={cn('press grid h-20 cursor-pointer place-items-center rounded-2xl border text-lg font-medium transition-colors', on && many ? 'border-primary bg-primary/5' : 'hover:bg-accent/50')}>{label}</button>
  );
  return (
    <Panel step="quien" title={t('wizard.whoTitle')}>
      <div className="grid grid-cols-2 gap-3">{choice(false, t('wizard.onlyMe'), 'wizard-only-me')}{choice(true, t('wizard.yes'), 'wizard-more-people')}</div>
      {many ? (
        <form className="animate-in fade-in-0 grid gap-2 duration-200" onSubmit={(e) => { e.preventDefault(); go(); }}>
          {names.map((n, i) => <Input key={i} ref={i === names.length - 1 ? last : undefined} autoFocus={i === 0} value={n} maxLength={40} onChange={(e) => setNames(names.map((x, j) => (j === i ? e.target.value : x)))} placeholder={t('wizard.personPh')} aria-label={t('wizard.personPh')} data-testid={`wizard-person-${i}`} />)}
          <Button type="button" size="sm" variant="ghost" className="w-fit" onClick={add} data-testid="wizard-add-person"><Plus />{t('wizard.addPerson')}</Button>
          <div className="flex items-center justify-between gap-2 pt-1">
            <Back onBack={onBack} />
            <Button type="submit" size="lg" disabled={busy || !names.some((x) => x.trim())} data-testid="wizard-next">{busy ? <Spinner className="border-white/40 border-t-white" /> : null}{t('wizard.next')}<ArrowRight /></Button>
          </div>
        </form>
      ) : <div><Back onBack={onBack} /></div>}
    </Panel>
  );
}

// 3. What for: one tile, one template, applied as it is; «Más tarde» makes nothing. Then the app.
function UseStep({ onDone, onBack }) {
  const t = useT();
  const [busy, setBusy] = useState(null);
  const pick = async (use) => {
    setBusy(use.id);
    try { if (use.template) await call('templates.apply', { id: use.template, tz: hereTz() }); onDone(); }
    catch (error) { toast.error(errorText(error)); setBusy(null); }
  };
  return (
    <Panel step="para" title={t('wizard.useTitle')}>
      <div className="grid grid-cols-2 gap-3">
        {WIZARD_USES.map((u) => {
          const Icon = ICONS[u.id];
          return (
            <button key={u.id} type="button" onClick={() => pick(u)} disabled={Boolean(busy)} data-testid={`wizard-use-${u.id}`}
              className="press hover:bg-accent/50 grid h-28 cursor-pointer place-items-center content-center gap-2 rounded-2xl border text-[17px] font-medium transition-colors disabled:cursor-default disabled:opacity-60">
              {busy === u.id ? <Spinner className="size-7" /> : <Icon className="text-primary size-7" strokeWidth={1.75} />}{t(`wizard.use.${u.id}`)}
            </button>
          );
        })}
      </div>
      <div><Back onBack={onBack} /></div>
    </Panel>
  );
}
