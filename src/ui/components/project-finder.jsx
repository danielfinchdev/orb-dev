// Ctrl+P (a file of the project) and Ctrl+Shift+F (a text in the project), inside the command palette's window. The engine
// does the search (projects.findFiles / projects.searchText: only the project's folder, never secrets); choosing a result
// puts its path (and line) in the message box, ready to be sent: nothing is sent or opened by itself.
import { useEffect, useRef, useState } from 'react';
import { Search, FileText, CornerDownLeft, FileSearch } from 'lucide-react';
import { DialogContent, DialogTitle, DialogDescription } from '@/components/ui/overlay.jsx';
import { Kbd } from '@/components/ui/basic.jsx';
import { useStore, call } from '@/lib/store.js';
import { addToChat, asPath } from '@/lib/add-to-chat.js';
import { useT } from '@/lib/i18n.js';
import { cn } from '@/lib/utils.js';

const split = (file) => { const i = file.lastIndexOf('/'); return i < 0 ? ['', file] : [file.slice(0, i), file.slice(i + 1)]; };

// The project the search is about: the one of the chat on screen, else the active one.
export function useFinderProject() {
  return useStore((s) => {
    const chat = s.route?.view === 'chat' && s.route.id != null ? s.conversations.find((c) => c.id === s.route.id)?.project : null;
    return chat || s.app?.activeProject?.name || null;
  });
}

export function ProjectFinder({ mode, onClose }) {
  const t = useT();
  const project = useFinderProject();
  const [q, setQ] = useState('');
  const [state, setState] = useState({ rows: [], busy: false, error: '', engine: '' });
  const [at, setAt] = useState(0);
  const ticket = useRef(0);
  const list = useRef(null);
  const files = mode === 'files';
  useEffect(() => {
    const need = files ? 1 : 2;
    if (!project || q.trim().length < need) { ticket.current += 1; setState({ rows: [], busy: false, error: '', engine: '' }); return undefined; }
    const mine = ++ticket.current;
    setState((s) => ({ ...s, busy: true, error: '' }));
    const wait = setTimeout(async () => {
      try {
        const r = await call(files ? 'projects.findFiles' : 'projects.searchText', { project, q: q.trim() });
        if (mine !== ticket.current) return;
        setState({ rows: files ? r.files.map((file) => ({ file })) : r.hits, busy: false, error: '', engine: r.engine });
      } catch (e) {
        if (mine === ticket.current) setState({ rows: [], busy: false, error: String(e?.message ?? e), engine: '' });
      }
    }, 180);
    return () => clearTimeout(wait);
  }, [q, project, files]);
  useEffect(() => { setAt(0); }, [state.rows]);
  useEffect(() => { list.current?.querySelector('[data-active=true]')?.scrollIntoView({ block: 'nearest' }); }, [at]);
  const choose = (row) => { if (!row) return; onClose(); addToChat(asPath(row.file, row.line)); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAt((i) => Math.min(state.rows.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); choose(state.rows[at]); }
  };
  const Icon = files ? FileSearch : Search;
  const title = t(files ? 'finder.filesTitle' : 'finder.textTitle');
  return (
    <DialogContent instant showClose={false} className="top-[18%] translate-y-0 sm:max-w-xl gap-0 overflow-hidden p-0" onKeyDown={onKey} data-testid="project-finder">
      <DialogTitle className="sr-only">{title}</DialogTitle>
      <DialogDescription className="sr-only">{t('finder.hint')}</DialogDescription>
      <label className="flex h-12 items-center gap-2.5 border-b px-4">
        <Icon className="text-muted-foreground size-4 shrink-0" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} disabled={!project} placeholder={project ? t(files ? 'finder.filesPlaceholder' : 'finder.textPlaceholder', { project }) : t('finder.noProject')} aria-label={title}
          className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-body compact:text-control outline-none" data-testid="finder-input" />
        <Kbd>Esc</Kbd>
      </label>
      <div ref={list} className="max-h-[min(60vh,420px)] overflow-y-auto p-1.5" role="listbox" aria-label={title} aria-busy={state.busy}>
        {state.rows.map((row, i) => {
          const [dir, name] = split(row.file);
          return (
            <button key={`${row.file}:${row.line ?? ''}`} type="button" role="option" aria-selected={i === at} data-active={i === at} onMouseMove={() => setAt(i)} onClick={() => choose(row)}
              className={cn('flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-left text-control compact:text-control', i === at && 'bg-accent')} data-testid="finder-row">
              <FileText className="text-muted-foreground size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{name}{row.line ? <span className="text-muted-foreground">:{row.line}</span> : null}{dir ? <span className="text-muted-foreground text-caption"> · {dir}</span> : null}</span>
                {row.text ? <span className="text-muted-foreground block truncate text-caption">{row.text}</span> : null}
              </span>
              {i === at ? <CornerDownLeft className="text-muted-foreground size-3.5 shrink-0" /> : null}
            </button>
          );
        })}
        <p className="text-muted-foreground px-3 py-3 text-sm compact:text-control" role="status" aria-live="polite">
          {state.error || (!project ? t('finder.noProject') : state.busy ? t('finder.searching') : q.trim().length < (files ? 1 : 2) ? t('finder.type') : !state.rows.length ? t('finder.none') : t('finder.chooseHint'))}
        </p>
      </div>
    </DialogContent>
  );
}
