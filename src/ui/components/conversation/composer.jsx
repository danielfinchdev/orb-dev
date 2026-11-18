// The message box shared by the chat with the assistant (views/chat.jsx) and an agent's conversation
// (views/session.jsx), and the scrolling that keeps a conversation at its bottom.
import { useCallback, useEffect, useRef, useState } from 'react';
import { routeKey, takeDraft } from '@/lib/reload.js';
import { useDraftValue, useDraftBlocks } from '@/lib/draft.js';
import { isLongPaste, countLines, MAX_MESSAGE_CHARS } from '../../../shared/chat-compose.mjs';
import { micMode } from '@/lib/mic.js';
import { ArrowUp, Square, AtSign, Mic, ChevronRight, ClipboardPaste, X } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Tip } from '@/components/ui/overlay.jsx';
import { bridge, useStore, call, act, getState } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { notifyWarn } from '@/lib/notify.js';
import { useT, t as tNow } from '@/lib/i18n.js';

// A conversation stays at its bottom while the user has not scrolled up (`stick`): when a line arrives (deps) and,
// whenever the lines change height (older messages drawn late by content-visibility, markdown, pictures)
// or the area does (the composer grows): a ResizeObserver on the scrolling area and on its lines.
export function useAutoScroll(deps) {
  const node = useRef(null);
  const stick = useRef(true);
  const observer = useRef(null);
  const toBottom = useCallback(() => { const el = node.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, []);
  useEffect(toBottom, deps); // eslint-disable-line react-hooks/exhaustive-deps
  const ref = useCallback((el) => {
    observer.current?.disconnect(); observer.current = null;
    node.current = el;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const o = new ResizeObserver(toBottom);
    o.observe(el); if (el.firstElementChild) o.observe(el.firstElementChild);
    observer.current = o;
  }, [toBottom]);
  const onScroll = () => { const el = node.current; if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140; };
  return { ref, onScroll };
}

// "@" picker: while typing @word, a list of tasks, conversations and logs to attach as context (token @tarea:12…).
function useMentions(value, onChange, ta) {
  const [options, setOptions] = useState(null);
  const [index, setIndex] = useState(0);
  const caret = ta.current?.selectionStart ?? value.length;
  const match = /(^|\s)@([\wÀ-ɏ-]*)$/.exec(value.slice(0, caret));
  const query = match ? match[2].toLowerCase() : null;
  useEffect(() => { if (query !== null && !options) call('mentions.options').then(setOptions).catch(() => setOptions([])); }, [query !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  const fold = (x) => String(x ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const list = query === null ? [] : (options ?? []).filter((o) => fold(`${o.label} ${o.hint ?? ''}`).includes(fold(query))).slice(0, 8);
  useEffect(() => setIndex(0), [query]);
  const pick = (o) => {
    const before = value.slice(0, caret).replace(/@[\wÀ-ɏ-]*$/, `${o.token} `);
    onChange(before + value.slice(caret));
    requestAnimationFrame(() => { const el = ta.current; if (el) { el.focus(); el.selectionStart = el.selectionEnd = before.length; } });
  };
  const onKey = (e) => {
    if (!list.length) return false;
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => (i + 1) % list.length); return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => (i - 1 + list.length) % list.length); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(list[index]); return true; }
    if (e.key === 'Escape') { e.preventDefault(); onChange(value.slice(0, caret).replace(/@[\wÀ-ɏ-]*$/, '') + value.slice(caret)); return true; }
    return false;
  };
  return { list, index, pick, onKey };
}

// mentions: false hides the «@» picker. The microphone also dictates in a computer's browser that has speech
// recognition (the PC app opens Windows' voice typing instead).
const WebSpeech = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition || null) : null;
function webDictate(lang) {
  return new Promise((resolve, reject) => {
    const r = new WebSpeech(); r.lang = lang === 'en' ? 'en-US' : 'es-ES'; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = (e) => resolve(e.results?.[0]?.[0]?.transcript ?? '');
    r.onerror = (e) => reject(new Error(e.error === 'not-allowed' ? tNow('chats.dictateDenied') : tNow('chats.dictateOff')));
    r.onend = () => resolve('');
    r.start();
  });
}
// A long pasted text as a folded card above the box: its size, and its text when unfolded; «Quitar» drops it. The box itself
// stays as it was; the card's text goes with the message when it is sent (draft.message()).
function PastedCards({ draft, blocks }) {
  const t = useT();
  const [open, setOpen] = useState(null);
  if (!blocks.length) return null;
  return (
    <div className="grid gap-1.5 px-3 pt-3" data-testid="pasted-cards">
      {blocks.map((b) => {
        const lines = countLines(b.text); const shown = open === b.id;
        return (
          <div key={b.id} className="bg-muted/60 rounded-lg border text-control" data-testid="pasted-card">
            <div className="flex items-center gap-1 pr-1">
              <button type="button" className="hover:text-foreground flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left" aria-expanded={shown} onClick={() => setOpen(shown ? null : b.id)}>
                <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', shown && 'rotate-90')} aria-hidden="true" />
                <ClipboardPaste className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{t('paste.card', { lines, chars: b.text.length })}</span>
              </button>
              <Button type="button" size="icon-xs" variant="ghost" onClick={() => draft.removeBlock(b.id)} aria-label={t('paste.remove')} title={t('paste.remove')} data-testid="pasted-remove"><X /></Button>
            </div>
            {shown ? <pre className="text-muted-foreground mx-2.5 mb-2 max-h-48 overflow-auto font-mono text-xs whitespace-pre-wrap break-words" data-testid="pasted-text">{b.text}</pre> : null}
          </div>
        );
      })}
    </div>
  );
}

