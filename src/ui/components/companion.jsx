// The floating robot: sits in a corner and says what happens (finished tasks, approvals, answers) in speech bubbles,
// like the old Office assistant. Click it to open the chat. Hidden in the chat itself (the robot is already there).
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Robot } from './robot.jsx';
import { Button } from './ui/button.jsx';
import { bridge, go } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';

const moodOf = (body) => (/^(✅|↩️|👍)/.test(body) ? 'happy' : /^(❌|⛔|🛑|⚠️)/.test(body) ? 'worried' : 'talking');

export function Companion({ name, base, hidden }) {
  const t = useT();
  const [bubble, setBubble] = useState(null);
  const [flash, setFlash] = useState(null);
  const [sleepy, setSleepy] = useState(false);
  const timers = useRef({});
  useEffect(() => bridge.on('chat:new', (payload) => {
    const body = String(payload?.body ?? '');
    const mood = moodOf(body);
    setFlash(mood); clearTimeout(timers.current.flash); timers.current.flash = setTimeout(() => setFlash(null), 3500);
    if (hidden) return;
    const action = /aprobaci|approv/i.test(body) ? { label: t('comp.companion.viewTasks'), run: () => go('tasks') } : payload.role === 'orb' ? { label: t('comp.companion.openChat'), run: () => go('chat') } : null;
    setBubble({ text: body, action });
    clearTimeout(timers.current.bubble); timers.current.bubble = setTimeout(() => setBubble(null), action ? 12000 : 7000);
  }), [hidden]); // eslint-disable-line react-hooks/exhaustive-deps
  // A sleepy robot after five minutes without activity.
  useEffect(() => {
    const wake = () => { setSleepy(false); clearTimeout(timers.current.sleep); timers.current.sleep = setTimeout(() => setSleepy(true), 5 * 60_000); };
    wake();
    window.addEventListener('mousemove', wake, { passive: true }); window.addEventListener('keydown', wake);
    return () => { window.removeEventListener('mousemove', wake); window.removeEventListener('keydown', wake); clearTimeout(timers.current.sleep); };
  }, []);
  if (hidden) return null;
  const mood = flash ?? (base === 'idle' && sleepy ? 'sleeping' : base);
  return (
    <div className="pointer-events-none fixed right-6 bottom-6 z-40 flex items-end gap-2">
      {bubble ? (
        <div className="bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-bottom-2 pointer-events-auto relative mb-14 max-w-72 rounded-2xl rounded-br-md border p-3 pr-8 text-[13px] shadow-lg">
          <button className="text-muted-foreground hover:text-foreground absolute top-2 right-2 cursor-pointer" onClick={() => setBubble(null)} aria-label={t('comp.close')}><X className="size-3.5" /></button>
          <p className="whitespace-pre-wrap break-words">{bubble.text.slice(0, 280)}</p>
          {bubble.action ? <Button size="xs" className="mt-2" onClick={() => { bubble.action.run(); setBubble(null); }}>{bubble.action.label}</Button> : null}
        </div>
      ) : null}
      <button className="pointer-events-auto cursor-pointer drop-shadow-lg transition-transform hover:scale-105" onClick={() => go('chat')} title={t('comp.companion.talkTo', { name })}>
        <Robot size={68} mood={mood} title={name} />
      </button>
    </div>
  );
}
