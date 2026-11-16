// The chat's «/goal» capsule (its text, turns and a clock) and the «/debug» badge, above the message box. The state lives in
// the engine (src/engine/modes.mjs); here it is only shown, and «Parar», «Continuar» and «Quitar» ask the engine.
import { useEffect, useState } from 'react';
import { Target, Bug, Square, Play, X } from 'lucide-react';
import { call, act, bridge } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';
import { Button } from '@/components/ui/button.jsx';
import { Tip } from '@/components/ui/overlay.jsx';

const clock = (since, now) => {
  const s = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function ChatModes({ id }) {
  const t = useT();
  const [goal, setGoal] = useState(null);
  const [debug, setDebug] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let alive = true;
    setGoal(null); setDebug(false);
    call('sessions.modes', { id }).then((m) => { if (alive && m) { setGoal(m.goal ?? null); setDebug(Boolean(m.debug)); } }).catch(() => {});
    const offGoal = bridge.on('session:goal', (e) => { if (e.id === id) setGoal(e.goal ?? null); });
    const offDebug = bridge.on('session:debug', (e) => { if (e.id === id) setDebug(Boolean(e.on)); });
    return () => { alive = false; offGoal(); offDebug(); };
  }, [id]);
  const ticking = goal?.status === 'active';
  useEffect(() => {
    if (!ticking) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  if (!goal && !debug) return null;
  const goalAct = (action) => act(call('sessions.goal', { id, action }));
  return (
    <div className="mx-auto flex w-full max-w-3xl shrink-0 flex-wrap items-center gap-2 px-5 pb-2" data-testid="chat-modes">
      {goal ? (
        <div className="bg-muted/60 flex min-w-0 max-w-full items-center gap-2 rounded-full border px-3 py-1 text-xs" data-testid="goal-capsule" data-status={goal.status}>
          <Target className="text-muted-foreground size-3.5 shrink-0" />
          <span className="truncate" title={goal.text}>{t('session.goal.title')}: {goal.text}</span>
          <span className="text-muted-foreground shrink-0">{t('session.goal.turns', { turns: goal.turns, max: goal.max })}</span>
          <span className="text-muted-foreground shrink-0">{t(`session.goal.${goal.status}`)}{ticking ? ` · ${clock(goal.startedAt, now)}` : ''}</span>
          {ticking ? <Tip label={t('session.goal.stop')}><Button variant="ghost" size="icon-sm" aria-label={t('session.goal.stop')} onClick={() => goalAct('stop')}><Square /></Button></Tip> : null}
          {['paused', 'blocked', 'limit'].includes(goal.status) ? <Tip label={t('session.goal.resume')}><Button variant="ghost" size="icon-sm" aria-label={t('session.goal.resume')} onClick={() => goalAct('resume')}><Play /></Button></Tip> : null}
          {ticking ? null : <Tip label={t('session.goal.close')}><Button variant="ghost" size="icon-sm" aria-label={t('session.goal.close')} onClick={() => goalAct('clear')}><X /></Button></Tip>}
        </div>
      ) : null}
      {debug ? (
        <div className="bg-muted/60 flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs" data-testid="debug-badge">
          <Bug className="text-muted-foreground size-3.5" />{t('session.debug.badge')}
          <Tip label={t('session.debug.off')}><Button variant="ghost" size="icon-sm" aria-label={t('session.debug.off')} onClick={() => act(call('sessions.send', { id, text: '/debug apagar' }))}><X /></Button></Tip>
        </div>
      ) : null}
    </div>
  );
}
