// 3.7 (WS5): «Ver navegador del Server»: the person's own page of Orb Server's browser, live, on a phone or the app.
// Tap or click to press, swipe or use the wheel to scroll, type in the field below (the phone's own keyboard) and send,
// and the special keys as buttons. While the person uses it the bots wait; «Devolver a los bots» lets them go on.
// Pictures come as «browser:live» events and are acknowledged once drawn (the Server sends the next one only then), so
// a slow connection gets fewer pictures, never a queue. Nothing is stored. Placed by the Bots / Magic Link views (WS4):
// <BrowserLive onClose={…} url={optional address} />.
import { useEffect, useRef, useState } from 'react';
import { X, Send, Hand, RotateCw, CornerDownLeft, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Delete } from 'lucide-react';
import { Button } from './ui/button.jsx';
import { Input } from './ui/basic.jsx';
import { call as storeCall, bridge } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';

const KEYS = [['Enter', CornerDownLeft], ['Tab', null], ['Backspace', Delete], ['Escape', null], ['ArrowLeft', ArrowLeft], ['ArrowUp', ArrowUp], ['ArrowDown', ArrowDown], ['ArrowRight', ArrowRight]];
const STOPPED = { idle: 'browserLive.stoppedIdle', replaced: 'browserLive.stoppedReplaced', lost: 'browserLive.stoppedLost' };

export function BrowserLive({ onClose, url = null, className, call = storeCall, listen = (fn) => bridge.on('*', fn) }) {
  const t = useT();
  const [sid, setSid] = useState(null);
  const [state, setState] = useState('connecting'); // connecting | live | stopped | error
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [using, setUsing] = useState(false);
  const [text, setText] = useState('');
  const [attempt, setAttempt] = useState(0);
  const img = useRef(null); const box = useRef(null); const sidRef = useRef(null); const down = useRef(null);

  // Open the view (again with «Volver a abrir»), at the width of this screen.
  useEffect(() => {
    let alive = true;
    setState('connecting'); setError(''); setReason('');
    const width = Math.round(box.current?.clientWidth || window.innerWidth || 390);
    call('browser.live.start', { width, dpr: window.devicePixelRatio || 1, ...(url ? { url } : {}) })
      .then((r) => { if (!alive) { call('browser.live.stop', { sid: r.sid }).catch(() => {}); return; } sidRef.current = r.sid; setSid(r.sid); setState('live'); })
      .catch((e) => { if (alive) { setError(String(e?.message ?? e)); setState('error'); } });
    return () => { alive = false; const s = sidRef.current; sidRef.current = null; if (s) call('browser.live.stop', { sid: s }).catch(() => {}); };
  }, [attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  // The pictures: drawn, then acknowledged (flow control).
  useEffect(() => listen((event, p) => {
    if (event !== 'browser:live' || !p || p.sid !== sidRef.current) return;
    if (p.state === 'stopped') { sidRef.current = null; setSid(null); setReason(p.reason ?? ''); setState('stopped'); return; }
    const el = img.current; if (!el || !p.data) return;
    el.onload = () => { if (sidRef.current === p.sid) call('browser.live.input', { sid: p.sid, ack: p.seq }).catch(() => {}); };
    el.src = `data:image/jpeg;base64,${p.data}`;
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // In the background: no pictures.
  useEffect(() => {
    const vis = () => { const s = sidRef.current; if (s) call('browser.live.input', { sid: s, pause: document.visibilityState === 'hidden' }).catch(() => {}); };
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (payload) => {
    const s = sidRef.current; if (!s) return;
    try { const r = await call('browser.live.input', { sid: s, ...payload }); if (r && typeof r.using === 'boolean') setUsing(r.using); } catch (e) { setError(String(e?.message ?? e)); }
  };
  const at = (e) => { const r = img.current.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)), h: r.height }; };
  const onDown = (e) => { if (!img.current) return; down.current = { ...at(e), t: Date.now() }; };
  const onUp = (e) => {
    const d = down.current; down.current = null; if (!d || !img.current) return;
    const p = at(e);
    const moved = Math.abs(p.y - d.y) * p.h;
    // A swipe scrolls the page (by the same share of it as the finger moved); a tap presses.
    if (moved > 12) send({ events: [{ type: 'wheel', x: d.x, y: d.y, dy: Math.round((d.y - p.y) * 800) }] });
    else send({ events: [{ type: 'tap', x: p.x, y: p.y }] });
  };
  const onWheel = (e) => { if (!img.current) return; const p = at(e); send({ events: [{ type: 'wheel', x: p.x, y: p.y, dx: Math.round(e.deltaX), dy: Math.round(e.deltaY) }] }); };
  const typeIt = (e) => { e?.preventDefault?.(); if (!text) return; send({ events: [{ type: 'text', text }] }); setText(''); };
  const stop = () => { const s = sidRef.current; sidRef.current = null; if (s) call('browser.live.stop', { sid: s }).catch(() => {}); onClose?.(); };

  return (
    <div className={cn('flex h-full w-full flex-col gap-2 bg-background', className)} data-testid="browser-live">
      <div className="flex items-center gap-2 px-2 pt-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{t('browserLive.title')}</span>
        {using ? <Button size="xs" variant="outline" onClick={() => send({ release: true }).then(() => setUsing(false))} data-testid="browser-live-release"><Hand />{t('browserLive.giveBack')}</Button> : null}
        <Button size="icon-xs" variant="ghost" onClick={stop} aria-label={t('browserLive.close')} data-testid="browser-live-close"><X /></Button>
      </div>
      {using ? <div className="px-2 text-xs text-muted-foreground">{t('browserLive.using')}</div> : null}
      <div ref={box} className="relative min-h-0 flex-1 overflow-hidden bg-black/80">
        <img ref={img} alt="" draggable={false} className={cn('block w-full select-none touch-none', state !== 'live' && 'opacity-30')}
          onPointerDown={onDown} onPointerUp={onUp} onWheel={onWheel} onContextMenu={(e) => e.preventDefault()} />
        {state !== 'live' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-sm text-white">
            <span>{state === 'connecting' ? t('browserLive.connecting') : state === 'error' ? t('browserLive.error', { error }) : t(STOPPED[reason] ?? 'browserLive.stopped')}</span>
            {state === 'stopped' || state === 'error' ? <Button size="sm" variant="secondary" onClick={() => setAttempt((n) => n + 1)} data-testid="browser-live-reopen"><RotateCw />{t('browserLive.reopen')}</Button> : null}
          </div>
        ) : null}
      </div>
      <form className="flex items-center gap-2 px-2" onSubmit={typeIt}>
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('browserLive.typeHint')} autoCapitalize="off" autoCorrect="off" spellCheck={false} disabled={!sid} data-testid="browser-live-text" />
        <Button size="sm" type="submit" disabled={!sid || !text}><Send />{t('browserLive.send')}</Button>
      </form>
      <div className="flex flex-wrap items-center gap-1 px-2 pb-2" aria-label={t('browserLive.keys')}>
        {KEYS.map(([key, Icon]) => (
          <Button key={key} size="xs" variant="outline" disabled={!sid} onClick={() => send({ events: [{ type: 'key', key }] })} aria-label={key} data-testid={`browser-live-key-${key}`}>
            {Icon ? <Icon /> : key === 'Escape' ? 'Esc' : key}
          </Button>
        ))}
        <span className="ml-auto text-[11px] text-muted-foreground">{t('browserLive.private')}</span>
      </div>
    </div>
  );
}
