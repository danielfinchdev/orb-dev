// «Local / Worktree» (and the base branch) on the row over the box of a direct chat: where the chat works. Local is the project's
// folder; Worktree is a copy of its own, on a branch of its own, that Orb keeps outside the repository.
import { useEffect, useState } from 'react';
import { Folder, GitBranch } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuLabel, BubbleTip } from '@/components/ui/overlay.jsx';
import { Button } from '@/components/ui/button.jsx';
import { call } from '@/lib/store.js';
import { quiet } from '@/lib/quiet.js';
import { useT } from '@/lib/i18n.js';
import { cn } from '@/lib/utils.js';

const CURRENT = '@current'; // the radio group's value for «the branch the folder is on»
const SEGMENT = 'rounded-[calc(var(--r-ctl)-2px)] px-2';
const ON = 'bg-card text-foreground shadow-sm hover:bg-card';
// A chat that already started keeps where it works: the pills show it as a segment like any other (the chosen one marked, not
// dimmed; its bubble says it cannot change) and the branch it started from (the worktree's base; for a Local chat, the project's
// branch the view already has: `branch`).
// value: { mode: 'local' | 'worktree', base: '' (the current branch) | a branch }; chat: the id of a chat that already started.
export function WorkspacePills({ project, value, onChange, chat = null, branch = '' }) {
  const t = useT();
  const [info, setInfo] = useState(null); // { git, current, branches } (a new chat) or { has, base } (one that started)
  useEffect(() => {
    let alive = true; setInfo(null);
    if (chat != null) call('worktrees.status', { id: String(chat) }).then((r) => { if (alive) setInfo({ has: r?.has === true, base: r?.base ?? '' }); }).catch((e) => { quiet(e); if (alive) setInfo({ has: false, base: '' }); });
    else if (project) call('worktrees.branches', { project }).then((r) => { if (alive) setInfo(r); }).catch((e) => { quiet(e); if (alive) setInfo({ git: false, branches: [] }); });
    return () => { alive = false; };
  }, [project, chat]);
  if (!project) return null;
  if (chat != null) {
    if (!info) return null;
    const from = info.has ? info.base : branch;
    return (
      <>
        <BubbleTip title={t('chat.workspace.tip')} text={t('chat.workspace.locked')} side="top">
          <div role="group" aria-label={t('chat.workspace.tip')} className="bg-secondary inline-flex shrink-0 items-center gap-0.5 rounded-[var(--r-ctl)] p-0.5" data-testid="workspace-pills" data-locked="">
            <Button size="xs" variant="ghost" className={cn(SEGMENT, 'cursor-default', !info.has && ON)} aria-pressed={!info.has} data-testid="workspace-local"><Folder />{t('chat.workspace.local')}</Button>
            <Button size="xs" variant="ghost" className={cn(SEGMENT, 'cursor-default', info.has && ON)} aria-pressed={info.has} data-testid="workspace-worktree"><GitBranch />{t('chat.workspace.worktree')}</Button>
          </div>
        </BubbleTip>
        {from ? <span className="text-faint-foreground truncate px-1.5 text-xs" data-testid="workspace-base">{t('chat.workspace.from', { branch: from })}</span> : null}
      </>
    );
  }
  const git = info?.git === true && info.current != null;
  const worktree = value.mode === 'worktree' && git;
  const pick = (mode) => onChange({ mode, base: '' });
  return (
    <>
      <div role="group" aria-label={t('chat.workspace.tip')} className="bg-secondary inline-flex shrink-0 items-center gap-0.5 rounded-[var(--r-ctl)] p-0.5" data-testid="workspace-pills">
        <BubbleTip title={t('chat.workspace.local')} text={t('chat.workspace.localTip')} side="top">
          <Button size="xs" variant="ghost" className={cn(SEGMENT, !worktree && ON)} onClick={() => pick('local')} aria-pressed={!worktree} data-testid="workspace-local"><Folder />{t('chat.workspace.local')}</Button>
        </BubbleTip>
        <BubbleTip title={t('chat.workspace.worktree')} text={git ? t('chat.workspace.worktreeTip') : t('chat.workspace.noGit')} side="top">
          <span>
            <Button size="xs" variant="ghost" className={cn(SEGMENT, worktree && ON)} disabled={!git} onClick={() => pick('worktree')} aria-pressed={worktree} data-testid="workspace-worktree"><GitBranch />{t('chat.workspace.worktree')}</Button>
          </span>
        </BubbleTip>
      </div>
      {worktree ? (
        <DropdownMenu modal={false}>
          <BubbleTip title={t('chat.workspace.base')} text={t('chat.workspace.baseTip')} side="top">
            <DropdownMenuTrigger asChild>
              <Button size="xs" variant="ghost" className="text-faint-foreground max-w-40 min-w-0 px-1.5 font-normal" data-testid="workspace-base"><span className="truncate">{t('chat.workspace.from', { branch: value.base || info.current })}</span></Button>
            </DropdownMenuTrigger>
          </BubbleTip>
          <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
            <DropdownMenuLabel>{t('chat.workspace.base')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={value.base || CURRENT} onValueChange={(base) => onChange({ mode: 'worktree', base: base === CURRENT ? '' : base })}>
              <DropdownMenuRadioItem value={CURRENT}>{t('chat.workspace.baseCurrent', { branch: info.current })}</DropdownMenuRadioItem>
              {info.branches.filter((b) => b !== info.current).map((b) => <DropdownMenuRadioItem key={b} value={b}>{b}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  );
}
