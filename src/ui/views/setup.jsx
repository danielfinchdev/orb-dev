// First run: the assistant's name, what to call the user and where its folder goes (C:\Orb unless the user picks another
// place). Everything lives in that folder.
// 3.7: the 3.5.1 welcome again (the owner's wish). Done without asking: this PC's language and time zone in the settings,
// backups on (the default). 3.8: then, when the folder has folders of an earlier Orb, what to do with them
// (views/layout.jsx: nothing moves without the user's choice), and the master password (views/master.jsx).
// config.setupPending is on from the folder's creation to the last step: a welcome closed halfway goes on where it
// stopped (resume: { step, plan, name }, lib/startup.js), never with the words of an Orb updated from 3.7.
// 3.8.2: maximised, and .onboard / .onboard-card (app.css) shrink the spacing with the window's height.
import { useEffect, useState } from 'react';
import { FolderOpen, ArrowRight, LogIn } from 'lucide-react';
import { Robot } from '@/components/robot.jsx';
import { Installer, InstallProgress, useFunPhrase } from '@/components/installer.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input, Field, Spinner } from '@/components/ui/basic.jsx';
import { bridge, call, getState } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';
import { toast } from 'sonner';
import { errorText } from '@/lib/utils.js';
import { PRODUCT } from '../../shared/product.mjs';
import { MasterCreate } from './master.jsx';
import { LayoutReview } from './layout.jsx';

const hereTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
const hereLanguage = () => (/^en/i.test(navigator.language ?? '') ? 'en' : 'es');

export function Setup({ onDone, resume = null }) {
  const t = useT();
  const [name, setName] = useState(resume?.name || PRODUCT.assistant);
  const [user, setUser] = useState('');
  // 3.8: C:\Orb already chosen (app:info › defaultBase); «Cambiar ubicación…» picks another place.
  const [base, setBase] = useState(() => getState().info?.defaultBase ?? null);
  const [busy, setBusy] = useState(false);
  const [mood, setMood] = useState('happy');
  const [step, setStep] = useState(resume?.step ?? 'datos'); // datos → carpetas (folders of an earlier Orb, if any) → maestra (the master password) → equipo (Windows: install what is missing) → app
  const [plan, setPlan] = useState(resume?.plan ?? null);
  // 3.8.2: the welcome opens maximised (its screens fit without scrolling; only the agents' install may scroll).
  useEffect(() => { bridge.windowControls?.act('maximize-on').catch(() => {}); }, []);
  const shown = name.trim() || PRODUCT.assistant;
  const sep = base?.includes('\\') ? '\\' : '/';
  // The same rule the app uses (homeFor): always <base>/Orb, whatever the assistant is called, unless the base already is it.
  const target = base ? (/^orb$/i.test(base.split(/[\\/]/).filter(Boolean).pop() ?? '') ? base : `${base}${base.endsWith(sep) ? '' : sep}${PRODUCT.folder}`) : null;
  const create = async (e) => {
    e.preventDefault();
    setBusy(true); setMood('thinking');
    try {
      const language = hereLanguage();
      await bridge.setup({ base, assistantName: shown, userName: user.trim(), language });
      // The engine runs in the new folder now: it gets this PC's language and time zone.
      await call('config.save', { patch: { language, tz: hereTz(), setupPending: true } }).catch(() => {});
      setMood('happy');
      const lp = await call('app.layoutPlan').catch(() => null);
      setBusy(false);
      if (lp?.pending) { setPlan(lp); setStep('carpetas'); } else setStep('maestra');
    }
    catch (error) { setMood('worried'); toast.error(errorText(error)); setBusy(false); }
  };
  // The welcome is over: the next start opens Orb.
  const finish = async (route) => { await call('config.save', { patch: { setupPending: false } }).catch(() => {}); onDone(route); };
  const afterMaster = async () => { const info = await bridge.info(); if (info.platform === 'win32') setStep('equipo'); else await finish(); };
  // A welcome that goes on may already have its master password (it stopped at «Ordenar carpetas» after making it).
  const afterFolders = async () => { const ms = await call('master.state').catch(() => null); if (ms?.exists) await afterMaster(); else setStep('maestra'); };
  if (step === 'carpetas') return <LayoutReview plan={plan} onDone={afterFolders} />;
  if (step === 'maestra') return <MasterCreate onDone={afterMaster} />;
  if (step === 'equipo') return <Prepare name={shown} onDone={() => finish()} onAgents={() => finish({ view: 'agents' })} />;
  return (
    <div className="brand-sky onboard">
      <form onSubmit={create} data-testid="setup-datos" className="bg-card/95 text-card-foreground onboard-card m-auto grid w-full max-w-[460px] rounded-3xl border border-white/40 shadow-2xl backdrop-blur">
        <div className="-mt-20 flex justify-center"><Robot size={128} mood={mood} title={shown} /></div>
        <div className="text-center">
          <h1 className="text-2xl">{t('setup.hello', { name: shown })}</h1>
          <p className="mt-1 text-sm font-medium" data-testid="setup-tagline">{t('setup.tagline')}</p>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{t('setup.intro')}</p>
        </div>
        <Field label={t('setup.nameLabel')}><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus data-testid="setup-assistant" /></Field>
        <Field label={t('setup.userLabel')}><Input value={user} onChange={(e) => setUser(e.target.value)} placeholder={t('setup.userPlaceholder')} maxLength={40} data-testid="setup-user" /></Field>
        <div className="grid gap-2">
          <span className="text-[13px] font-medium">{t('setup.whereFolder')}</span>
          <Button type="button" variant="outline" className="justify-start" data-testid="setup-folder" onClick={async () => { const f = await bridge.pickFolder(t('setup.whereFolder')); if (f) setBase(f); }}><FolderOpen />{base ? t('setup.changeLocation') : t('setup.pickLocation')}</Button>
          <div className="bg-muted rounded-lg px-3 py-2 font-mono text-xs break-all" data-testid="setup-target">{target ?? t('setup.example', { name: PRODUCT.folder })}</div>
          <p className="text-muted-foreground text-xs leading-relaxed">{t('setup.folderNote')}</p>
        </div>
        <Button type="submit" size="lg" disabled={!base || busy} data-testid="setup-create">{busy ? <Spinner className="border-white/40 border-t-white" /> : null}{t('setup.create')}<ArrowRight /></Button>
      </form>
    </div>
  );
}

