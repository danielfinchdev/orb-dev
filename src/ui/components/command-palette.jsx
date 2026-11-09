// 3.8.2: Ctrl+K on the PC: jump to a chat, a task, a project or a place of Orb, or start something, by typing. It adds
// to the sidebar's search (the same search, lib/search.js) and never takes the key from what already uses it: a project
// action with Ctrl+K, the whiteboard's own Ctrl+K or an open dialog keep it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, MessageSquarePlus, FolderPlus, ListTodo, FolderKanban, CalendarClock, PenTool, BookOpen, Bot, GraduationCap, SquareTerminal, Settings, MessageSquare, FileText, CornerDownLeft } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/overlay.jsx';
import { Kbd } from '@/components/ui/basic.jsx';
import { useOrbItems, openOrbItem, newProjectChat } from '@/views/orb/inbox.jsx';
import { useSearch } from '@/lib/search.js';
import { isPaletteKey, paletteGroups } from '@/lib/palette.js';
import { useStore, go, newChat, openSettings, openOrbInfo, fullPc } from '@/lib/store.js';
import { STATUS } from '@/lib/labels.js';
import { useT } from '@/lib/i18n.js';
import { cn } from '@/lib/utils.js';

// The places and actions, in the sidebar's order.
function commands(t, config) {
  return [
    { key: 'new-chat', icon: MessageSquarePlus, label: t('nav.newChat'), run: () => newChat() },
    { key: 'new-project', icon: FolderPlus, label: t('comp.projects.newTitle'), run: newProjectChat },
    { key: 'tasks', icon: ListTodo, label: t('nav.tasks'), run: () => go({ view: 'tasks' }) },
    { key: 'projects', icon: FolderKanban, label: t('nav.projects'), run: () => go({ view: 'projects' }) },
    { key: 'schedules', icon: CalendarClock, label: t('nav.schedules'), run: () => go({ view: 'schedules' }) },
    { key: 'board', icon: PenTool, label: t('nav.board'), run: () => go({ view: 'board' }) },
    { key: 'logs', icon: BookOpen, label: t('nav.memories'), run: () => go({ view: 'logs' }) },
    { key: 'agents', icon: Bot, label: t('nav.agents'), run: () => go({ view: 'agents' }) },
    { key: 'tutorials', icon: GraduationCap, label: t('nav.tutorials'), run: () => go({ view: 'tutorials' }) },
    ...(config?.expert?.enabled && fullPc() ? [{ key: 'expert', icon: SquareTerminal, label: t('nav.expert'), run: () => go({ view: 'expert' }) }] : []),
    { key: 'settings', icon: Settings, label: t('nav.settings'), run: () => openSettings() }
  ];
}

const TITLE = { go: 'palette.places', chats: 'orbchats.chatsFound', messages: 'chats.messages', tasks: 'orbchats.tasksFound', projects: 'orbchats.projectsFound' };

function Palette({ onClose }) {
  const t = useT();
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const config = useStore((s) => s.app?.config);
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const items = useOrbItems();
  const found = useSearch(q);
  const cmds = useMemo(() => commands(t, config), [t, config]);
  const groups = useMemo(() => paletteGroups({ q, cmds, items, found, tasks, projects }), [q, cmds, items, found, tasks, projects]);
  // Every row as { key, icon, label, detail, run }, in the order shown.
  const rows = groups.flatMap((g) => g.rows.map((r) => {
    if (g.id === 'go') return { ...r, group: g.id };
    if (g.id === 'chats') return { group: g.id, key: `c:${r.key}`, icon: MessageSquare, label: r.title, detail: r.project ?? '', run: () => openOrbItem(r) };
    if (g.id === 'messages') return { group: g.id, key: `m:${r.key}:${r.line.id}`, icon: FileText, label: r.item.title, detail: r.line.text, run: () => openOrbItem(r.item) };
    if (g.id === 'tasks') return { group: g.id, key: `t:${r.id}`, icon: ListTodo, label: `#${r.id} ${r.title}`, detail: r.snippet || (STATUS[r.status]?.[0] ?? r.status), run: () => go({ view: 'tasks', id: r.id }) };
    return { group: g.id, key: `p:${r.name}`, icon: FolderKanban, label: r.name, detail: '', run: () => openOrbInfo({ type: 'project', name: r.name }) };
  }));
  useEffect(() => { setAt(0); }, [q]);
  const list = useRef(null);
  useEffect(() => { list.current?.querySelector('[data-active=true]')?.scrollIntoView({ block: 'nearest' }); }, [at]);
  const run = (row) => { if (!row) return; onClose(); row.run(); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAt((i) => Math.min(rows.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); run(rows[at]); }
  };
  let index = -1;
  return (
    <DialogContent showClose={false} className="top-[18%] translate-y-0 sm:max-w-xl gap-0 overflow-hidden p-0" onKeyDown={onKey} data-testid="command-palette">
      <DialogTitle className="sr-only">{t('palette.title')}</DialogTitle>
      <DialogDescription className="sr-only">{t('palette.hint')}</DialogDescription>
      <label className="flex h-12 items-center gap-2.5 border-b px-4">
        <Search className="text-muted-foreground size-4 shrink-0" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('palette.placeholder')} aria-label={t('palette.placeholder')} className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-[14.5px] outline-none" data-testid="palette-input" />
        <Kbd>Esc</Kbd>
      </label>
      <div ref={list} className="max-h-[min(60vh,420px)] overflow-y-auto p-1.5" role="listbox" aria-label={t('palette.title')}>
        {groups.map((g) => (
          <div key={g.id}>
            <div className="text-muted-foreground px-2.5 pt-2 pb-1 text-[11px] font-medium tracking-wide uppercase">{t(TITLE[g.id])}</div>
            {g.rows.map(() => {
              index += 1; const i = index; const row = rows[i];
              const Icon = row.icon;
              return (
                <button key={row.key} type="button" role="option" aria-selected={i === at} data-active={i === at} onMouseMove={() => setAt(i)} onClick={() => run(row)}
                  className={cn('flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[13.5px]', i === at && 'bg-accent')} data-testid={`palette-${row.key}`}>
                  <Icon className="text-muted-foreground size-4 shrink-0" />
                  <span className="min-w-0 flex-1"><span className="block truncate">{row.label}</span>{row.detail ? <span className="text-muted-foreground block truncate text-[12.5px]">{row.detail}</span> : null}</span>
                  {i === at ? <CornerDownLeft className="text-muted-foreground size-3.5 shrink-0" /> : null}
                </button>
              );
            })}
          </div>
        ))}
        {!rows.length ? <p className="text-muted-foreground px-3 py-4 text-sm">{t('chats.noResults')}</p> : null}
      </div>
    </DialogContent>
  );
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e) => {
      if (!isPaletteKey(e) || e.repeat) return;
      // After every other handler of this key: a project action, the whiteboard or a dialog that took it keeps it.
      setTimeout(() => { if (!e.defaultPrevented && !document.querySelector('[role=dialog]')) setOpen(true); }, 0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return <Dialog open={open} onOpenChange={setOpen}>{open ? <Palette onClose={() => setOpen(false)} /> : null}</Dialog>;
}
