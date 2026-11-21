// Ajustes › Datos: deleted chats kept for a few days, with a button to bring each one back.
// The card draws nothing when the engine has no trash (trash.list unknown), so it degrades on older engines.
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button.jsx';
import { ListRow } from '@/components/ui/primitives.jsx';
import { call, act, bridge } from '@/lib/store.js';
import { ago } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { Block, Panel, Stack, Hint } from './rows.jsx';

export function TrashCard() {
  const t = useT();
  // null = not loaded yet or not supported: nothing is drawn.
  const [items, setItems] = useState(null);
  const load = () => call('trash.list').then((r) => setItems(Array.isArray(r) ? r : null)).catch(() => setItems(null));
  useEffect(() => {
    load();
    const offs = ['inbox:changed', 'trash:added'].map((ev) => bridge.on(ev, () => load()));
    return () => offs.forEach((off) => off?.());
  }, []);
  if (!items) return null;
  const restore = async (it) => {
    const method = it.kind === 'session' ? 'sessions.restore' : 'conversations.restore';
    await act(call(method, { id: it.id }), t('trash.restored'));
    load();
  };
  return (
    <Block title={t('trash.title')} note={t('trash.desc')} data-testid="trash-card">
      <Panel>
        {items.length ? items.map((it) => (
          <ListRow key={`${it.kind}:${it.id}`} className="border-border rounded-none not-first:border-t" title={it.title} meta={ago(it.trashedAt)}
            trailing={<Button size="xs" variant="outline" onClick={() => restore(it)} data-testid="trash-restore">{t('trash.restore')}</Button>} />
        )) : <Stack><Hint data-testid="trash-empty">{t('trash.empty')}</Hint></Stack>}
      </Panel>
    </Block>
  );
}
