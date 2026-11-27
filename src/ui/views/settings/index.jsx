// Settings, in ten sections: General, Apariencia, Agentes y cuentas, Permisos y seguridad, Dispositivos, Extensiones,
// Atajos de teclado, Datos, Avanzado and Acerca de. Every setting saves as it changes (the header says «Guardado»).
import { useEffect, useState } from 'react';
import { Database, SlidersHorizontal, Settings, Smartphone, Bot, Info, Puzzle, ShieldCheck, Palette, Keyboard } from 'lucide-react';
import { ToolIcon } from '@/components/agent-icon.jsx';
import { PRODUCT, AUTHOR } from '../../../shared/product.mjs';
import { Dialog, DialogContent, DialogTitle, BubbleTip, Tabs, TabsList, TabsTrigger } from '@/components/ui/overlay.jsx';
import { useStore, bridge, openSettings, closeSettings, fullPc } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { t, useT } from '@/lib/i18n.js';
import { MagicLinkPanel, SubSection } from '../magic-link.jsx';
import { DataCards } from '../data.jsx';
import { ExtensionsPanel } from '../extensions.jsx';
import { Block, SavedNotice } from './rows.jsx';
import { ShortcutsCard } from './shortcuts.jsx';
import { MasterCard } from '../master.jsx';
import { AssistantCard, ThemeCard, FontCard, SizeCard, ChatsLookCard, SoundCard, MusicCard, ChatCard, PermissionsCard, ApprovalWaitCard, TasksCard, FolderCard, ProtectedCard, ProjectScriptsCard, TerminalCard, DictationCard, GitCard, ExpertCard } from './general.jsx';
import { AndroidCard, MobileCard, BrowserCard } from './devices.jsx';
import { McpExtCard } from './mcp-ext.jsx';
import { UsageAccounts, BrakesCard, BrakeRails } from './usage-tab.jsx';
// «Este móvil», the phone's screen of its own (main.jsx loads it from here, with the dialog).
export { PhoneView } from './devices.jsx';
import { UpdatesCard, SupportCard, FeedbackCard, MoreAppsCard, AboutCard } from './about.jsx';


// «Agentes y uso»: the mock-up's two tabs. The one chosen is kept for the session only.
let agentsTab = 'tareas';
function AgentsTabs({ c }) {
  const [tab, setTab] = useState(agentsTab);
  const pick = (v) => { agentsTab = v; setTab(v); };
  return (
    <>
      <Tabs value={tab} onValueChange={pick}>
        <TabsList variant="line" aria-label={t('settings.section.agentes')}>
          <TabsTrigger value="tareas" data-testid="agents-tab-tareas">{t('settings.tasks')}</TabsTrigger>
          <TabsTrigger value="uso" data-testid="agents-tab-uso">{t('settings.tabUsage')}</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === 'tareas' ? <TasksCard c={c} /> : <><UsageAccounts c={c} /><ChatCard c={c} /><BrakesCard c={c} /><BrakeRails c={c} /></>}
    </>
  );
}

