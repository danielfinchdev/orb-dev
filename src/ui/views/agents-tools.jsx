// «Herramientas» of the Agents page: what Orb needs on this PC, folded into one line that opens by itself when something
// necessary is missing or has a new version. The installer (installer.* in the engine) does the work; this only draws it.
import { useEffect, useState } from 'react';
import { CircleCheck, TriangleAlert, ChevronDown, RefreshCw, ListChecks, Download, ExternalLink, Coffee, Smartphone, Layers, Wrench } from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/overlay.jsx';
import { BubbleTip } from '@/components/ui/overlay.jsx';
import { ListCard } from '@/components/ui/primitives.jsx';
import { Badge, Spinner } from '@/components/ui/basic.jsx';
import { Button } from '@/components/ui/button.jsx';
import { InstallProgress } from '@/components/installer.jsx';
import { AgentIcon, ToolIcon } from '@/components/agent-icon.jsx';
import { bridge, call, act } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';

// The agents whose button updates them (Claude Code and Codex, installed by Orb); a newer Cursor only gets the command to run.
const AGENT_UPDATE = ['claude', 'codex'];
// What the installer sets up besides the agents of the first block (they are installed from their own ficha).
export const TEAM_AGENTS = ['gemini', 'copilot', 'opencode', 'qwen', 'hermes'];

// The groups, in the order they are drawn. A tool lands in the group GROUP_OF names; one the installer adds later without an
// entry here goes to «Recomendadas» (optional) or «Necesarias». A group with no tool is not drawn.
const GROUPS = ['need', 'rec', 'mobile', 'lang'];
const GROUP_OF = { git: 'need', node: 'need', claude: 'need', codex: 'need', cursor: 'need', gh: 'need', tailscale: 'mobile', java: 'mobile', androidSdk: 'mobile', flutter: 'mobile' };
// The one line that says what each tool is for (the installer's own text for any other).
const WHY = new Set(['git', 'node', 'claude', 'codex', 'cursor', 'gh', 'tailscale', 'java', 'androidSdk', 'flutter', 'uv', 'rg', 'pwsh', 'jq', 'gitLfs', 'pnpm', 'rustup', 'go', 'dotnet', 'bun', 'docker', 'buildTools', 'playwright']);
const LINE_ICON = { java: Coffee, androidSdk: Smartphone, flutter: Layers };

function ToolMark({ id }) {
  if (['claude', 'codex', 'cursor'].includes(id)) return <AgentIcon agent={id} className="size-4" />;
  const Line = LINE_ICON[id];
  if (Line) return <Line className="text-muted-foreground size-4" />;
  return ToolIcon({ tool: id }) ?? <Wrench className="text-muted-foreground size-4" />;
}

