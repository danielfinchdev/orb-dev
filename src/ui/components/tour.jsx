// 2.6: the guided tour. The whole robot (the one of the notices) walks the user through the app step by step: each step
// lights the control it talks about (a ring around it, the rest dimmed) and the robot explains it in a bubble next to
// it, with «Siguiente» / «Atrás», a counter and «Saltar tutorial» always in view (Esc skips too). It changes screen when
// a step needs it and comes back to the chat at the end. Steps whose control is not on screen (the context ring before
// the first answer, the sidebar in a narrow window) are skipped. The dimmed area does not take clicks: the app stays
// usable underneath. Without animations, the robot stands still; in the «profesional» theme the bubbles go alone.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Robot } from './robot.jsx';
import { Button } from './ui/button.jsx';
import { useStore, go, endTour, getState } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';

// id: texts help.tour.<id>.title / .text. target: the data-testid to light (none: the bubble in the middle). view: the
// screen to show first. wrap: light the control's container instead (the switch alone is tiny). mood: the robot's.
export const TOUR_STEPS = [
  { id: 'welcome', mood: 'hello', view: 'chat' },
  { id: 'chat', target: 'nav-chat', view: 'chat', sidebar: true },
  { id: 'composer', target: 'chat-input', view: 'chat' },
  { id: 'project', target: 'project-picker', view: 'chat' },
  { id: 'brain', target: 'brain-picker', view: 'chat' },
  { id: 'reasoning', target: 'reasoning-picker', view: 'chat' },
  { id: 'orchestrator', target: 'orchestrator-check', view: 'chat', wrap: 'label' },
  { id: 'context', target: 'context-meter', view: 'chat', optional: true },
  { id: 'bar', target: 'bar-games', view: 'chat' },
  { id: 'newchat', target: 'new-conversation', sidebar: true },
  { id: 'folders', target: 'sidebar-folders', sidebar: true },
  { id: 'tasks', target: 'nav-tasks', view: 'tasks', sidebar: true },
  { id: 'schedules', target: 'nav-schedules', view: 'schedules', sidebar: true },
  { id: 'agents', target: 'nav-agents', view: 'agents', sidebar: true },
  { id: 'logs', target: 'nav-logs', view: 'logs', sidebar: true },
  { id: 'activity', target: 'nav-activity', view: 'activity', sidebar: true },
  { id: 'tutorials', target: 'nav-tutorials', view: 'tutorials', sidebar: true },
  { id: 'settings', target: 'nav-settings', sidebar: true },
  { id: 'end', mood: 'happy', view: 'chat' }
];
const GESTURES = ['look', 'tilt', 'wink'];
const MARGIN = 16;
const PAD = 6; // the ring sits a little outside the control

const visible = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? r : null; };
function findTarget(step) {
  if (!step.target) return null;
  let el = document.querySelector(`[data-testid="${step.target}"]`);
  if (el && step.wrap) el = el.closest(step.wrap) ?? el;
  return el;
}
// Steps known to be missing before starting: the whole sidebar in a narrow window, the context ring before any answer.
function knownMissing() {
  const out = new Set();
  const { app } = getState();
  if (!visible(document.querySelector('[data-testid="nav-chat"]'))) for (const s of TOUR_STEPS) if (s.sidebar) out.add(s.id);
  if (!(app?.chat?.context ?? app?.assistant?.context)?.size) out.add('context');
  return out;
}

