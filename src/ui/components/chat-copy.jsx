// A chat in the middle of its conversation moves to its own copy (a git worktree) and back (src/engine/chat-copy.mjs).
// - CopyBar: the fixed «Copia aparte · rama …» header (join, discard, open folder), «Deshacer la unión» and the conflict line;
// - MoveToCopyDialog: the list of what moves, always shown before the chat is moved; it opens from ⋯, Ctrl+K, the small button
//   by the box, or by itself when the engine says a switch asked for during a turn (or proposed by the agent) is ready;
// - CopyAskCards: the agent's proposal «¿Lo hago en una copia aparte?». Only this PC's window.
import { useCallback, useEffect, useState } from 'react';
import { GitBranch, GitMerge, FolderOpen, Trash2, Undo2, FolderOutput, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle, DialogDescription, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, BubbleTip } from '@/components/ui/overlay.jsx';
import { confirm } from '@/components/dialogs.jsx';
import { call, act, bridge, fullPc } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';
import { quiet } from '@/lib/quiet.js';
import { cn } from '@/lib/utils.js';

export const COPY_MOVE_EVENT = 'orb:copy-move';
// Opens the list of what moves for chat `id` (any component or the palette may ask).
export const askMoveToCopy = (id, opts = {}) => window.dispatchEvent(new CustomEvent(COPY_MOVE_EVENT, { detail: { id: String(id), ...opts } }));

// What the header shows for a chat: where it works, whether a join can be undone. Reloaded when the chat changes folder.
export function useCopyState(id, version) {
  const [state, setState] = useState({ where: null });
  const reload = useCallback(() => call('copy.state', { id: String(id) }).then(setState).catch((e) => { quiet(e); setState({ where: null }); }), [id]);
  useEffect(() => { if (fullPc()) reload(); }, [reload, version]);
  return [state, reload];
}

const shown = (list) => (list ?? []).map((p) => (typeof p === 'string' ? p : p.path));