// Ajustes is a window over the app: ten sections on the left. groups: the parts of a section, each
// with its heading; the active section lists them under its name in the menu, to jump to one.
const SECTIONS = [
  { id: 'general', icon: Settings, groups: ['actualizaciones'],
    cards: (c, app) => <><AssistantCard c={c} /><FolderCard c={c} home={app.home} /><TerminalCard c={c} /><DictationCard c={c} /><GitCard c={c} /><SubSection id="actualizaciones" title={t('settings.group.actualizaciones')}><UpdatesCard /></SubSection></> },
  { id: 'apariencia', icon: Palette, cards: (c) => <><ThemeCard c={c} /><FontCard c={c} /><SizeCard /><ChatsLookCard c={c} /><SoundCard c={c} /><MusicCard /></> },
  { id: 'agentes', icon: Bot, cards: (c) => <AgentsTabs c={c} /> },
  // What the agents may do without asking, how long a question waits, the protected paths and the master password (with Windows Hello).
  { id: 'permisos', icon: ShieldCheck, cards: (c) => <><PermissionsCard c={c} /><ApprovalWaitCard c={c} /><ProtectedCard c={c} /><MasterCard /><ProjectScriptsCard /></> },
  // Who can enter this Orb: the linked phones and browsers.
  { id: 'magiclink', icon: Smartphone, groups: ['dispositivos'],
    cards: () => <MagicLinkPanel grouped phoneAccess={(more) => <MobileCard more={more} />} /> },
  // every skill and MCP server of core (src/ui/views/extensions.jsx); this PC only.
  { id: 'extensiones', icon: Puzzle, pcOnly: true, cards: () => <ExtensionsPanel /> },
  { id: 'atajos', icon: Keyboard, cards: () => <ShortcutsCard /> },
  { id: 'datos', icon: Database, cards: () => <DataCards /> },
  { id: 'avanzado', icon: SlidersHorizontal, groups: () => ['herramientas', ...(fullPc() ? ['experto'] : [])],
    cards: (c) => <><SubSection id="herramientas" title={t('settings.group.herramientas')}><BrowserCard c={c} /></SubSection>
      {fullPc() ? <SubSection id="experto" title={t('settings.group.experto')}><ExpertCard c={c} /></SubSection> : null}
      <AndroidCard />{bridge.mobile ? null : <McpExtCard />}</> },
  { id: 'acerca', icon: Info, groups: ['contribuye', 'apps'],
    cards: (c, app) => <><SubSection id="contribuye" title={t('settings.group.contribuye')}><FeedbackCard /></SubSection><AboutCard version={app.version} /><SupportCard /><SubSection id="apps" title={t('settings.group.apps')}><MoreAppsCard /></SubSection></> }
];
// The names used before the ten-section layout (links in tutorials, notices and the sidebar) → [section, part].
const ALIASES = { conexiones: ['magiclink', 'dispositivos'], movil: ['magiclink', 'dispositivos'], dispositivos: ['magiclink'], uso: ['agentes'], teclado: ['atajos'], atajos: ['atajos'], actualizaciones: ['general', 'actualizaciones'], tareas: ['agentes'],
  herramientas: ['avanzado', 'herramientas'], mcp: ['extensiones'], skills: ['extensiones'], experto: ['avanzado', 'experto'], monitor: ['avanzado', 'herramientas'], contribuye: ['acerca', 'contribuye'], apps: ['acerca', 'apps'] };
function resolveSection(open) {
  if (!open || open === true) return ['general', null];
  const [id, part = null] = String(open).split(':');
  return ALIASES[id] ? [ALIASES[id][0], part ?? ALIASES[id][1] ?? null] : [id, part];
}
const groupsOf = (section) => (typeof section.groups === 'function' ? section.groups() : section.groups ?? []);