export function Tour() {
  const t = useT();
  const app = useStore((s) => s.app);
  const route = useStore((s) => s.route);
  const name = app.config.assistantName;
  const ui = app.config.ui ?? {};
  const still = ui.motion === 'minima' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const noRobot = ui.skin === 'profesional';
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const [side, setSide] = useState('center');
  const skipped = useRef(null);
  if (!skipped.current) skipped.current = knownMissing();
  const dir = useRef(1);
  const panel = useRef(null);
  const stepsLeft = TOUR_STEPS.filter((s) => !skipped.current.has(s.id));
  const step = TOUR_STEPS[index];
  const position = stepsLeft.indexOf(step) + 1;
  const first = index === 0;
  const last = index === TOUR_STEPS.length - 1;

  const finish = () => { endTour(); if (getState().route.view !== 'chat') go('chat'); };
  const move = (d) => {
    dir.current = d;
    let next = index + d;
    while (next >= 0 && next < TOUR_STEPS.length && skipped.current.has(TOUR_STEPS[next].id)) next += d;
    if (next < 0) return;
    if (next >= TOUR_STEPS.length) return finish();
    setIndex(next);
  };

  // Each step: show its screen, then find its control (the screen may need a moment to draw). Missing: skip it.
  useEffect(() => {
    if (step.view && getState().route.view !== step.view) go(step.view);
    if (!step.target) { setRect(null); return undefined; }
    let tries = 0; let timer = null; let alive = true;
    const look = () => {
      if (!alive) return;
      const el = findTarget(step); const r = visible(el);
      if (r) { setRect(r); el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); return; }
      if (++tries < 12) { timer = setTimeout(look, 70); return; }
      skipped.current.add(step.id);
      move(dir.current);
    };
    look();
    return () => { alive = false; clearTimeout(timer); };
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  // The ring follows its control while the layout moves (the sidebar resized, the window, a scroll).
  useEffect(() => {
    if (!step.target) return undefined;
    const update = () => { const r = visible(findTarget(step)); if (r) setRect((old) => (old && Math.abs(old.left - r.left) < 0.5 && Math.abs(old.top - r.top) < 0.5 && Math.abs(old.width - r.width) < 0.5 && Math.abs(old.height - r.height) < 0.5 ? old : r)); };
    const id = setInterval(update, 200);
    window.addEventListener('resize', update); window.addEventListener('scroll', update, true);
    return () => { clearInterval(id); window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [index, route.view]); // eslint-disable-line react-hooks/exhaustive-deps

  // The panel (robot + bubble) next to its control: to the right when there is room (the sidebar), else below, above or
  // to the left; without a control, in the middle. Measured after each draw so it never leaves the window.
  useLayoutEffect(() => {
    const el = panel.current; if (!el) return;
    const pw = el.offsetWidth; const ph = el.offsetHeight; const vw = window.innerWidth; const vh = window.innerHeight;
    const clampX = (x) => Math.max(MARGIN, Math.min(vw - pw - MARGIN, x));
    const clampY = (y) => Math.max(MARGIN, Math.min(vh - ph - MARGIN, y));
    let left; let top; let where = 'center';
    if (rect && step.target) {
      const gap = MARGIN + PAD;
      const fits = { right: vw - rect.right >= pw + gap, left: rect.left >= pw + gap, bottom: vh - rect.bottom >= ph + gap, top: rect.top >= ph + gap };
      // Where to try first: next to the controls of the left column (the sidebar); above the ones low in the window
      // (the message box), below the ones high up (the top bar); otherwise to the side.
      const cy = rect.top + rect.height / 2;
      const order = rect.right < vw * 0.4 ? ['right', 'bottom', 'top', 'left'] : cy > vh * 0.6 ? ['top', 'left', 'right', 'bottom'] : cy < vh * 0.4 ? ['bottom', 'left', 'right', 'top'] : ['right', 'left', 'bottom', 'top'];
      where = order.find((w) => fits[w]) ?? 'center';
      if (where === 'right') { left = rect.right + gap; top = clampY(cy - ph / 2); }
      if (where === 'left') { left = rect.left - pw - gap; top = clampY(cy - ph / 2); }
      if (where === 'bottom') { top = rect.bottom + gap; left = clampX(rect.left + rect.width / 2 - pw / 2); }
      if (where === 'top') { top = rect.top - ph - gap; left = clampX(rect.left + rect.width / 2 - pw / 2); }
    }
    if (where === 'center') { left = clampX((vw - pw) / 2); top = clampY((vh - ph) / 2); }
    el.style.left = `${Math.round(left)}px`; el.style.top = `${Math.round(top)}px`;
    setSide(where);
  }, [rect, index, noRobot]);

  // Keyboard: Esc skips, the arrows move, Tab stays inside the bubble.
  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); return; }
      if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); move(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
      if (e.key === 'Tab' && panel.current) {
        const items = [...panel.current.querySelectorAll('button:not([disabled])')];
        if (!items.length) return;
        const i = items.indexOf(document.activeElement);
        if (e.shiftKey && (i <= 0)) { e.preventDefault(); items[items.length - 1].focus(); }
        else if (!e.shiftKey && (i === -1 || i === items.length - 1)) { e.preventDefault(); items[0].focus(); }
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { panel.current?.querySelector('[data-testid="tour-next"]')?.focus({ preventScroll: true }); }, [index]);

  const spot = rect && step.target ? { left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 } : null;
  const mood = step.mood ?? (step.target ? 'happy' : 'idle');
  return (
    <div className="tour" data-testid="tour" data-step={step.id} data-side={side}>
      {spot ? <div className="tour-spot" style={spot} aria-hidden="true" /> : <div className="tour-dim" aria-hidden="true" />}
      <div ref={panel} className={cn('tour-panel', noRobot && 'tour-panel-plain')} role="dialog" aria-label={t('help.tour.aria')} aria-labelledby={`tour-title-${step.id}`} aria-describedby={`tour-text-${step.id}`}>
        {noRobot ? null : <div className="tour-robot"><Robot size={118} mood={mood} gesture={step.target && !still ? GESTURES[index % GESTURES.length] : undefined} still={still} live title={name} /></div>}
        <div className="tour-bubble">
          <span className="tour-tail" aria-hidden="true" />
          <div className="text-muted-foreground text-[11px] tracking-wide uppercase" data-testid="tour-counter">{t('help.tour.counter', { n: position, total: stepsLeft.length })}</div>
          <h2 id={`tour-title-${step.id}`} className="tour-title mt-0.5 text-[17px] leading-snug font-medium">{t(`help.tour.${step.id}.title`, { name })}</h2>
          <p id={`tour-text-${step.id}`} className="text-muted-foreground mt-1.5 text-[13.5px] leading-relaxed">{t(`help.tour.${step.id}.text`, { name })}</p>
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" className="text-muted-foreground mr-auto" onClick={finish} data-testid="tour-skip">{t('help.tour.skip')}</Button>
            {first ? null : <Button size="sm" variant="outline" onClick={() => move(-1)} data-testid="tour-back"><ChevronLeft />{t('help.tour.back')}</Button>}
            <Button size="sm" onClick={() => move(1)} data-testid="tour-next">{last ? t('help.tour.finish') : t('help.tour.next')}{last ? null : <ChevronRight />}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
