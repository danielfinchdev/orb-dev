// 3.5: the chat with a bot (route { view: 'bot-chat', id }) or with a group of bots ({ view: 'bot-group', id }). The
// same message box and the same look as the chat with the assistant; the bots' cards (approve or reject) and their
// grouped questions are answered right here. Live through bot.message and bot.state.
import { useEffect, useMemo, useState } from 'react';
import { Check, X, ShieldAlert, Pause, Play, Pencil, Bell, ArrowRight, Users, MessageCircleQuestion, ChevronRight } from 'lucide-react';
import { Markdown } from '@/components/markdown.jsx';
import { PageHeader } from '@/components/page.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Spinner, Input } from '@/components/ui/basic.jsx';
import { Select } from '@/components/ui/overlay.jsx';
import { Composer, useAutoScroll } from '@/views/chat.jsx';
import { LiveActivity } from '@/components/chat-live.jsx';
import { botCall, onBotEvent, act, go, loadBotsSoon } from '@/lib/store.js';
import { chatBot, mergeLine, speakerOf } from '@/lib/bots.js';
import { cn } from '@/lib/utils.js';
import { useT, useLocale } from '@/lib/i18n.js';
import { useBots, useCanManage, BotFace, NoBots, BotsDown, Loading } from './common.jsx';

const LAST = 'orb.ultimoBot';
const lastBot = () => { try { return localStorage.getItem(LAST); } catch { return null; } };

function Time({ at }) {
  const locale = useLocale();
  if (!at) return null;
  const d = new Date(at); if (Number.isNaN(d.getTime())) return null;
  const today = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return <time className="msg-time" dateTime={d.toISOString()}>{today ? time : `${d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} ${time}`}</time>;
}

const STATUS = { pending: ['bots.card.pending', 'warning'], running: ['bots.card.running', 'info'], done: ['bots.card.done', 'success'], failed: ['bots.card.failed', 'destructive'], denied: ['bots.card.denied', 'secondary'], expired: ['bots.card.expired', 'secondary'] };

// A card a bot needs approved (create or change a bot, a change on the server, something at home, a purchase…).
function BotCard({ m, botsById }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const status = m.meta.status ?? 'pending';
  const pending = status === 'pending';
  const who = botsById.get(m.meta.bot);
  const decide = async (decision) => { setBusy(true); await act(botCall('bots.decide', { item: m.id, decision })); setBusy(false); };
  const detail = m.meta.payload ?? (m.meta.input ? { input: m.meta.input } : null);
  const [label, tone] = STATUS[status] ?? STATUS.expired;
  return (
    <div className={cn('mx-auto w-full max-w-[92%] rounded-xl border px-3.5 py-2.5 text-[13.5px]', pending ? 'border-warning/50 bg-warning/10' : 'bg-muted/50')} data-testid="bot-card" data-status={status}>
      <div className="flex items-start gap-2">
        <ShieldAlert className={cn('mt-0.5 size-4 shrink-0', pending ? 'text-warning' : 'text-muted-foreground')} />
        <div className="min-w-0 flex-1">
          <div className="text-muted-foreground mb-0.5 text-xs">{t('bots.card.title', { name: who?.name ?? m.meta.name ?? t('bots.aBot') })}</div>
          <div className="whitespace-pre-wrap break-words">{m.body}</div>
          {m.meta.result?.summary ? <div className="text-muted-foreground mt-1 text-xs">{m.meta.result.summary}</div> : null}
        </div>
      </div>
      {detail ? (
        <div className="pl-6">
          <button type="button" className="text-muted-foreground hover:text-foreground mt-1 inline-flex cursor-pointer items-center gap-1 text-xs" onClick={() => setOpen(!open)} aria-expanded={open}><ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />{t('bots.card.details')}</button>
          {open ? <pre className="bg-muted mt-1.5 max-h-48 overflow-auto rounded-md px-2.5 py-1.5 font-mono text-[11px] whitespace-pre-wrap break-all">{typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2)}</pre> : null}
        </div>
      ) : null}
      <div className="chat-actions mt-2 flex flex-wrap items-center gap-2 pl-6">
        {pending ? (<>
          <Button size="xs" className="px-2.5" disabled={busy} onClick={() => decide('allow')} data-testid="bot-card-allow"><Check />{t('bots.card.allow')}</Button>
          <Button size="xs" className="px-2.5" variant="outline" disabled={busy} onClick={() => decide('deny')} data-testid="bot-card-deny"><X />{t('bots.card.deny')}</Button>
        </>) : <Badge variant={tone}>{t(label)}</Badge>}
        {!pending && m.meta.by?.name ? <span className="text-muted-foreground text-xs" data-testid="bot-card-by">{t('bots.card.by', { name: m.meta.by.name })}</span> : null}
      </div>
    </div>
  );
}

