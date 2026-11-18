// The floating robot: sits in the bottom right corner and says what happens (finished tasks, approvals, answers) in
// speech bubbles, like the old Office assistant. Click it to open the chat; grab it to move it inside the window (it stays
// where it is dropped, per device). Hidden in the chat itself (the robot is already there) and in every visual theme but
// «orb», the only one with the robot.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Robot } from './robot.jsx';
import { Button } from './ui/button.jsx';
import { BubbleTip } from './ui/overlay.jsx';
import { bridge, go, useStore, robotSkin } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';
import { play } from '@/lib/sounds.js';
import { chatMood } from '@/lib/chat-mood.js';
import { noticeOf } from './notices.jsx';
import { cn } from '@/lib/utils.js';

// Where it rests (px from the window's right and bottom edges; the drawn robot is narrower than its box) and how close
// to the window's edges it may be dropped (the top one leaves the window's own buttons free).
const REST_RIGHT = 9, REST_BOTTOM = 96, EDGE = 8, TOP_EDGE = 60;
// Pointer travel (px) that turns a press into a drag: a shorter one is a click and keeps opening the chat.
const DRAG_THRESHOLD = 5;
const POS_KEY = 'orb.companion.offset';

const loadOffset = () => { try { const o = JSON.parse(localStorage.getItem(POS_KEY)); return Number.isFinite(o?.x) && Number.isFinite(o?.y) ? { x: o.x, y: o.y } : { x: 0, y: 0 }; } catch { return { x: 0, y: 0 }; } };
const saveOffset = (o) => { try { if (o.x === 0 && o.y === 0) localStorage.removeItem(POS_KEY); else localStorage.setItem(POS_KEY, JSON.stringify(o)); } catch { /* storage unavailable */ } };
// The offset is measured from the resting spot, so the robot keeps hugging its corner when the window is resized.
function clampOffset(el, o) {
  const w = el.offsetWidth, h = el.offsetHeight;
  const restLeft = window.innerWidth - REST_RIGHT - w, restTop = window.innerHeight - REST_BOTTOM - h;
  const fit = (v, lo, hi) => Math.round(Math.min(Math.max(v, Math.min(lo, hi)), Math.max(lo, hi)));
  return { x: fit(o.x, EDGE - restLeft, window.innerWidth - EDGE - w - restLeft), y: fit(o.y, TOP_EDGE - restTop, window.innerHeight - EDGE - h - restTop) };
}

export function Companion({ name, base, hidden: hiddenHere }) {
  const t = useT();
  const hidden = !robotSkin(useStore((s) => s.app?.config?.ui?.skin)) || hiddenHere;
  const [bubble, setBubble] = useState(null);
  const [flash, setFlash] = useState(null);
  const [sleepy, setSleepy] = useState(false);
  // the bubble opens towards the middle of the window
  const [side, setSide] = useState('left');
  // never while the robot of the notices is on screen, so two robots never show at once.
  const noticeShown = useStore((s) => s.noticeShown);
  const timers = useRef({});
  const box = useRef(null);
  const offset = useRef({ x: 0, y: 0 });
  const drag = useRef(null);
  const frame = useRef(0);
  const moved = useRef(false);
  useEffect(() => bridge.on('chat:new', (payload) => {
    const body = String(payload?.body ?? '');
    const mood = chatMood(payload);
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
    wake();
    window.addEventListener('mousemove', wake, { passive: true }); window.addEventListener('keydown', wake);
    return () => { window.removeEventListener('mousemove', wake); window.removeEventListener('keydown', wake); clearTimeout(timers.current.sleep); };
  }, []);
  const shown = !hidden && !noticeShown;
  // One transform per frame and no React render while it moves; React only hears of where it ended.
  const place = (o) => { offset.current = o; if (box.current) box.current.style.transform = `translate3d(${o.x}px, ${o.y}px, 0)`; };
  const settle = () => {
    const el = box.current; if (!el) return;
    place(clampOffset(el, offset.current));
    setSide(el.getBoundingClientRect().left + el.offsetWidth / 2 < window.innerWidth / 2 ? 'right' : 'left');
  };
  useLayoutEffect(() => {
    if (!shown) return undefined;
    offset.current = loadOffset(); settle();
    window.addEventListener('resize', settle);
    return () => { window.removeEventListener('resize', settle); cancelAnimationFrame(frame.current); frame.current = 0; };
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  const press = (e) => {
    if (e.button !== 0) return;
    moved.current = false;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, from: offset.current, on: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const dragTo = (e) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    // the button was released while the robot was away (a notice took its place): that drag is over
    if (!(e.buttons & 1)) { drag.current = null; box.current?.removeAttribute('data-dragging'); return; }
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.on) { if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return; d.on = true; moved.current = true; box.current?.setAttribute('data-dragging', 'true'); }
    d.next = { x: d.from.x + dx, y: d.from.y + dy };
    if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; if (drag.current?.next && box.current) place(clampOffset(box.current, drag.current.next)); });
  };
  const drop = (e) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    drag.current = null; cancelAnimationFrame(frame.current); frame.current = 0;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    box.current?.removeAttribute('data-dragging');
    if (!d.on) return;
    if (d.next && box.current) place(clampOffset(box.current, d.next));
    saveOffset(offset.current); settle();
  };
  // back to the resting spot: right click, or Home while it has the focus
  const rest = () => { place({ x: 0, y: 0 }); saveOffset({ x: 0, y: 0 }); settle(); };
  if (!shown) return null;
  const mood = flash ?? (base === 'idle' && sleepy ? 'sleeping' : base);
  return (
    <div ref={box} className="companion fixed z-40 [&[data-dragging]_button]:cursor-grabbing" style={{ right: REST_RIGHT, bottom: REST_BOTTOM }} data-testid="companion" data-shown="true">
      {bubble ? (
        <div className={cn('bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-bottom-2 absolute bottom-2 w-max max-w-[220px] rounded-[var(--r-card)] border px-3 py-2.5 pr-8 text-[13px] shadow-lg', side === 'left' ? 'right-full mr-2 rounded-br-[4px]' : 'left-full ml-2 rounded-bl-[4px]')}>
          <button className="text-muted-foreground hover:text-foreground absolute top-2 right-2 cursor-pointer" onClick={() => setBubble(null)} aria-label={t('comp.close')}><X className="size-3.5" /></button>
          <p className="whitespace-pre-wrap break-words">{bubble.text.slice(0, 280)}</p>
          {bubble.action ? <Button size="xs" className="mt-2" onClick={() => { bubble.action.run(); setBubble(null); }}>{bubble.action.label}</Button> : null}
        </div>
      ) : null}
      <BubbleTip title={t('comp.companion.talkTo', { name })} side="top">
        <button className="cursor-grab touch-none drop-shadow-lg" aria-label={t('comp.companion.talkTo', { name })}
          onPointerDown={press} onPointerMove={dragTo} onPointerUp={drop} onPointerCancel={drop} onContextMenu={(e) => { e.preventDefault(); rest(); }}
          onKeyDown={(e) => { moved.current = false; if (e.key === 'Home') rest(); }}
          onClick={() => { if (moved.current) { moved.current = false; return; } go('chat'); }}>
          <Robot size={90} mood={mood} title={name} live active />
        </button>
      </BubbleTip>
    </div>
  );
}
