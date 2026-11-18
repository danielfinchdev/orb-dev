// First run: the assistant's name, what to call the user and where its folder goes (C:\Orb unless the user picks another
// place). Everything lives in that folder.
// The same welcome for everyone, including an updated Orb (the owner's wish). Done without asking: this PC's language and time zone in the settings,
// backups on (the default). Then the theme (the same cards and the same ui.skin of Ajustes › Apariencia), when the folder has
// folders of an earlier Orb what to do with them (views/layout.jsx: nothing moves without the user's choice), and the master
// password (views/master.jsx).
// config.setupPending is on from the folder's creation to the last step: a welcome closed halfway goes on where it
// stopped (resume: { step, plan, name }, lib/startup.js), never with the words of an Orb updated from 3.7.
// maximised, and the steps' column scrolls only for what does not fit (components/wizard.jsx).
// Until the user picks a theme the welcome wears the default one: nothing applies the saved appearance before the app opens.
import { useEffect, useState } from 'react';
import { Bot, Candy, CircleCheck, Download, Folder, Gem, LayoutDashboard, LoaderCircle, RefreshCw, Sparkles, Terminal, TriangleAlert, Waves } from 'lucide-react';
import { InstallRows, InstallCard, useInstaller, useFunPhrase } from '@/components/installer.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input, Field, Spinner } from '@/components/ui/basic.jsx';
import { WizardPage, WizardCard, WizardFoot, WizardText, WizardTitle, StartMark } from '@/components/wizard.jsx';
import { bridge, call, getState, setState, useStore, applyTheme, applyAppearance } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';
import { notifyError } from '@/lib/notify.js';
import { cn } from '@/lib/utils.js';
import { PRODUCT } from '../../shared/product.mjs';
import { SKINS, PALETTES, APPEARANCE_DEFAULTS, plainSkin } from '../../shared/appearance.mjs';
import { MasterCreate } from './master.jsx';
import { LayoutReview } from './layout.jsx';
import { quiet } from '@/lib/quiet.js';

const hereTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
const hereLanguage = () => (/^en/i.test(navigator.language ?? '') ? 'en' : 'es');

// The icon of each theme's card and the sample of each palette, as in Ajustes › Apariencia.
const SKIN_ICON = { predeterminado: LayoutDashboard, cristal: Gem, orb: Bot, vaporwave: Waves, candy: Candy, retro: Terminal };
const PALETTE_SWATCH = { grafito: 'oklch(0.6 0.18 40)', oceano: 'oklch(0.6 0.17 252)', bosque: 'oklch(0.6 0.13 155)', uva: 'oklch(0.6 0.18 300)', rubi: 'oklch(0.6 0.19 15)', arena: 'oklch(0.62 0.12 65)' };

