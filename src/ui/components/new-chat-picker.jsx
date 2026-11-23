// «New chat»: one click opens this picker (No project, then the projects) instead of a menu that needs a second click.
// Keys: ↑ ↓ move, Enter picks, Esc closes (the dialog), Ctrl+1…9 pick that row at once, typing filters the list.
import { useMemo, useState } from 'react';
import { CircleSlash } from 'lucide-react';
import { DialogHeader, DialogTitle, DialogDescription, DialogBody } from '@/components/ui/overlay.jsx';
import { SearchInput } from '@/components/ui/primitives.jsx';
import { ProjectIcon } from '@/components/project-icon.jsx';
import { useStore } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';
import { cn } from '@/lib/utils.js';
import { pickerEntries, digitIndex, moveActive, PICKER_KEYS } from '@/lib/chat-picker.js';

export function NewChatPicker({ onChoose }) {
  const t = useT();
  const projects = useStore((s) => s.projects) ?? [];
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const none = t('orbchats.noProject');
  const entries = useMemo(() => pickerEntries(projects, query, none), [projects, query, none]);
  const pick = (i) => { const e = entries[i]; if (e) onChoose({ project: e.project }); };
  const onKeyDown = (e) => {
    const d = digitIndex(e);
    if (d >= 0) { e.preventDefault(); if (d < PICKER_KEYS) pick(d); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); setActive((a) => moveActive(a, e.key, entries.length)); return; }
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); pick(Math.min(active, entries.length - 1)); }
  };
  return (
    <div className="flex max-h-[inherit] min-h-0 flex-col" onKeyDown={onKeyDown} data-testid="new-chat-picker">
      <DialogHeader className="flex-none"><DialogTitle>{t('nav.newChat')}</DialogTitle><DialogDescription>{t('newchat.pickHint')}</DialogDescription></DialogHeader>
      <DialogBody className="grid gap-2 p-3.5">
        <SearchInput autoFocus value={query} onChange={(v) => { setQuery(v); setActive(0); }} placeholder={t('newchat.search')} className="w-full" data-testid="new-chat-search" />
        <div role="listbox" aria-label={t('nav.newChat')} className="grid max-h-[50vh] gap-0.5 overflow-y-auto" data-testid="new-chat-list">
          {entries.map((e, i) => (
            <button key={e.project ?? '\0none'} type="button" role="option" aria-selected={i === active} onClick={() => pick(i)} onMouseMove={() => setActive(i)} tabIndex={-1}
              className={cn('flex h-(--ctl) w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-ctl px-2.5 text-left text-control', i === active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60')}
              data-testid={e.project === null ? 'new-conversation' : `new-chat-project-${e.project}`}>
              {e.project === null ? <CircleSlash className="size-4 shrink-0" aria-hidden="true" /> : <ProjectIcon name={e.project} />}
              <span className="min-w-0 flex-1 truncate">{e.project ?? none}</span>
              {i < PICKER_KEYS ? <kbd className="text-faint-foreground shrink-0 font-sans text-micro">Ctrl+{i + 1}</kbd> : null}
            </button>
          ))}
          {entries.length ? null : <p className="text-muted-foreground m-0 px-2.5 py-3 text-control">{t('chats.noResults')}</p>}
        </div>
      </DialogBody>
    </div>
  );
}
