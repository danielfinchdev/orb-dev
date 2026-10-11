// The floating robot: sits in a corner and says what happens (finished tasks, approvals, answers) in speech bubbles,
// like the old Office assistant. Click it to open the chat. Hidden in the chat itself (the robot is already there) and
// in the «profesional» visual theme, which has no robot.
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Robot } from './robot.jsx';
import { Button } from './ui/button.jsx';
import { BubbleTip } from './ui/overlay.jsx';
import { bridge, go, useStore } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';
import { play } from '@/lib/sounds.js';
import { noticeOf } from './notices.jsx';
import { cn } from '@/lib/utils.js';

const moodOf = (body) => (/^(✅|↩️|👍)/.test(body) ? 'happy' : /^(❌|⛔|🛑|⚠️)/.test(body) ? 'worried' : 'talking');

export function Companion({ name, base, hidden: hiddenHere }) {
  const t = useT();
  const hidden = useStore((s) => s.app?.config?.ui?.skin) === 'profesional' || hiddenHere;
  const [bubble, setBubble] = useState(null);
  const [flash, setFlash] = useState(null);
  const [sleepy, setSleepy] = useState(false);
  // 3.0: out of sight until the pointer comes near the corner (its last bubble waits there), and never while the robot
  // of the notices is on screen, so two robots never show at once.
  const [near, setNear] = useState(false);
  const noticeShown = useStore((s) => s.noticeShown);
  const timers = useRef({});
  useEffect(() => bridge.on('chat:new', (payload) => {
    const body = String(payload?.body ?? '');
    // 3.1: something that waits for the user (a permission, an approval) sounds like a warning too, whatever its text.
    const mood = ['task-approval', 'approval', 'attention'].includes(payload?.meta?.kind) ? 'worried' : moodOf(body);
    play(mood === 'happy' ? 'done' : mood === 'worried' ? 'uhoh' : payload.role === 'orb' ? 'talk' : null, body, { force: mood === 'worried' });
    setFlash(mood); clearTimeout(timers.current.flash); timers.current.flash = setTimeout(() => setFlash(null), 3500);
    if (hidden || noticeOf(payload)) return; // finished tasks and things that need you: the robot of notices.jsx says them
    const action = /aprobaci|approv/i.test(body) ? { label: t('comp.companion.viewTasks'), run: () => go('tasks') } : payload.role === 'orb' ? { label: t('comp.companion.openChat'), run: () => go('chat') } : null;
    setBubble({ text: body, action });
    clearTimeout(timers.current.bubble); timers.current.bubble = setTimeout(() => setBubble(null), action ? 12000 : 7000);
  }), [hidden]); // eslint-disable-line react-hooks/exhaustive-deps
  // A sleepy robot after five minutes without activity.
  useEffect(() => {
    const wake = () => { setSleepy(false); clearTimeout(timers.current.sleep); timers.current.sleep = setTimeout(() => { setSleepy(true); play('yawn'); }, 5 * 60_000); };
    const move = (e) => { wake(); setNear(window.innerWidth - e.clientX < 230 && window.innerHeight - e.clientY < 200); };
    const leave = () => setNear(false);
    wake();
    window.addEventListener('mousemove', move, { passive: true }); window.addEventListener('keydown', wake); document.addEventListener('mouseleave', leave);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('keydown', wake); document.removeEventListener('mouseleave', leave); clearTimeout(timers.current.sleep); };
  }, []);
  if (hidden || noticeShown) return null;
  const mood = flash ?? (base === 'idle' && sleepy ? 'sleeping' : base);
  return (
    <div className={cn('fixed right-6 bottom-6 z-40 flex items-end gap-2 transition-opacity duration-200', near ? 'pointer-events-none opacity-100' : 'pointer-events-none opacity-0 [&_*]:pointer-events-none')} data-testid="companion" data-shown={near ? 'true' : 'false'}>
      {bubble ? (
        <div className="bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-bottom-2 pointer-events-auto relative mb-14 max-w-72 rounded-2xl rounded-br-md border p-3 pr-8 text-[13px] shadow-lg">
          <button className="text-muted-foreground hover:text-foreground absolute top-2 right-2 cursor-pointer" onClick={() => setBubble(null)} aria-label={t('comp.close')}><X className="size-3.5" /></button>
          <p className="whitespace-pre-wrap break-words">{bubble.text.slice(0, 280)}</p>
          {bubble.action ? <Button size="xs" className="mt-2" onClick={() => { bubble.action.run(); setBubble(null); }}>{bubble.action.label}</Button> : null}
        </div>
      ) : null}
      <BubbleTip title={t('comp.companion.talkTo', { name })} side="left">
        <button className="pointer-events-auto cursor-pointer drop-shadow-lg transition-transform hover:scale-105" onClick={() => go('chat')} aria-label={t('comp.companion.talkTo', { name })}>
          <Robot size={68} mood={mood} title={name} live />
        </button>
      </BubbleTip>
    </div>
  );
}
