// «/side»: the side chats of a conversation (src/engine/side.mjs). A question apart, read only: it is answered here and never
// written into the chat or the project. They live in the engine's memory and expire; «Cerrar» ends one at once.
import { useEffect, useState } from 'react';
import { MessagesSquare, X, ArrowUp } from 'lucide-react';
import { call, act, bridge } from '@/lib/store.js';
import { quiet } from '@/lib/quiet.js';
import { useT } from '@/lib/i18n.js';
import { Button } from '@/components/ui/button.jsx';
import { Tip } from '@/components/ui/overlay.jsx';
import { Markdown } from '@/components/markdown.jsx';

// the open side chats of a conversation: the engine pushes each change (session:side), and says when one is gone
export function useSides(id) {
  const [sides, setSides] = useState([]);
  useEffect(() => {
    let alive = true;
    setSides([]);
    call('sessions.sides', { id }).then((l) => { if (alive && Array.isArray(l)) setSides(l); }).catch(quiet);
    const off = bridge.on('session:side', (e) => {
      if (e.id !== id || !e.side) return;
      setSides((prev) => (e.side.closed ? prev.filter((x) => x.id !== e.side.id) : prev.some((x) => x.id === e.side.id) ? prev.map((x) => (x.id === e.side.id ? e.side : x)) : [...prev, e.side]));
    });
    return () => { alive = false; off(); };
  }, [id]);
  return sides;
}

function Side({ id, side }) {
  const t = useT();
  const [text, setText] = useState('');
  const running = side.status === 'running';
  const ask = () => { const q = text.trim(); if (!q || running) return; setText(''); act(call('sessions.sideAsk', { id, side: side.id, text: q })); };
  return (
    <div className="bg-card rounded-xl border text-control" data-testid="side-chat" data-status={side.status}>
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <MessagesSquare className="text-muted-foreground size-3.5" />
        <span className="font-medium">{t('session.side.title')}</span>
        <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">{t('session.side.note')}</span>
        <Tip label={t('session.side.close')}><Button variant="ghost" size="icon-sm" aria-label={t('session.side.close')} onClick={() => act(call('sessions.sideClose', { side: side.id }))} data-testid="side-close"><X /></Button></Tip>
      </div>
      <div className="grid max-h-80 gap-2 overflow-auto px-3 py-2">
        {side.turns.map((turn, i) => (
          <div key={i} className="grid gap-1">
            <div className="text-muted-foreground text-xs">{turn.q}</div>
            {turn.a ? <Markdown>{turn.a}</Markdown> : i === side.turns.length - 1 && running ? <div className="text-muted-foreground text-xs">{t('session.side.thinking')}</div> : null}
          </div>
        ))}
        {side.error ? <div className="text-destructive text-xs">{side.error}</div> : null}
      </div>
      <div className="flex items-center gap-1.5 border-t px-3 py-1.5">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); ask(); } }}
          placeholder={t('session.side.placeholder')} disabled={running} className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-control outline-none" data-testid="side-input" />
        <Tip label={t('session.side.ask')}><Button variant="ghost" size="icon-sm" aria-label={t('session.side.ask')} disabled={running || !text.trim()} onClick={ask}><ArrowUp /></Button></Tip>
      </div>
    </div>
  );
}

export function SideChats({ id }) {
  const sides = useSides(id);
  if (!sides.length) return null;
  return <div className="mx-auto grid w-full max-w-3xl shrink-0 gap-2 px-5 pb-2" data-testid="side-chats">{sides.map((s) => <Side key={s.id} id={id} side={s} />)}</div>;
}
