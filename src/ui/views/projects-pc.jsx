// Projects on the PC (orb-ui-2.0 04-proyectos): the list by category with each project's git and work state, the way to
// add one, the finished ones folded at the end and GitHub's account. A project opens on its own page (project-page.jsx).
import { useEffect, useMemo, useState } from 'react';
import { FolderGit2, Plus, ChevronDown, ChevronRight, FolderPlus, Link2, GitFork, RefreshCw, MessageSquarePlus, CircleCheckBig, GitBranch, FilePen, Check, GitPullRequest, ArrowUp } from 'lucide-react';
import { PageHeader, PageBody } from '@/components/page.jsx';
import { NotificationBell } from '@/components/notification-center.jsx';
import { BarPause } from '@/components/conversation/bar.jsx';
import { ProjectIcon } from '@/components/project-icon.jsx';
import { ProjectOpenMenu } from '@/components/project-tools.jsx';
import { createProjectFlow, linkFolderFlow, cloneRepoFlow, CATEGORIES } from '@/components/project-actions.jsx';
import { finishFlow, chatHereFlow } from '@/components/project-flows.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Empty, PathText } from '@/components/ui/basic.jsx';
import { Select, BubbleTip, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/overlay.jsx';
import { Segmented, SearchInput, ListCard, ListRow, MoreButton } from '@/components/ui/primitives.jsx';
import { useStore, call, act, go, refresh } from '@/lib/store.js';
import { useT, useLocale } from '@/lib/i18n.js';
import { usePress } from '@/lib/use-press.js';
import { cn } from '@/lib/utils.js';
import { quiet } from '@/lib/quiet.js';
import { lastActivityAt, taskCounts, since, plural, gitFacts } from '@/lib/project-status.js';
import { useRowInfo, forgetRowInfos } from '@/lib/use-project-info.js';
import { ProjectPage } from './project-page.jsx';

// the open project's page, or the list.
export function ProjectsPc({ route }) {
  const projects = useStore((s) => s.projects);
  const current = route.name ? projects.find((p) => p.name === route.name) : null;
  return current ? <ProjectPage key={current.name} p={current} /> : <ProjectsList />;
}

const ORDERS = ['activity', 'name', 'category'];
const sectionOf = (p) => p.category ?? null;

// «3 cambios sin guardar», «1 PR abierto»…: one fact of a row (the git state of the project), with the colour that says if it
// asks for something (amber), is fine (green) or is only information.
function Fact({ icon: Icon, kind, children }) {
  return <span className={cn('inline-flex items-center gap-1', kind === 'warn' && 'text-warning-ink', kind === 'ok' && 'text-success', kind === 'err' && 'text-destructive')}>{Icon ? <Icon className="size-3.5" /> : null}{children}</span>;
}

function RowFacts({ info, counts }) {
  const t = useT();
  const facts = gitFacts(info);
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5" data-testid="project-facts">
      {facts.map((f) => {
        if (f.key === 'branch') return <Fact key={f.key} icon={GitBranch}>{f.value}</Fact>;
        if (f.key === 'changes') return <Fact key={f.key} icon={FilePen} kind="warn">{plural(t, 'projects.m.changes', f.n)}</Fact>;
        if (f.key === 'ahead') return <Fact key={f.key} icon={ArrowUp} kind="warn">{plural(t, 'projects.m.ahead', f.n)}</Fact>;
        if (f.key === 'uptodate') return <Fact key={f.key} icon={Check} kind="ok">{t('projects.m.upToDate')}</Fact>;
        if (f.key === 'prs') return f.n ? <Fact key={f.key} icon={GitPullRequest}>{plural(t, 'projects.m.pr', f.n)}</Fact> : <Fact key={f.key}>{t('projects.m.noPr')}</Fact>;
        if (f.key === 'nodata') return <Fact key={f.key}>{t('projects.m.noData')}</Fact>;
        return <Fact key={f.key}>{t('projects.m.noGit')}</Fact>;
      })}
      {counts.running ? <Fact>{plural(t, 'projects.m.run', counts.running)}</Fact> : <Fact>{t('projects.m.noRun')}</Fact>}
      {counts.approve ? <Fact kind="warn">{t('projects.m.approve', { n: counts.approve })}</Fact> : null}
      {counts.failed ? <Fact kind="err">{plural(t, 'projects.m.fail', counts.failed)}</Fact> : null}
    </span>
  );
}

