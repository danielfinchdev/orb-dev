// One project's page on the PC (orb-ui-2.0 05-proyecto): the header with where it lives and what to open it with, the
// tabs (Resumen, Chats, Tareas, Git y PR, Bitácora, Pizarra) and the ⋯ menu with everything that can be done to it.
import { useEffect, useMemo, useState } from 'react';
import { FolderTree, LayoutDashboard, MessagesSquare, ClipboardCheck, GitPullRequest, NotebookPen, Presentation, MessageSquarePlus, PencilLine, ImageIcon, CircleCheckBig, Trash2, ScanSearch, ShieldCheck, Unlink, Pin, RefreshCw, GitBranch, FilePen, FilePlus2, FileX2, Check, CircleCheck, CircleX, LoaderCircle, ExternalLink, GitMerge, Plus, Upload, SquareTerminal, GitPullRequestCreate, ArrowDownUp, ChevronDown } from 'lucide-react';
import { PageHeader } from '@/components/page.jsx';
import { NotificationBell } from '@/components/notification-center.jsx';
import { BarPause } from '@/components/conversation/bar.jsx';
import { ProjectIcon } from '@/components/project-icon.jsx';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { ProjectOpenMenu } from '@/components/project-tools.jsx';
import { GithubCard, ContributionGraph } from '@/components/project-github.jsx';
import { TaskStatus } from '@/components/task-state.jsx';
import { approveTask, rejectTask } from '@/components/task-approval.jsx';
import { finishFlow, deleteProjectFlow, renameFlow, unlinkFlow, commitFlow, publishFlow, pushFlow, chatHereFlow, changeIconFlow, clearIconFlow, changeCategory } from '@/components/project-flows.jsx';
import { confirm, form } from '@/components/dialogs.jsx';
import { askReview, askSecurityReview } from './tasks.jsx';
import { PrFilter, usePrCounts, usePrList, PrChecksBadge, usePrWatch, usePrRequests, PrAsk } from '@/components/pr-project.jsx';
import { syncFlow, writeEntryFlow } from '@/components/project-sync.jsx';
import { useOrbItems, openOrbItem } from './orb/inbox.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Card, Empty, Field, Input, Kbd, Spinner, Textarea } from '@/components/ui/basic.jsx';
import { Tabs, TabsList, TabsTrigger, BubbleTip, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/overlay.jsx';
import { ListCard, ListRow, MoreButton, Note } from '@/components/ui/primitives.jsx';
import { useStore, call, act, go, bridge } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';
import { AGENT } from '@/lib/labels.js';
import { notifyOk, notifyWarn } from '@/lib/notify.js';
import { orbProgress } from '@/lib/inbox.js';
import { cn } from '@/lib/utils.js';
import { quiet } from '@/lib/quiet.js';
import { needsApproval } from '@/lib/task-approval.js';
import { since, plural, lastLogEntry, repoOf, repoOfPr } from '@/lib/project-status.js';
import { useProjectInfo, forgetInfo } from '@/lib/use-project-info.js';

const WEEK = 7 * 86_400_000;
const H3 = 'font-(family-name:--title) text-card-title font-semibold';
const code = 'font-mono text-caption';

// a card of the page (.card.pad): its title with an icon, what sits at the end of the title, and the body.
function PjCard({ icon: Icon, title, aside, children, className, ...props }) {
  return (
    <Card className={cn('gap-2 p-3.5', className)} {...props}>
      <h3 className={cn(H3, 'flex items-center gap-2')}>{Icon ? <Icon className="size-4" /> : null}{title}<span className="grow" />{aside}</h3>
      {children}
    </Card>
  );
}
const Actions = ({ children }) => <div className="mt-2.5 flex flex-wrap items-center justify-end gap-2">{children}</div>;
const FileList = ({ children }) => <div className="border-border my-1 overflow-hidden rounded-card border">{children}</div>;
const FileRow = ({ icon: Icon, path, nums }) => (
  <div className="border-border hover:bg-accent flex items-center gap-2.5 border-t px-3 py-[9px] first:border-t-0">
    {Icon ? <Icon className="text-muted-foreground size-3.5 shrink-0" /> : null}
    <span className={cn(code, 'min-w-0 flex-1 truncate')}>{path}</span>{nums}
  </div>
);
const Nums = ({ add, del }) => <span className="text-caption tabular-nums"><span className="text-success">+{add}</span> <span className="text-destructive">−{del}</span></span>;
const FILE_ICON = { '??': FilePlus2, A: FilePlus2, D: FileX2 };

// the newest entry of the project's logbook, as plain text.
function LogCard({ p, full }) {
  const t = useT();
  const version = useStore((s) => s.version);
  const [entry, setEntry] = useState(undefined);
  const [written, setWritten] = useState(0);
  useEffect(() => { let alive = true; call('logs.read', { project: p.name }).then((r) => alive && setEntry(lastLogEntry(r))).catch(() => alive && setEntry(null)); return () => { alive = false; }; }, [p.name, version, written]);
  return (
    <PjCard icon={NotebookPen} title={t('projects.log.last')} data-testid="project-log-card"
      aside={<Button variant="link" size="xs" className="text-info text-control font-semibold" onClick={() => go({ view: 'logs', name: p.name })} data-testid="project-log-open">{t('projects.log.open')}</Button>}>
      {entry === undefined ? <Spinner /> : !entry ? <p className="text-muted-foreground text-control">{t('projects.log.none')}</p> : (<>
        <p className="text-muted-foreground text-caption">{[entry.who, `${entry.date}${entry.time ? ` ${entry.time}` : ''}`].filter(Boolean).join(' · ')}</p>
        <b className="text-body font-medium">{entry.topic}</b>
        <p className={cn('text-control whitespace-pre-line', !full && 'line-clamp-6')}>{entry.body}</p>
      </>)}
      <Actions>
        <Button variant="outline" onClick={() => writeEntryFlow(p, t, () => setWritten((n) => n + 1))} data-testid="project-log-write"><PencilLine />{t('projects.log.write')}</Button>
        <Button variant={full ? 'default' : 'outline'} onClick={() => go({ view: 'logs', name: p.name })} data-testid="project-log">{t('projects.log.view')}</Button>
      </Actions>
    </PjCard>
  );
}

function GitCard({ p, info, reload, expert }) {
  const t = useT();
  const [files, setFiles] = useState([]);
  const [last, setLast] = useState(null);
  useEffect(() => {
    let alive = true;
    setFiles([]);
    if (info?.git && info.changes) call('projects.commitFiles', { name: p.name }).then((l) => alive && setFiles(l ?? [])).catch(quiet);
    return () => { alive = false; };
  }, [p.name, info]);
  useEffect(() => { let alive = true; if (info?.git) call('expert.log', { project: p.name, limit: 1 }).then((l) => alive && setLast(l?.[0] ?? null)).catch(() => alive && setLast(null)); return () => { alive = false; }; }, [p.name, info]);
  return (
    <PjCard icon={GitBranch} title={t('projects.gitState')} data-testid="project-git-card"
      aside={info?.git ? (info.changes ? <Badge variant="warning">{plural(t, 'projects.badge.changes', info.changes)}</Badge> : <Badge variant="success">{t('projects.m.upToDate')}</Badge>) : null}>
      {!info ? <Spinner /> : !info.git ? <p className="text-muted-foreground text-control">{info.error ?? t('projects.noGit')}</p> : (<>
        <div className="flex flex-wrap items-center gap-2 text-control"><span className="text-muted-foreground">{t('projects.branchLabel')}</span><code className={code}>{info.branch}</code>{info.ahead ? <span className="text-muted-foreground">{plural(t, 'projects.unpushed', info.ahead)}</span> : null}</div>
        {files.length ? (
          <FileList>
            {files.slice(0, 5).map((f) => <FileRow key={f.path} icon={FILE_ICON[f.status] ?? FilePen} path={f.path} nums={f.add != null ? <Nums add={f.add} del={f.del} /> : null} />)}
            {files.length > 5 ? <div className="text-muted-foreground border-border border-t px-3 py-[9px] text-control">{t('projects.moreFiles', { n: files.length - 5 })}</div> : null}
          </FileList>
        ) : null}
        {last ? <p className="text-faint-foreground text-caption">{t('projects.lastCommit', { subject: last.subject, when: since(last.date, t) })}</p> : null}
        <Actions>
          {expert ? <Button variant="ghost" onClick={async () => { await act(call('projects.setActive', { name: p.name })); go('expert'); }} data-testid="project-see-changes">{t('projects.seeChanges')}</Button> : null}
          {info.remote ? <Button variant="outline" onClick={() => syncFlow(p, t, reload)} data-testid="project-sync"><ArrowDownUp />{t('projects.sync')}</Button> : null}
          {info.changes ? <Button onClick={() => commitFlow(p, t, reload)} data-testid="project-commit">{t('projects.commit.title')}</Button> : null}
        </Actions>
      </>)}
    </PjCard>
  );
}

const prState = (pr, t) => (pr.mergeable === 'CONFLICTING' ? { icon: CircleX, text: t('projects.prs.conflicts'), cls: 'text-warning-ink' } : pr.mergeable === 'MERGEABLE' ? { icon: Check, text: t('projects.prs.noConflicts'), cls: 'text-success' } : null);

async function createPrFlow(p, info, t, onDone) {
  const r = await form(t('projects.prs.create'), { description: t('projects.prs.createDesc', { branch: info.branch }), initial: { title: '', body: '' },
    body: (v, set) => (<>
      <Field label={t('projects.prs.createTitle')}><Input autoFocus value={v.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} /></Field>
      <Field label={t('projects.prs.createBody')}><Textarea value={v.body} onChange={(e) => set({ body: e.target.value })} rows={4} /></Field>
    </>),
    ok: t('projects.prs.create'), onOk: (v) => call('projects.createPr', { name: p.name, branch: info.branch, title: v.title.trim(), body: v.body }) });
  if (r) { notifyOk(t('projects.prs.created', { url: r.url })); onDone?.(); }
}

function PrsCard({ p, info, reload, onOpenGit }) {
  const t = useT();
  const prs = info?.prs ?? [];
  const github = info?.git && info.remote && /github\.com/i.test(info.remote);
  return (
    <PjCard icon={GitPullRequest} title={t('projects.prs.title')} data-testid="project-prs-card" aside={prs.length ? <Badge variant="info">{plural(t, 'projects.prs.open', prs.length)}</Badge> : null}>
      {!info ? <Spinner /> : !github ? <p className="text-muted-foreground text-control">{t('projects.prs.noGithub')}</p> : !prs.length ? <p className="text-muted-foreground text-control">{t('projects.prs.none')}</p> : prs.slice(0, 3).map((pr) => {
        const st = prState(pr, t);
        return (
          <div key={pr.number} className="flex flex-col gap-0.5 py-1.5">
            <b className="text-body font-medium">#{pr.number} {pr.title}</b>
            <span className="text-muted-foreground flex flex-wrap items-center gap-x-2.5 text-caption"><code className={code}>{pr.headRefName}</code>{pr.isDraft ? <Badge variant="secondary">{t('projects.prs.draft')}</Badge> : null}{st ? <span className={cn('inline-flex items-center gap-1', st.cls)}><st.icon className="size-3.5" />{st.text}</span> : null}</span>
          </div>
        );
      })}
      {github ? (
        <Actions>
          <Button variant="ghost" onClick={() => createPrFlow(p, info, t, reload)} data-testid="project-pr-create">{t('projects.prs.create')}</Button>
          {prs.length ? <Button variant="outline" onClick={() => bridge.openExternal(prs[0].url)}><ExternalLink />{t('projects.prs.view')}</Button> : null}
          {prs.length ? <Button onClick={onOpenGit}>{t('projects.tabs.git')}</Button> : null}
        </Actions>
      ) : null}
    </PjCard>
  );
}

// A disabled button says nothing on its own: when the PR's repository cannot be told, a bubble on its wrapper says why.
function NoRepoTip({ off, t, children }) {
  return off ? <BubbleTip title={t('projects.prs.noRepo')}><span className="inline-flex">{children}</span></BubbleTip> : children;
}

// a pull request with its checks, files and the actions on it. Merge asks first and goes with the exact commit the user saw.
function PrDetail({ p, pr: row, reload, onChanged }) {
  const t = useT();
  const watching = usePrWatch(p.name, row.number);
  const asks = usePrRequests(p.name, row.number);
  const [pr, setPr] = useState(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  // the repository is the one the PR's own URL names (what gh will act on), never the folder's remote or the project's name
  const repo = pr && !pr.error ? repoOfPr(pr.url) : null;
  useEffect(() => { let alive = true; setPr(null); call('projects.pr', { name: p.name, number: row.number }).then((r) => alive && setPr(r)).catch((e) => alive && setPr({ error: e.message })); return () => { alive = false; }; }, [p.name, row.number, row.headRefOid]);
  // Only a click on the button (and the confirmation) gets here. `busy` is raised before the dialog opens so a second click
  // cannot stack another one; a failure comes back as a notice (act) and the button is free again, with no retry.
  // The PR is read again just before asking, so the dialog names what is on GitHub now and the commit sent is the one it shows.
  const merge = async () => {
    if (busy || !repo) return;
    setBusy(true);
    try {
      const now = await act(call('projects.pr', { name: p.name, number: pr.number }));
      if (!now) return;
      const nowRepo = repoOfPr(now.url);
      if (!nowRepo) { notifyWarn(t('projects.prs.noRepo')); return; }
      setPr(now);
      if (!(await confirm(t('projects.prs.mergeTitle'), t('projects.prs.mergeBody', { repo: nowRepo, n: now.number, title: now.title, base: now.baseRefName }), { ok: t('projects.prs.mergeOk'), danger: true }))) return;
      if ((await act(call('projects.mergePr', { name: p.name, number: now.number, method: 'merge', headRefOid: now.headRefOid }), t('projects.prs.merged'))) !== undefined) { forgetInfo(p.name); reload(); onChanged?.(); }
    } finally { setBusy(false); }
  };
  // The exact text goes into the review step; nothing is published until «Publicar comentario». What is shown is what is sent.
  const send = async () => {
    const body = comment.trim();
    if (busy || !body || !repo) return;
    setBusy(true);
    try {
      if (!(await confirm(t('projects.prs.commentTitle'), t('projects.prs.commentBody', { repo, n: pr.number, text: body }), { ok: t('projects.prs.commentOk') }))) return;
      if ((await act(call('projects.prComment', { name: p.name, number: pr.number, body }), t('projects.prs.commented'))) !== undefined) setComment('');
    } finally { setBusy(false); }
  };
  // The task that already reviews this PR is opened; without one, a read-only review task is made (it never changes files).
  const reviewTask = async () => {
    const r = await act(call('projects.prReview', { name: p.name, number: row.number }), undefined);
    if (!r) return;
    if (r.created) notifyOk(t('projects.prs.reviewMade'));
    go({ view: 'tasks', id: r.id });
  };
  const checkIcon = (c) => (c.conclusion === 'SUCCESS' || c.conclusion === 'NEUTRAL' || c.conclusion === 'SKIPPED' ? [CircleCheck, 'text-success'] : c.conclusion ? [CircleX, 'text-destructive'] : [LoaderCircle, 'text-info animate-spin']);
  return (
    <Card className="gap-2 p-3.5" data-testid="project-pr-detail">
      {!pr ? <Spinner /> : pr.error ? <p className="text-destructive text-control">{pr.error}</p> : (<>
        <h3 className={cn(H3, 'flex items-center gap-2')}><span className="min-w-0 flex-1">{pr.title}</span><Badge variant={pr.state === 'MERGED' ? 'info' : pr.state === 'CLOSED' || pr.isDraft ? 'secondary' : 'success'} data-testid="project-pr-state">{pr.state === 'MERGED' ? t('projects.prs.stateMerged') : pr.state === 'CLOSED' ? t('projects.prs.stateClosed') : pr.isDraft ? t('projects.prs.draft') : t('projects.prs.stateOpen')}</Badge></h3>
        <p className="text-muted-foreground text-caption">#{pr.number}{pr.author ? ` · ${pr.author}` : ''} · {since(pr.createdAt, t)} · <code className={code}>{pr.headRefName}</code> → <code className={code}>{pr.baseRefName}</code>{watching && pr.state === 'OPEN' ? <> · <Badge variant="info" data-testid="project-pr-watching">{t('projects.prs.watching')}</Badge></> : null}</p>
        {asks.map((r) => <PrAsk key={r.id} r={r} project={p.name} number={pr.number} onDone={() => { reload(); onChanged?.(); }} />)}
        {watching && pr.state === 'OPEN' ? <p className="text-faint-foreground text-caption" data-testid="project-pr-watch-note">{t('projects.prs.watchNote')}</p> : null}
        {prState(pr, t) ? <span className={cn('inline-flex items-center gap-1 text-control', prState(pr, t).cls)}>{(() => { const I = prState(pr, t).icon; return <I className="size-3.5" />; })()}{prState(pr, t).text}</span> : null}
        <Actions>
          <Button variant="ghost" onClick={reviewTask} data-testid="project-pr-review">{t('projects.prs.reviewTask')}</Button>
          <Button variant="outline" onClick={() => bridge.openExternal(pr.url)}><ExternalLink />{t('projects.prs.openGh')}</Button>
          <NoRepoTip off={!repo} t={t}><Button disabled={busy || !repo || pr.state !== 'OPEN' || pr.isDraft || pr.mergeable === 'CONFLICTING'} onClick={merge} data-testid="project-pr-merge"><GitMerge />{t('projects.prs.merge', { base: pr.baseRefName })}</Button></NoRepoTip>
        </Actions>
        <h4 className={cn(H3, 'mt-2')}>{t('projects.prs.checks')}</h4>
        {pr.checks.length ? pr.checks.slice(0, 12).map((c, i) => { const [I, cls] = checkIcon(c); return <div key={`${c.name}${i}`} className="flex items-center gap-2 py-1 text-control"><I className={cn('size-3.5', cls)} /><span>{c.name}</span></div>; }) : <p className="text-muted-foreground text-control">{t('projects.prs.noChecks')}</p>}
        <h4 className={cn(H3, 'mt-2')}>{t('projects.prs.files')} <span className="text-faint-foreground text-caption font-normal">{pr.changedFiles}</span></h4>
        <FileList>
          {pr.files.slice(0, 6).map((f) => <FileRow key={f.path} path={f.path} nums={<Nums add={f.additions} del={f.deletions} />} />)}
          {pr.changedFiles > 6 ? <div className="text-muted-foreground border-border border-t px-3 py-[9px] text-control">{t('projects.moreFiles', { n: pr.changedFiles - 6 })}</div> : null}
        </FileList>
        {pr.changedFiles ? <Button variant="link" size="xs" className="text-info w-fit px-0" onClick={() => bridge.openExternal(`${pr.url}/files`)} data-testid="project-pr-files">{t('projects.prs.allFiles', { n: pr.changedFiles })}</Button> : null}
        <h4 className={cn(H3, 'mt-2')}>{t('projects.prs.thread')} <span className="text-faint-foreground text-caption font-normal">{pr.comments}</span></h4>
        {(pr.thread ?? []).map((c, i) => (
          <div key={i} className="border-border flex gap-2 border-t py-2 text-control first:border-t-0" data-testid="project-pr-thread">
            <div className="min-w-0"><b className="font-medium">{c.author || '?'}</b>{c.at ? <span className="text-faint-foreground"> · {since(c.at, t)}</span> : null}<p className="whitespace-pre-line break-words">{c.body}</p></div>
          </div>
        ))}
        <div className="mt-2 flex gap-2">
          <Input className="flex-1" value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} placeholder={t('projects.prs.commentPh')} aria-label={t('projects.prs.commentPh')} data-testid="project-pr-comment" />
          <NoRepoTip off={!repo} t={t}><Button disabled={busy || !repo || !comment.trim()} onClick={send}>{t('projects.prs.comment')}</Button></NoRepoTip>
        </div>
      </>)}
    </Card>
  );
}

function GitPanel({ p, info, reload }) {
  const t = useT();
  const prs = info?.prs ?? [];
  const [sel, setSel] = useState(null);
  const [filter, setFilter] = useState('open');
  const [counts, loadCounts] = usePrCounts(p.name, info);
  const { list, error } = usePrList(p.name, filter, info);
  // the open list falls back to the page's own read while the richer one loads or fails
  const shown = list ?? (filter === 'open' ? prs : []);
  const current = shown.find((x) => x.number === sel) ?? shown[0] ?? null;
  const github = info?.git && info.remote && /github\.com/i.test(info.remote);
  if (!info) return <Spinner />;
  if (!info.git) return <Note>{info.error ?? t('projects.noGit')}</Note>;
  return (
    <div className="flex flex-col gap-3">
      <div className="toolbar flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground text-control">{info.remote ? t('projects.prs.repo', { remote: repoOf(info.remote) ?? info.remote }) : t('projects.unpublished')} <code className={code}>{info.branch}</code></span>
        <span className="grow" />
        {info.remote ? <Button variant="outline" onClick={() => pushFlow(p, info, t, reload)} data-testid="project-push"><Upload />{t('projects.pushBtn')}</Button> : null}
        {info.remote ? <Button variant="outline" onClick={() => syncFlow(p, t, reload)} data-testid="project-panel-sync"><ArrowDownUp />{t('projects.sync')}</Button> : null}
        {info.remote ? (github ? <Button onClick={() => createPrFlow(p, info, t, reload)} data-testid="project-pr-create"><GitPullRequestCreate />{t('projects.prs.create')}</Button> : null)
          : <Button onClick={() => publishFlow(p, t, reload)} data-testid="project-publish"><Upload />{t('projects.publish.title')}</Button>}
      </div>
      {github ? (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex items-center gap-2"><h2 className={H3}>{t('projects.prs.title')}</h2></div>
            <PrFilter value={filter} onChange={(v) => { setFilter(v); setSel(null); }} counts={counts} />
            {error ? <Note data-testid="project-pr-error">{t('projects.prs.readFail', { detail: error })}</Note> : null}
            <ListCard>
              {list === null && filter !== 'open' ? <Spinner /> : shown.length ? shown.map((pr) => (
                <ListRow key={pr.number} selected={current?.number === pr.number} onClick={() => setSel(pr.number)} className="border-border rounded-none border-t first:border-t-0" data-testid="project-pr-row"
                  title={pr.title} meta={<span>#{pr.number} · <code className={code}>{pr.headRefName}</code>{pr.baseRefName ? <> → <code className={code}>{pr.baseRefName}</code></> : null}{pr.createdAt ? ` · ${since(pr.createdAt, t)}` : ''}</span>}
                  trailing={<>{filter === 'open' ? <PrChecksBadge s={pr.checksSummary} /> : <Badge variant={filter === 'merged' ? 'info' : 'secondary'}>{t(filter === 'merged' ? 'projects.prs.stateMerged' : 'projects.prs.stateClosed')}</Badge>}{pr.isDraft ? <Badge variant="secondary">{t('projects.prs.draft')}</Badge> : null}</>} />
              )) : <Empty icon={GitPullRequest} title={t(filter === 'open' ? 'projects.prs.none' : filter === 'merged' ? 'projects.prs.noneMerged' : 'projects.prs.noneClosed')} />}
            </ListCard>
            <p className="text-faint-foreground text-caption">{t('projects.prs.source')}</p>
          </div>
          <div className="min-w-0">{current ? <PrDetail key={current.number} p={p} pr={current} reload={reload} onChanged={() => loadCounts(true)} /> : <Card className="p-3.5"><Empty title={t('projects.prs.pick')} /></Card>}</div>
        </div>
      ) : <Note>{t('projects.prs.noGithub')}</Note>}
      <div className="flex items-center gap-2"><h2 className={H3}>{t('projects.prs.branches')}</h2><span className="text-faint-foreground text-caption">{info.branches?.length ?? 0}</span></div>
      <ListCard>
        {(info.branches ?? []).map((b) => {
          const pr = prs.find((x) => x.headRefName === b);
          return <ListRow key={b} className="border-border rounded-none border-t first:border-t-0" leading={<GitBranch className="text-muted-foreground size-3.5" />} title={<span className="font-mono">{b}</span>} meta={b === info.branch ? `${t('projects.branch')}${info.ahead ? ` ${plural(t, 'projects.unpushed', info.ahead)}` : ''}` : pr ? `PR #${pr.number}${pr.isDraft ? ` · ${t('projects.prs.draft')}` : ''}` : null} />;
        })}
      </ListCard>
    </div>
  );
}

// compact: the summary card's row, one line with the state at the end; the tab's row also names the agent and approves.
function TaskRow({ x, compact = false }) {
  const t = useT();
  return (
    <ListRow data-testid="project-task-row" className={cn('border-border rounded-none border-t first:border-t-0', compact && 'px-0 py-2')} leading={<AgentIcon agent={x.agent} className="size-4" />}
      title={`#${x.id} ${x.title}`} meta={compact ? null : (AGENT[x.agent] ?? x.agent)}
      trailing={<><TaskStatus task={x} board />{!compact && x.status === 'awaiting_approval' && !x.held ? <div className="acts flex shrink-0 items-center gap-1.5"><Button size="xs" variant="outline" onClick={() => rejectTask(x)}>{t('tasks.reject')}</Button><Button size="xs" onClick={() => approveTask(x)}>{t('tasks.approve.ok')}</Button></div> : null}</>} />
  );
}

function ChatRow({ x, assistant, compact = false }) {
  const t = useT();
  const pr = orbProgress(x, t, { assistant });
  return (
    <ListRow data-testid="project-chat-row" className={cn('border-border cursor-pointer rounded-none border-t first:border-t-0', compact && 'px-0 py-2')} onClick={() => openOrbItem(x)} leading={<AgentIcon agent={x.kind === 'session' ? x.agent : 'orb'} className="size-4" />}
      title={x.title} meta={<span className="inline-flex items-center gap-2">{pr?.text ? <span className="truncate">{pr.prefix ?? ''}{pr.text}</span> : null}</span>}
      trailing={pr?.badge ? <Badge variant="warning">{t('projects.chats.permission')}</Badge> : x.at ? <span className="text-faint-foreground text-caption">{since(x.at, t)}</span> : null} />
  );
}

export function ProjectPage({ p }) {
  const t = useT();
  const app = useStore((s) => s.app);
  const allTasks = useStore((s) => s.tasks);
  const icon = useStore((s) => s.projectIcons?.[p.name] ?? null);
  const allItems = useOrbItems();
  const [info, reload] = useProjectInfo(p.name);
  const [tab, setTab] = useState('resumen');
  const assistant = app.config?.assistantName ?? 'Orb';
  const expert = Boolean(app.config?.expert?.enabled);

  const items = useMemo(() => allItems.filter((x) => x.project === p.name).sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? ''))), [allItems, p.name]);
  const mine = useMemo(() => allTasks.filter((x) => x.project === p.name), [allTasks, p.name]);
  const active = mine.filter((x) => needsApproval(x) || x.status === 'running' || x.status === 'queued');
  const week = mine.filter((x) => Date.now() - new Date(x.updated_at).getTime() < WEEK);
  const prs = info?.prs ?? [];
  const rename = () => (p.open ? undefined : renameFlow(p, t, (name) => go({ view: 'projects', name })));

  // F2 renames, like in the sidebar's chats (never while typing).
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'F2' && !e.target.closest?.('input, textarea, [contenteditable], [role=dialog]')) { e.preventDefault(); rename(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const chatsN = t(items.length === 1 ? 'projects.chatsOne' : 'projects.chatsOther', { n: items.length });
  const tasksN = t(mine.length === 1 ? 'projects.tasksOne' : 'projects.tasksOther', { n: mine.length });
  const sep = <span className="text-faint-foreground">·</span>;
  const tabs = [
    ['resumen', LayoutDashboard, t('projects.tabs.summary'), null],
    ['chats', MessagesSquare, t('projects.tabs.chats'), items.length],
    ['tareas', ClipboardCheck, t('projects.tabs.tasks'), active.length],
    ['git', GitPullRequest, t('projects.tabs.git'), prs.length || null],
    ['bitacora', NotebookPen, t('projects.tabs.log'), null],
    ['pizarra', Presentation, t('projects.tabs.board'), null]
  ];

  return (
    <>
      {/* The right group (Abrir en…, pause, bell, ⋯) keeps its own width: with the bar's 150 px minimum it grew over the centre and cut the line under the title. */}
      <PageHeader className="[&.bar]:grid-cols-[minmax(max-content,1fr)_minmax(0,auto)_minmax(max-content,1fr)]!"
        title={<><button type="button" className="text-faint-foreground hover:text-foreground cursor-pointer" onClick={() => go('projects')} data-testid="project-back">{t('projects.title')} /</button> {p.name}</>}
        meta={<><ProjectIcon name={p.name} small /><span className="shrink-0">{t(`comp.projects.category.${p.category ?? 'other'}`)}</span>{sep}<span className="min-w-0 truncate" title={p.path} data-testid="project-path">{p.path}</span>{sep}<span className="shrink-0">{chatsN}</span>{sep}<span className="shrink-0">{tasksN}</span></>}>
        <ProjectOpenMenu project={p} page />
        <BarPause />
        <NotificationBell />
        <DropdownMenu modal={false}>
          <BubbleTip title={t('projects.moreOptions')}><DropdownMenuTrigger asChild><MoreButton label={t('projects.moreOptions')} data-testid="project-more" /></DropdownMenuTrigger></BubbleTip>
          <DropdownMenuContent align="end" className="w-72" data-testid="project-page-menu-list">
            <DropdownMenuItem onSelect={() => chatHereFlow(p)} data-testid="project-chat"><MessageSquarePlus />{t('projects.newChat')}</DropdownMenuItem>
            <DropdownMenuItem className="items-start" disabled={Boolean(p.open)} onSelect={rename} data-testid="project-rename"><PencilLine /><span>{t('projects.renameItem')}{p.open ? <><br /><span className="text-muted-foreground text-caption">{t('projects.rename.busy')}</span></> : null}</span>{p.open ? null : <Kbd className="ml-auto">F2</Kbd>}</DropdownMenuItem>
            <DropdownMenuItem disabled={Boolean(p.active)} onSelect={() => act(call('projects.setActive', { name: p.name }), t('projects.setActive.done', { name: p.name }))} data-testid="project-set-active"><Pin />{p.active ? t('projects.workNow') : t('projects.setActive')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={reload} data-testid="project-git-refresh"><RefreshCw />{t('projects.refresh')}</DropdownMenuItem>
            {expert ? <DropdownMenuItem onSelect={async () => { await act(call('projects.setActive', { name: p.name })); go('expert'); }} data-testid="project-expert-open"><SquareTerminal />{t('projects.expert.title')}</DropdownMenuItem> : null}
            <DropdownMenuItem onSelect={() => changeIconFlow(p, t)} data-testid="project-icon-change"><ImageIcon />{t('projects.icon.change')}</DropdownMenuItem>
            <DropdownMenuItem disabled={!p.category} title={p.category ? undefined : t('projects.category.linked')} onSelect={() => changeCategory(t, p, reload)} data-testid="project-change-category"><FolderTree />{t('projects.category.item')}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="items-start" onSelect={() => finishFlow(p, t).then((done) => done && go('projects'))} data-testid="project-finish"><CircleCheckBig /><span>{t('projects.finish.title')}<br /><span className="text-muted-foreground text-caption">{t('projects.finish.hint')}</span></span></DropdownMenuItem>
            {p.inHome ? <DropdownMenuItem className="items-start" variant="destructive" onSelect={() => deleteProjectFlow(p, t).then((done) => done && go('projects'))} data-testid="project-delete"><Trash2 /><span>{t('projects.delete.item')}<br /><span className="text-muted-foreground text-caption">{t('projects.delete.hint')}</span></span></DropdownMenuItem>
              : <DropdownMenuItem className="items-start" variant="destructive" onSelect={() => unlinkFlow(p, t)} data-testid="project-unlink"><Unlink /><span>{t('projects.unlink.ok')}<br /><span className="text-muted-foreground text-caption">{t('projects.unlink.hint')}</span></span></DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable] pt-5 pr-[calc(1.5rem-var(--sb-w))] pb-10 pl-6 md:pb-28">
        <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList variant="line" data-testid="project-tabs">
              {tabs.map(([id, Icon, label, n]) => <TabsTrigger key={id} value={id} data-testid={`project-tab-${id}`}><Icon />{label}{n ? <span className="text-faint-foreground">{n}</span> : null}</TabsTrigger>)}
              <span className="flex-1" />
              <Button onClick={() => chatHereFlow(p)} data-testid="project-new-chat"><MessageSquarePlus />{t('projects.newChat')}</Button>
            </TabsList>
          </Tabs>

          {tab === 'resumen' ? (
            <div className="grid items-start gap-4 lg:grid-cols-2" data-testid="project-summary">
              <div className="flex min-w-0 flex-col gap-4">
                {p.notes ? <p className="text-muted-foreground text-control" data-testid="project-intro">{p.notes}</p> : null}
                <GitCard p={p} info={info} reload={reload} expert={expert} />
                <PrsCard p={p} info={info} reload={reload} onOpenGit={() => setTab('git')} />
                <LogCard p={p} />
              </div>
              <div className="flex min-w-0 flex-col gap-4">
                <PjCard icon={ClipboardCheck} title={t('projects.tasks.active')} aside={<Button variant="link" size="xs" className="text-info text-control font-semibold" onClick={() => go({ view: 'tasks', project: p.name })}>{t('projects.tasks.all')}</Button>}>
                  {active.length ? <ListCard className="border-0">{active.slice(0, 3).map((x) => <TaskRow key={x.id} x={x} compact />)}</ListCard> : <p className="text-muted-foreground text-control">{t('projects.tasks.none')}</p>}
                  <p className="text-faint-foreground text-caption">{t('projects.tasks.week', { done: week.filter((x) => x.status === 'done' && !x.undone).length, undone: week.filter((x) => x.undone).length })}</p>
                  <Actions><Button variant="outline" onClick={() => go({ view: 'tasks', project: p.name })}><Plus />{t('projects.tasks.new')}</Button></Actions>
                </PjCard>
                <PjCard icon={MessagesSquare} title={t('projects.chats.recent')} aside={items.length > 4 ? <Button variant="link" size="xs" className="text-info text-control font-semibold" onClick={() => setTab('chats')}>{t('projects.chats.all', { n: items.length })}</Button> : null}>
                  {items.length ? <ListCard className="border-0">{items.slice(0, 4).map((x) => <ChatRow key={x.key} x={x} assistant={assistant} compact />)}</ListCard> : <p className="text-muted-foreground text-control">{t('projects.chats.none')}</p>}
                </PjCard>
                <PjCard icon={ImageIcon} title={t('projects.icon.title')}>
                  <div className="flex items-center gap-3">
                    <ProjectIcon name={p.name} size={48} big />
                    <div className="flex-1 text-control font-medium">{icon ? t('projects.icon.own') : t('projects.icon.dot')}</div>
                    {icon ? <Button variant="ghost" onClick={() => clearIconFlow(p, t)}>{t('projects.icon.clear')}</Button> : null}
                    <Button variant="outline" onClick={() => changeIconFlow(p, t)}>{t('projects.icon.change')}</Button>
                  </div>
                </PjCard>
              </div>
            </div>
          ) : null}

          {tab === 'chats' ? (
            <div>
              <div className="sec-h flex items-center gap-2"><h2 className={H3}>{t('projects.chats.title')}</h2><span className="text-faint-foreground text-caption">{items.length}</span></div>
              <ListCard className="mt-1.5">{items.length ? items.map((x) => <ChatRow key={x.key} x={x} assistant={assistant} />) : <Empty icon={MessagesSquare} title={t('projects.chats.none')} />}</ListCard>
            </div>
          ) : null}

          {tab === 'tareas' ? (
            <div className="flex flex-col gap-3">
              <div>
                <div className="sec-h flex items-center gap-2"><h2 className={H3}>{t('projects.tasks.active')}</h2><span className="text-faint-foreground text-caption">{active.length}</span><span className="grow" /><Button variant="link" size="xs" className="text-info text-control font-semibold" onClick={() => go({ view: 'tasks', project: p.name })}>{t('projects.tasks.all')}</Button></div>
                <ListCard className="mt-1.5">{active.length ? active.map((x) => <TaskRow key={x.id} x={x} />) : <Empty icon={ClipboardCheck} title={t('projects.tasks.none')} />}</ListCard>
              </div>
              <p className="text-faint-foreground text-caption">{t('projects.tasks.week', { done: week.filter((x) => x.status === 'done' && !x.undone).length, undone: week.filter((x) => x.undone).length })}</p>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <div className="inline-flex" data-testid="project-new-task-split">
                  <Button className="rounded-r-none" onClick={() => go({ view: 'tasks', project: p.name })} data-testid="project-new-task"><Plus />{t('projects.tasks.new')}</Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button className="border-primary-foreground/25 rounded-l-none border-l px-2" aria-label={t('projects.tasks.moreKinds')} data-testid="project-new-task-more"><ChevronDown /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-72" data-testid="project-new-task-menu">
                      <DropdownMenuItem className="items-start" onSelect={() => askReview({ project: p.name })} data-testid="project-review"><ScanSearch /><span>{t('projects.review')}<br /><span className="text-muted-foreground text-caption">{t('projects.reviewTip')}</span></span></DropdownMenuItem>
                      <DropdownMenuItem className="items-start" onSelect={() => askSecurityReview({ project: p.name })} data-testid="project-security"><ShieldCheck /><span>{t('projects.security')}<br /><span className="text-muted-foreground text-caption">{t('projects.securityTip')}</span></span></DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          ) : null}

          {tab === 'git' ? (<>
            <GitPanel p={p} info={info} reload={reload} />
            {/* Orb's own, not drawn by the mock-up: under «Más opciones», at the end of the tab. */}
            <div className="grid gap-3" data-testid="project-git-more"><h2 className={H3}>{t('settings.moreOptions')}</h2><GithubCard /><ContributionGraph /></div>
          </>) : null}
          {tab === 'bitacora' ? <LogCard p={p} full /> : null}

          {tab === 'pizarra' ? (
            <Card className="py-2.5"><Empty icon={Presentation} title={t('projects.board.title', { name: p.name })}>{t('projects.board.desc', { assistant })}
              <Button className="mt-3" onClick={async () => { await act(call('projects.setActive', { name: p.name })); go('board'); }} data-testid="project-board-open">{t('projects.board.open')}</Button></Empty></Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
