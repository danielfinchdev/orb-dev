// What the person keeps next to a chat, in its info panel: their own notes (saved by themselves a moment after they stop
// typing) and the messages they pinned (src/engine/api/chat.mjs › chat.notes, chat.pin, chat.pinned). Neither is sent to the
// agent: they are for the person.
import { useEffect, useRef, useState } from 'react';
import { Pin, PinOff, StickyNote } from 'lucide-react';
import { Textarea } from '@/components/ui/basic.jsx';
import { Button } from '@/components/ui/button.jsx';
import { call, act, useStore } from '@/lib/store.js';
import { notify } from '@/lib/notify.js';
import { quiet } from '@/lib/quiet.js';
import { useT } from '@/lib/i18n.js';

export const MAX_NOTES = 4000;
const SAVE_MS = 800;

export function ChatNotes({ conversation }) {
  const t = useT();
  const [text, setText] = useState(null); // null while it loads
  const [state, setState] = useState('saved'); // 'saved' | 'saving' | 'error'
  const last = useRef('');
  const latest = useRef('');
  const timer = useRef(null);
  useEffect(() => {
    let alive = true;
    call('chat.notes', { conversation }).then((r) => { if (alive) { last.current = r?.notes ?? ''; latest.current = last.current; setText(last.current); } }).catch(quiet);
    return () => { alive = false; };
  }, [conversation]);
  const save = async () => {
    clearTimeout(timer.current);
    const value = latest.current;
    if (value === last.current) { setState('saved'); return; }
    setState('saving');
    try { await call('conversations.update', { id: conversation, notes: value }); last.current = value; setState(latest.current === value ? 'saved' : 'saving'); } catch { setState('error'); }
  };
  // leaving the panel (or the chat) saves what is pending
  useEffect(() => () => { clearTimeout(timer.current); if (latest.current !== last.current) call('conversations.update', { id: conversation, notes: latest.current }).catch(quiet); }, [conversation]);
  const change = (v) => { setText(v); latest.current = v; setState('saving'); clearTimeout(timer.current); timer.current = setTimeout(save, SAVE_MS); };
  return (
    <div data-testid="chat-notes">
      <label htmlFor={`chat-notes-${conversation}`} className="text-muted-foreground flex items-center gap-1.5 px-1 pb-1.5 text-caption font-medium tracking-wide uppercase"><StickyNote className="size-3.5" aria-hidden="true" />{t('notes.title')}</label>
      <Textarea id={`chat-notes-${conversation}`} value={text ?? ''} disabled={text === null} maxLength={MAX_NOTES} rows={4} placeholder={t('notes.placeholder')} onChange={(e) => change(e.target.value)} onBlur={save} className="min-h-24 resize-y text-control" data-testid="chat-notes-input" />
      <p className="text-muted-foreground px-1 pt-1 text-caption" role="status" aria-live="polite">{state === 'error' ? t('notes.error') : state === 'saving' ? t('notes.saving') : t('notes.hint')}</p>
    </div>
  );
}

// The pinned messages of the chat, most recent first; a click goes to the message when it is on screen.
export function PinnedList({ conversation, assistant, you }) {
  const t = useT();
  const version = useStore((s) => s.version);
  const [list, setList] = useState([]);
  useEffect(() => {
    let alive = true;
    const wait = setTimeout(() => { call('chat.pinned', { conversation }).then((r) => { if (alive) setList(Array.isArray(r) ? r : []); }).catch(quiet); }, 150);
    return () => { alive = false; clearTimeout(wait); };
  }, [conversation, version]);
  if (!list.length) return null;
  const goTo = (id) => {
    const el = document.getElementById(`msg-${id}`);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); else notify({ title: t('pins.notLoaded'), tone: 'info' }, { record: false });
  };
  const unpin = async (id) => { if ((await act(call('chat.pin', { conversation, id, pinned: false }))) !== undefined) setList((l) => l.filter((x) => x.id !== id)); };
  return (
    <div data-testid="chat-pinned">
      <div className="text-muted-foreground flex items-center gap-1.5 px-1 pb-1.5 text-caption font-medium tracking-wide uppercase"><Pin className="size-3.5" aria-hidden="true" />{t('pins.title', { n: list.length })}</div>
      <ul className="bg-card divide-y overflow-hidden rounded-xl border">
        {list.map((m) => (
          <li key={m.id} className="flex items-start gap-1 px-3.5 py-2">
            <button type="button" onClick={() => goTo(m.id)} className="hover:text-foreground min-w-0 flex-1 cursor-pointer text-left text-control" data-testid="pinned-go">
              <span className="text-muted-foreground block text-caption">{m.role === 'usuario' ? you : assistant}</span>
              <span className="line-clamp-3 break-words">{m.body}</span>
            </button>
            <Button type="button" size="icon-xs" variant="ghost" aria-label={t('pins.unpin')} title={t('pins.unpin')} onClick={() => unpin(m.id)} data-testid="pinned-unpin"><PinOff /></Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
