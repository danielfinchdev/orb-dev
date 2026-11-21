// «Historial»: the chats that Claude Code and Codex left on this PC, read only (history.list / history.read). They are
// not Orb's conversations: nothing can be sent to them or changed, and the files are not touched. Reached from Ctrl+K.
import { useEffect, useState } from 'react';
import { History, ArrowLeft } from 'lucide-react';
import { PageHeader, PageBody } from '@/components/page.jsx';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Card, Empty, Input, Spinner } from '@/components/ui/basic.jsx';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/overlay.jsx';
import { call } from '@/lib/store.js';
import { AGENT } from '@/lib/labels.js';
import { useT, useLocale } from '@/lib/i18n.js';
import { cn } from '@/lib/utils.js';

const stamp = (at, locale) => (at ? new Date(at).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

function Chat({ id, onBack }) {
  const t = useT();
  const locale = useLocale();
  const [chat, setChat] = useState(null);
  useEffect(() => { let alive = true; call('history.read', { id }).then((r) => alive && setChat(r ?? false)).catch(() => alive && setChat(false)); return () => { alive = false; }; }, [id]);
  return (
    <>
      <PageHeader icon={<History className="text-primary-text size-5" />} title={chat?.project || t('history.title')}>
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="history-back"><ArrowLeft />{t('history.back')}</Button>
      </PageHeader>
      <PageBody>
        {chat === null ? <Spinner /> : chat === false ? <Empty icon={History} title={t('history.gone')} /> : (
          <div className="flex flex-col gap-3" data-testid="history-chat">
            <p className="text-muted-foreground text-control">{t('history.readOnly', { agent: AGENT[chat.agent] ?? chat.agent })}{chat.model ? ` · ${chat.model}` : ''}</p>
            {chat.messages.map((m, i) => (
              <div key={i} className={cn('max-w-[85%] rounded-xl border px-3.5 py-2.5 text-control whitespace-pre-wrap break-words', m.role === 'user' ? 'bg-muted self-end' : 'self-start', m.tool && 'text-muted-foreground text-xs')}>
                {m.text}
                {m.at ? <div className="text-muted-foreground mt-1 text-[11px]">{stamp(m.at, locale)}</div> : null}
              </div>
            ))}
            {chat.truncated ? <p className="text-muted-foreground text-control">{t('history.truncated')}</p> : null}
          </div>
        )}
      </PageBody>
    </>
  );
}

export function HistoryView() {
  const t = useT();
  const locale = useLocale();
  const [agent, setAgent] = useState('all');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => { call('history.list', { agent: agent === 'all' ? undefined : agent, q }).then((r) => alive && setRows(r)).catch(() => alive && setRows(false)); }, q ? 250 : 0);
    return () => { alive = false; clearTimeout(timer); };
  }, [agent, q]);
  if (open) return <Chat id={open} onBack={() => setOpen(null)} />;
  return (
    <>
      <PageHeader icon={<History className="text-primary-text size-5" />} title={t('history.title')}>
        <Tabs value={agent} onValueChange={setAgent}><TabsList>{['all', 'claude', 'codex'].map((a) => <TabsTrigger key={a} value={a} data-testid={`history-agent-${a}`}>{a === 'all' ? t('history.all') : AGENT[a]}</TabsTrigger>)}</TabsList></Tabs>
      </PageHeader>
      <PageBody>
        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground text-control">{t('history.intro')}</p>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('history.search')} aria-label={t('history.search')} data-testid="history-search" />
          {rows === null ? <Spinner /> : rows === false ? <Empty icon={History} title={t('history.unavailable')} /> : !rows.length ? <Empty icon={History} title={t('history.empty')} /> : (
            <Card className="gap-0 py-1" data-testid="history-list">
              {rows.map((r) => (
                <button key={r.id} type="button" onClick={() => setOpen(r.id)} className="hover:bg-muted flex w-full items-center gap-3 border-b px-5 py-2.5 text-left last:border-b-0" data-testid="history-row">
                  <AgentIcon agent={r.agent} className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1"><span className="text-control block truncate">{r.title}</span><span className="text-muted-foreground block truncate text-xs">{[r.project, r.model].filter(Boolean).join(' · ')}</span></span>
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{stamp(r.updatedAt, locale)}</span>
                </button>
              ))}
            </Card>
          )}
        </div>
      </PageBody>
    </>
  );
}
