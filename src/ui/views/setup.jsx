// First run: the assistant's name, what to call the user and where its folder goes. Everything lives in that folder.
import { useState } from 'react';
import { FolderOpen, ArrowRight } from 'lucide-react';
import { Robot } from '@/components/robot.jsx';
import { Installer } from '@/components/installer.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input, Field, Spinner } from '@/components/ui/basic.jsx';
import { bridge } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';
import { toast } from 'sonner';
import { errorText } from '@/lib/utils.js';
import { PRODUCT, folderName } from '../../core/product.mjs';

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
  const target = base ? `${base}${base.endsWith(sep) ? '' : sep}${folderName(shown)}` : null; // the same rule the app uses to create it
  const create = async (e) => {
    e.preventDefault();
    setBusy(true); setMood('thinking');
    try {
      await bridge.setup({ base, assistantName: shown, userName: user.trim() });
      setMood('happy');
      const info = await bridge.info();
      if (info.platform === 'win32') { setBusy(false); setStep('equipo'); } else setTimeout(onDone, 700);
    }
    catch (error) { setMood('worried'); toast.error(errorText(error)); setBusy(false); }
  };
  if (step === 'equipo') return (
    <div className="brand-sky flex h-full overflow-auto px-6 pt-24 pb-6">
      <div className="bg-card/95 text-card-foreground m-auto grid w-full max-w-[520px] gap-5 rounded-3xl border border-white/40 p-8 shadow-2xl backdrop-blur">
        <div className="-mt-20 flex justify-center"><Robot size={120} mood="happy" title={shown} /></div>
        <div className="text-center"><h1 className="text-2xl">{t('setup.prepareTitle')}</h1><p className="text-muted-foreground mt-2 text-sm">{t('setup.prepareDesc')}</p></div>
        <Installer />
        <Button size="lg" onClick={onDone}>{t('setup.continue')}<ArrowRight /></Button>
      </div>
    </div>
  );
  return (
    <div className="brand-sky flex h-full overflow-auto px-6 pt-24 pb-6">
      <form onSubmit={create} className="bg-card/95 text-card-foreground m-auto grid w-full max-w-[460px] gap-5 rounded-3xl border border-white/40 p-8 shadow-2xl backdrop-blur">
        <div className="-mt-20 flex justify-center"><Robot size={128} mood={mood} title={shown} /></div>
        <div className="text-center">
          <h1 className="text-2xl">{t('setup.hello', { name: shown })}</h1>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{t('setup.intro')}</p>
        </div>
        <Field label={t('setup.nameLabel')}><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus /></Field>
        <Field label={t('setup.userLabel')}><Input value={user} onChange={(e) => setUser(e.target.value)} placeholder={t('setup.userPlaceholder')} maxLength={40} /></Field>
        <div className="grid gap-2">
          <span className="text-[13px] font-medium">{t('setup.whereFolder')}</span>
          <Button type="button" variant="outline" className="justify-start" onClick={async () => { const f = await bridge.pickFolder(t('setup.whereFolder')); if (f) setBase(f); }}><FolderOpen />{base ? t('setup.changeLocation') : t('setup.pickLocation')}</Button>
          <div className="bg-muted rounded-lg px-3 py-2 font-mono text-xs break-all" data-testid="setup-target">{target ?? t('setup.example', { name: PRODUCT.assistant })}</div>
          <p className="text-muted-foreground text-xs leading-relaxed">{t('setup.folderNote')}</p>
        </div>
        <Button type="submit" size="lg" disabled={!base || busy}>{busy ? <Spinner className="border-white/40 border-t-white" /> : null}{t('setup.create')}<ArrowRight /></Button>
      </form>
    </div>
  );
}