export function ToolsBlock({ team, agents, renderUpdate }) {
  const t = useT();
  const [now, setNow] = useState(Date.now());
  const [userOpen, setUserOpen] = useState(null);
  const [folded, setFolded] = useState({ lang: true });
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  // Newer versions are asked only once the user opens the block (the engine keeps the answer for a while).
  const askedUpgrades = userOpen === true;
  useEffect(() => { if (askedUpgrades && team.available) { team.reload(true); team.checkUpgrades?.(false); } }, [askedUpgrades]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!team.available) return null;

  const agentOf = (id) => agents?.find((x) => x.id === id);
  const tools = team.items ? [
    ...team.items.filter((i) => !TEAM_AGENTS.includes(i.id)).map((i) => {
      const a = agentOf(i.id);
      const upd = a?.installed && a.update?.available ? a.update : null;
      // a newer version winget reported for a tool of the catalog (asked only when the block was opened or «Comprobar» pressed)
      const wupd = i.installed && i.canUpdate ? (team.upgrades?.[i.id] ?? i.update ?? null) : null;
      return { id: i.id, label: i.label, why: WHY.has(i.id) ? t(`agents.tool.${i.id}`) : i.why, installed: i.installed, optional: i.optional, version: i.version?.match(/\d+(?:\.\d+)+/)?.[0] ?? a?.version ?? null, group: GROUP_OF[i.id] ?? i.group ?? (i.optional ? 'rec' : 'need'), upd: upd ?? wupd, wupd, agent: a, canUpdate: AGENT_UPDATE.includes(i.id), installable: true };
    }),
    // Flutter has no installer here: Orb finds it and points to its page.
    ...(team.dev ?? []).filter((d) => !team.items.some((i) => i.id === d.id)).map((d) => ({ id: d.id, label: t(`agents.team.tool.${d.id}`), why: t(`agents.tool.${d.id}`), installed: d.installed, optional: true, version: d.version ?? null, group: GROUP_OF[d.id] ?? 'rec', url: d.url, installable: false }))
  ] : [];
  const stepOf = (id) => team.progress?.steps.find((s) => s.id === id);
  const done = (x) => x.installed || stepOf(x.id)?.state === 'hecho';
  const needed = tools.filter((x) => !x.optional);
  const optional = tools.filter((x) => x.optional);
  const missing = needed.filter((x) => !done(x));
  const updates = tools.filter((x) => x.upd);
  const attention = missing.length > 0 || updates.length > 0;
  const open = userOpen ?? attention;
  const ago = Math.floor((now - (team.checkedAt ?? now)) / 60_000);
  const sub = [
    t('agents.tools.needed', { n: needed.length - missing.length, total: needed.length }),
    updates.length ? t(updates.length === 1 ? 'agents.tools.updateOne' : 'agents.tools.updateMany', { n: updates.length }) : null,
    !missing.length && !updates.length ? t('agents.tools.optional', { n: optional.filter(done).length, total: optional.length }) : null
  ].filter(Boolean).join(' · ');

  const row = (x) => {
    const step = stepOf(x.id);
    const busy = step?.state === 'instalando';
    const ok = done(x);
    const lacking = !ok && !x.optional;
    return (
      <div key={x.id} className={cn('flex items-center gap-3 px-3.5 py-2.5 not-first:border-t border-border', lacking && 'bg-warning/10')} data-testid={`team-tool-${x.id}`}>
        <span className="grid size-6 flex-none place-items-center"><ToolMark id={x.id} /></span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5"><b className="text-control font-medium">{x.label}</b><span className="text-muted-foreground truncate text-caption">{x.why}</span></div>
        <div className="flex flex-none items-center gap-2">
          {ok ? <>
            {x.wupd ? <Button size="sm" variant="outline" disabled={team.running} onClick={() => team.install([x.id], { update: true })} data-testid={`team-update-${x.id}`}><Download />{t('agents.update')}</Button> : null}
            {x.version ? <span className="text-muted-foreground text-control tabular-nums">{x.upd?.latest ? `${x.version} → ${x.upd.latest}` : x.version}</span> : null}
            {x.wupd ? null
              : x.upd && x.agent && x.canUpdate && renderUpdate ? renderUpdate(x.agent)
              : x.upd ? <span className="flex items-center gap-2"><Badge variant="success">{t('comp.installer.installed')}</Badge>{x.upd.command ? <span className="text-muted-foreground max-w-[260px] truncate text-caption" title={x.upd.command} data-testid={`team-update-cmd-${x.id}`}>{t('agents.howUpdate', { cmd: x.upd.command })}</span> : null}</span>
                : <Badge variant="success">{t('comp.installer.installed')}</Badge>}
          </> : <>
            {step?.state === 'error' ? <BubbleTip title={t('comp.installer.failed')} text={step.detail}><Badge variant="destructive" tabIndex={0}>{t('comp.installer.failed')}</Badge></BubbleTip>
              : lacking ? <Badge variant="destructive">{t('agents.tools.lacks')}</Badge> : null}
            {x.installable
              ? <Button size="sm" variant={x.optional ? 'outline' : 'default'} disabled={team.running || busy} onClick={() => team.install([x.id])} data-testid={`team-install-${x.id}`}>{busy ? <Spinner className="size-3.5" /> : <Download />}{busy ? t('comp.installer.installingBtn') : t('agents.install')}</Button>
              : x.url ? <Button size="sm" variant="outline" onClick={() => bridge.openExternal(x.url)} data-testid={`team-howto-${x.id}`}><ExternalLink />{t('agents.howInstall')}</Button> : null}
          </>}
        </div>
      </div>
    );
  };

  return (
    <section className="flex min-w-0 flex-col gap-3" data-testid="agents-team">
      <h2 className="font-(family-name:--title) text-card-title leading-[1.45] font-semibold">{t('agents.tools.title')}</h2>
      {!team.items ? <div className="text-muted-foreground flex items-center gap-2 text-control"><Spinner />{t('comp.installer.checking')}</div> : (
        <ListCard>
          <Collapsible open={open} onOpenChange={setUserOpen}>
            <div className="flex flex-wrap items-center gap-2 pr-3.5">
              <CollapsibleTrigger className="hover:bg-accent/40 focus-visible:outline-ring flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-3.5 py-3 text-left outline-none focus-visible:outline-2" data-testid="agents-tools-toggle">
                {missing.length ? <TriangleAlert className="text-warning-ink size-5 flex-none" /> : <CircleCheck className="text-success size-5 flex-none" />}
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <b className="text-body font-medium">{missing.length ? t(missing.length === 1 ? 'agents.tools.lacksOne' : 'agents.tools.lacksMany', { n: missing.length }) : t('agents.tools.allReady')}</b>
                  <span className="text-muted-foreground text-caption" data-testid="agents-tools-summary">{sub}</span>
                </span>
                <ChevronDown className={cn('text-muted-foreground size-4 flex-none transition-transform', open && 'rotate-180')} />
              </CollapsibleTrigger>
              {missing.length ? <Button size="sm" disabled={team.running} onClick={() => team.install(missing.map((x) => x.id))} data-testid="team-install-all"><ListChecks />{team.running ? t('comp.installer.installingBtn') : t('agents.tools.installMissing', { n: missing.length })}</Button> : null}
            </div>
            <CollapsibleContent className="border-border border-t">
              {GROUPS.map((g) => {
                const list = tools.filter((x) => x.group === g);
                if (!list.length) return null;
                const isFolded = folded[g] === true;
                return (
                  <div key={g} data-testid={`team-group-${g}`}>
                    <button type="button" aria-expanded={!isFolded} onClick={() => setFolded((f) => ({ ...f, [g]: !isFolded }))} className="bg-muted/40 border-border hover:bg-muted/60 flex w-full cursor-pointer items-center gap-2 border-b px-3.5 py-2 text-left not-first:border-t">
                      <b className="text-control font-medium">{t(`agents.tools.group.${g}`)}</b>
                      <span className="text-faint-foreground text-caption tabular-nums">{t('agents.tools.groupCount', { n: list.filter(done).length, total: list.length })}</span>
                      <span className="text-muted-foreground min-w-0 flex-1 truncate text-caption">{t(`agents.tools.groupNote.${g}`)}</span>
                      <ChevronDown className={cn('text-muted-foreground size-3.5 flex-none transition-transform', !isFolded && 'rotate-180')} />
                    </button>
                    {isFolded ? null : <div>{list.map(row)}
                      {g === 'rec' && list.some((x) => !done(x)) ? (
                        <div className="border-border flex justify-end border-t px-3.5 py-2.5">
                          <Button size="sm" disabled={team.running} onClick={() => team.install(list.filter((x) => !done(x)).map((x) => x.id))} data-testid="team-install-rec"><ListChecks />{t('agents.tools.installRec', { n: list.filter((x) => !done(x)).length })}</Button>
                        </div>
                      ) : null}
                    </div>}
                  </div>
                );
              })}
              <div className="border-border flex flex-wrap items-center justify-between gap-3 border-t px-3.5 py-3">
                <span className="text-faint-foreground min-w-0 flex-1 text-caption">{t('agents.tools.foot')}</span>
                <span className="flex flex-none items-center gap-3">
                  <span className="text-faint-foreground text-caption">{ago < 1 ? t('agents.team.checkedNow') : t('agents.team.checkedAgo', { n: ago })}</span>
                  <Button size="sm" variant="outline" onClick={() => { team.reload(true); team.checkUpgrades?.(true); }} data-testid="team-recheck"><RefreshCw />{t('agents.team.recheck')}</Button>
                </span>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </ListCard>
      )}
      {team.progress?.steps.length ? <InstallProgress progress={team.progress} /> : null}
      {team.progress?.running ? <p className="text-faint-foreground text-caption">{t('comp.installer.windowOpened')}</p> : null}
    </section>
  );
}