// the text lives in a draft (lib/draft.js) that only this box follows: a key redraws the box, not the view around
// it. attached: something besides text can be sent (pictures). The box grows with its text in CSS (field-sizing), with
// no layout read per key; where the browser lacks it, measured once per change.
const FIELD_SIZING = typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content');
export function Composer({ draft, onSend, onStop, busy, placeholder, suggestion, onSuggestionDone, top, above, bottom, notice, disabled, onPaste, onDrop, testid, attached = false, mentions = true }) {
  const t = useT();
  const ta = useRef(null);
  const value = useDraftValue(draft);
  const onChange = draft.set;
  // a proposed next message shows grey in the empty box; Tab takes it (it is never sent by itself), typing drops it
  const proposed = suggestion && !value ? suggestion : '';
  useEffect(() => { if (suggestion && value) onSuggestionDone?.(); }, [suggestion, value]); // eslint-disable-line react-hooks/exhaustive-deps
  const blocks = useDraftBlocks(draft);
  // a long text pasted goes to a card, not into the box (files and pictures keep the view's own handling)
  const paste = (e) => {
    const data = e.clipboardData; const text = data?.getData?.('text/plain') ?? '';
    if (!data?.files?.length && isLongPaste(text)) { e.preventDefault(); if (!draft.addBlock(text)) notifyWarn(tNow('paste.tooLong', { max: MAX_MESSAGE_CHARS.toLocaleString() })); return; }
    onPaste?.(e);
  };
  useEffect(() => { const el = ta.current; if (!el || FIELD_SIZING) return; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 260)}px`; }, [value]);
  const [dropping, setDropping] = useState(false);
  const m = useMentions(value, onChange, ta);
  // what this box had when F5 reloaded the window comes back on the same screen (lib/reload.js).
  const here = useStore((s) => routeKey(s.route));
  useEffect(() => { if (!testid) return; const saved = takeDraft(testid, getState().route); if (saved && !draft.get().trim()) draft.set(saved); }, [testid, here]); // eslint-disable-line react-hooks/exhaustive-deps
  // Windows' voice typing in Orb for Windows, nothing on a phone (its keyboard dictates), the browser's speech
  // recognition in a computer's browser (lib/mic.js).
  const mic = micMode({ desktop: Boolean(bridge.desktop), windowsDictation: Boolean(bridge.dictateWindows), androidApp: window.__orbHost?.app === true, mobile: Boolean(bridge.mobile),
    coarse: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches, webSpeech: Boolean(WebSpeech) });
  const [hearing, setHearing] = useState(false);
  const dictate = async () => {
    // Windows writes what is said into the box that has the focus: the message box, with the cursor at the end.
    if (mic === 'windows') {
      const el = ta.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
      await act(bridge.dictateWindows().catch(() => { throw new Error(t('chat.dictateFailed')); }));
      return;
    }
    setHearing(true);
    try { const said = await act(webDictate(getState().app?.config?.language ?? 'es')); if (said) onChange(value.trim() ? `${value.trimEnd()} ${said}` : said); }
    finally { setHearing(false); }
  };
  return (
    <div className="composer-dock shrink-0 px-5 pb-5">
      {/* the row over the box (where the chat works, «Compactar»): outside the box, as wide as it. */}
      {above ? <div className="mx-auto mb-1.5 flex max-w-[var(--chat-max-width)] min-w-0 items-center gap-1" data-testid="composer-above">{above}</div> : null}
      <div data-slot="composer" className={cn('bg-card relative mx-auto max-w-[var(--chat-max-width)] rounded-big border border-[color-mix(in_oklab,var(--foreground)_10%,transparent)] shadow-[var(--shadow)] transition-shadow focus-within:ring-[3px] focus-within:ring-ring/25', dropping && 'ring-ring ring-2')}
        onDragOver={onDrop ? (e) => { e.preventDefault(); setDropping(true); } : undefined} onDragLeave={() => setDropping(false)} onDrop={onDrop ? (e) => { e.preventDefault(); setDropping(false); onDrop(e); } : undefined}>
        {mentions && m.list.length ? null : notice}
        {mentions && m.list.length ? (
          <div className="bg-popover text-popover-foreground absolute right-3 bottom-full left-3 z-20 mb-2 overflow-hidden rounded-xl border shadow-lg" data-testid="mention-list">
            <div className="text-muted-foreground border-b px-3 py-1.5 text-micro">{t('chat.mentionHeader')}</div>
            {m.list.map((o, i) => (
              <button key={o.token} onMouseDown={(e) => { e.preventDefault(); m.pick(o); }} className={cn('flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-control', i === m.index ? 'bg-accent' : 'hover:bg-accent/60')}>
                {o.icon ?? <AtSign className="text-muted-foreground size-3.5 shrink-0" />}<span className="min-w-0 flex-1 truncate">{o.label}</span><span className="text-muted-foreground shrink-0 text-micro">{o.hint}</span>
              </button>
            ))}
          </div>
        ) : null}
        {top ? <div className="flex min-w-0 items-center gap-2 px-3 pt-3" data-testid="composer-top">{top}</div> : null}
        <PastedCards draft={draft} blocks={blocks} />
        <textarea ref={ta} data-testid={testid} value={value} disabled={disabled} rows={2} placeholder={proposed || placeholder} title={proposed ? t('session.suggest.hint') : undefined} onPaste={paste}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (proposed && e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); onChange(proposed); return; } if (mentions && m.onKey(e)) return; if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onSend({ alt: e.ctrlKey || e.metaKey }); } }}
          className="composer-text placeholder:text-muted-foreground block w-full resize-none bg-transparent px-4 pt-3 pb-1 text-body compact:text-body compact:leading-5 leading-relaxed outline-none" />
        <div className="flex items-center gap-2 px-3 pb-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1" data-testid="composer-bottom">{bottom}</div>
          {mic ? <Tip label={t('chat.dictate')}><Button size="icon-sm" variant="ghost" className="rounded-full" onClick={dictate} disabled={disabled || hearing} aria-label={t('chat.dictate')} data-testid="dictate"><Mic className={hearing ? 'text-primary-text animate-pulse' : undefined} /></Button></Tip> : null}
          {busy && onStop ? <Tip label={t('chat.stop')}><Button size="icon-sm" variant="secondary" onClick={onStop} aria-label={t('chat.stop')}><Square className="size-3.5 fill-current" /></Button></Tip> : null}
          <Button size="icon-sm" className={cn('rounded-full', !disabled && 'disabled:opacity-100')} onClick={() => onSend({ alt: false })} disabled={disabled || !(value.trim() || attached || blocks.length)} aria-label={t('chat.send')} data-testid="send"><ArrowUp /></Button>
        </div>
      </div>
    </div>
  );
}
