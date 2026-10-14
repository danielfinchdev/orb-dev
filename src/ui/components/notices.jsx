// 2.6: when something happens (tasks finished, the assistant's report ready, something that needs you), the whole robot
// comes in at the bottom right with a bubble that says so. Without animations (Ajustes), in the «profesional» theme or on
// the phone, a notice at the top instead: green when all went well, orange when something needs attention.
import { useEffect, useRef, useState } from 'react';
import { CircleCheck, TriangleAlert, X } from 'lucide-react';
import { Robot } from './robot.jsx';
import { Button } from './ui/button.jsx';
import { bridge, go, useStore, getState, setState } from '@/lib/store.js';
import { notify, popupClosed } from '@/lib/notify.js';
import { cn } from '@/lib/utils.js';
import { cutWords } from '@/lib/text.js';
import { useT } from '@/lib/i18n.js';

// Which chat messages are notices: { level: 'ok' | 'attention', go } or null.
export function noticeOf(payload) {
  const m = payload?.meta;
  // A task done on its own says nothing (the assistant's report comes when the whole request is over): only problems.
  if (m?.kind === 'task-end') return ['failed', 'blocked'].includes(m.status) ? { level: 'attention', go: 'tasks' } : null;
  if (m?.kind === 'report' && payload.role === 'orb') return { level: 'ok', go: 'chat' };
  if (['attention', 'task-approval', 'approval'].includes(m?.kind)) return { level: 'attention', go: m.kind === 'approval' ? 'chat' : 'tasks' };
  return null;
}
const clean = (body) => String(body ?? '').replace(/^\p{Extended_Pictographic}️?\s*/u, '').trim();

export function Notices() {
  const t = useT();
  const ui = useStore((s) => s.app?.config?.ui);
  const [notice, setNotice] = useState(null);
  const timer = useRef(null);
  const last = useRef(0);
  const quiet = ui?.motion === 'minima' || ui?.skin === 'profesional' || bridge.mobile || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => bridge.on('chat:new', (payload) => {
    const found = noticeOf(payload); if (!found) return;
    // 3.2: «chat» is the conversation the notice belongs to.
    const n = found.go === 'chat' && payload?.conversation != null ? { ...found, go: { view: 'chat', id: payload.conversation } } : found;
    // 2.6: less often, so it never gets in the way: not for what is already on screen (the report while in its
    // conversation), and good news at most once a minute; what needs the user always comes.
    const route = getState().route;
    if (found.go === 'chat' && route?.view === 'chat' && (payload?.conversation == null || route.id === payload.conversation) && document.hasFocus()) return;
    if (n.level === 'ok' && Date.now() - last.current < 60_000) return;
    last.current = Date.now();
    const title = t(n.level === 'ok' ? 'notice.done' : 'notice.attention');
    const text = cutWords(clean(payload.body), 240);
    // 3.2: kept for the bell, never twice in a row and one on screen at a time (lib/notify.js).
    const ms = n.level === 'ok' ? 6000 : 10000;
    const shown = notify({ title, body: text, tone: n.level === 'ok' ? 'success' : 'warning', go: n.go, action: quiet ? { label: t('notice.open'), onClick: () => go(n.go) } : undefined }, { toast: quiet, ms });
    if (quiet || !shown.show) return;
    setNotice({ ...n, kind: payload?.meta?.kind, session: payload?.meta?.session, title, text, key: shown.id });
    clearTimeout(timer.current); timer.current = setTimeout(() => setNotice(null), ms);
  }), [quiet]); // eslint-disable-line react-hooks/exhaustive-deps
  // Another notification took the screen: this one steps aside (it stays in the bell).
  const popup = useStore((s) => s.popup);
  useEffect(() => { if (notice && popup && popup !== notice.key) setNotice(null); }, [popup, notice]);
  const close = () => { popupClosed(notice?.key); setNotice(null); };
  useEffect(() => () => clearTimeout(timer.current), []);
  // 3.1: a permission notice goes as soon as the permission is answered (here, in the task or by nobody in time).
  useEffect(() => bridge.on('approval:changed', () => {
    // Only when its own task no longer waits (another task may still have one pending).
    const answered = (n) => n?.kind === 'task-approval' && !(getState().app?.approvals ?? []).some((a) => a.session_id === n.session);
    setTimeout(() => setNotice((n) => (answered(n) ? null : n)), 800);
  }), []);
  // 3.0: while this robot is on screen, the one of the corner (companion.jsx) steps aside: never two robots at once.
  useEffect(() => { setState({ noticeShown: Boolean(notice && !quiet) }); }, [notice, quiet]);
  if (!notice || quiet) return null;
  const ok = notice.level === 'ok';
  return (
    <div key={notice.key} className="pointer-events-none fixed right-4 bottom-32 z-50 flex items-end gap-1" data-testid="robot-notice">
      <div className={cn('bg-card text-card-foreground animate-in fade-in-0 slide-in-from-right-4 pointer-events-auto relative mb-10 max-w-64 rounded-2xl border px-3.5 py-2.5 shadow-xl duration-500', ok ? 'border-success/40' : 'border-warning/50')}>
        <button className="text-muted-foreground hover:text-foreground absolute top-2 right-2 cursor-pointer rounded p-0.5" onClick={close} aria-label={t('brain.close')}><X className="size-3.5" /></button>
        <div className="flex items-center gap-2 pr-5 text-[14px] font-medium">
          {ok ? <CircleCheck className="text-success size-4.5" /> : <TriangleAlert className="text-warning size-4.5" />}{notice.title}
        </div>
        <p className="text-muted-foreground mt-1 text-[13px] leading-snug">{notice.text}</p>
        <Button size="xs" variant={ok ? 'soft' : 'default'} className="mt-2" onClick={() => { go(notice.go); close(); }}>{t('notice.open')}</Button>
        <span className="bg-card absolute -right-1.5 bottom-6 size-3 rotate-45 border-t border-r" aria-hidden="true" />
      </div>
      <div className="animate-in fade-in-0 slide-in-from-bottom-8 pointer-events-auto duration-700">
        <button className="cursor-pointer drop-shadow-xl" onClick={() => { go(notice.go); close(); }} aria-label={notice.title}>
          <Robot size={92} mood={ok ? 'happy' : 'worried'} gesture={ok ? 'hop' : undefined} live />
        </button>
      </div>
    </div>
  );
}
