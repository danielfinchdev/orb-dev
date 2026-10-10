// Projects: the folders inside the assistant's folder (plus any linked one), with git and GitHub actions.
import { useEffect, useState } from 'react';
import { FolderKanban, FolderPlus, FolderOpen, Pin, MessageSquare, BookOpen, Unlink, GitBranch, Save, Upload, RefreshCw, GitPullRequest, Folder, ScanSearch } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page.jsx';
import { confirm, form } from '@/components/dialogs.jsx';
import { createProjectFlow, linkFolderFlow, cloneRepoFlow, CATEGORIES } from '@/components/project-actions.jsx';
import { askReview } from './tasks.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Card, CardContent, CardHeader, CardTitle, CardDescription, Empty, Field, Input, PathText, Spinner } from '@/components/ui/basic.jsx';
import { Checkbox, BubbleTip } from '@/components/ui/overlay.jsx';
import { useStore, call, act, go, bridge } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { GithubIcon } from '@/components/agent-icon.jsx';
import { useT } from '@/lib/i18n.js';

function GithubCard() {
  const t = useT();
  const [gh, setGh] = useState(null);
  const load = () => { setGh(null); call('github.status').then(setGh).catch((e) => setGh({ error: e.message })); };
  useEffect(load, []);
  return (
    <Card className="flex-row items-center gap-3 px-5 py-3.5">
      <GithubIcon className="size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium">GitHub</div>
        <div className="text-muted-foreground text-xs">{t('projects.gh.desc')}</div>
      </div>
      {!gh ? <Spinner /> : !gh.installed ? (<><Badge variant="secondary">{t('projects.gh.notInstalled')}</Badge><Button size="sm" variant="outline" onClick={() => bridge.openExternal('https://cli.github.com/')}>{t('projects.gh.download')}</Button></>)
        : gh.loggedIn ? <Badge variant="success">{t('projects.gh.connected', { user: gh.user ?? '?' })}</Badge>
          : (<><Badge variant="destructive">{t('projects.gh.noSession')}</Badge><Button size="sm" onClick={() => act(call('github.login'), t('projects.gh.login.done'))}>{t('projects.gh.login')}</Button></>)}
      <BubbleTip title={t('projects.gh.check')}><Button size="icon-sm" variant="ghost" onClick={load} aria-label={t('projects.gh.check')}><RefreshCw /></Button></BubbleTip>
    </Card>
  );
}