export function MoveToCopyDialog({ sessionId, onMoved }) {
  const t = useT();
  const [open, setOpen] = useState(null); // { proceed }
  const [plan, setPlan] = useState(null);
  const [mixed, setMixed] = useState('leave');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const on = (e) => { if (String(e.detail?.id) === String(sessionId)) { setPlan(null); setMixed('leave'); setOpen({ proceed: e.detail.proceed === true }); } };
    window.addEventListener(COPY_MOVE_EVENT, on);
    const off = bridge.on('copy:ready', (r) => { if (String(r?.id) === String(sessionId)) askMoveToCopy(sessionId, { proceed: r.proceed === true }); });
    return () => { window.removeEventListener(COPY_MOVE_EVENT, on); off(); };
  }, [sessionId]);
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    call('copy.preview', { id: String(sessionId) }).then((p) => { if (alive) setPlan(p); }).catch((e) => { quiet(e); if (alive) setPlan({ ok: false, message: String(e?.message ?? e) }); });
    return () => { alive = false; };
  }, [open, sessionId]);
  // closing without moving also frees what waited for the turn (a queued message goes on)
  const close = () => { setOpen(null); setPlan(null); call('copy.cancelWait', { id: String(sessionId) }).catch(quiet); };
  const go = async () => {
    setBusy(true);
    try {
      const out = await act(call('copy.toCopy', { id: String(sessionId), fingerprint: plan.fingerprint, mixed: plan.mixedTotal ? mixed : undefined, ack: true, proceed: open.proceed }));
      if (out) { setOpen(null); setPlan(null); onMoved?.(); }
    } finally { setBusy(false); }
  };
  const files = shown(plan?.files); const others = shown(plan?.others); const mix = shown(plan?.mixed);
  return (
    <Dialog open={Boolean(open)} onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent size="md" data-testid="copy-move-dialog">
        <DialogHeader><DialogTitle>{t('copy.moveTitle')}</DialogTitle><DialogDescription>{t('copy.moveLead')}</DialogDescription></DialogHeader>
        <DialogBody className="grid gap-3 text-control">
          {!plan ? <p className="text-muted-foreground">{t('copy.reading')}</p> : plan.ok === false ? <p data-testid="copy-refused">{plan.message}</p> : <>
            <List title={t('copy.files', { n: plan.filesTotal })} list={files} total={plan.filesTotal} empty={t('copy.noFiles')} testid="copy-files" />
            {plan.mixedTotal ? <div className="grid gap-1.5" data-testid="copy-mixed">
              <List title={t('copy.mixed')} list={mix} total={plan.mixedTotal} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={mixed === 'take' ? 'default' : 'outline'} onClick={() => setMixed('take')} data-testid="copy-mixed-take">{t('copy.mixedTake')}</Button>
                <Button size="sm" variant={mixed === 'leave' ? 'default' : 'outline'} onClick={() => setMixed('leave')} data-testid="copy-mixed-leave">{t('copy.mixedLeave')}</Button>
              </div>
            </div> : null}
            {plan.othersTotal ? <List title={t('copy.others')} list={others} total={plan.othersTotal} testid="copy-others" /> : null}
            {plan.stay?.ignoredTotal + plan.stay?.secretTotal > 0 ? <p className="text-muted-foreground text-xs" data-testid="copy-stay">{t('copy.stay', { n: plan.stay.ignoredTotal + plan.stay.secretTotal })}</p> : null}
            {plan.stagedTotal ? <p className="text-warning-ink flex items-start gap-1.5 text-xs" data-testid="copy-staged"><TriangleAlert className="mt-px size-3.5 shrink-0" />{t('copy.staged')}</p> : null}
          </>}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={close} data-testid="copy-cancel">{t('copy.cancel')}</Button>
          {plan?.ok ? <Button disabled={busy} onClick={go} data-testid="copy-go">{plan.othersTotal ? t('copy.continue') : t('copy.go')}</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function List({ title, list, total, empty, testid }) {
  return (
    <div className="grid gap-1" data-testid={testid}>
      <div className="font-medium">{title}</div>
      {list.length ? <ul className="bg-muted max-h-40 overflow-auto rounded-md p-2 text-xs">{list.map((p) => <li key={p} className="truncate"><bdi>{p}</bdi></li>)}{total > list.length ? <li className="text-muted-foreground">{`+${total - list.length}`}</li> : null}</ul> : empty ? <p className="text-muted-foreground text-xs">{empty}</p> : null}
    </div>
  );
}

// The header of a chat that works in a copy, «Deshacer la unión» after a join and the conflict line.
export function CopyBar({ s, running, onChanged }) {
  const t = useT();
  const [state, reload] = useCopyState(s.id, `${s.cwd}|${s.updated_at}`);
  const [conflicts, setConflicts] = useState([]);
  const changed = () => { reload(); onChanged?.(); };
  if (!fullPc() || !state.where) return null;
  const merge = async () => {
    const out = await act(call('copy.merge', { id: s.id }));
    if (out && out.ok === false) setConflicts(out.conflicts ?? []); else setConflicts([]);
    changed();
  };
  const resolve = async () => { const out = await act(call('copy.resolve', { id: s.id })); if (out) setConflicts([]); changed(); };
  const discard = async () => {
    if (!(await confirm(t('copy.discardTitle'), t('copy.discardBody'), { ok: t('copy.discardOk'), cancel: t('copy.discardKeep'), danger: true }))) return;
    await act(call('copy.discard', { id: s.id, confirm: true })); changed();
  };
  const undo = async () => { await act(call('copy.undoMerge', { id: s.id })); changed(); };
  return (
    <div className="mx-auto flex w-full max-w-[calc(var(--chat-max-width)+2.5rem)] shrink-0 flex-wrap items-center gap-2 px-5 pb-1.5 text-xs" data-testid="copy-bar">
      {state.where === 'copy' ? (
        <DropdownMenu modal={false}>
          <BubbleTip title={t('chat.workspace.worktreeHelp')} text={t('chat.workspace.worktreeTip')} side="bottom">
            <DropdownMenuTrigger asChild>
              <Button size="xs" variant="outline" className="max-w-full min-w-0 font-normal" data-testid="copy-pill"><GitBranch /><span className="truncate">{t('copy.pill', { branch: state.branch ?? '' })}</span></Button>
            </DropdownMenuTrigger>
          </BubbleTip>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem disabled={running} onSelect={merge} data-testid="copy-merge"><GitMerge />{t('copy.merge')}</DropdownMenuItem>
            <DropdownMenuItem disabled={running} onSelect={discard} data-testid="copy-discard"><Trash2 />{t('copy.discard')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => act(bridge.openPath(state.path))} data-testid="copy-open"><FolderOpen />{t('copy.openFolder')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {state.undo ? <>
        <span className="text-muted-foreground" data-testid="copy-joined">{t('copy.joined')}</span>
        <Button size="xs" variant="ghost" disabled={running} onClick={undo} data-testid="copy-undo"><Undo2 />{t('copy.undoJoin')}</Button>
      </> : null}
      {conflicts.length ? <div className="text-warning-ink flex w-full flex-wrap items-center gap-2" data-testid="copy-conflict">
        <span>{t('copy.conflict')}</span>
        <Button size="xs" variant="outline" disabled={running} onClick={resolve} data-testid="copy-resolve">{t('copy.resolve')}</Button>
      </div> : null}
    </div>
  );
}

// The small button where the Local / Copia aparte switch was, for a chat that works in the project's folder; with the agent
// working it waits for the end of the turn.
export function MoveToCopyButton({ s, running }) {
  const t = useT();
  const [state] = useCopyState(s.id, `${s.cwd}|${s.updated_at}`);
  if (!fullPc() || state.where !== 'local') return null;
  const click = async () => {
    if (!running) { askMoveToCopy(s.id); return; }
    await act(call('copy.wait', { id: s.id }));
  };
  return (
    <BubbleTip title={t('copy.menuMove')} text={state.blocked ?? t('copy.moveTip')} side="top">
      <Button size="xs" variant="ghost" className="text-faint-foreground px-1.5 font-normal" disabled={state.waiting || Boolean(state.blocked)} onClick={click} data-testid="copy-move-button"><FolderOutput />{running || state.waiting ? t('copy.afterTurn') : t('copy.menuMove')}</Button>
    </BubbleTip>
  );
}
// The agent's proposal.
export function CopyAskCards({ sessionId }) {
  const t = useT();
  const [list, setList] = useState([]);
  useEffect(() => {
    if (!fullPc()) return undefined;
    let alive = true; setList([]);
    const mine = (r) => r?.session === String(sessionId);
    call('copyAsk.pending').then((all) => { if (alive) setList((all ?? []).filter(mine)); }).catch(quiet);
    const offAsk = bridge.on('copy:request', (r) => { if (mine(r)) setList((prev) => [...prev.filter((x) => x.id !== r.id), r]); });
    const offDone = bridge.on('copy:done', (r) => setList((prev) => prev.filter((x) => x.id !== r?.id)));
    return () => { alive = false; offAsk(); offDone(); };
  }, [sessionId]);
  if (!list.length) return null;
  const answer = (r, method) => act(call(method, { id: r.id, session: r.session })).then(() => setList((prev) => prev.filter((x) => x.id !== r.id)));
  return (
    <div className="mx-auto grid w-full max-w-3xl shrink-0 gap-2 px-5 pb-2">
      {list.map((r) => (
        <div key={r.id} role="group" aria-label={t('copy.askTitle')} className="bg-card grid gap-2.5 rounded-xl border px-3.5 py-3 text-control" data-testid="copy-ask-card">
          <div className="flex items-center gap-2 font-medium"><GitBranch className="text-muted-foreground size-4 shrink-0" />{t('copy.askTitle')}</div>
          {r.reason ? <p className={cn('text-muted-foreground text-xs')} data-testid="copy-ask-reason"><bdi>{r.reason}</bdi></p> : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => answer(r, 'copyAsk.decline')} data-testid="copy-ask-no">{t('copy.askNo')}</Button>
            <Button type="button" size="sm" onClick={() => answer(r, 'copyAsk.answer')} data-testid="copy-ask-yes">{t('copy.askYes')}</Button>
          </div>
        </div>
      ))}
    </div>
  );
}
