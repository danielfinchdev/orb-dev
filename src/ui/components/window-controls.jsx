// the window's minimise / maximise / close, drawn by the app (no Windows buttons): top right, as tall as the top bars,
// styled like the rest of the bar in each theme (themes.css: .win-controls). Only in the PC app: a browser (the phone)
// has its own.
// They live INSIDE the top bar that is on screen (each bar renders a <WindowControlsSlot/>), so they share its height,
// blur and theme. Where no bar is visible (the welcome, a modal dialog covering the bar) the same single set falls back
// to a fixed overlay; there is never more than one set of buttons.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Minus, Square, Copy, X } from 'lucide-react';
import { useT } from '@/lib/i18n.js';
import { quiet } from '@/lib/quiet.js';

const controls = () => window.orb?.windowControls;

const slots = new Set();
const listeners = new Set();
let current = null;
let version = 0;
const MODAL = '[role=dialog], [role=alertdialog]';

// The visible bar closest to the top-right corner wins; a hidden one (md:hidden) is skipped, and so is every bar while a
// modal dialog is open (it would cover the buttons).
function pick() {
  if (typeof document === 'undefined' || document.querySelector(MODAL)) return null;
  let best = null;
  let bestRect = null;
  for (const el of slots) {
    const bar = el.parentElement;
    if (!bar || bar.getClientRects().length === 0) continue;
    const r = bar.getBoundingClientRect();
    if (!bestRect || r.top < bestRect.top - 1 || (Math.abs(r.top - bestRect.top) <= 1 && r.right > bestRect.right)) { best = el; bestRect = r; }
  }
  return best;
}
function refresh() {
  const next = pick();
  if (next === current) return;
  current = next;
  version += 1;
  listeners.forEach((l) => l());
}
function subscribe(l) {
  listeners.add(l);
  return () => listeners.delete(l);
}

let watching = false;
function watch() {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  window.addEventListener('resize', refresh);
  // Dialogs mount in portals directly under <body>.
  new MutationObserver(refresh).observe(document.body, { childList: true });
}

// Rendered by every top bar (which is position: relative): marks where the controls may live.
export function WindowControlsSlot() {
  const [el, setEl] = useState(null);
  useEffect(() => {
    if (!el || !controls()) return undefined;
    slots.add(el);
    watch();
    refresh();
    return () => { slots.delete(el); refresh(); };
  }, [el]);
  if (!controls()) return null;
  return <span ref={setEl} className="win-slot" />;
}

export function WindowControls() {
  const t = useT();
  const [maximized, setMaximized] = useState(false);
  useSyncExternalStore(subscribe, () => version);
  useEffect(() => {
    const c = controls();
    if (!c) return undefined;
    Promise.resolve(c.act('state')).then((s) => setMaximized(Boolean(s?.maximized))).catch(quiet);
    return c.onState((s) => setMaximized(Boolean(s?.maximized)));
  }, []);
  if (!controls()) return null;
  const act = (a) => Promise.resolve(controls().act(a)).catch(quiet);
  const button = (action, label, icon, extra = '') => (
    <button type="button" className={`win-control ${extra}`} onClick={() => act(action)} aria-label={label} data-testid={`window-${action}`}>{icon}</button>
  );
  const node = (
    // Over an open dialog (Ajustes, the games…) a click here must not close it: neither the press nor the focus reach it.
    <div className={`win-controls${current ? ' in-bar' : ''}`} role="group" aria-label={t('app.window.controls')} onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.preventDefault()}>
      {button('minimize', t('app.window.minimize'), <Minus />)}
      {button('maximize', maximized ? t('app.window.restore') : t('app.window.maximize'), maximized ? <Copy className="-scale-x-100" /> : <Square />)}
      {button('close', t('app.window.close'), <X />, 'win-close')}
    </div>
  );
  return current ? createPortal(node, current) : node;
}
