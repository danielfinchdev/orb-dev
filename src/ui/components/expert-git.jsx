// The git panel of God mode: unsaved changes with a box per file, the message and «Guardar cambios (N)», the branches and
// «Traer cambios». Saving, pushing and bringing changes in are the same calls and flows the project page uses (commit with
// chosen files, `pushFlow`, `syncFlow`), with their own checks and confirmations; switching branch, a new branch and undoing
// the last unpublished save are the engine's `expert.*` methods, which never discard anything.
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, CloudDownload, CloudUpload, GitBranch, GitCommitHorizontal, Plus, Undo2, CircleCheck } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Checkbox, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/overlay.jsx';
import { Field, Input, Textarea, Spinner } from '@/components/ui/basic.jsx';
import { IconButton, MoreButton } from '@/components/ui/primitives.jsx';
import { confirm, form } from '@/components/dialogs.jsx';
import { pushFlow } from '@/components/project-flows.jsx';
import { syncFlow } from '@/components/project-sync.jsx';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { call, act } from '@/lib/store.js';
import { notifyOk, notifyWarn } from '@/lib/notify.js';
import { forgetInfo } from '@/lib/use-project-info.js';
import { cn } from '@/lib/utils.js';
import { quiet } from '@/lib/quiet.js';
import { t, useT } from '@/lib/i18n.js';

// Branches of the project (read again when `version` changes): { name, current, date, upstream }.
export function useBranches(project, version) {
  const [list, setList] = useState(null);
  useEffect(() => { let alive = true; call('expert.branches', { project }).then((r) => alive && setList(r.branches ?? [])).catch(() => alive && setList([])); return () => { alive = false; }; }, [project, version]);
  return list;
}

// What «Guardar cambios» can save: the very list of the project page's dialog (projects.commitFiles), one entry per file (a new
// folder comes with its files), so what is ticked is exactly what is saved.
function useCommitFiles(project, version) {
  const [list, setList] = useState(null);
  useEffect(() => { let alive = true; call('projects.commitFiles', { name: project }).then((r) => alive && setList(r)).catch(() => alive && setList([])); return () => { alive = false; }; }, [project, version]);
  return list;
}

// The last save and whether it can still be undone ({ canUndo, reason, hash, short, subject }).
function useLastCommit(project, version) {
  const [last, setLast] = useState(null);
  useEffect(() => { let alive = true; call('expert.lastCommit', { project }).then((r) => alive && setLast(r)).catch(() => alive && setLast(null)); return () => { alive = false; }; }, [project, version]);
  return last;
}

// Switching needs a tree with nothing unsaved: it is said here first, and the engine checks it again.
export async function switchFlow(project, branch, from, dirty, reload) {
  if (dirty) { notifyWarn(t('expert.git.switchDirty')); return; }
  if (!(await confirm(t('expert.git.switchTitle'), t('expert.git.switchBody', { branch, from }), { ok: t('expert.git.switchOk') }))) return;
  const r = await act(call('expert.switchBranch', { project, branch }));
  if (r) { notifyOk(t('expert.git.switchDone', { branch })); forgetInfo(project); reload(); }
}

export async function newBranchFlow(project, reload) {
  const r = await form(t('expert.git.newTitle'), { description: t('expert.git.newDesc'), initial: { name: '', switch: true },
    body: (v, set) => (<>
      <Field label={t('expert.git.newName')}><Input autoFocus value={v.name} onChange={(e) => set({ name: e.target.value })} maxLength={255} placeholder={t('expert.git.newPh')} data-testid="expert-git-newname" /></Field>
      <label className="flex cursor-pointer items-center gap-2 text-control"><Checkbox checked={v.switch} onCheckedChange={(c) => set({ switch: c === true })} />{t('expert.git.newSwitch')}</label>
    </>),
    okDisabled: (v) => !v.name.trim(), ok: t('expert.git.newOk'),
    onOk: (v) => call('expert.createBranch', { project, name: v.name.trim(), switch: v.switch }) });
  if (r) { notifyOk(t('expert.git.newDone', { branch: r.branch })); forgetInfo(project); reload(); }
}

