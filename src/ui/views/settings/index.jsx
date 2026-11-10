// Settings: the assistant, its brain, how tasks run, usage caps, skills and MCP servers and the assistant's folder.
// 3.6 (DESIGN-SYSTEM §2.3): six sections — General, Magic Link (Dispositivos), Agentes y uso, Datos, Avanzado and
// Acerca de.
import { useEffect } from 'react';
import { DatabaseBackup, Wrench, SlidersHorizontal, Radar, Cpu, Info, Puzzle } from 'lucide-react';
import { ToolIcon } from '@/components/agent-icon.jsx';
import { PRODUCT, AUTHOR } from '../../../shared/product.mjs';
import { Dialog, DialogContent, DialogTitle, BubbleTip } from '@/components/ui/overlay.jsx';
import { useStore, bridge, openSettings, closeSettings, fullPc } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { t, useT } from '@/lib/i18n.js';
import { MagicLinkPanel, SubSection } from '../magic-link.jsx';
import { DataCards } from '../data.jsx';
import { ExtensionsPanel } from '../extensions.jsx';
import { AssistantCard, AppearanceCard, ChatCard, TasksCard, TestCard, FolderCard, ProtectedCard, InterfaceCard, ExpertCard } from './general.jsx';
import { AndroidCard, MobileCard, BrowserCard } from './devices.jsx';
// «Este móvil», the phone's screen of its own (main.jsx loads it from here, with the dialog).
export { PhoneView } from './devices.jsx';
import { UpdatesCard, SupportCard, FeedbackCard, MoreAppsCard, AboutCard } from './about.jsx';


// Ajustes is a window over the app: six sections on the left (DESIGN-SYSTEM §2.3). groups: the parts of a section, each
// with its heading; the active section lists them under its name in the menu, to jump to one.
const SECTIONS = [
  { id: 'general', icon: SlidersHorizontal, groups: ['apariencia', 'actualizaciones'],
    cards: (c, app) => <><AssistantCard c={c} /><FolderCard c={c} home={app.home} /><SubSection id="apariencia" title={t('settings.group.apariencia')}><AppearanceCard c={c} /><InterfaceCard c={c} /></SubSection><SubSection id="actualizaciones" title={t('settings.group.actualizaciones')}><UpdatesCard /></SubSection></> },
  // Who can enter this Orb: the linked phones and browsers.
  { id: 'magiclink', icon: Radar, groups: ['dispositivos'],
    cards: () => <MagicLinkPanel grouped phoneAccess={<MobileCard />} /> },
  { id: 'agentes', icon: Cpu, cards: (c) => <><ChatCard c={c} /><TasksCard c={c} />{bridge.mobile ? null : <TestCard />}</> },
  // 3.8.1: every skill and MCP server of core (src/ui/views/extensions.jsx); this PC only.
  { id: 'extensiones', icon: Puzzle, pcOnly: true, cards: () => <ExtensionsPanel /> },
  { id: 'datos', icon: DatabaseBackup, cards: () => <DataCards /> },
  { id: 'avanzado', icon: Wrench, groups: () => ['herramientas', ...(fullPc() ? ['experto'] : [])],
    cards: (c) => <><SubSection id="herramientas" title={t('settings.group.herramientas')}><BrowserCard c={c} /><ProtectedCard c={c} /><AndroidCard /></SubSection>
      {fullPc() ? <SubSection id="experto" title={t('settings.group.experto')}><ExpertCard c={c} /></SubSection> : null}</> },
  { id: 'acerca', icon: Info, groups: ['contribuye', 'apps'],
    cards: (c, app) => <><AboutCard version={app.version} /><SubSection id="contribuye" title={t('settings.group.contribuye')}><SupportCard /><FeedbackCard /></SubSection><SubSection id="apps" title={t('settings.group.apps')}><MoreAppsCard /></SubSection></> }
];
// The names of before 3.6 (links in tutorials, notices and the sidebar) → [section, part].
const ALIASES = { conexiones: ['magiclink', 'dispositivos'], movil: ['magiclink', 'dispositivos'], apariencia: ['general', 'apariencia'], actualizaciones: ['general', 'actualizaciones'], tareas: ['agentes'],
  herramientas: ['avanzado', 'herramientas'], mcp: ['extensiones'], skills: ['extensiones'], experto: ['avanzado', 'experto'], monitor: ['avanzado', 'herramientas'], contribuye: ['acerca', 'contribuye'], apps: ['acerca', 'apps'] };