// Windows, after the folder: install what is missing. While it installs, the title is a light phrase that changes every
// few seconds, the bar goes under it and the explanation under the bar.
export function Prepare({ name, onDone, onAgents = null }) {
  const t = useT();
  const [progress, setProgress] = useState(null);
  const running = Boolean(progress?.running);
  const { n, phrase } = useFunPhrase(running);
  const finished = progress?.finished && !progress.interrupted;
  const title = running ? `${phrase}…` : finished ? t('install.ready') : progress?.interrupted ? t('install.interrupted') : t('setup.prepareTitle');
  return (
    <div className="brand-sky onboard">
      <div className="bg-card/95 text-card-foreground onboard-card m-auto grid w-full max-w-[520px] rounded-3xl border border-white/40 shadow-2xl backdrop-blur" data-testid="setup-prepare">
        <div className="-mt-20 flex justify-center"><Robot size={120} mood={running ? 'thinking' : finished ? 'happy' : 'hello'} title={name} live /></div>
        <div className="grid gap-3 text-center">
          <h1 key={running ? n : title} className="animate-in fade-in slide-in-from-bottom-1 text-2xl duration-500" aria-live="polite" data-testid="prepare-title">{title}</h1>
          {progress?.steps.length ? <InstallProgress progress={progress} fun={false} /> : null}
          <p className="text-muted-foreground text-sm">{t('setup.prepareDesc')}</p>
        </div>
        <Installer bar={false} onProgress={setProgress} />
        <div className="grid gap-2">
          <Button size="lg" onClick={onDone} data-testid="setup-continue">{t('setup.continue')}<ArrowRight /></Button>
          {/* 3.8 (F5b): where to sign in to the agents, one click away. */}
          {onAgents ? <Button variant="ghost" onClick={onAgents} data-testid="setup-agents"><LogIn />{t('setup.signIn')}</Button> : null}
        </div>
      </div>
    </div>
  );
}