// The dialog names the save that goes back to the tree; the hash goes with the call so a newer save is never undone by mistake.
async function undoFlow(project, last, reload) {
  if (!last?.canUndo) return;
  if (!(await confirm(t('expert.git.undo'), `${t('expert.git.undoBody', { subject: last.subject, hash: last.short })}

${t('expert.git.undoNote')}`, { ok: t('expert.git.undoOk'), danger: true }))) return;
  const r = await act(call('expert.undoCommit', { project, hash: last.hash }));
  if (r) { notifyOk(t('expert.git.undoDone')); forgetInfo(project); reload(); }
}

function UndoItem({ last, onUndo }) {
  const why = last && !last.canUndo ? t(`expert.git.undoWhy.${last.reason ?? 'none'}`) : null;
  return (
    <DropdownMenuItem disabled={!last?.canUndo} onSelect={onUndo} data-testid="expert-git-undo" title={why ?? undefined}>
      <Undo2 /><span className="flex min-w-0 flex-col"><span>{t('expert.git.undo')}</span>{why ? <small className="text-faint-foreground text-micro whitespace-normal">{why}</small> : null}</span>
    </DropdownMenuItem>
  );
}

// «Ramas»: the local branches; a click on another one switches to it (with its confirmation) and «Nueva rama» opens the form.
function Branches({ project, st, dirty, branches, version, reload, ago }) {
  const t2 = useT();
  return (
    <section className="border-border flex flex-col gap-1.5 border-b px-3 py-2.5" data-testid="expert-git-branches">
      <div className="text-faint-foreground flex items-center gap-1.5 text-micro tracking-wide uppercase"><span className="min-w-0 flex-1 truncate">{t2('expert.git.branches')}</span>
        <Button variant="ghost" size="xs" className="normal-case" onClick={() => newBranchFlow(project, reload)} data-testid="expert-git-newbranch"><Plus />{t2('expert.git.newBranch')}</Button>
      </div>
      {!branches ? <div className="p-1"><Spinner className="size-3" /></div> : !branches.length ? <p className="text-muted-foreground py-1 text-caption">{t2('expert.git.noBranches')}</p> : branches.slice(0, 30).map((b) => (
        <button key={b.name} type="button" disabled={b.current || b.orb} onClick={() => switchFlow(project, b.name, st.branch, dirty, reload)} title={b.orb ? t2('expert.git.orbBranch') : b.name} data-testid={`expert-git-branch-${b.name}`} data-version={version}
          className="hover:bg-accent/60 flex min-h-7 w-full cursor-pointer items-center gap-2 rounded-ctl px-1 text-left text-control disabled:cursor-default disabled:hover:bg-transparent">
          <GitBranch className="text-muted-foreground size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate font-mono">{b.name}</span>
          <span className="text-faint-foreground text-micro whitespace-nowrap">{b.current ? t2('expert.git.current') : b.orb ? t2('expert.git.orbBranch') : b.upstream && !b.gone ? b.upstream : ago(b.date)}</span>
        </button>
      ))}
    </section>
  );
}

