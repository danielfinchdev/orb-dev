// First run: the assistant's name, what to call the user and where its folder goes. Everything lives in that folder.
// 3.7: the 3.5.1 welcome again (the owner's wish). Done without asking: this PC's language and time zone in the settings,
// backups on (the default).
import { useState } from 'react';
import { FolderOpen, ArrowRight } from 'lucide-react';
import { Robot } from '@/components/robot.jsx';
import { Installer, InstallProgress, useFunPhrase } from '@/components/installer.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input, Field, Spinner } from '@/components/ui/basic.jsx';
import { bridge, call } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';
import { toast } from 'sonner';
import { errorText } from '@/lib/utils.js';
import { PRODUCT } from '../../core/product.mjs';

const hereTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
const hereLanguage = () => (/^en/i.test(navigator.language ?? '') ? 'en' : 'es');

export function Setup({ onDone }) {
  const t = useT();
  const [name, setName] = useState(PRODUCT.assistant);
  const [user, setUser] = useState('');
  const [base, setBase] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mood, setMood] = useState('happy');
  const [step, setStep] = useState('datos'); // datos → equipo (Windows: install what is missing) → app
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
      await call('config.save', { patch: { language, tz: hereTz() } }).catch(() => {});
      setMood('happy');
      const info = await bridge.info();
      if (info.platform === 'win32') { setBusy(false); setStep('equipo'); } else setTimeout(onDone, 700);
    }
    catch (error) { setMood('worried'); toast.error(errorText(error)); setBusy(false); }
  };
  if (step === 'equipo') return <Prepare name={shown} onDone={onDone} />;
  return (
    <div className="brand-sky flex h-full overflow-auto px-6 pt-24 pb-6">
      <form onSubmit={create} data-testid="setup-datos" className="bg-card/95 text-card-foreground m-auto grid w-full max-w-[460px] gap-5 rounded-3xl border border-white/40 p-8 shadow-2xl backdrop-blur">
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
export function Prepare({ name, onDone }) {
  const t = useT();
  const [progress, setProgress] = useState(null);
  const running = Boolean(progress?.running);
  const { n, phrase } = useFunPhrase(running);
  const finished = progress?.finished && !progress.interrupted;
  const title = running ? `${phrase}…` : finished ? t('install.ready') : progress?.interrupted ? t('install.interrupted') : t('setup.prepareTitle');
  return (
    <div className="brand-sky flex h-full overflow-auto px-6 pt-24 pb-6">
      <div className="bg-card/95 text-card-foreground m-auto grid w-full max-w-[520px] gap-5 rounded-3xl border border-white/40 p-8 shadow-2xl backdrop-blur" data-testid="setup-prepare">
        <div className="-mt-20 flex justify-center"><Robot size={120} mood={running ? 'thinking' : finished ? 'happy' : 'hello'} title={name} live /></div>
        <div className="grid gap-3 text-center">
          <h1 key={running ? n : title} className="animate-in fade-in slide-in-from-bottom-1 text-2xl duration-500" aria-live="polite" data-testid="prepare-title">{title}</h1>
          {progress?.steps.length ? <InstallProgress progress={progress} fun={false} /> : null}
          <p className="text-muted-foreground text-sm">{t('setup.prepareDesc')}</p>
        </div>
        <Installer bar={false} onProgress={setProgress} />
        <Button size="lg" onClick={onDone} data-testid="setup-continue">{t('setup.continue')}<ArrowRight /></Button>
      </div>
    </div>
  );
}