export function SettingsDialog() {
  const t = useT();
  const open = useStore((s) => s.settings);
  const app = useStore((s) => s.app);
  const [wanted, part] = resolveSection(open);
  const openedAt = useStore((s) => s.settingsAt);
  // The part asked for (a link to «Copias de seguridad», a notice about updates…): scrolled into view once the section is drawn.
  // Some parts appear only after their data loads: it waits for them for a moment, and the sections above them may
  // still grow, so it follows for a second. Clicking the same part again scrolls again.
  useEffect(() => {
    if (!open || !part) return undefined;
    let frame = 0; const until = performance.now() + 1500;
    const tick = () => {
      document.getElementById(`settings-${part}`)?.scrollIntoView({ block: 'start' });
      if (performance.now() < until) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    // The person scrolls or clicks on their own (a menu opening must not jump away): stop following.
    const stop = () => cancelAnimationFrame(frame);
    window.addEventListener('wheel', stop, { once: true, passive: true });
    window.addEventListener('touchmove', stop, { once: true, passive: true });
    window.addEventListener('keydown', stop, { once: true });
    window.addEventListener('pointerdown', stop, { once: true, capture: true });
    return () => { stop(); window.removeEventListener('wheel', stop); window.removeEventListener('touchmove', stop); window.removeEventListener('keydown', stop); window.removeEventListener('pointerdown', stop, { capture: true }); };
  }, [open, part, openedAt]);
  if (!app) return null;
  const section = SECTIONS.find((s) => s.id === wanted && (!s.pcOnly || !bridge.mobile)) ?? SECTIONS[0];
  const c = app.config;
  return (
    <Dialog open={Boolean(open)} onOpenChange={(o) => { if (!o) { document.activeElement?.blur?.(); closeSettings(); } }}>
      <DialogContent className="flex h-[min(780px,90vh)] w-[min(1080px,94vw)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none" data-testid="settings-dialog" aria-describedby={undefined}>
        <div className="border-border flex h-14 shrink-0 items-center border-b pr-14 pl-[18px]">
          <DialogTitle className="text-title font-semibold">{t('settings.title')}</DialogTitle>
          <SavedNotice />
        </div>
        <div className="flex min-h-0 flex-1">
            <nav className="border-border flex w-[220px] shrink-0 flex-col border-r max-sm:w-16" aria-label={t('settings.title')}>
              <div className="grid min-h-0 flex-1 content-start gap-px overflow-y-auto px-2 py-2.5">
                {SECTIONS.filter((sec) => !sec.pcOnly || !bridge.mobile).map((sec) => {
                  const { id, icon: Icon } = sec;
                  const on = section.id === id;
                  return (
                    <div key={id} className="grid gap-px">
                      <button type="button" onClick={() => openSettings(id)} data-testid={`settings-nav-${id}`} aria-label={t(`settings.section.${id}`)} aria-current={on ? 'page' : undefined}
                        className={cn('focus-visible:outline-ring flex h-(--ctl) cursor-pointer items-center gap-2.5 rounded-ctl px-2.5 text-left text-control outline-none focus-visible:outline-2', on ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-[color-mix(in_oklab,var(--accent)_60%,transparent)]')}>
                        <Icon className="size-4 shrink-0" /><span className="truncate max-sm:hidden">{t(`settings.section.${id}`)}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
              {/* the developer's GitHub, the version and the licence at the foot of the list again (also in «Acerca de»). */}
              <div className="text-faint-foreground mb-2.5 px-[18px] py-2 text-caption leading-normal max-sm:px-1" data-testid="settings-foot">
                <BubbleTip title={`@${AUTHOR.github}`} text={AUTHOR.url.replace('https://', '')} side="top" align="start">
                  <button type="button" onClick={() => bridge.openExternal(AUTHOR.url)} className="hover:text-primary-text cursor-pointer" aria-label={AUTHOR.url.replace('https://', '')} data-testid="settings-foot-github">
                    <ToolIcon tool="gh" className="size-4 sm:hidden" /><span className="max-sm:hidden">@{AUTHOR.github}</span>
                  </button>
                </BubbleTip>
                <span className="max-sm:hidden" data-testid="settings-foot-version"> · {PRODUCT.name} {app.version} · {t('settings.footLicense')}</span>
              </div>
            </nav>
            <div key={section.id} className="min-h-0 min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable] pt-[18px] pr-[calc(1.5rem-var(--sb-w))] pb-8 pl-6">
              {/* min-w-0 on the blocks: a long one-line text inside (a path, a wide control) must not widen the column in a narrow window */}
              <div className="grid gap-4 [&>*]:min-w-0">
                <Block title={t(`settings.section.${section.id}`)} note={t(`settings.sectionDesc.${section.id}`)} />
                {section.cards(c, app)}
              </div>
            </div>
          </div>
      </DialogContent>
    </Dialog>
  );
}
