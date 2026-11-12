// The confirmation card of a pull-request merge or comment an agent asked for (orb_pr_merge / orb_pr_comment,
// src/engine/host/pr-tools.mjs). Only in this PC's window. Every string of the PR comes from the internet, so it is
// rendered as plain text (React text nodes), never as HTML or markdown.
import { useEffect, useRef, useState } from 'react';
import { GitPullRequest, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { call, act, bridge, fullPc } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';
import { quiet } from '@/lib/quiet.js';
import { cn } from '@/lib/utils.js';

// The answer names the request by everything the card showed, so a stale card cannot answer another request.
const refOf = (r) => ({ id: r.id, session: r.session, number: r.number, headRefOid: r.headRefOid ?? null });

function PrCard({ r }) {
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
  const accept = async () => { setBusy(true); try { await act(call('prConfirm.answer', refOf(r))); } finally { setBusy(false); } };
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
        <Button type="button" size="sm" variant="ghost" ref={declineRef} disabled={busy} onClick={() => act(call('prConfirm.decline', refOf(r)))} data-testid="pr-decline">{t('prcard.decline')}</Button>
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