// A bot's grouped questions: one box per question (with its options as buttons), all sent as one answer.
function BotQuestions({ m }) {
  const t = useT();
  const qs = m.meta.questions ?? [];
  const [answers, setAnswers] = useState(() => qs.map(() => ''));
  const [busy, setBusy] = useState(false);
  const done = (m.meta.status ?? 'pending') !== 'pending';
  const set = (i, v) => setAnswers((a) => a.map((x, j) => (j === i ? v : x)));
  const ready = answers.some((a) => a.trim());
  const send = async () => {
    if (!ready || busy) return;
    setBusy(true);
    const text = qs.map((q, i) => `${i + 1}. ${q.question}\n→ ${answers[i].trim() || t('bots.q.noAnswer')}`).join('\n');
    await act(botCall('bots.answer', { item: m.id, text }));
    setBusy(false);
  };
  return (
    <div className="chat-glass mx-auto w-full max-w-[92%]" data-testid="bot-questions">
      <div className="text-primary mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase"><MessageCircleQuestion className="size-3.5" />{t('bots.q.title', { name: m.meta.name ?? '' })}</div>
      <div className="grid gap-3">
        {qs.map((q, i) => (
          <div key={i} className="grid gap-1.5">
            <div className="text-[14px] font-medium">{q.question}</div>
            {done ? null : (<>
              {q.options?.length ? <div className="flex flex-wrap gap-1.5">{q.options.map((o) => <Button key={o} size="xs" variant={answers[i] === o ? 'default' : 'outline'} onClick={() => set(i, answers[i] === o ? '' : o)}>{o}</Button>)}</div> : null}
              <Input value={answers[i]} onChange={(e) => set(i, e.target.value)} placeholder={t('bots.q.placeholder')} maxLength={600} data-testid={`bot-q-${i + 1}`} />
            </>)}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        {done ? <Badge variant="success"><Check />{t('bots.q.answered')}</Badge> : <Button size="sm" onClick={send} disabled={!ready || busy} data-testid="bot-q-send">{t('bots.q.send')}</Button>}
      </div>
    </div>
  );
}

function Line({ m, group, botsById }) {
  const t = useT();
  const who = speakerOf(m);
  if (m.meta?.kind === 'bot_card') return <BotCard m={m} botsById={botsById} />;
  if (m.meta?.kind === 'bot_question') return <BotQuestions m={m} />;
  if (who.kind === 'user') return <div className="bg-bubble text-bubble-foreground ml-auto max-w-[80%] rounded-2xl rounded-br-md px-4 py-2.5 whitespace-pre-wrap break-words" data-testid="bot-line-user">{m.body}<Time at={m.at} /></div>;
  if (who.kind === 'bot') {
    const bot = botsById.get(who.id) ?? { name: who.name, icon: who.icon };
    // A message from one bot to another: small, with who it goes to.
    if (m.meta?.kind === 'relay') {
      const to = botsById.get(m.meta.to);
      return (
        <div className="text-muted-foreground mx-auto flex w-full max-w-[92%] items-start gap-2 rounded-xl border border-dashed px-3 py-2 text-[13px]" data-testid="bot-line-relay">
          <BotFace bot={bot} size="sm" />
          <div className="min-w-0 flex-1"><div className="flex items-center gap-1 text-xs">{bot.name}<ArrowRight className="size-3" />{to?.name ?? t('bots.aBot')}</div><div className="whitespace-pre-wrap break-words">{m.body}</div></div>
        </div>
      );
    }
    return (
      <div className="flex gap-3" data-testid="bot-line">
        <BotFace bot={bot} className="mt-0.5" />
        <div className="chat-glass min-w-0 flex-1">
          <div className="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs">{m.meta?.kind === 'reminder' ? <Bell className="size-3" /> : null}{group || m.meta?.kind === 'reminder' ? <span className="text-foreground/80 font-medium">{bot.name}</span> : bot.name}{m.meta?.kind === 'reminder' ? ` · ${t('bots.reminder')}` : ''}</div>
          <Markdown>{m.body}</Markdown>
          <div className="text-muted-foreground flow-root"><Time at={m.at} /></div>
        </div>
      </div>
    );
  }
  return <div className="bg-muted/70 text-muted-foreground mx-auto max-w-[88%] rounded-xl px-3.5 py-2 text-center text-[13px] whitespace-pre-wrap">{m.body}</div>;
}

// The bots or groups to switch to, at the top of the chat.
function Switcher({ bots, groups, current }) {
  const t = useT();
  const options = [...bots.map((b) => ({ value: `b${b.id}`, label: `${b.icon ? `${b.icon} ` : ''}${b.name}` })), ...groups.map((g) => ({ value: `g${g.id}`, label: `${g.icon ? `${g.icon} ` : ''}${g.name} · ${t('bots.group')}` }))];
  if (options.length < 2) return null;
  return <Select size="sm" value={current} onValueChange={(v) => go({ view: v[0] === 'g' ? 'bot-group' : 'bot-chat', id: Number(v.slice(1)) })} options={options} title={t('bots.switchTo')} data-testid="bot-switch" />;
}

export function BotChatView({ route }) {
  const t = useT();
  const group = route.view === 'bot-group';
  const { bots, groups, loaded, error, states } = useBots();
  const manage = useCanManage();
  const botsById = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);
  const bot = group ? null : route.id != null ? botsById.get(Number(route.id)) ?? null : chatBot(bots, lastBot());
  const grp = group ? groups.find((g) => g.id === Number(route.id)) ?? null : null;
  const target = group ? grp : bot;
  const [conv, setConv] = useState(null);
  const [lines, setLines] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  useEffect(() => { if (bot && !group) try { localStorage.setItem(LAST, String(bot.id)); } catch { /* storage unavailable */ } }, [bot?.id, group]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = target ? `${group ? 'g' : 'b'}${target.id}` : null;
  useEffect(() => {
    if (!target) return undefined;
    let alive = true; setLines([]); setConv(null);
    botCall(group ? 'bots.groups.chat' : 'bots.chat', { id: target.id }).then((r) => { if (alive) { setConv(r.conversation); setLines(r.lines ?? []); } }).catch(() => {});
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (conv == null) return undefined;
    return onBotEvent('bot.message', (msg) => { if (msg?.conversation === conv) setLines((l) => mergeLine(l, msg)); });
  }, [conv]);
  // Who is answering in this conversation now (a bot, or one of the group's).
  const live = Object.values(states).filter((s) => (s.busy || s.queued) && (group ? s.conversation === conv : s.bot === bot?.id));
  const speaking = live.map((s) => ({ ...s, who: botsById.get(s.bot) })).filter((s) => s.who);
  const scroll = useAutoScroll([lines.length, speaking.map((s) => `${s.partial}${s.tools?.length ?? 0}`).join(''), key]);

  if (!loaded) return error ? <><PageHeader title={t('nav.botChat')} /><BotsDown error={error} /></> : <><PageHeader title={t('nav.botChat')} /><Loading /></>;
  if (!bots.length) return <><PageHeader title={t('nav.botChat')} /><NoBots /></>;
  if (!target) return <><PageHeader title={t('nav.botChat')} /><p className="text-muted-foreground p-8 text-center text-sm">{t('bots.gone')}</p></>;

  const send = async () => {
    const msg = text.trim(); if (!msg || sending) return;
    setText(''); setSending(true);
    const r = await act(botCall(group ? 'bots.groups.send' : 'bots.send', { id: target.id, text: msg }));
    setSending(false);
    if (r === undefined) { setText(msg); return; }
    if (conv == null) setConv(r.conversation);
    botCall(group ? 'bots.groups.chat' : 'bots.chat', { id: target.id }).then((x) => setLines(x.lines ?? [])).catch(() => {});
  };
  const busy = speaking.some((s) => s.busy);
  const members = group ? (grp.members ?? []).map((id) => botsById.get(Number(id?.id ?? id))).filter(Boolean) : [];
  const title = (
    <span className="flex min-w-0 items-center gap-2">
      {group ? <span className="bg-primary/10 text-primary grid size-8 shrink-0 place-items-center rounded-xl">{grp.icon || <Users className="size-4" />}</span> : <BotFace bot={bot} busy={busy} />}
      <span className="min-w-0 truncate" data-testid="bot-chat-title">{target.name}</span>
      {bot?.is_chief ? <Badge>{t('bots.chief')}</Badge> : null}
      {bot?.paused ? <Badge variant="secondary">{t('bots.paused')}</Badge> : null}
    </span>
  );
  const meta = group ? members.map((b) => b.name).join(', ') : bot.role_text || t('bots.noRole');
  return (
    <>
      <PageHeader title={title} meta={meta}>
        <Switcher bots={bots} groups={groups} current={key} />
        {bot ? <Button size="icon-sm" variant="ghost" onClick={async () => { await act(botCall('bots.pause', { id: bot.id, paused: !bot.paused })); loadBotsSoon(); }} aria-label={bot.paused ? t('bots.resume') : t('bots.pause')} title={bot.paused ? t('bots.resume') : t('bots.pause')} data-testid="bot-chat-pause">{bot.paused ? <Play /> : <Pause />}</Button> : null}
        {bot && manage ? <Button size="icon-sm" variant="ghost" onClick={() => go({ view: 'bots', id: bot.id })} aria-label={t('bots.edit')} title={t('bots.edit')} data-testid="bot-chat-edit"><Pencil /></Button> : null}
      </PageHeader>
      <div ref={scroll.ref} onScroll={scroll.onScroll} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-5 py-6" data-testid="bot-chat-lines">
          {!lines.length && !speaking.length ? (
            <div className="flex flex-col items-center gap-3 pt-10 text-center">
              {group ? <span className="bg-primary/10 text-primary grid size-16 place-items-center rounded-3xl text-3xl">{grp.icon || <Users className="size-7" />}</span> : <BotFace bot={bot} size="lg" />}
              <h2 className="text-xl">{group ? t('bots.chat.helloGroup', { name: grp.name }) : t('bots.chat.hello', { name: bot.name })}</h2>
              <p className="text-muted-foreground max-w-md text-sm">{group ? t('bots.chat.groupHint') : bot.role_text || t('bots.chat.hint')}</p>
            </div>
          ) : lines.map((m) => <Line key={m.id} m={m} group={group} botsById={botsById} />)}
          {speaking.map((s) => (
            <div key={s.bot} className="flex gap-3" data-testid="bot-typing">
              <BotFace bot={s.who} busy className="mt-0.5" />
              <div className="chat-glass min-w-0 flex-1">
                <div className="text-muted-foreground mb-1 text-xs">{s.who.name}</div>
                {s.partial ? <Markdown>{s.partial}</Markdown> : null}
                {s.busy ? <LiveActivity chat={{ ...s, queued: 0 }} testid="bot-activity" /> : <div className="text-muted-foreground flex items-center gap-2 text-[13px]"><Spinner className="size-3.5" />{t('bots.chat.queued')}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
      <Composer value={text} onChange={setText} onSend={send} onStop={bot && busy ? () => act(botCall('bots.stop', { id: bot.id })) : undefined} busy={busy} disabled={sending} mentions={false} testid="bot-chat-input"
        placeholder={group ? t('bots.chat.placeholderGroup', { name: grp.name }) : bot.paused ? t('bots.chat.placeholderPaused', { name: bot.name }) : t('bots.chat.placeholder', { name: bot.name })} />
    </>
  );
}
