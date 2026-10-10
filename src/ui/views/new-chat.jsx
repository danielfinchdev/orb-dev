// 2.6: «Nuevo chat», a clean chat with no pop-up. Under the message box: the project, the brain (agent + model), the
// reasoning and «Orquestador». Ticked, the message starts a new conversation with the assistant, which coordinates the
// agents with that brain; unticked, it starts a direct chat with that agent in the project, with the permissions chosen.
import { useEffect, useState } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { Robot } from '@/components/robot.jsx';
import { PageHeader } from '@/components/page.jsx';
import { ProjectPicker } from '@/components/project-actions.jsx';
import { BrainPicker, ReasoningPicker, PermissionPicker, UsageBubble, useCatalog, useUsageBubble } from '@/components/brain-picker.jsx';
import { confirm } from '@/components/dialogs.jsx';
import { Checkbox } from '@/components/ui/overlay.jsx';
import { useStore, call, act, go, refresh } from '@/lib/store.js';
import { PERMISSION_HINT } from '@/lib/labels.js';
import { useT } from '@/lib/i18n.js';
import { Composer } from './chat.jsx';

export function NewChatView() {
  const t = useT();
  const app = useStore((s) => s.app);
  const info = app.assistant ?? {};
  const active = app.activeProject;
  const catalog = useCatalog();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [orchestrate, setOrchestrate] = useState(true);
  const [permission, setPermission] = useState('editar');
  // Starts from the assistant's current brain; if that agent is not usable here, the first one that is.
  const [brain, setBrain] = useState({ agent: info.agent ?? 'claude', model: info.model ?? '', account: info.account, reasoning: info.reasoning ?? 'medium' });
  useEffect(() => {
    if (!catalog?.length || catalog.some((a) => a.id === brain.agent)) return;
    const a = catalog[0];
    setBrain((b) => ({ ...b, agent: a.id, model: a.models[0]?.id ?? '', account: a.accounts[0]?.id ?? a.id }));
  }, [catalog]); // eslint-disable-line react-hooks/exhaustive-deps
  const bubble = useUsageBubble(catalog, brain);
  const name = app.config.assistantName;

  const send = async () => {
    const msg = text.trim(); if (!msg || busy) return;
    if (!orchestrate && active && permission === 'total' && !(await confirm(t('permission.total'), t('session.totalBody'), { ok: t('session.totalYesFull'), danger: true }))) return;
    setBusy(true);
    try {
      if (orchestrate) {
        const ok = await act((async () => {
          await call('chat.settings', { agent: brain.agent, model: brain.model, account: brain.account, reasoning: brain.reasoning, orchestrate: true });
          await call('chat.reset');
          await call('chat.send', { text: msg });
          return true;
        })());
        if (ok) { await refresh().catch(() => {}); go('chat'); }
        return;
      }
      const id = await act((async () => {
        const s = await call('sessions.create', { agent: brain.agent, account: brain.account, project: active?.name ?? null, model: brain.model || null, permission: active ? permission : 'leer', reasoning: brain.reasoning, title: null });
        await call('sessions.send', { id: s.id, text: msg });
        return s.id;
      })());
      if (id) { await refresh().catch(() => {}); go({ view: 'session', id }); }
    } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader icon={<MessageSquarePlus className="text-primary size-5" />} title={t('newChat.title')} meta={orchestrate ? t('newChat.metaOrchestrator', { name }) : t('newChat.metaDirect')} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 px-5 pt-16 pb-6 text-center">
          <Robot size={120} mood="hello" live />
          <h2 className="hero-title mt-2 text-2xl">{t('newChat.hello')}</h2>
          <p className="text-muted-foreground max-w-md">{orchestrate ? t('newChat.introOrchestrator', { name }) : t('newChat.introDirect')}</p>
          {!orchestrate && active ? <p className="text-muted-foreground max-w-md text-xs">{PERMISSION_HINT[permission]}</p> : null}
          {!orchestrate && !active ? <p className="text-muted-foreground max-w-md text-xs">{t('session.noProjectHint')}</p> : null}
        </div>
      </div>
      <Composer value={text} onChange={setText} onSend={send} busy={busy} disabled={busy} testid="new-chat-input" mentions={orchestrate}
        placeholder={orchestrate ? t('chat.placeholder', { name }) : t('newChat.placeholderDirect')}
        top={<ProjectPicker />}
        notice={<UsageBubble text={bubble.text} onClose={bubble.close} />}
        bottom={<>
          <BrainPicker catalog={catalog} value={brain} onChange={(b) => setBrain((x) => ({ ...x, ...b }))} />
          <ReasoningPicker value={brain.reasoning} onChange={(reasoning) => setBrain((x) => ({ ...x, reasoning }))} />
          {/* Without a project the agent works in the assistant's folder: read-only. */}
          {!orchestrate ? <PermissionPicker value={active ? permission : 'leer'} onChange={setPermission} disabled={!active} /> : null}
          <label className="flex cursor-pointer items-center gap-2 text-[13px]" title={t('chat.orchestratorHint')}>
            <Checkbox checked={orchestrate} onCheckedChange={(v) => setOrchestrate(v === true)} data-testid="new-chat-orchestrator" />{t('chat.orchestrator')}
          </label>
        </>} />
    </>
  );
}