export function resolveSection(open) {
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
    <Dialog open={Boolean(open)} onOpenChange={(o) => { if (!o) closeSettings(); }}>
      <DialogContent className="flex h-[min(780px,90vh)] w-[min(1080px,94vw)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none" data-testid="settings-dialog" aria-describedby={undefined}>
        <div className="flex h-16 shrink-0 items-center border-b px-6 pr-14">
          <DialogTitle className="text-lg font-medium">{t('settings.title')}</DialogTitle>
        </div>
        <div className="flex min-h-0 flex-1">
            <nav className="flex w-56 shrink-0 flex-col max-sm:w-16" aria-label={t('settings.title')}>
              <div className="grid min-h-0 flex-1 content-start gap-1 overflow-y-auto px-3 pt-4 pb-4">
                {SECTIONS.filter((sec) => !sec.pcOnly || !bridge.mobile).map((sec) => {
                  const { id, icon: Icon } = sec;
                  const on = section.id === id;
                  const groups = on ? groupsOf(sec) : [];
                  return (
                    <div key={id} className="grid gap-0.5">
                      <button type="button" onClick={() => openSettings(id)} data-testid={`settings-nav-${id}`} aria-label={t(`settings.section.${id}`)} aria-current={on ? 'page' : undefined}
                        className={cn('flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm', on ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground')}>
                        <Icon className="size-[18px] shrink-0" /><span className="truncate max-sm:hidden">{t(`settings.section.${id}`)}</span>
                      </button>
                      {groups.length ? (
                        <div className="grid gap-0.5 pb-1 pl-[42px] max-sm:hidden">
                          {groups.map((g) => (
                            <button key={g} type="button" onClick={() => openSettings(`${id}:${g}`)} data-testid={`settings-sub-${g}`} aria-current={part === g ? 'location' : undefined}
                              className={cn('cursor-pointer truncate rounded-lg px-2 py-1 text-left text-[13px]', part === g ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground')}>{t(`settings.group.${g}`)}</button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {/* 3.8.2: the developer's GitHub, the version and the licence at the foot of the list again (also in «Acerca de»). */}
              <div className="grid gap-0.5 px-6 pt-3 pb-5 max-sm:px-3" data-testid="settings-foot">
                <BubbleTip title={`@${AUTHOR.github}`} text={AUTHOR.url.replace('https://', '')} side="top" align="start">
                  <button type="button" onClick={() => bridge.openExternal(AUTHOR.url)} className="hover:text-primary flex w-fit cursor-pointer items-center gap-1.5 text-[13px] font-medium" aria-label={AUTHOR.url.replace('https://', '')} data-testid="settings-foot-github">
                    <ToolIcon tool="gh" className="size-4" /><span className="max-sm:hidden">@{AUTHOR.github}</span>
                  </button>
                </BubbleTip>
                <span className="text-muted-foreground text-xs max-sm:hidden" data-testid="settings-foot-version">{PRODUCT.name} {app.version} · {t('settings.footLicense')}</span>
              </div>
            </nav>
            <div key={section.id} className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 pt-6 pb-8">
              {/* min-w-0 on the cards: a long one-line text inside (a path, a wide control) must not widen the column in a narrow window */}
              <div className="mx-auto grid max-w-3xl gap-4 [&>*]:min-w-0">
                <div className="grid gap-1 pb-1"><h2 className="text-2xl font-medium">{t(`settings.section.${section.id}`)}</h2><p className="text-muted-foreground text-sm">{t(`settings.sectionDesc.${section.id}`)}</p></div>
                {section.cards(c, app)}
              </div>
            </div>
          </div>
      </DialogContent>
    </Dialog>
  );
}