export function Setup({ onDone, resume = null }) {
  const t = useT();
  const [name, setName] = useState(resume?.name || PRODUCT.assistant);
  const [user, setUser] = useState('');
  // C:\Orb already chosen (app:info › defaultBase); «Cambiar ubicación…» picks another place.
  const [base, setBase] = useState(() => getState().info?.defaultBase ?? null);
  const [busy, setBusy] = useState(false);
  const [mood, setMood] = useState('happy');
  const [step, setStep] = useState(resume?.step ?? 'datos'); // datos → tema → carpetas (folders of an earlier Orb, if any) → maestra (the master password) → equipo (Windows: install what is missing) → app
  const [plan, setPlan] = useState(resume?.plan ?? null);
  const [foldersDone, setFoldersDone] = useState(false);
  // the welcome opens maximised (its screens fit without scrolling; only the agents' install may scroll).
  useEffect(() => { bridge.windowControls?.act('maximize-on').catch(quiet); }, []);
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
      await call('config.save', { patch: { language, tz: hereTz(), setupPending: true } }).catch((e) => notifyError(e));
      setMood('happy');
      const lp = await call('app.layoutPlan').catch(() => null);
      setBusy(false);
      setPlan(lp?.pending ? lp : null);
      setStep('tema');
    }
    catch (error) { setMood('worried'); notifyError(error); setBusy(false); }
  };
  // The welcome is over: the next start opens Orb.
  const finish = async (route) => { await call('config.save', { patch: { setupPending: false } }).catch((e) => notifyError(e)); onDone(route); };
  const afterMaster = async () => { const info = await bridge.info(); if (info.platform === 'win32') setStep('equipo'); else await finish(); };
  // A welcome that goes on may already have its master password (it stopped at «Ordenar carpetas» after making it).
  // «Ordenar carpetas» is over (applied or kept as it was): going back from the password never shows it again.
  const afterFolders = async () => { setFoldersDone(true); const ms = await call('master.state').catch(() => null); if (ms?.exists) await afterMaster(); else setStep('maestra'); };
  if (step === 'tema') return <ThemeStep onDone={() => setStep(plan?.pending && !foldersDone ? 'carpetas' : 'maestra')} />;
  if (step === 'carpetas') return <LayoutReview plan={plan} step="carpetas" onDone={afterFolders} />;
  if (step === 'maestra') return <MasterCreate wizard onDone={afterMaster} onBack={() => setStep('tema')} />;
  if (step === 'equipo') return <Prepare name={shown} onDone={() => finish()} onAgents={() => finish({ view: 'agents' })} />;
  return (
    <WizardPage step="datos">
      <WizardCard as="form" onSubmit={create} data-testid="setup-datos" kick={t('setup.kick', { n: 1 })}>
        <div className="flex items-center gap-4">
          <StartMark icon={Sparkles} mood={mood} title={shown} />
          <div>
            <WizardTitle>{t('setup.hello', { name: shown })}</WizardTitle>
            <p className="text-muted-foreground m-0 mt-0.5 text-control leading-[1.45]" data-testid="setup-tagline">{t('setup.tagline')}</p>
          </div>
        </div>
        <WizardText>{t('setup.intro')}</WizardText>
        <Field label={t('setup.nameLabel')}><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus data-testid="setup-assistant" /></Field>
        <Field label={t('setup.userLabel')}><Input value={user} onChange={(e) => setUser(e.target.value)} placeholder={t('setup.userPlaceholder')} maxLength={40} data-testid="setup-user" /></Field>
        <div className="grid gap-1.5">
          <span className="text-control font-medium">{t('setup.whereFolder')}</span>
          <div className="bg-card border-border rounded-ctl flex items-center gap-2 border px-3 py-2.5 text-control">
            <Folder className="size-4 flex-none" aria-hidden="true" />
            <code className="min-w-0 flex-1 font-mono break-all" data-testid="setup-target">{target ?? t('setup.example', { name: PRODUCT.folder })}</code>
            <Button type="button" variant="outline" data-testid="setup-folder" onClick={async () => { const f = await bridge.pickFolder(t('setup.whereFolder')); if (f) setBase(f); }}>{base ? t('setup.changeLocation') : t('setup.pickLocation')}</Button>
          </div>
          <WizardText>{t('setup.folderNote')}</WizardText>
        </div>
        <WizardFoot><Button type="submit" disabled={!base || busy} data-testid="setup-create">{busy ? <Spinner className="border-primary-foreground/40 border-t-primary-foreground" /> : null}{t('setup.create')}</Button></WizardFoot>
      </WizardCard>
    </WizardPage>
  );
}

// «Tu tema»: the six themes (and the palette of the plain ones), the same choice and the same setting as Ajustes › Apariencia
// (ui.skin, ui.palette); it is saved and applied as soon as it is picked.
function ThemeStep({ onDone }) {
  const t = useT();
  const ui = { ...APPEARANCE_DEFAULTS, ...useStore((s) => s.app?.config?.ui) };
  const choose = async (patch) => {
    const config = await call('config.save', { patch: { ui: patch } }).catch((e) => { notifyError(e); return null; });
    if (!config) return;
    setState({ app: { ...getState().app, config } });
    applyTheme(config.ui?.theme); applyAppearance(config.ui);
  };
  return (
    <WizardPage step="tema" data-testid="setup-theme">
      <WizardCard kick={t('setup.kick', { n: 2 })}>
        <WizardTitle>{t('setup.themeTitle')}</WizardTitle>
        <WizardText>{t('setup.themeDesc')}</WizardText>
        <div className="grid grid-cols-3 gap-2 max-[900px]:grid-cols-2" role="radiogroup" aria-label={t('setup.themeLabel')} data-testid="setup-skins">
          {SKINS.map((skin) => {
            const Icon = SKIN_ICON[skin];
            return (
              <button key={skin} type="button" role="radio" aria-checked={ui.skin === skin} onClick={() => choose({ skin })} data-testid={`setup-skin-${skin}`}
                className={cn('focus-visible:outline-ring rounded-card flex min-h-[82px] min-w-0 cursor-pointer flex-col items-start gap-1 border p-2.5 text-left outline-none focus-visible:outline-2', ui.skin === skin ? 'border-primary-text bg-card shadow-[0_0_0_1px_var(--primary-text)]' : 'border-border bg-card hover:bg-accent')}>
                <Icon className="size-4" aria-hidden="true" />
                <span className="text-control font-medium">{t(`appearance.skin.${skin}`)}</span>
                <span className="text-muted-foreground text-caption">{t(`appearance.skinDesc.${skin}`)}</span>
              </button>
            );
          })}
        </div>
        {plainSkin(ui.skin) ? (
          <div className="grid gap-1.5" data-testid="setup-palettes">
            <span className="text-control font-medium">{t('appearance.palette')}</span>
            <div className="flex gap-1.5" role="radiogroup" aria-label={t('appearance.palette')}>
              {PALETTES.map((id) => (
                <button key={id} type="button" role="radio" aria-checked={ui.palette === id} aria-label={t(`appearance.palette.${id}`)} title={t(`appearance.palette.${id}`)} onClick={() => choose({ palette: id })} data-testid={`setup-palette-${id}`}
                  className={cn('focus-visible:outline-ring grid size-8 cursor-pointer place-items-center rounded-full border outline-none focus-visible:outline-2', ui.palette === id ? 'border-foreground border-2' : 'border-border')}>
                  <i className="pal-dot block size-5 rounded-full" data-palette={id} style={{ width: 20, height: 20, background: PALETTE_SWATCH[id] }} aria-hidden="true" />
                </button>
              ))}
            </div>
            <WizardText>{t('appearance.paletteHint')}</WizardText>
          </div>
        ) : null}
        <WizardFoot><Button onClick={onDone} autoFocus data-testid="setup-theme-continue">{t('setup.continue')}</Button></WizardFoot>
      </WizardCard>
    </WizardPage>
  );
}

