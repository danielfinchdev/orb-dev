// The subagents a chat's agent started (Claude's Agent tool, Codex's spawnAgent), as a list of children of the chat: state, and
// three actions: «Abrir» (read what it did), «Fondo» (let it go on without waiting for it) and «Parar» (only that one, when the agent
// can; the engine says so when it cannot). They are read only: nothing is written to a subagent from here.
import { useState } from 'react';
import { Bot, ChevronRight, Square, MoveDownRight, ExternalLink } from 'lucide-react';
import { call, act } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';
import { cn } from '@/lib/utils.js';
import { Button } from '@/components/ui/button.jsx';
import { Tip } from '@/components/ui/overlay.jsx';
import { subagentState } from '@/lib/session-blocks.js';

const DOT = { running: 'bg-info animate-pulse', done: 'bg-success', failed: 'bg-destructive', stopped: 'bg-muted-foreground' };

// every subagent block of the conversation, nested ones included, in order
function subagentsOf(blocks, out = []) {
  for (const b of blocks) if (b.type === 'subagent') { out.push(b); subagentsOf(b.steps, out); }
  return out;
}

// renderBlock(b): how a subagent's own steps are drawn (the conversation's own block, so it looks the same)
export function SubagentList({ blocks, sessionId, renderBlock }) {
  const t = useT();
  const [opened, setOpened] = useState(null);
  const list = subagentsOf(blocks);
  if (!list.length) return null;
  const running = list.filter((b) => subagentState(b) === 'running').length;
  const ask = (b, action, done) => act(call('sessions.subagent', { id: sessionId, tool: b.call.id, action }), done);
  const shown = list.slice(-8);
  const open = shown.find((b) => b.key === opened);
  return (
    <div className="mx-auto w-full max-w-3xl shrink-0 px-5 pb-2" data-testid="subagent-list">
      <div className="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs"><Bot className="size-3.5" />{t('session.subagents.title')} · {list.length}{running ? ` (${t('session.subagentState.running').toLowerCase()}: ${running})` : ''}</div>
      <div className="grid gap-1">
        {shown.map((b) => {
          const state = subagentState(b); const a = b.call.agent;
          return (
            <div key={b.key} className="bg-card flex items-center gap-2 rounded-lg border px-3 py-1.5 text-control" data-testid="subagent-child" data-state={state}>
              <span className={cn('size-1.5 shrink-0 rounded-full', DOT[state])} role="img" aria-label={t(`session.subagentState.${state}`)} />
              <span className="font-medium">{a.name ?? t('session.subagent')}</span>
              <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">{a.description ?? ''}</span>
              <span className="text-muted-foreground shrink-0 text-xs">{t(`session.subagentState.${state}`)}</span>
              <Tip label={t('session.subagents.open')}><Button variant="ghost" size="icon-sm" aria-label={t('session.subagents.open')} onClick={() => setOpened(opened === b.key ? null : b.key)} data-testid="subagent-open"><ExternalLink className={cn(opened === b.key && 'text-primary')} /></Button></Tip>
              {state === 'running' ? (<>
                <Tip label={t('session.subagents.backgroundTip')}><Button variant="ghost" size="xs" onClick={() => ask(b, 'background', t('session.subagents.backgrounded'))} data-testid="subagent-background"><MoveDownRight />{t('session.subagents.background')}</Button></Tip>
                <Button variant="ghost" size="xs" onClick={() => ask(b, 'stop', t('session.subagents.stopped'))} data-testid="subagent-stop"><Square className="fill-current" />{t('session.subagents.stop')}</Button>
              </>) : null}
            </div>
          );
        })}
      </div>
      {open ? (
        <div className="mt-1.5" data-testid="subagent-view">
          <div className="text-muted-foreground mb-1 flex items-center gap-1 text-xs"><ChevronRight className="size-3 rotate-90" />{t('session.subagents.readonly')}</div>
          {renderBlock(open)}
        </div>
      ) : null}
    </div>
  );
}