// What a project's files ask for and this PC lacks (pyproject.toml: Python + uv, Cargo.toml: Rust...), with «Instalar».
// The engine finds the project by name; nothing is installed until the button is pressed.
export function ToolSuggestions({ project }) {
  const t = useT();
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(null);
  const load = () => call('installer.suggest', { project }).then((r) => setList(Array.isArray(r) ? r : [])).catch(() => setList([]));
  useEffect(() => { load(); }, [project]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => bridge.on('installer:progress', (p) => { if (p.finished) { setBusy(null); load(); } }), [project]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!list.length) return null;
  const install = async (tool) => { setBusy(tool); const p = await act(call('installer.start', { ids: [tool] })); if (!p) setBusy(null); };
  return (
    <div className="flex flex-col gap-2" data-testid="project-tool-suggestions">
      {list.map((x) => (
        <div key={x.tool} className="bg-card border-border rounded-card flex items-center gap-3 border px-3.5 py-2.5" data-testid={`project-tool-${x.tool}`}>
          <Wrench className="text-muted-foreground size-4 flex-none" />
          <span className="min-w-0 flex-1 text-control">{t('agents.suggest.text', { file: x.file, tool: x.label })}</span>
          {x.installable
            ? <Button size="sm" variant="outline" disabled={busy != null} onClick={() => install(x.tool)} data-testid={`project-tool-install-${x.tool}`}>{busy === x.tool ? <Spinner className="size-3.5" /> : <Download />}{busy === x.tool ? t('comp.installer.installingBtn') : t('agents.install')}</Button>
            : <Button size="sm" variant="outline" onClick={() => bridge.openExternal('https://docs.flutter.dev/get-started/install')} data-testid={`project-tool-howto-${x.tool}`}><ExternalLink />{t('agents.howInstall')}</Button>}
        </div>
      ))}
    </div>
  );
}