export function GitPanel({ project, st, version, reload, onDiff, ago }) {
  const t2 = useT();
  const branches = useBranches(project, version);
  const last = useLastCommit(project, version);
  const list = useCommitFiles(project, version);
  const [off, setOff] = useState(() => new Set()); // unticked paths: everything is ticked until the user says otherwise
  const [message, setMessage] = useState('');
  const [guess, setGuess] = useState(false);
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState(false);
  const ticket = useRef(0);
  useEffect(() => { setOff(new Set()); setMessage(''); setGuess(false); ticket.current += 1; setWriting(false); }, [project]);
  if (!st) return <div className="p-3" data-testid="panel-git"><Spinner className="size-3" /></div>;
  if (!st.repo) return <div data-testid="panel-git"><div className="text-muted-foreground flex flex-col items-center gap-1.5 px-3 py-6 text-center"><GitBranch className="text-faint-foreground size-6" /><b className="text-foreground font-(family-name:--title) text-card-title font-semibold">{t2('expert.noGit')}</b></div></div>;

  if (!list) return <div className="p-3" data-testid="panel-git"><Spinner className="size-3" /></div>;
  const files = list;
  const ticked = files.filter((f) => !f.risky && !off.has(f.path));
  const selectable = files.filter((f) => !f.risky);
  const toggle = (p) => setOff((prev) => { const n = new Set(prev); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const all = selectable.length > 0 && ticked.length === selectable.length;
  const some = ticked.length > 0 && !all;
  const ready = ticked.length > 0 && message.trim().length > 0 && !busy && !writing;
  const p = { name: project };

  // The same suggestion the commit dialog asks for: nothing more is sent to the assistant.
  const suggest = () => {
    const mine = ++ticket.current; setWriting(true);
    call('projects.commitSuggest', { name: project }).then((r) => { if (mine !== ticket.current) return; setMessage(r.message ?? ''); setGuess(r.source === 'guess'); }).catch(quiet).finally(() => { if (mine === ticket.current) setWriting(false); });
  };
  // Saves only the ticked files. «Guardar y subir» then goes through the push flow of the project page: its danger
  // confirmation and its secrets check. Cancelling that leaves the save done and nothing published.
  const save = async (andPush) => {
    setBusy(true); ticket.current += 1; setWriting(false); // a suggestion that arrives after saving belongs to the old save
    const sent = ticked.map((f) => f.path);
    try {
      const r = await act(call('projects.commit', { name: project, message, files: ticked.map((f) => f.path), push: false }));
      if (!r) return;
      setMessage(''); setGuess(false); setOff(new Set()); forgetInfo(project); reload();
      const rest = await call('projects.commitFiles', { name: project }).catch(() => null);
      const left = rest ? sent.filter((p2) => rest.some((x) => x.path === p2)) : [];
      if (left.length) notifyWarn(t2('expert.git.savedLess', { saved: r.files, marked: sent.length, files: left.slice(0, 5).join(', ') }));
      else if (r.files < sent.length) notifyWarn(t2('expert.git.savedFewer', { saved: r.files, marked: sent.length }));
      if (!left.length && r.files >= sent.length) notifyOk(t2('expert.git.saved', { files: r.files }));
      if (!andPush) return;
      await pushFlow(p, { branch: r.branch, remote: 'origin' }, t, reload);
    } finally { setBusy(false); }
  };
  const pushOnly = () => pushFlow(p, { branch: st.branch, remote: 'origin' }, t, reload);
  const pull = () => syncFlow(p, t, reload);

  return (
    <div data-testid="panel-git" data-state={files.length ? 'changes' : 'clean'}>
      <div className="border-border flex items-center gap-1.5 border-b py-2 pr-2 pl-3" data-testid="expert-git-head">
        <div className="flex min-w-0 flex-1 flex-col"><b className="font-(family-name:--title) text-card-title font-semibold">{t2('expert.git')}</b>
          <span className="text-muted-foreground truncate text-caption">{[st.branch, st.ahead ? t2(st.upstream ? 'expert.aheadOf' : 'expert.ahead', { n: st.ahead, base: st.upstream }) : null, st.behind ? t2(st.upstream ? 'expert.behindOf' : 'expert.behind', { n: st.behind, base: st.upstream }) : null].filter(Boolean).join(' · ')}</span></div>
        <IconButton small label={t2('expert.git.pull')} onClick={pull} data-testid="expert-git-pull"><CloudDownload /></IconButton>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild><MoreButton label={t2('expert.git.more')} data-testid="expert-git-more" /></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem onSelect={pushOnly} data-testid="expert-git-push"><CloudUpload />{t2('projects.pushBtn')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onDiff('')} disabled={!files.length} data-testid="expert-git-alldiff"><GitCommitHorizontal />{t2('expert.allChanges')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {files.length ? (
        <section className="border-border flex flex-col gap-1.5 border-b px-3 py-2.5" data-testid="expert-git-changes">
          <div className="text-faint-foreground flex items-center gap-2 text-micro tracking-wide uppercase">
            <Checkbox checked={all ? true : some ? 'indeterminate' : false} disabled={!selectable.length} onCheckedChange={() => setOff(all ? new Set(selectable.map((f) => f.path)) : new Set())} aria-label={t2('expert.git.selectAll')} data-testid="expert-git-all" />
            <button type="button" onClick={() => onDiff('')} className="hover:text-foreground min-w-0 flex-1 cursor-pointer truncate text-left uppercase">{t2('expert.unsaved')}</button>
            <span className="text-caption normal-case">{files.length}</span>
          </div>
          <div data-testid="expert-git">
            {files.map((f) => {
              const i = f.path.lastIndexOf('/'); const dir = i >= 0 ? f.path.slice(0, i) : ''; const name = i >= 0 ? f.path.slice(i + 1) : f.path;
              return (
                <div key={f.path} className="hover:bg-accent/60 flex min-h-7 items-center gap-2 rounded-ctl px-1 text-control" data-testid="expert-git-row">
                  <Checkbox checked={!f.risky && !off.has(f.path)} disabled={f.risky} onCheckedChange={() => toggle(f.path)} aria-label={t2('expert.git.pick', { name: f.path })} />
                  <button type="button" disabled={f.risky} onClick={() => onDiff(f.path)} title={f.risky ? t2('expert.secretFile') : f.path} className="min-w-0 flex-1 cursor-pointer truncate text-left disabled:cursor-not-allowed disabled:opacity-60">{name}{dir ? <small className="text-faint-foreground ml-1 text-micro">{dir}</small> : null}</button>
                  {f.add != null ? <span className="text-micro tabular-nums" title={t2('expert.lines', f)}><span className="text-success">+{f.add}</span> <span className="text-destructive">−{f.del}</span></span> : null}
                  <span className={cn('text-micro font-semibold', f.risky ? 'text-warning-ink' : 'text-muted-foreground')} title={f.status}>{f.risky ? t2('expert.secret') : f.status === '??' ? 'N' : f.status}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex flex-col gap-2" data-testid="expert-git-commit">
            <Textarea rows={3} value={writing ? '' : message} onChange={(e) => setMessage(e.target.value)} maxLength={5000} disabled={writing || busy} placeholder={writing ? t2('expert.git.suggesting') : t2('expert.git.messagePh')} aria-label={t2('expert.git.message')} className="min-h-16 w-full" data-testid="expert-git-message" />
            {guess && !writing ? <p className="text-muted-foreground text-caption">{t2('expert.git.guess')}</p> : null}
            <div className="flex"><Button variant="ghost" size="xs" disabled={writing || busy || !ticked.length} onClick={suggest} data-testid="expert-git-suggest"><AgentIcon agent="orb" className="size-3" />{t2('expert.git.suggest')}</Button></div>
            <div className="flex items-center justify-end gap-1.5">
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild><IconButton label={t2('expert.git.saveMore')} className="border-border border" data-testid="expert-git-savemore"><ChevronDown /></IconButton></DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top" className="w-60">
                  <DropdownMenuItem disabled={!ready} onSelect={() => save(true)} data-testid="expert-git-saveandpush"><CloudUpload />{t2('expert.git.saveAndPush')}</DropdownMenuItem>
                  <UndoItem last={last} onUndo={() => undoFlow(project, last, reload)} />
                </DropdownMenuContent>
              </DropdownMenu>
              <Button disabled={!ready} onClick={() => save(false)} data-testid="expert-git-save"><GitCommitHorizontal />{t2('expert.git.save', { n: ticked.length })}</Button>
            </div>
          </div>
        </section>
      ) : (
        <div className="border-border border-b" data-testid="expert-git-clean">
          <div className="text-muted-foreground flex flex-col items-center gap-1.5 px-3 py-6 text-center">
            <CircleCheck className="text-faint-foreground size-6" />
            <b className="text-foreground font-(family-name:--title) text-card-title font-semibold">{t2('expert.noChanges')}</b>
            <span className="text-control">{t2('expert.noChangesBody')}</span>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="xs" data-testid="expert-git-cleanmore">{t2('expert.git.saveMore')}<ChevronDown /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="w-60"><UndoItem last={last} onUndo={() => undoFlow(project, last, reload)} /></DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}
      <Branches project={project} st={st} dirty={files.length > 0 || Boolean(st.files?.length)} branches={branches} version={version} reload={reload} ago={ago} />
    </div>
  );
}

// The project bar's branch button: the same list and «Nueva rama», as a menu.
export function BranchMenu({ project, st, changes, version, reload }) {
  const t2 = useT();
  const branches = useBranches(project, version);
  const dirty = Boolean(st?.files?.length) || Boolean(changes?.length);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="min-w-0 shrink" title={t2('expert.git.branches')} data-testid="expert-branch"><GitBranch /><span className="truncate">{st.branch}</span></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60" data-testid="expert-branch-menu">
        {(branches ?? []).filter((b) => !b.orb).slice(0, 30).map((b) => <DropdownMenuItem key={b.name} disabled={b.current} onSelect={() => switchFlow(project, b.name, st.branch, dirty, reload)}><GitBranch /><span className="min-w-0 flex-1 truncate font-mono">{b.name}</span>{b.current ? <CircleCheck className="size-3.5" /> : null}</DropdownMenuItem>)}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => newBranchFlow(project, reload)} data-testid="expert-branch-new"><Plus />{t2('expert.git.newBranch')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