// Windows, after the folder: install what is missing. While it installs, the title is a light phrase that changes every
// few seconds; the progress card, the tools and the optional ones go as the mock-up draws them.
export function Prepare({ name, onDone, onAgents = null }) {
  const t = useT();
  const inst = useInstaller();
  const { progress } = inst;
  const running = Boolean(progress?.running);
  const { n, phrase } = useFunPhrase(running);
  const finished = progress?.finished && !progress.interrupted;
  const installing = running && !progress?.finished && !progress?.interrupted;
  const failed = Boolean(progress?.steps.some((x) => x.state === 'error'));
  const title = running ? `${phrase}…` : finished ? t('install.ready') : progress?.interrupted ? t('install.interrupted') : t('setup.prepareTitle');
  const icon = finished ? CircleCheck : progress?.interrupted ? TriangleAlert : LoaderCircle;
  const desc = finished && !failed ? 'install.readyDesc' : progress?.interrupted ? 'install.stoppedDesc' : 'setup.prepareDesc';
  return (
    <WizardPage step="equipo" data-testid="setup-prepare">
      <WizardCard kick={t('setup.kick', { n: 5 })}>
        <div className="flex items-center gap-4">
          <StartMark icon={icon} mood={running ? 'thinking' : finished ? 'happy' : progress?.interrupted ? 'worried' : 'hello'} title={name} />
          <WizardTitle key={running ? n : title} className="animate-in fade-in slide-in-from-bottom-1 duration-500" aria-live="polite" data-testid="prepare-title">{title}</WizardTitle>
        </div>
        <WizardText>{t(desc)}</WizardText>
        {progress?.steps.length && (running || (finished && failed)) ? <InstallCard progress={progress} /> : null}
        {inst.items
          ? <InstallRows items={inst.items} chosen={inst.chosen} setChosen={inst.setChosen} progress={progress} />
          : <div className="text-muted-foreground flex items-center gap-2 text-control"><Spinner />{t('comp.installer.checking')}</div>}
        <WizardFoot>
          {/* where to sign in to the agents, one click away. */}
          {onAgents ? <Button variant="outline" onClick={onAgents} data-testid="setup-agents">{t('setup.signIn')}</Button> : null}
          <Button variant="outline" onClick={inst.load} disabled={running}><RefreshCw />{t('comp.installer.check')}</Button>
          {inst.missing.length ? <Button variant="outline" disabled={!inst.ids.length || running} onClick={inst.start} data-testid="setup-install"><Download />{running ? t('comp.installer.installingBtn') : t('comp.installer.installMarked', { n: inst.ids.length })}</Button> : null}
          {/* off only while something is really installing: finished (well or not), interrupted or idle leave it on */}
          <Button onClick={onDone} disabled={installing} data-testid="setup-continue">{t('setup.continue')}</Button>
        </WizardFoot>
      </WizardCard>
    </WizardPage>
  );
}