function ProjectDetail({ p }) {
  const t = useT();
  const [info, setInfo] = useState(null);
  const load = () => { setInfo(null); call('projects.info', { name: p.name }).then(setInfo).catch((e) => setInfo({ git: false, error: e.message })); };
  useEffect(load, [p.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = async () => {
    const r = await form(t('projects.commit.title'), { description: t('projects.commit.desc'), initial: { message: '' },
      body: (v, set) => <Field label={t('projects.commit.message')}><Input autoFocus value={v.message} onChange={(e) => set({ message: e.target.value })} maxLength={200} placeholder={t('projects.commit.ph')} /></Field>,
      ok: t('projects.commit.ok'), onOk: (v) => call('projects.commit', { name: p.name, message: v.message }) });
    if (r) { toast.success(t('projects.commit.done', { files: r.files })); load(); }
  };
  const publish = async () => {
    const r = await form(t('projects.publish.title'), { description: t('projects.publish.desc'), initial: { repo: p.name.replace(/[^\w.-]+/g, '-'), isPrivate: true },
      body: (v, set) => (<><Field label={t('projects.publish.repo')}><Input value={v.repo} onChange={(e) => set({ repo: e.target.value })} /></Field><label className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox checked={v.isPrivate} onCheckedChange={(c) => set({ isPrivate: c === true })} />{t('projects.publish.private')}</label></>),
      ok: t('projects.publish.ok'), onOk: (v) => call('projects.createRepo', { name: p.name, repo: v.repo.trim(), isPrivate: v.isPrivate }) });
    if (r) { toast.success(t('projects.publish.done', { url: r.url })); load(); }
  };
  return (
    <Card className="gap-5">
      <CardHeader className="flex-row items-start gap-3">
        <Folder className="text-primary mt-0.5 size-5 shrink-0" />
        <div className="min-w-0 flex-1"><CardTitle className="text-[17px]">{p.name}</CardTitle><CardDescription className="mt-1 font-mono text-xs break-all">{p.path}</CardDescription></div>
        {p.active ? <Badge><Pin />{t('projects.workProject')}</Badge> : null}
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {!p.active ? <Button size="sm" onClick={() => act(call('projects.setActive', { name: p.name }), t('projects.setActive.done', { name: p.name }))}><Pin />{t('projects.setActive')}</Button> : null}
        {bridge.mobile ? null : <Button size="sm" variant="outline" onClick={() => act(bridge.openPath(p.path))}><FolderOpen />{t('projects.openFolder')}</Button>}
        <Button size="sm" variant="outline" onClick={async () => { await act(call('projects.setActive', { name: p.name })); go('new'); }}><MessageSquare />{t('projects.chatHere')}</Button>
        <Button size="sm" variant="outline" onClick={() => askReview({ project: p.name })} data-testid="project-review"><ScanSearch />{t('projects.review')}</Button>
        <Button size="sm" variant="outline" onClick={() => go({ view: 'logs', name: p.name })}><BookOpen />{t('projects.log')}</Button>
        {!p.inHome ? <Button size="sm" variant="danger" onClick={async () => { if (await confirm(t('projects.unlink.title'), t('projects.unlink.body', { name: p.name }), { ok: t('projects.unlink.ok'), danger: true })) act(call('projects.remove', { name: p.name }), t('projects.unlink.done')); }}><Unlink />{t('projects.unlink.ok')}</Button> : null}
      </CardContent>
      {p.notes ? <CardContent className="text-muted-foreground text-sm">{p.notes}</CardContent> : null}
      <CardContent className="grid gap-3">
        <div className="text-muted-foreground flex items-center gap-1.5 text-xs"><GitBranch className="size-3.5" />{t('projects.git')}</div>
        {!info ? <Spinner /> : !info.git ? <p className="text-muted-foreground text-sm">{info.error ?? t('projects.noGit')}</p> : (<>
          <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-1.5 text-[13px]">
            <dt className="text-muted-foreground">{t('projects.branch')}</dt><dd className="font-mono text-xs">{info.branch}</dd>
            <dt className="text-muted-foreground">{t('projects.changes')}</dt><dd>{info.changes ? t('projects.filesN', { n: info.changes }) : t('projects.none')}</dd>
            <dt className="text-muted-foreground">{t('projects.remote')}</dt><dd className="break-all">{info.remote ?? t('projects.unpublished')}</dd>
            {info.ahead != null ? <><dt className="text-muted-foreground">{t('projects.ahead')}</dt><dd>{t('projects.commitsN', { n: info.ahead })}</dd></> : null}
          </dl>
          <div className="flex flex-wrap gap-2">
            {info.changes ? <Button size="sm" variant="outline" onClick={commit}><Save />{t('projects.commitBtn')}</Button> : null}
            {info.remote ? <Button size="sm" variant="outline" onClick={async () => { if (await confirm(t('projects.push.title'), t('projects.push.body', { branch: info.branch, remote: info.remote }), { ok: t('projects.push.ok') })) { await act(call('projects.push', { name: p.name, branch: info.branch }), t('projects.push.done')); load(); } }}><Upload />{t('projects.pushBtn')}</Button>
              : <Button size="sm" variant="outline" onClick={publish}><GithubIcon />{t('projects.publish.title')}</Button>}
          </div>
          {info.branches?.length > 1 ? <div className="flex flex-wrap gap-1.5">{info.branches.map((b) => <Badge key={b} variant="secondary" className="font-mono font-normal">{b}</Badge>)}</div> : null}
          {info.prs?.length ? <div className="grid gap-1.5"><div className="text-muted-foreground text-xs">{t('projects.prs')}</div>{info.prs.map((pr) => <a key={pr.number} className="flex cursor-pointer items-center gap-2 text-sm hover:underline" onClick={() => bridge.openExternal(pr.url)}><GitPullRequest className="text-success size-4" />#{pr.number} {pr.title}<span className="text-muted-foreground text-xs">{pr.headRefName}</span></a>)}</div> : null}
        </>)}
      </CardContent>
    </Card>
  );
}

export function ProjectsView({ route }) {
  const t = useT();
  const projects = useStore((s) => s.projects);
  const app = useStore((s) => s.app);
  const [selected, setSelected] = useState(route.name ?? app.activeProject?.name ?? projects[0]?.name ?? null);
  const current = projects.find((p) => p.name === selected) ?? null;
  const pick = (p) => p && setSelected(p.name);
  return (
    <>
      <PageHeader icon={<FolderKanban className="text-primary size-5" />} title={t('projects.title')} meta={t('projects.meta', { home: app.home })}>
        {bridge.mobile ? null : <><Button size="sm" variant="ghost" onClick={async () => pick(await cloneRepoFlow())}><GithubIcon />{t('projects.clone')}</Button>
        <Button size="sm" variant="ghost" onClick={async () => pick(await linkFolderFlow())}><FolderOpen />{t('projects.link')}</Button></>}
        <Button size="sm" onClick={async () => pick(await createProjectFlow())}><FolderPlus />{t('projects.create')}</Button>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:pb-28">
        <div className="grid gap-4">
          {bridge.mobile ? null : <GithubCard />}
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(280px,1fr)_minmax(400px,1.4fr)]">
            <Card className="gap-0 overflow-hidden py-0">
              {projects.length ? [...CATEGORIES, null].map((cat) => {
                // Grouped by category (windows, ios, android, web); linked folders outside Orb's folder go last.
                const list = projects.filter((p) => (p.category ?? null) === cat);
                return list.length ? (
                  <div key={cat ?? 'other'} data-testid={`category-${cat ?? 'other'}`}>
                    <div className="text-muted-foreground bg-muted/40 border-b px-4 py-1.5 text-[11px] font-medium tracking-wide uppercase">{t(`comp.projects.category.${cat ?? 'other'}`)}</div>
                    {list.map((p) => (
                      <button key={p.name} onClick={() => setSelected(p.name)} className={cn('flex w-full cursor-pointer items-center gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-accent/50', selected === p.name && 'bg-accent')}>
                        <Folder className={cn('size-4 shrink-0', p.active ? 'text-primary' : 'text-muted-foreground')} />
                        <div className="grid min-w-0 flex-1"><div className="truncate">{p.name}</div><PathText path={p.path} className="text-muted-foreground text-[11px]" /></div>
                        {p.open ? <Badge variant="info">{t(p.open === 1 ? 'projects.openOne' : 'projects.openOther', { n: p.open })}</Badge> : null}
                        {p.active ? <Pin className="text-primary size-3.5" /> : null}
                      </button>
                    ))}
                  </div>
                ) : null;
              }) : <Empty icon={FolderKanban} title={t('projects.empty.title')}>{t('projects.empty.hint', { home: app.home })}</Empty>}
            </Card>
            {current ? <ProjectDetail key={current.name} p={current} /> : <Card><Empty icon={Folder} title={t('projects.pick')} /></Card>}
          </div>
        </div>
      </div>
    </>
  );
}
