// Conversation trail: a rail of ticks at the left edge of a transcript, one per message the user sent.
// It reads the transcript's DOM instead of its data, and pointer/scroll effects are written straight to the
// ticks, so the transcript never re-renders because of it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n.js';
import { cardTop, collapse, gutterFits, magnify, nearestIndex, readingIndex, tickCenter, TICK_PITCH, TICK_REST } from '@/lib/trail.js';

const ARTICLES = 'article.msg-box[data-role]';
const OPACITY = { rest: 0.2, visible: 0.5, reading: 0.9, hover: 1 };

// Text of a message without its header and action row.
function bodyText(article, max) {
  let out = '';
  for (const el of article.children) {
    if (el.classList.contains('msg-box-head') || el.classList.contains('chat-actions')) continue;
    out += ` ${el.textContent}`;
  }
  return collapse(out, max);
}

const reducedMotion = () => document.documentElement.dataset.motion === 'minima' || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

// Gives a view one stable ref callback that feeds the auto-scroll hook and also exposes the node to the trail.
export function useTrailScroll(scroll) {
  const node = useRef(null);
  const ref = useCallback((el) => { node.current = el; scroll.ref(el); }, [scroll.ref]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ref, node };
}

export function ConversationTrail({ scrollRef }) {
  const t = useT();
  const [count, setCount] = useState(0);
  const [labels, setLabels] = useState([]);
  const [fits, setFits] = useState(false);
  const [maxH, setMaxH] = useState(0);
  const [card, setCard] = useState(null);
  const list = useRef({ all: [], users: [] });
  const bars = useRef([]);
  const inner = useRef(null);
  const outer = useRef(null);
  const cardEl = useRef(null);
  const hoverY = useRef(null);
  const focused = useRef(-1);
  const frame = useRef(0);
  const lastReading = useRef(-1);

  const paint = useCallback(() => {
    frame.current = 0;
    const box = scrollRef.current; const { users } = list.current;
    if (!box || !users.length) return;
    const top = box.getBoundingClientRect().top; const bottom = top + box.clientHeight;
    const rects = users.map((a) => a.getBoundingClientRect());
    const reading = readingIndex(rects.map((r) => r.top - top));
    const hovering = hoverY.current !== null;
    const widths = hovering && !reducedMotion() ? magnify(hoverY.current, users.length) : null;
    const near = hovering ? nearestIndex(hoverY.current, users.length) : -1;
    users.forEach((_, i) => {
      const bar = bars.current[i]; if (!bar) return;
      const inView = rects[i].top < bottom && rects[i].bottom > top;
      bar.style.width = `${widths ? widths[i] : TICK_REST}px`;
      bar.style.opacity = i === near ? OPACITY.hover : i === reading ? OPACITY.reading : inView ? OPACITY.visible : OPACITY.rest;
    });
    // Keep the reading tick in view when the rail itself scrolls (long chats).
    const rail = inner.current;
    if (rail && reading !== lastReading.current && !hovering && focused.current < 0) {
      const c = tickCenter(reading);
      if (c < rail.scrollTop || c > rail.scrollTop + rail.clientHeight) rail.scrollTop = c - rail.clientHeight / 2;
    }
    lastReading.current = reading;
  }, [scrollRef]);

  const schedule = useCallback(() => { if (!frame.current) frame.current = requestAnimationFrame(paint); }, [paint]);

  const refresh = useCallback(() => {
    const box = scrollRef.current; if (!box) return;
    const all = [...box.querySelectorAll(ARTICLES)];
    const users = all.filter((a) => a.dataset.role === 'user');
    list.current = { all, users };
    setCount(users.length);
    setFits(gutterFits(box.clientWidth));
    setMaxH(Math.round(box.clientHeight * 0.8));
    const next = users.map((a) => bodyText(a, 60));
    setLabels((prev) => (prev.length === next.length && prev.every((x, i) => x === next[i]) ? prev : next));
    schedule();
  }, [scrollRef, schedule]);

  useEffect(() => {
    const box = scrollRef.current; if (!box) return undefined;
    let timer = 0;
    const later = () => { if (!timer) timer = setTimeout(() => { timer = 0; refresh(); }, 250); };
    const mo = new MutationObserver(later); mo.observe(box, { childList: true, subtree: true });
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(later) : null; ro?.observe(box);
    box.addEventListener('scroll', schedule, { passive: true });
    refresh();
    return () => { mo.disconnect(); ro?.disconnect(); box.removeEventListener('scroll', schedule); clearTimeout(timer); cancelAnimationFrame(frame.current); frame.current = 0; };
  }, [scrollRef, refresh, schedule]);

  useEffect(() => { bars.current.length = count; schedule(); }, [count, fits, schedule]);

  // Preview texts are read only now, when the card is about to show.
  const show = useCallback((i) => {
    const { all, users } = list.current; const a = users[i]; if (!a) return;
    let reply = '';
    for (let k = all.indexOf(a) + 1; k < all.length && all[k].dataset.role !== 'user'; k += 1) reply = bodyText(all[k], 280) || reply;
    const railH = outer.current?.clientHeight ?? 0;
    const scrolled = inner.current?.scrollTop ?? 0;
    setCard((c) => (c && c.i === i && c.reply === reply ? c : { i, title: bodyText(a, 280), reply, center: tickCenter(i) - scrolled, railH }));
  }, []);

  useEffect(() => {
    const el = cardEl.current; if (!card || !el) return;
    el.style.top = `${cardTop(card.center, el.offsetHeight, card.railH)}px`;
  }, [card]);

  const jump = (i) => {
    list.current.users[i]?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
  };

  const onMove = (e) => {
    const r = inner.current.getBoundingClientRect();
    hoverY.current = e.clientY - r.top + inner.current.scrollTop;
    const i = nearestIndex(hoverY.current, list.current.users.length);
    if (i !== focused.current) { focused.current = i; show(i); }
    schedule();
  };
  const onLeave = () => { hoverY.current = null; focused.current = -1; setCard(null); schedule(); };
  const onKey = (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const n = list.current.users.length;
    const from = focused.current >= 0 ? focused.current : lastReading.current;
    bars.current[Math.min(n - 1, Math.max(0, from + (e.key === 'ArrowDown' ? 1 : -1)))]?.parentElement?.focus();
  };

  if (count < 2 || !fits) return null;
  return (
    <nav ref={outer} aria-label={t('chat.trail.label')} data-testid="chat-trail" onKeyDown={onKey}
      className="pointer-events-none absolute top-1/2 left-2 z-10 flex -translate-y-1/2 [@media(pointer:coarse)]:hidden">
      <div ref={inner} className="pointer-events-auto overflow-y-auto [scrollbar-width:none]" style={{ maxHeight: maxH || undefined }}
        onPointerMove={onMove} onPointerLeave={onLeave}>
        {Array.from({ length: count }, (_, i) => (
          <button key={i} type="button" tabIndex={i === 0 ? 0 : -1} aria-label={t('chat.trail.item', { n: i + 1, text: labels[i] ?? '' })}
            onClick={() => jump(i)} onFocus={() => { focused.current = i; show(i); }}
            onBlur={() => { if (hoverY.current === null) { focused.current = -1; setCard(null); } }}
            className="text-foreground focus-visible:ring-ring/60 flex w-10 items-center rounded-sm outline-none focus-visible:ring-2" style={{ height: TICK_PITCH }}>
            <span ref={(el) => { bars.current[i] = el; }} className="block h-0.5 rounded-full bg-current" style={{ width: TICK_REST, opacity: OPACITY.rest, transition: 'opacity 80ms' }} />
          </button>
        ))}
      </div>
      {card ? (
        <div ref={cardEl} className="bg-popover text-popover-foreground border-border pointer-events-none absolute left-12 w-max max-w-[380px] rounded-xl border px-3 py-2 text-sm shadow-lg">
          <p className="truncate font-medium">{card.title}</p>
          <p className="text-muted-foreground line-clamp-2">{card.reply || t('chat.trail.noReply')}</p>
        </div>
      ) : null}
    </nav>
  );
}
