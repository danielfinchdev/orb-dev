// The confirmation card of a pull-request merge or comment an agent asked for (orb_pr_merge / orb_pr_comment,
// src/engine/host/pr-tools.mjs). Only in this PC's window. Every string of the PR comes from the internet, so it is
// rendered as plain text (React text nodes), never as HTML or markdown.
import { useEffect, useRef, useState } from 'react';
import { GitPullRequest, ShieldAlert, MessageSquareWarning, GitMerge, Radar, ExternalLink, ChevronDown, CircleCheck, GitBranch, Users, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Switch, BubbleTip } from '@/components/ui/overlay.jsx';
import { ProjectIcon } from '@/components/project-icon.jsx';
import { call, act, bridge, fullPc } from '@/lib/store.js';
import { useT, useLocale } from '@/lib/i18n.js';
import { quiet } from '@/lib/quiet.js';
import { cn } from '@/lib/utils.js';

// The answer names the request by everything the card showed, so a stale card cannot answer another request.
export const refOf = (r) => ({ id: r.id, session: r.session, number: r.number, headRefOid: r.headRefOid ?? null });

// onDone: where the card is shown beside a PR (the project page), to reload once an answer went.
export function PrCard({ r, onDone }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const comment = r.kind === 'comment';
  // Merging is the dangerous action; the engine may send danger / focusCancel to override these defaults.
  const danger = r.danger ?? !comment;
  const focusCancel = r.focusCancel ?? danger;
  const declineRef = useRef(null);
  // Focus «Reject» on arrival, but never steal the focus from a text field: the user may be typing and the next
  // Enter or Space must not answer a card they have not read.
  useEffect(() => {
    const a = document.activeElement;
    const typing = a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
    if (focusCancel && !typing) declineRef.current?.focus();
  }, [focusCancel]);
  const checks = Array.isArray(r.checks) ? r.checks.slice(0, 30) : [];
  const accept = async () => { setBusy(true); try { const out = await act(call('prConfirm.answer', refOf(r))); if (out !== undefined) onDone?.(r, 'prConfirm.answer'); } finally { setBusy(false); } };
  const decline = async () => { setBusy(true); try { const out = await act(call('prConfirm.decline', refOf(r))); if (out !== undefined) onDone?.(r, 'prConfirm.decline'); } finally { setBusy(false); } };
  return (
    <div role="group" aria-label={t('prcard.group', { number: r.number })} className={cn('bg-card grid gap-2.5 rounded-xl border px-3.5 py-3 text-control', danger && 'border-warning/50')} data-testid="pr-card">
      <div className="flex items-center gap-2 font-medium">
        <GitPullRequest className="text-muted-foreground size-4 shrink-0" />
        {comment ? t('prcard.titleComment') : t('prcard.titleMerge', { method: r.method })}
      </div>
      <div className="grid gap-1">
        <div data-testid="pr-title"><bdi>{r.project}</bdi> #{r.number} · <bdi>{r.title}</bdi></div>
        <div className="text-muted-foreground text-xs"><bdi>{r.headRefName}</bdi> → <bdi>{r.baseRefName}</bdi> · <code title={r.headRefOid ?? undefined}>{String(r.headRefOid ?? '').slice(0, 7)}</code></div>
        <div className="text-muted-foreground text-xs">{t('prcard.stats', { add: r.additions ?? 0, del: r.deletions ?? 0, files: r.changedFiles ?? 0 })} · {r.mergeStateStatus}</div>
      </div>
      {checks.length ? (
        <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 text-xs" data-testid="pr-checks">
          <span className="font-medium">{t('prcard.checks')}</span>
          {checks.map((c, i) => <span key={i}><bdi>{c.name}</bdi>: {c.conclusion ?? c.status ?? '?'}</span>)}
        </div>
      ) : null}
      {comment ? <pre className="bg-muted max-h-48 overflow-auto whitespace-pre-wrap rounded-md p-2 text-xs" data-testid="pr-body">{r.body}</pre> : null}
      {danger ? <p className="text-warning-ink flex items-start gap-1.5 text-xs font-medium" data-testid="pr-danger"><ShieldAlert className="mt-px size-3.5 shrink-0" />{t('prcard.dangerNote')}</p> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" ref={declineRef} disabled={busy} onClick={decline} data-testid="pr-decline">{t('prcard.decline')}</Button>
        <Button type="button" size="sm" className={cn(danger && 'ring-warning/60 ring-2 ring-offset-1')} disabled={busy} onClick={accept} data-testid="pr-accept">{comment ? t('prcard.acceptComment') : t('prcard.acceptMergeMethod', { method: r.method })}</Button>
      </div>
    </div>
  );
}

// The requests of one conversation waiting for an answer.
export function PrCards({ sessionId }) {
  const [list, setList] = useState([]);
  useEffect(() => {
    if (!fullPc()) return undefined;
    let alive = true;
    setList([]);
    const mine = (r) => r?.session === String(sessionId);
    call('prConfirm.pending').then((all) => { if (alive) setList((all ?? []).filter(mine)); }).catch(quiet);
    const offAsk = bridge.on('pr:request', (r) => { if (mine(r)) setList((prev) => [...prev.filter((x) => x.id !== r.id), r]); });
    const offDone = bridge.on('pr:done', (r) => setList((prev) => prev.filter((x) => x.id !== r?.id)));
    return () => { alive = false; offAsk(); offDone(); };
  }, [sessionId]);
  if (!list.length) return null;
  return <div className="mx-auto grid w-full max-w-3xl shrink-0 gap-2 px-5 pb-2">{list.map((r) => <PrCard key={r.id} r={r} />)}</div>;
}

// The pull request of this chat's branch (what the panel's «PR» tab and its title are made of): the open one, else the
// newest merged or closed one, so the tab does not vanish when the PR is done. Only this PC's window.
const DEFAULT_BRANCHES = new Set(['main', 'master']);
// what projects.branchPr answered for a chat and a branch, so a refresh of the chat does not ask again
const lastPrs = new Map();
export function usePr(session) {
  const [pr, setPr] = useState(null);
  const project = session?.project;
  useEffect(() => {
    if (!fullPc() || !project || session.kind !== 'chat') return undefined;
    let alive = true; setPr(null);
    call('projects.info', { name: project }).then(async (info) => {
      const open = (info?.prs ?? []).find((p) => p.headRefName === info.branch) ?? null;
      if (open || !info?.branch || info.branch === 'HEAD' || !info.remote) { if (alive) setPr(open); return; }
      // The repository's own branch never shows its old PRs as «this chat's»; any other branch is asked about once per chat
      // (gh missing or offline: just no tab).
      if (DEFAULT_BRANCHES.has(info.branch)) { if (alive) setPr(null); return; }
      const key = `${session.id}:${info.branch}`;
      if (!lastPrs.has(key)) lastPrs.set(key, await call('projects.branchPr', { name: project, branch: info.branch }).catch(() => null));
      if (alive) setPr(lastPrs.get(key));
    }).catch(quiet);
    return () => { alive = false; };
  }, [project, session?.id, session?.kind]);
  return pr;
}

// how long ago, in the user's language
function ago(iso, locale) {
  const ms = Date.parse(iso ?? ''); if (Number.isNaN(ms)) return '';
  const min = Math.round((Date.now() - ms) / 60000); const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (min < 60) return rtf.format(-Math.max(min, 0), 'minute');
  if (min < 60 * 24) return rtf.format(-Math.round(min / 60), 'hour');
  return rtf.format(-Math.round(min / 1440), 'day');
}
const PASSED = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const FAILED = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR']);
function checksOf(list) {
  const ok = list.filter((c) => PASSED.has(c.conclusion) || c.status === 'SUCCESS').length;
  const bad = list.filter((c) => FAILED.has(c.conclusion) || FAILED.has(c.status)).length;
  return { n: list.length, ok, bad, running: list.length - ok - bad };
}

// The «PR» tab: gathers what is pending into the chat («Arreglar comentarios», «Arreglar conflictos») and has «Vigilar la CI»
// as a row of its list with its switch (engine/scheduler/ci-watch.mjs: it never merges). Every string comes from the
// internet, so it is plain text (React text nodes), never markup. Only this PC's window.
export function PrPanel({ session, pr }) {
  const t = useT();
  const locale = useLocale();
  const [detail, setDetail] = useState(null);
  const [watch, setWatch] = useState(null);
  const [busy, setBusy] = useState(false);
  const [bodyOpen, setBodyOpen] = useState(true);
  const project = session?.project;
  useEffect(() => {
    if (!fullPc() || !project || !pr) return undefined;
    let alive = true; setDetail(null);
    call('projects.pr', { name: project, number: pr.number }).then((d) => { if (alive) setDetail(d); }).catch(quiet);
    return () => { alive = false; };
  }, [project, pr?.number]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!fullPc() || !project) return undefined;
    let alive = true;
    const load = () => call('ciWatch.list').then((all) => { if (alive) setWatch((all ?? []).find((w) => w.session === String(session.id)) ?? null); }).catch(quiet);
    load();
    const off = bridge.on('ciwatch:changed', load);
    return () => { alive = false; off(); };
  }, [project, session?.id]);
  if (!pr) return null;
  const fix = async (kind) => {
    setBusy(true);
    try { await act(call('projects.prFix', { session: String(session.id), number: pr.number, kind }), t('prbar.sent')); } finally { setBusy(false); }
  };
  const toggle = async (on) => {
    const r = await act(call('ciWatch.set', { session: String(session.id), number: pr.number, on }), on ? t('prbar.watchOn') : t('prbar.watchOff'));
    if (r) setWatch(on ? { session: String(session.id), number: pr.number, attempts: 0, max: 3 } : null);
  };
  const d = detail ?? pr;
  const state = d.state === 'MERGED' ? 'merged' : d.state === 'CLOSED' ? 'closed' : d.isDraft ? 'draft' : 'open';
  const checks = checksOf(Array.isArray(detail?.checks) ? detail.checks : []);
  const checksText = !detail ? '…' : !checks.n ? t('panel.pr.checksNone') : checks.bad ? t('panel.pr.checksFail', { ...checks, bad: checks.bad }) : checks.running ? t('panel.pr.checksRun', checks) : t('panel.pr.checksOk', checks);
  const checksTone = checks.bad ? 'text-destructive' : checks.running || !checks.n ? 'text-muted-foreground' : 'text-success';
  const reviewers = Array.isArray(detail?.reviewers) ? detail.reviewers : [];
  const commentCount = Number(detail?.comments) || 0;
  // «Arreglar conflictos» only waits when GitHub says there are none; unknown (not read yet, or still computing) leaves it on
  const noConflicts = (detail?.mergeable ?? pr.mergeable) === 'MERGEABLE';
  // a merged or closed PR has nothing left to fix or to watch
  const over = state === 'merged' || state === 'closed';
  const dt = 'text-muted-foreground flex items-center gap-1.5 whitespace-nowrap [&_svg]:size-3.5';
  return (
    <section className="grid gap-0" data-testid="pr-bar" role="group" aria-label={t('prbar.pr', { number: pr.number, n: pr.number })}>
      <h2 className="mb-2 font-(family-name:--title) text-[16px] leading-[1.35] font-semibold" data-testid="pr-title"><bdi>{d.title}</bdi></h2>
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-1 text-control">
        {d.author ? <><ProjectIcon name={d.author} size={18} /><b className="text-foreground font-medium"><bdi>{d.author}</bdi></b> ·</> : null}
        {d.createdAt || d.updatedAt ? <><span>{ago(d.createdAt ?? d.updatedAt, locale)}</span> ·</> : null}
        <span className={cn('inline-flex items-center gap-1', state === 'merged' && 'text-primary-text font-medium')}>{state === 'merged' ? <GitMerge className="size-3.5" /> : <GitPullRequest className="size-3.5" />}{t(`panel.pr.${state}`)}</span>
        {d.url ? <BubbleTip title={t('panel.pr.openGithub')}><button type="button" className="text-info focus-visible:outline-ring ml-auto inline-flex cursor-pointer items-center gap-1 rounded-sm hover:underline focus-visible:outline-2" onClick={() => bridge.openExternal(d.url)} data-testid="pr-open-github"><ExternalLink className="size-3.5" />{t('panel.pr.github')}</button></BubbleTip> : null}
      </div>
      <dl className="my-4 grid grid-cols-[minmax(120px,max-content)_1fr] items-center gap-x-2.5 gap-y-[9px] text-control">
        <dt className={dt}><GitBranch />{t('panel.pr.branch')}</dt>
        <dd className="m-0 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1"><code className="whitespace-nowrap"><bdi>{d.headRefName}</bdi></code>{d.baseRefName ? <> → <code className="whitespace-nowrap"><bdi>{d.baseRefName}</bdi></code></> : null}
          {detail ? <><span className="text-success">+{detail.additions}</span> <span className="text-destructive">−{detail.deletions}</span></> : null}</dd>
        <dt className={dt}><Users />{t('panel.pr.reviewers')}</dt>
        <dd className="m-0 min-w-0" data-testid="pr-reviewers">{!detail ? '…' : reviewers.length ? <bdi>{reviewers.join(', ')}</bdi> : t('panel.pr.reviewersNone')}{detail?.reviewDecision ? <span className="text-muted-foreground"> · {t(`panel.pr.${detail.reviewDecision}`)}</span> : null}</dd>
        <dt className={dt}><MessageSquare />{t('panel.pr.comments')}</dt>
        <dd className="m-0" data-testid="pr-comments">{!detail ? '…' : commentCount ? t(commentCount === 1 ? 'panel.pr.commentsOne' : 'panel.pr.commentsMany', { n: commentCount }) : t('panel.pr.commentsNone')}</dd>
        <dt className={dt}><CircleCheck />{t('panel.pr.checks')}</dt>
        <dd className={cn('m-0 flex items-center gap-1.5', checksTone)} data-testid="pr-checks">{checks.n && !checks.bad && !checks.running ? <CircleCheck className="size-3.5" /> : null}{checksText}</dd>
        {over ? null : <>
        <dt className={dt}><BubbleTip title={t('prbar.watch')} text={t('prbar.watchTip')} side="left"><span className="inline-flex items-center gap-1.5"><Radar />{watch ? t('prbar.watching', { attempts: watch.attempts, max: watch.max }) : t('prbar.watch')}</span></BubbleTip></dt>
        <dd className="m-0"><Switch checked={Boolean(watch)} onCheckedChange={toggle} aria-label={t('prbar.watch')} data-testid="pr-watch" /></dd></>}
      </dl>
      {over ? <div className="border-y" /> : (
      <div className="flex flex-wrap gap-1.5 border-y py-3">
        <BubbleTip title={t('prbar.fixComments')} text={t('prbar.fixTip')}><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => fix('comments')} data-testid="pr-fix-comments"><MessageSquareWarning />{t('prbar.fixComments')}</Button></BubbleTip>
        <BubbleTip title={t('prbar.fixConflicts')} text={t('prbar.fixTip')}><Button type="button" size="sm" variant="outline" disabled={busy || noConflicts} onClick={() => fix('conflicts')} data-testid="pr-fix-conflicts"><GitMerge />{t('prbar.fixConflicts')}</Button></BubbleTip>
      </div>
      )}
      <button type="button" className="focus-visible:outline-ring mt-[18px] mb-1.5 flex w-full cursor-pointer items-center gap-1.5 text-left font-(family-name:--title) text-[15px] font-semibold focus-visible:outline-2" aria-expanded={bodyOpen} onClick={() => setBodyOpen(!bodyOpen)}>
        {t('panel.pr.description')}<ChevronDown className={cn('text-muted-foreground size-3.5 transition-transform duration-200', !bodyOpen && '-rotate-90')} />
      </button>
      {bodyOpen ? <p className="m-0 text-control leading-[1.6] whitespace-pre-wrap" data-testid="pr-body"><bdi>{detail ? (detail.body?.trim() || t('panel.pr.noDescription')) : '…'}</bdi></p> : null}
      <p className="text-faint-foreground mt-1.5 text-xs">{t('panel.pr.note')}</p>
    </section>
  );
}
