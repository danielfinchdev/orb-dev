// Ajustes › Datos: deleted chats kept for a few days, with a button to bring each one back.
// The card draws nothing when the engine has no trash (trash.list unknown), so it degrades on older engines.
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/basic.jsx';
import { ListRow } from '@/components/ui/primitives.jsx';
import { call, act, bridge } from '@/lib/store.js';
import { ago } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';

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
    <Card data-testid="trash-card">
      <CardHeader><CardTitle>{t('trash.title')}</CardTitle><CardDescription>{t('trash.desc')}</CardDescription></CardHeader>
      <CardContent className="grid gap-1">
        {items.length ? items.map((it) => (
          <ListRow key={`${it.kind}:${it.id}`} title={it.title} meta={ago(it.trashedAt)}
            trailing={<Button size="sm" variant="outline" onClick={() => restore(it)} data-testid="trash-restore">{t('trash.restore')}</Button>} />
        )) : <p className="text-muted-foreground text-sm" data-testid="trash-empty">{t('trash.empty')}</p>}
      </CardContent>
    </Card>
  );
}
