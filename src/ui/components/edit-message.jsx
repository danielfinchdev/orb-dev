// «Editar» on a user message of a direct chat, and the line a rewind leaves in the conversation.
import { Pencil, Undo2 } from 'lucide-react';
import { form } from '@/components/dialogs.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Textarea } from '@/components/ui/basic.jsx';
import { Checkbox, Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/overlay.jsx';
import { useStore, call, act } from '@/lib/store.js';
import { notifyError } from '@/lib/notify.js';
import { useT, t } from '@/lib/i18n.js';

const textOf = (body) => (typeof body === 'string' ? body : body?.text ?? '');

async function edit(sessionId, item) {
  let info;
  try { info = await call('sessions.rewindInfo', { id: sessionId, item: item.id }); } catch (error) { notifyError(error); return; }
  if (!info.canEdit) { notifyError(new Error(info.editWhy)); return; }
  await form(t('edit.title'), {
    description: t('edit.desc'), initial: { text: textOf(item.body), rewind: false }, wide: true,
    body: (v, set) => (
      <div className="flex flex-col gap-3">
        <Textarea value={v.text} onChange={(e) => set({ text: e.target.value })} className="min-h-28" autoFocus data-testid="edit-text" />
        <label className={`flex items-start gap-2 text-control ${info.canRewind ? '' : 'opacity-60'}`}>
          <Checkbox checked={Boolean(v.rewind) && info.canRewind} disabled={!info.canRewind} onCheckedChange={(on) => set({ rewind: on === true })} className="mt-0.5" data-testid="edit-rewind" />
          <span>{t('edit.rewind')}</span>
        </label>
        {info.canRewind ? <p className="text-xs font-medium" data-testid="edit-commits-kept">{t('edit.commitsKept')}</p> : null}
        {item.body?.images?.length ? <p className="text-muted-foreground text-xs" data-testid="edit-images">{t('edit.imagesKept', { n: item.body.images.length })}</p> : null}
        <p className="text-muted-foreground text-xs">{info.canRewind ? t('edit.rewindHelp') : t('edit.rewindOff', { why: info.rewindWhy })}</p>
      </div>
    ),
    ok: t('edit.save'),
    onOk: (v) => {
      if (!String(v.text ?? '').trim()) throw new Error(t('edit.empty'));
      return call(v.rewind && info.canRewind ? 'sessions.editRewind' : 'sessions.edit', { id: sessionId, item: item.id, text: v.text });
    },
  });
}

export function EditButton({ sessionId, item }) {
  const t = useT();
  const chat = useStore((s) => s.sessions.find((x) => x.id === sessionId));
  // only a saved message of a chat that is not answering now; a steering note or an unsent message has nothing to go back to
  if (!chat || chat.kind !== 'chat' || chat.status === 'running' || !Number.isInteger(item?.id) || item.body?.steer) return null;
  return <Button variant="ghost" size="sm" onClick={() => edit(sessionId, item)} data-testid="edit-message"><Pencil />{t('edit.button')}</Button>;
}

function Paths({ title, list }) {
  return list?.length ? <div className="mt-1"><div>{title}</div><ul className="font-mono">{list.map((p) => <li key={p} className="break-all">{p}</li>)}</ul></div> : null;
}

export function RewindLine({ sessionId, item }) {
  const t = useT();
  const body = item.body ?? {};
  const result = body.undone ? body.result ?? {} : null;
  const counts = result
    ? t('rewind.lineUndone', { restored: result.restored ?? 0, removed: result.removed ?? 0, skipped: result.skipped ?? 0 })
    : t('rewind.line', { restored: body.restored ?? 0, removed: body.removed ?? 0, skipped: body.skipped ?? 0 });
  const skipped = result ? result.skippedFiles : body.files?.skipped;
  return (
    <Collapsible className="text-muted-foreground text-center text-xs" data-testid="rewind-line">
      <span>{counts}</span>
      {skipped?.length ? <> · <CollapsibleTrigger className="cursor-pointer underline-offset-2 hover:underline">{t('rewind.skipped')}</CollapsibleTrigger></> : null}
      {!body.undone ? <Button variant="ghost" size="sm" className="ml-2" onClick={() => act(call('sessions.rewindUndo', { id: sessionId, item: item.id }))} data-testid="rewind-undo"><Undo2 />{t('rewind.undo')}</Button> : null}
      <CollapsibleContent className="bg-muted/40 mt-2 rounded-xl px-3.5 py-2.5 text-left">
        <Paths title={t('rewind.skipped')} list={skipped} />
        {(body.skipped ?? 0) > (skipped?.length ?? 0) ? <div className="mt-1 italic">{t('rewind.moreHint')}</div> : null}
      </CollapsibleContent>
    </Collapsible>
  );
}