// ⋯ of a row (also opened with a right click or a long press): what can be done with the whole project from the list.
function RowMenu({ p, open, setOpen }) {
  const t = useT();
  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <BubbleTip title={t('projects.menu', { name: p.name })}>
        <DropdownMenuTrigger asChild><MoreButton small label={t('projects.menu', { name: p.name })} data-testid="project-menu" onClick={(e) => e.stopPropagation()} /></DropdownMenuTrigger>
      </BubbleTip>
      <DropdownMenuContent align="end" className="w-56" data-testid="project-menu-list">
        <DropdownMenuItem onSelect={() => chatHereFlow(p)} data-testid="project-chat"><MessageSquarePlus />{t('projects.newChat')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => finishFlow(p, t)} data-testid="project-finish"><CircleCheckBig />{t('projects.finish.title')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// The row paints with what the window knows; its git facts arrive later, once the row is on screen (useRowInfo).
function ProjectRow({ p, stamp, counts, last, onOpen }) {
  const t = useT();
  const [rowRef, info] = useRowInfo(p.name, p.path, stamp);
  const [menu, setMenu] = useState(false);
  const press = usePress(() => setMenu(true));
  return (
    <ListRow ref={rowRef} data-testid="project-row" {...press} className="border-border cursor-pointer rounded-none border-t first:border-t-0"
      onClickCapture={(e) => { if (!e.target.closest('button, a, [role=menuitem]')) onOpen(p.name); }}
      leading={<ProjectIcon name={p.name} />}
      title={<button type="button" onClick={() => onOpen(p.name)} className="max-w-full cursor-pointer truncate text-left font-medium outline-none focus-visible:underline" data-testid="project-open-name">{p.name}</button>}
      meta={<><PathText path={p.path} className="text-faint-foreground text-caption" /><RowFacts info={info} counts={counts} /></>}
      trailing={<>
        <span className="text-muted-foreground w-[150px] shrink-0 text-right text-caption">{last ? t('projects.last', { when: since(last, t) }) : t('projects.last.none')}</span>
        <div className="acts flex shrink-0 items-center gap-1.5">
          <ProjectOpenMenu project={p} />
          <Button size="xs" onClick={() => onOpen(p.name)} data-testid="project-open">{t('projects.open')}</Button>
          <RowMenu p={p} open={menu} setOpen={setMenu} />
        </div>
      </>} />
  );
}

// «Terminados»: folded by default; each one comes back with «Reabrir».
function FinishedSection({ list, tasks, onReopened }) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const reopen = async (x) => { const name = await act(call('projects.reopen', { key: x.key })); if (name) { await refresh().catch(quiet); onReopened(name); } };
  return (
    <div data-testid="projects-finished">
      <button type="button" className="sec-h mt-2 flex w-full cursor-pointer items-center gap-2 text-left outline-none focus-visible:underline" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="projects-finished-toggle">
        <ChevronRight className={cn('size-3.5 transition-transform duration-150', open && 'rotate-90')} />
        <h2 className="font-(family-name:--title) text-card-title font-semibold">{t('projects.terminated')}</h2>
        <span className="text-faint-foreground text-caption">{list.length}</span>
      </button>
      <p className="text-muted-foreground mt-2.5 text-caption">{t('projects.terminatedHint')}</p>
      {open ? (
        <ListCard className="mt-3">
          {list.map((x) => (
            <ListRow key={x.key} data-testid="project-finished" className="border-border rounded-none border-t first:border-t-0" leading={<ProjectIcon name={x.name} />} title={x.name}
              meta={<span className="flex flex-wrap items-center gap-x-2.5"><span>{x.category ?? t('comp.projects.category.other')}</span><span>{t('projects.finished.on', { date: new Date(x.at).toLocaleDateString(locale, { day: 'numeric', month: 'short' }) })} · {plural(t, 'projects.tasks', tasks.filter((k) => k.project === x.name).length)}</span></span>}
              trailing={<Button size="xs" variant="outline" onClick={() => reopen(x)} data-testid="project-reopen">{t('projects.reopen')}</Button>} />
          ))}
        </ListCard>
      ) : null}
    </div>
  );
}

// «Nuevo proyecto» and its three ways in, each with its own dialog.
function NewProject({ onMade }) {
  const t = useT();
  const items = [
    ['create', FolderPlus, createProjectFlow, 'project-new-create'],
    ['link', Link2, linkFolderFlow, 'project-new-link'],
    ['clone', GitFork, cloneRepoFlow, 'project-new-clone']
  ];
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild><Button data-testid="project-new"><Plus />{t('projects.create')}<ChevronDown /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72" data-testid="project-new-list">
        {items.map(([id, Icon, flow, testid]) => (
          <DropdownMenuItem key={id} className="items-start" onSelect={async () => onMade(await flow())} data-testid={testid}>
            <Icon /><span><span className="font-medium">{t(`projects.new.${id}`)}</span><br /><span className="text-muted-foreground text-caption">{t(`projects.new.${id}Hint`)}</span></span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProjectsList() {
  const t = useT();
  const projects = useStore((s) => s.projects);
  const tasks = useStore((s) => s.tasks);
  const sessions = useStore((s) => s.sessions);
  const conversations = useStore((s) => s.conversations);
  const app = useStore((s) => s.app);
  const version = useStore((s) => s.version);
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [order, setOrder] = useState('activity');
  const [finished, setFinished] = useState([]);
  useEffect(() => { let alive = true; call('projects.finished').then((l) => alive && setFinished(l ?? [])).catch(quiet); return () => { alive = false; }; }, [version]);
  const [stamp, setStamp] = useState(0);
  const reloadInfos = () => { forgetRowInfos(); setStamp((n) => n + 1); };
  const open = (name) => go({ view: 'projects', name });

  const rows = useMemo(() => projects.map((p) => ({ p, counts: taskCounts(p.name, tasks), last: lastActivityAt(p.name, { tasks, sessions, conversations }) })), [projects, tasks, sessions, conversations]);
  const present = [...CATEGORIES, null].filter((c) => rows.some((r) => sectionOf(r.p) === c));
  const needle = q.trim().toLowerCase();
  // a category that no longer has projects (the last one finished) falls back to all of them.
  const catNow = cat === 'all' || present.some((c) => (c ?? 'other') === cat) ? cat : 'all';
  const shown = rows.filter((r) => (catNow === 'all' || (sectionOf(r.p) ?? 'other') === catNow) && (!needle || `${r.p.name} ${r.p.path}`.toLowerCase().includes(needle)));
  const byActivity = (a, b) => String(b.last ?? '').localeCompare(String(a.last ?? '')) || a.p.name.localeCompare(b.p.name);
  const sorted = [...shown].sort(order === 'activity' ? byActivity : (a, b) => a.p.name.localeCompare(b.p.name));
  const sections = present.map((c) => ({ c, list: sorted.filter((r) => sectionOf(r.p) === c) })).filter((s) => s.list.length);
  // by activity the section holding the most recent project goes first; otherwise the order of Orb's categories.
  if (order === 'activity') sections.sort((a, b) => String(b.list[0].last ?? '').localeCompare(String(a.list[0].last ?? '')));
  const meta = [t('projects.sub.active', { n: projects.length }), finished.length ? t('projects.sub.finished', { n: finished.length }) : null, app.home ? t('projects.sub.in', { home: app.home }) : null].filter(Boolean).join(' · ');

  return (
    <>
      <PageHeader title={t('projects.title')} meta={meta}>
        <BarPause />
        <NotificationBell />
        <DropdownMenu modal={false}>
          <BubbleTip title={t('nav.more')}><DropdownMenuTrigger asChild><MoreButton label={t('nav.more')} data-testid="projects-more" /></DropdownMenuTrigger></BubbleTip>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem onSelect={reloadInfos} data-testid="projects-refresh-git"><RefreshCw />{t('projects.refreshGit')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </PageHeader>
      <PageBody className="md:pb-28">
        <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4">
          <div className="toolbar flex flex-wrap items-center gap-1.5">
            <Segmented value={catNow} onChange={setCat} aria-label={t('projects.cat.label')} itemTestId={(v) => `projects-cat-${v}`}
              options={[{ value: 'all', label: t('projects.cat.all'), count: projects.length }, ...present.map((c) => ({ value: c ?? 'other', label: c ?? t('comp.projects.category.other'), count: rows.filter((r) => sectionOf(r.p) === c).length }))]} />
            <span className="grow" />
            <SearchInput className="w-auto flex-[0_1_220px]" value={q} onChange={setQ} placeholder={t('projects.search')} data-testid="projects-search" />
            <Select value={order} caret="solid" onValueChange={setOrder} title={t('projects.order.label')} data-testid="projects-order" options={ORDERS.map((o) => ({ value: o, label: t(`projects.order.${o}`) }))} />
            <NewProject onMade={(p) => p && open(p.name)} />
          </div>
          {sections.length ? sections.map(({ c, list }) => (
            <div key={c ?? 'other'} data-testid={`category-${c ?? 'other'}`}>
              <div className="sec-h mt-1 flex items-center gap-2"><h2 className="font-(family-name:--title) text-card-title font-semibold">{c ?? t('comp.projects.category.other')}</h2><span className="text-faint-foreground text-caption">{list.length}</span></div>
              <ListCard className="mt-1.5">
                {list.map((r) => <ProjectRow key={r.p.name} p={r.p} stamp={stamp} counts={r.counts} last={r.last} onOpen={open} />)}
              </ListCard>
            </div>
          )) : (
            <ListCard>
              {projects.length ? <Empty icon={FolderGit2} title={t('projects.empty.filtered')}>{t('projects.empty.filteredHint')}</Empty>
                : <Empty icon={FolderGit2} title={t('projects.empty.title')}>{app.home ? t('projects.empty.hint', { home: app.home }) : t('projects.empty.hintRemote')}</Empty>}
            </ListCard>
          )}
          {finished.length ? <FinishedSection list={finished} tasks={tasks} onReopened={open} /> : null}
        </div>
      </PageBody>
    </>
  );
}
