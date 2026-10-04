// Bitácoras: the assistant's memory (general log and one per project). Read-only here: only the assistant appends.
import { useEffect, useState } from 'react';
import { BookOpen, Copy, Maximize2, NotebookText } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page.jsx';
import { Markdown } from '@/components/markdown.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Card, Spinner } from '@/components/ui/basic.jsx';
import { useStore, call } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';

export function LogsView({ route }) {
  const version = useStore((s) => s.version);
  const [logs, setLogs] = useState([]);
  const [selected, setSelected] = useState(route.name ?? 'general');
  const [whole, setWhole] = useState(false);
  const [text, setText] = useState(null);
  useEffect(() => { call('logs.list').then(setLogs).catch(() => {}); }, [version]);
  useEffect(() => { setText(null); call('logs.read', { project: selected, whole }).then(setText).catch((e) => setText(e.message)); }, [selected, whole, version]);
  const partial = text?.startsWith('(');
  return (
    <>
      <PageHeader icon={<BookOpen className="text-primary size-5" />} title="Bitácoras" meta="Lo que se pidió, se hizo y queda pendiente. Solo crecen: nada se borra." />
      <div className="grid min-h-0 flex-1 grid-cols-[240px_1fr] gap-4 overflow-hidden px-5 py-5">
        <Card className="gap-0.5 overflow-y-auto p-2">
          {logs.map((l) => (
            <button key={l.name} onClick={() => { setSelected(l.name); setWhole(false); }} className={cn('flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors', selected === l.name ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50')}>
              <NotebookText className={cn('size-4', l.name === 'general' ? 'text-primary' : 'text-muted-foreground')} />
              <span className="min-w-0 flex-1 truncate">{l.name === 'general' ? 'General' : l.name}</span>
              <span className="text-muted-foreground text-[11px]">{Math.max(1, Math.ceil(l.size / 1024))} KB</span>
            </button>
          ))}
        </Card>
        <Card className="min-h-0 gap-3 overflow-hidden">
          <div className="flex items-center gap-2 px-5">
            <h2 className="flex-1 text-[16px]">{selected === 'general' ? 'Bitácora general' : `Bitácora de ${selected}`}</h2>
            {partial && !whole ? <Button size="sm" variant="ghost" onClick={() => setWhole(true)}><Maximize2 />Ver entera</Button> : null}
            <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(text ?? '').then(() => toast.success('Copiada'))}><Copy />Copiar</Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-2 text-[14px]">{text == null ? <Spinner /> : <Markdown>{text}</Markdown>}</div>
        </Card>
      </div>
    </>
  );
}
