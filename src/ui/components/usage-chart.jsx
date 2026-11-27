// The chart of «Uso»: smooth lines by day with a gradient under each, a legend with a box per series, a guide line and a
// tooltip, a click to pick a day and a drag to pick a range. Drawn by hand in SVG (no library), and only ever loaded with
// the usage page. Keyboard: arrows move between days, Enter picks the day, Shift+Enter widens the pick.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { niceMax, smoothPath } from '@/lib/usage-data.js';
import { cn } from '@/lib/utils.js';

// One colour per slot, from the theme's own tokens, so every theme and both modes keep it readable. The name is always
// in the legend and the tooltip, never only the colour.
export const SLOT = ['var(--primary-text)', 'var(--info)', 'var(--success)', 'color-mix(in oklab, var(--primary-text) 45%, var(--info))', 'var(--muted-foreground)'];
export const slotColor = (slot) => SLOT[(slot - 1) % SLOT.length];
const HEIGHT = 240;

export function UsageChart({ days, lines, hidden, onToggle, fmt, fmtAxis, dayLabel, dayShort, sel, onSel, itemsByDay, labels, ariaLabel }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const wrap = useRef(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState(null);
  const [focus, setFocus] = useState(days.length - 1);
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);
  const n = days.length;

  useLayoutEffect(() => {
    const el = wrap.current; if (!el) return undefined;
    const measure = () => setWidth(Math.max(120, el.clientWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { setFocus((f) => Math.min(Math.max(f, 0), Math.max(n - 1, 0))); setHover(null); }, [n]);

  const shown = lines.filter((l) => !hidden[l.key]);
  const max = niceMax(Math.max(0, ...shown.flatMap((l) => l.values)));
  const X = (i) => ((i + 0.5) * width) / n;
  const Y = (v) => HEIGHT - (v / max) * HEIGHT;
  const paths = useMemo(() => shown.map((l) => {
    const pts = l.values.map((v, i) => [X(i), Y(v)]);
    const line = smoothPath(pts);
    return { l, pts, line, area: line ? `${line} L${pts[pts.length - 1][0].toFixed(1)} ${HEIGHT} L${pts[0][0].toFixed(1)} ${HEIGHT} Z` : '' };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [lines, hidden, width, max, n]);

  const indexAt = (e) => { const r = e.currentTarget.getBoundingClientRect(); return Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n))); };
  const inSel = (i) => (drag ? i >= Math.min(drag.a, drag.b) && i <= Math.max(drag.a, drag.b) : Boolean(sel) && days[i] >= sel[0] && days[i] <= sel[1]);
  const commit = (a, b) => {
    const from = days[Math.min(a, b)]; const to = days[Math.max(a, b)];
    onSel(sel && sel[0] === from && sel[1] === to ? null : [from, to]);
  };
  const onDown = (e) => { if (e.button > 0) return; const i = indexAt(e); dragRef.current = { a: i, b: i }; setDrag({ a: i, b: i }); setHover(i); };
  const onMove = (e) => { const i = indexAt(e); setHover(i); if (dragRef.current && dragRef.current.b !== i) { dragRef.current = { ...dragRef.current, b: i }; setDrag(dragRef.current); } };
  useEffect(() => {
    const up = () => { const d = dragRef.current; if (!d) return; dragRef.current = null; setDrag(null); commit(d.a, d.b); };
    document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
    return () => { document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, sel]);

  const onKey = (e, i) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault(); const to = Math.min(n - 1, Math.max(0, i + (e.key === 'ArrowLeft' ? -1 : 1)));
      setFocus(to); requestAnimationFrame(() => wrap.current?.querySelector(`[data-col="${to}"]`)?.focus());
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (e.shiftKey && sel) onSel([sel[0] < days[i] ? sel[0] : days[i], sel[1] > days[i] ? sel[1] : days[i]]);
      else onSel(sel && sel[0] === days[i] && sel[1] === days[i] ? null : [days[i], days[i]]);
    }
  };

  const every = Math.ceil(n / 8);
  const at = hover;
  const tipLines = at == null ? [] : shown.filter((l) => l.values[at] > 0);
  const tipTotal = at == null ? 0 : shown.reduce((s, l) => s + l.values[at], 0);
  const tipX = at == null ? 0 : X(at);
  const tipTop = at == null ? 0 : Math.max(0, Math.min(HEIGHT - 96, (shown.length ? Math.min(...shown.map((l) => Y(l.values[at]))) : HEIGHT) - 70));

  return (
    <div className="flex flex-col gap-1.5" data-testid="usage-chart">
      <div className="relative pl-11">
        <div ref={wrap} className="relative touch-none select-none" style={{ height: HEIGHT }} role="group" aria-label={ariaLabel} data-testid="usage-plot"
          onPointerDown={onDown} onPointerMove={onMove} onPointerLeave={() => { if (!dragRef.current) setHover(null); }}>
          {[0, 0.5, 1].map((f) => (
            <div key={f} className={cn('absolute right-0 left-0 border-t', f === 0 ? 'border-input' : 'border-border/60')} style={{ bottom: `${f * 100}%` }}>
              <span className="text-faint-foreground absolute -left-11 -top-2 w-[38px] text-right text-[11px] tabular-nums">{fmtAxis(max * f)}</span>
            </div>
          ))}
          <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" viewBox={`0 0 ${width} ${HEIGHT}`} aria-hidden="true">
            <defs>
              {lines.map((l) => (
                <linearGradient key={l.key} id={`g${uid}${l.slot}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={slotColor(l.slot)} stopOpacity=".34" /><stop offset="1" stopColor={slotColor(l.slot)} stopOpacity="0" />
                </linearGradient>
              ))}
            </defs>
            {paths.map(({ l, pts, line, area }) => (
              <g key={l.key}>
                {line ? <><path d={area} fill={`url(#g${uid}${l.slot})`} /><path d={line} fill="none" stroke={slotColor(l.slot)} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></>
                  : <circle cx={pts[0][0]} cy={pts[0][1]} r="5" fill={slotColor(l.slot)} stroke="var(--card)" strokeWidth="2" />}
              </g>
            ))}
            {at != null ? (
              <g>
                <line x1={tipX} x2={tipX} y1="0" y2={HEIGHT} stroke="var(--input)" strokeWidth="1" />
                {shown.map((l) => <g key={l.key}><circle cx={tipX} cy={Y(l.values[at])} r="10" fill={slotColor(l.slot)} opacity=".18" /><circle cx={tipX} cy={Y(l.values[at])} r="5" fill={slotColor(l.slot)} stroke="var(--card)" strokeWidth="2" /></g>)}
              </g>
            ) : null}
          </svg>
          <div className="absolute inset-0 flex">
            {days.map((d, i) => {
              const parts = lines.filter((l) => l.values[i] > 0).map((l) => `${l.label} ${fmt(l.values[i])}`);
              const label = parts.length ? `${dayLabel(d)}: ${parts.join(', ')}` : `${dayLabel(d)}: ${labels.noUse}`;
              return (
                <button key={d} type="button" data-col={i} tabIndex={i === focus ? 0 : -1} aria-label={label} aria-pressed={inSel(i)}
                  className={cn('h-full min-w-0 flex-1 cursor-pointer outline-none focus-visible:bg-primary-text/10', inSel(i) && 'bg-primary-text/10')}
                  onFocus={() => { setFocus(i); setHover(i); }} onBlur={() => setHover(null)} onKeyDown={(e) => onKey(e, i)} />
              );
            })}
          </div>
          {at != null ? (
            <div className="bg-popover text-popover-foreground border-border pointer-events-none absolute z-5 min-w-40 rounded-ctl border px-2.5 py-2 text-[12px] shadow-lg" data-testid="usage-tip"
              style={{ left: Math.max(0, Math.min(width - 170, tipX > width * 0.6 ? tipX - 176 : tipX + 16)), top: tipTop }}>
              {shown.length === 1 ? (
                <><div className="font-(family-name:--title) text-[24px] leading-[1.1] font-semibold tabular-nums" style={{ color: slotColor(shown[0].slot) }}>{fmt(shown[0].values[at])}</div><div className="text-muted-foreground mt-1">{dayLabel(days[at])}</div></>
              ) : (
                <>
                  <b className="text-[13px] font-semibold">{dayLabel(days[at])}</b>
                  {tipTotal ? <>
                    {tipLines.map((l) => <div key={l.key} className="text-muted-foreground mt-1 flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-full" style={{ background: slotColor(l.slot) }} />{l.label}<span className="text-foreground ml-auto tabular-nums">{fmt(l.values[at])}</span></div>)}
                    <div className="border-border mt-1 flex border-t pt-1"><span>{labels.total}</span><span className="ml-auto tabular-nums">{fmt(tipTotal)}</span></div>
                    <div className="text-muted-foreground mt-1">{labels.items(itemsByDay[at] ?? 0)}</div>
                  </> : <div className="text-muted-foreground mt-1">{labels.noUseDay}</div>}
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>
      <div className="ml-11 flex" aria-hidden="true">
        {days.map((d, i) => <span key={d} className="text-faint-foreground flex min-w-0 flex-1 justify-center text-[11px] whitespace-nowrap">{(n - 1 - i) % every === 0 ? dayShort(d, i) : ''}</span>)}
      </div>
      <div className="bg-secondary flex flex-wrap items-center gap-x-4 gap-y-1 rounded-ctl px-3 py-2" role="group" aria-label={labels.series} data-testid="usage-legend">
        {lines.map((l) => (
          <button key={l.key} type="button" aria-pressed={!hidden[l.key]} onClick={() => onToggle(l.key)} data-testid="usage-series"
            className={cn('inline-flex h-(--ctl-sm) cursor-pointer items-center gap-2 rounded-ctl text-[12px] outline-none focus-visible:outline-2 focus-visible:outline-ring', hidden[l.key] ? 'text-muted-foreground' : 'text-foreground')}>
            <span className="grid size-[18px] place-items-center rounded-[calc(var(--r-ctl)-4px)] border" style={hidden[l.key] ? { borderColor: 'var(--input)', background: 'var(--card)' } : { borderColor: slotColor(l.slot), background: slotColor(l.slot), color: 'var(--background)' }}>
              {hidden[l.key] ? null : <Check className="size-3" />}
            </span>
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}
