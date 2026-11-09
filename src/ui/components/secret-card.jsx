// 3.8.2 (T3 3.4): the private card of a secret an agent asked for (orb_request_secret, src/engine/agent-secrets.mjs).
// Only in this PC's window: the value typed here goes to the engine once and never shows in the chat; saving it in the
// vault, or using the one saved, asks for the master password.
import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { unlockCore } from '@/lib/core-access.js';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/basic.jsx';
import { Checkbox } from '@/components/ui/overlay.jsx';
import { call, act, bridge, fullPc } from '@/lib/store.js';
import { AGENT } from '@/lib/labels.js';
import { useT } from '@/lib/i18n.js';

function SecretCard({ r }) {
  const t = useT();
  const [value, setValue] = useState('');
  const [save, setSave] = useState(false);
  const [busy, setBusy] = useState(false);
  const answer = async (params, action) => {
    const unlock = action ? await unlockCore(action) : null;
    if (action && !unlock) return;
    setBusy(true);
    try { if (await act(call('secrets.answer', { id: r.id, ...params, ...(unlock ? { unlock } : {}) }))) setValue(''); } finally { setBusy(false); }
  };
  const send = () => { if (value) answer({ value, save }, save ? 'secretSave' : null); };
  return (
    <form className="bg-card grid gap-2.5 rounded-xl border px-3.5 py-3 text-[13px]" data-testid="secret-card" autoComplete="off" onSubmit={(e) => { e.preventDefault(); send(); }}>
      <div className="flex items-center gap-2 font-medium"><KeyRound className="text-muted-foreground size-4 shrink-0" />{t('secrets.title', { agent: AGENT[r.agent] ?? r.agent, name: r.name })}</div>
      <p className="text-muted-foreground">{r.reason}</p>
      <Input type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder={r.name} autoComplete="new-password" spellCheck={false} maxLength={8192} aria-label={t('secrets.value')} data-testid="secret-value" />
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-muted-foreground mr-auto flex cursor-pointer items-center gap-2"><Checkbox checked={save} onCheckedChange={(v) => setSave(v === true)} data-testid="secret-save" />{t('secrets.save')}</label>
        {r.saved ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => answer({ saved: true }, 'secretSaved')} data-testid="secret-use-saved">{t('secrets.useSaved')}</Button> : null}
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => act(call('secrets.decline', { id: r.id }))} data-testid="secret-decline">{t('secrets.decline')}</Button>
        <Button type="submit" size="sm" disabled={busy || !value} data-testid="secret-send">{t('secrets.send')}</Button>
      </div>
      <p className="text-muted-foreground text-xs">{t('secrets.note')}</p>
    </form>
  );
}

// The requests of one conversation waiting for an answer.
export function SecretCards({ sessionId }) {
  const [list, setList] = useState([]);
  useEffect(() => {
    if (!fullPc()) return undefined;
    let alive = true;
    const mine = (r) => r?.session === String(sessionId);
    call('secrets.pending').then((all) => { if (alive) setList((all ?? []).filter(mine)); }).catch(() => {});
    const offAsk = bridge.on('secret:request', (r) => { if (mine(r)) setList((prev) => [...prev.filter((x) => x.id !== r.id), r]); });
    const offDone = bridge.on('secret:done', (r) => setList((prev) => prev.filter((x) => x.id !== r?.id)));
    return () => { alive = false; offAsk(); offDone(); };
  }, [sessionId]);
  if (!list.length) return null;
  return <div className="mx-auto grid w-full max-w-3xl shrink-0 gap-2 px-5 pb-2">{list.map((r) => <SecretCard key={r.id} r={r} />)}</div>;
}
