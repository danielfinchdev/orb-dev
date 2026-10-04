// First run: the assistant's name, what to call the user and where its folder goes. Everything lives in that folder.
import { useState } from 'react';
import { FolderOpen, ArrowRight } from 'lucide-react';
import { Robot } from '@/components/robot.jsx';
import { Installer } from '@/components/installer.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input, Field, Spinner } from '@/components/ui/basic.jsx';
import { bridge } from '@/lib/store.js';
import { toast } from 'sonner';
import { errorText } from '@/lib/utils.js';
import { PRODUCT } from '../../core/product.mjs';

export function Setup({ onDone }) {
  const [name, setName] = useState(PRODUCT.assistant);
  const [user, setUser] = useState('');
  const [base, setBase] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mood, setMood] = useState('happy');
  const [step, setStep] = useState('datos'); // datos → equipo (Windows: install what is missing) → app
  const shown = name.trim() || PRODUCT.assistant;
  const sep = base?.includes('\\') ? '\\' : '/';
  const target = base ? `${base}${base.endsWith(sep) ? '' : sep}${shown.replace(/[<>:"/\\|?*]/g, '')}` : null;
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
    <div className="brand-sky grid h-full place-items-center overflow-auto p-6">
      <div className="bg-card/95 text-card-foreground grid w-full max-w-[520px] gap-5 rounded-3xl border border-white/40 p-8 shadow-2xl backdrop-blur">
        <div className="-mt-20 flex justify-center"><Robot size={120} mood="happy" title={shown} /></div>
        <div className="text-center"><h1 className="text-2xl">Preparo tu equipo</h1><p className="text-muted-foreground mt-2 text-sm">Instalo los agentes y herramientas que faltan con sus instaladores oficiales. Luego inicias sesión en cada uno con tu cuenta.</p></div>
        <Installer />
        <Button size="lg" onClick={onDone}>Continuar<ArrowRight /></Button>
      </div>
    </div>
  );
  return (
    <div className="brand-sky grid h-full place-items-center overflow-auto p-6">
      <form onSubmit={create} className="bg-card/95 text-card-foreground grid w-full max-w-[460px] gap-5 rounded-3xl border border-white/40 p-8 shadow-2xl backdrop-blur">
        <div className="-mt-20 flex justify-center"><Robot size={128} mood={mood} title={shown} /></div>
        <div className="text-center">
          <h1 className="text-2xl">Hola, soy {shown}</h1>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">Tu jefe de proyecto. Me cuentas qué quieres, yo reparto el trabajo entre Claude, Codex y Cursor, reviso lo que hacen y te lo cuento. También puedes hablar con cada agente directamente.</p>
        </div>
        <Field label="¿Cómo quieres llamarme?"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus /></Field>
        <Field label="¿Y cómo te llamo a ti?"><Input value={user} onChange={(e) => setUser(e.target.value)} placeholder="Tu nombre (opcional)" maxLength={40} /></Field>
        <div className="grid gap-2">
          <span className="text-[13px] font-medium">¿Dónde creo mi carpeta?</span>
          <Button type="button" variant="outline" className="justify-start" onClick={async () => { const f = await bridge.pickFolder('¿Dónde creo mi carpeta?'); if (f) setBase(f); }}><FolderOpen />{base ? 'Cambiar ubicación…' : 'Elegir ubicación…'}</Button>
          <div className="bg-muted rounded-lg px-3 py-2 font-mono text-xs break-all" data-testid="setup-target">{target ?? `Por ejemplo D:\\ para tener D:\\${PRODUCT.assistant}`}</div>
          <p className="text-muted-foreground text-xs leading-relaxed">Ahí estará todo: cada proyecto en su carpeta, las bitácoras y mis datos. Nada sale de tu equipo. Si eliges una carpeta que ya es mía, la sigo usando.</p>
        </div>
        <Button type="submit" size="lg" disabled={!base || busy}>{busy ? <Spinner className="border-white/40 border-t-white" /> : null}Crear y empezar<ArrowRight /></Button>
      </form>
    </div>
  );
}
