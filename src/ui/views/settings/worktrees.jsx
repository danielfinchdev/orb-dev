// Ajustes › Datos: the own copies (git worktrees) of chats that are gone or archived. Their folder is the only place that
// holds the chat's work, so it is never removed unasked: «Quitar» goes through the same confirmation as archiving the chat.
// The card draws nothing when there is none, or when the engine does not know the method.
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button.jsx';
import { ListRow } from '@/components/ui/primitives.jsx';
import { call, bridge } from '@/lib/store.js';
import { offerWorktreeRemoval } from '@/components/worktree-removal.jsx';
import { useT } from '@/lib/i18n.js';
import { Block, Panel } from './rows.jsx';
import { notifyError } from '@/lib/notify.js';

export function WorktreesCard() {
  const t = useT();
  const [items, setItems] = useState(null);
  const load = () => call('worktrees.list').then((r) => setItems(Array.isArray(r) ? r.filter((x) => !x.removed && (!x.chat || x.chat.archived)) : null)).catch(() => setItems(null));
  useEffect(() => {
    load();
    const offs = ['session:update', 'session:removed', 'trash:added'].map((ev) => bridge.on(ev, () => load()));
    return () => offs.forEach((off) => off?.());
  }, []);
  if (!items?.length) return null;
  const remove = async (it) => {
    if (it.gone) await call('worktrees.discard', { id: it.id }).catch(notifyError); // nothing on disk: only the record and a safe branch go
    else await offerWorktreeRemoval({ id: it.id }, t);
    load();
  };
  return (
    <Block title={t('wtcopies.title')} note={t('wtcopies.desc')} data-testid="worktrees-card">
      <Panel>
        {items.map((it) => (
          <ListRow key={it.id} className="border-border rounded-none not-first:border-t" title={it.chat?.title ?? t('wtcopies.deleted', { project: it.project })} meta={`${it.branch} · ${it.chat ? t('wtcopies.archived') : t('wtcopies.deletedChat')} · ${it.path}`}
            trailing={<Button size="xs" variant="outline" onClick={() => remove(it)} data-testid="worktree-remove">{t('wtcopies.remove')}</Button>} />
        ))}
      </Panel>
    </Block>
  );
}
