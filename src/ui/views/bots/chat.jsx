// 3.6 (messaging, M2): a messaging app's conversation (mockup mensajeria.html): a header pill (avatar, name, what it is
// doing) that opens the chat's info (a pane on the PC, the whole screen on the phone, views/bots/info.jsx), day
// separators, reminders and notices as small lines in the middle, one bot writing to another as a forward line, each
// bot of a group with its avatar, name and colour, and «@» in a group's composer for its members. What is on screen is
// marked read (inbox.markRead). The phone: full screen with a back arrow to the list.
// 3.5: the chat with a bot (route { view: 'bot-chat', id }) or with a group of bots ({ view: 'bot-group', id }). The
// same message box and the same look as the chat with the assistant; the bots' cards (approve or reject) and their
// grouped questions are answered right here. Live through bot.message and bot.state.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, X, ShieldAlert, Pause, Play, Pencil, Bell, MessageCircleQuestion, ChevronRight, Ellipsis, Plus, Forward, Info, AtSign, BellOff, CircleAlert } from 'lucide-react';
import { Markdown } from '@/components/markdown.jsx';
import { ChatBar, BackToList } from '@/components/chat-bar.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Spinner, Input } from '@/components/ui/basic.jsx';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, Tip } from '@/components/ui/overlay.jsx';
import { Composer, useAutoScroll } from '@/views/chat.jsx';
import { LiveActivity } from '@/components/chat-live.jsx';
import { useStore, botCall, onBotEvent, act, go, loadBotsSoon, loadInboxSoon, inboxAct, isDark } from '@/lib/store.js';
import { withDays, nameColor } from '@/lib/inbox.js';
import { decideCard } from '@/lib/notes.js';
import { useInbox, itemOfRoute } from './inbox.jsx';
import { BotInfo, GroupInfo } from './info.jsx';
import { chatBot, mergeLine, speakerOf } from '@/lib/bots.js';
import { cn } from '@/lib/utils.js';
import { useT, useLocale } from '@/lib/i18n.js';
import { useBots, useCanManage, BotFace, GroupFace, NoBots, BotsDown, Loading } from './common.jsx';
import { ReplicaBar, PendingMark } from './home.jsx';
import { useHomes } from '@/lib/bot-homes.js';
import { homeOf, replicaActions } from '@/lib/homes.js';

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
  // 3.6 (M4): a sensitive card asks for the PIN here when the Orb needs it (lib/notes.js › decideCard).
  const decide = async (decision) => { setBusy(true); await act(decideCard(m.id, decision)); setBusy(false); };
  // 3.6: the card's text says what and why in plain words; the details only hold a longer text (never the raw data).
  const detail = typeof m.meta.input === 'string' && m.meta.input.length > 0 ? m.meta.input : typeof m.meta.payload?.text === 'string' && m.meta.payload.text.length > 300 ? m.meta.payload.text : null;
  const [label, tone] = STATUS[status] ?? STATUS.expired;
  return (
    <div className={cn('mx-auto w-full max-w-[92%] rounded-xl border px-3.5 py-2.5 text-[13.5px]', pending ? 'border-warning/50 bg-warning/10' : 'bg-muted/50')} data-testid="bot-card" data-status={status}>
      <div className="flex items-start gap-2">
        <ShieldAlert className={cn('mt-0.5 size-4 shrink-0', pending ? 'text-warning' : 'text-muted-foreground')} />
        <div className="min-w-0 flex-1">
          <div className="text-muted-foreground mb-0.5 flex items-center gap-1.5 text-xs">{who ? <BotFace bot={who} size="xs" /> : null}{t('bots.card.title', { name: who?.name ?? m.meta.name ?? t('bots.aBot') })}</div>
          <div className="whitespace-pre-wrap break-words">{m.body}</div>
          {m.meta.result?.summary ? <div className="text-muted-foreground mt-1 text-xs">{m.meta.result.summary}</div> : null}
        </div>
      </div>
      {detail ? (
        <div className="pl-6">
          <button type="button" className="text-muted-foreground hover:text-foreground mt-1 inline-flex cursor-pointer items-center gap-1 text-xs" onClick={() => setOpen(!open)} aria-expanded={open}><ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />{t('bots.card.details')}</button>
          {open ? <p className="bg-muted mt-1.5 max-h-48 overflow-auto rounded-md px-2.5 py-1.5 text-[12.5px] whitespace-pre-wrap break-words">{detail}</p> : null}
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

// A small line in the middle: a reminder that rang, a notice of the system.
function Notice({ icon: Icon, children, testid, tone }) {
  return (
    <div className={cn('mx-auto flex max-w-[88%] items-start gap-1.5 rounded-2xl border border-dashed px-3 py-1 text-center text-[12.5px]', tone === 'warn' ? 'border-warning/50 text-foreground/80' : 'text-muted-foreground')} data-testid={testid}>
      {Icon ? <Icon className="mt-0.5 size-3.5 shrink-0" /> : null}<span className="min-w-0 whitespace-pre-wrap break-words">{children}</span>
    </div>
  );
}

function Line({ m, group, botsById, first, me, dark }) {
  const t = useT();
  const who = speakerOf(m);
  if (m.meta?.kind === 'bot_card') return <BotCard m={m} botsById={botsById} />;
  if (m.meta?.kind === 'bot_question') return <BotQuestions m={m} />;
  if (who.kind === 'user') {
    // Someone else in a shared group: on the left, with their name.
    if (group && m.person_id != null && me != null && m.person_id !== me) return (
      <div className="flex max-w-[80%] flex-col" data-testid="bot-line-person"><span className="text-muted-foreground mb-0.5 px-1 text-xs font-medium">{m.author}</span><div className="bg-card rounded-2xl rounded-bl-md border px-4 py-2.5 whitespace-pre-wrap break-words">{m.body}<Time at={m.at} /></div></div>
    );
    // 3.7: written while the bot's home did not answer: «Pendiente» until that Orb has it.
    if (m.meta?.pending) return <div className="ml-auto flex max-w-[80%] flex-col items-end"><div className="bg-bubble text-bubble-foreground rounded-2xl rounded-br-md px-4 py-2.5 whitespace-pre-wrap break-words opacity-80" data-testid="bot-line-user">{m.body}<Time at={m.at} /></div><PendingMark /></div>;
    return <div className="bg-bubble text-bubble-foreground ml-auto max-w-[80%] rounded-2xl rounded-br-md px-4 py-2.5 whitespace-pre-wrap break-words" data-testid="bot-line-user">{m.body}<Time at={m.at} /></div>;
  }
  if (who.kind === 'bot') {
    const bot = botsById.get(who.id) ?? { id: who.id, name: who.name, icon: who.icon, avatar: m.meta?.avatar };
    // A reminder that rang: a small line in the middle with the bell.
    if (m.meta?.kind === 'reminder') return <Notice icon={Bell} testid="bot-line-reminder">{t('chats.reminderLine', { text: String(m.body).replace(/^⏰\s*/u, '') })}</Notice>;
    // One bot to another: «↪ A Jefe: …», small.
    if (m.meta?.kind === 'relay') {
      const to = botsById.get(m.meta.to);
      return (
        <div className="flex max-w-[85%] items-start gap-2" data-testid="bot-line-relay">
          {group ? <BotFace bot={bot} size={24} className="mt-1" /> : null}
          <div className="bg-card/70 text-foreground/85 min-w-0 rounded-2xl border border-dashed px-3.5 py-2 text-[13.5px]">
            <span className="text-muted-foreground"><Forward className="mr-1 inline size-3.5 -translate-y-px" />{group ? `${bot.name} · ` : ''}{t('chats.relayTo', { to: to?.name ?? t('bots.aBot') })}</span>
            <span className="whitespace-pre-wrap break-words">{m.body}</span><Time at={m.at} />
          </div>
        </div>
      );
    }
    return (
      <div className={cn('flex gap-2.5', !first && group && '-mt-2.5')} data-testid="bot-line">
        {group ? (first ? <BotFace bot={bot} size={32} className="mt-0.5" /> : <span className="w-8 shrink-0" />) : null}
        <div className="bot-bubble max-w-[85%] min-w-0">
          {group && first ? <div className="mb-0.5 text-[12.5px] font-semibold" style={{ color: nameColor(bot, dark) }} data-testid="bot-line-name">{bot.name}</div> : null}
          <Markdown>{m.body}</Markdown>
          <div className="text-muted-foreground flow-root"><Time at={m.at} /></div>
        </div>
      </div>
    );
  }
  return <Notice icon={m.meta?.kind === 'blocked' ? CircleAlert : null} tone={m.meta?.kind === 'blocked' ? 'warn' : null} testid="bot-line-system">{m.body}</Notice>;
}

// Marks the chat read while it is on screen (the window visible): when it opens and when a line arrives.
function useMarkRead(item, lines) {
  const last = lines.length ? lines[lines.length - 1].id : null;
  useEffect(() => {
    if (!item || !item.unread) return undefined;
    const run = () => { if (document.visibilityState === 'visible') botCall('inbox.markRead', { kind: item.kind, id: item.id }).then(() => loadInboxSoon(0)).catch(() => {}); };
    const id = setTimeout(run, 350);
    document.addEventListener('visibilitychange', run);
    return () => { clearTimeout(id); document.removeEventListener('visibilitychange', run); };
  }, [item?.key, item?.unread, last]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function BotChatView({ route }) {
  const t = useT();
  const locale = useLocale();
  const group = route.view === 'bot-group';
  const { bots, groups, loaded, error, states } = useBots();
  const manage = useCanManage();
  const inbox = useInbox();
  const me = useStore((s) => s.me?.person?.id ?? null);
  const cleared = useStore((s) => s.chatCleared ?? 0);
  const botsById = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);
  const bot = group ? null : route.id != null ? botsById.get(Number(route.id)) ?? null : chatBot(bots, lastBot());
  const grp = group ? groups.find((g) => g.id === Number(route.id)) ?? null : null;
  const target = group ? grp : bot;
  const item = target ? itemOfRoute(inbox, { view: route.view, id: target.id }) : null;
  const [conv, setConv] = useState(null);
  const [lines, setLines] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [info, setInfo] = useState(false);
  const homes = useHomes();
  useEffect(() => { if (bot && !group) try { localStorage.setItem(LAST, String(bot.id)); } catch { /* storage unavailable */ } }, [bot?.id, group]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = target ? `${group ? 'g' : 'b'}${target.id}` : null;
  useEffect(() => {
    if (!target) return undefined;
    let alive = true; setLines([]); setConv(null);
    botCall(group ? 'bots.groups.chat' : 'bots.chat', { id: target.id }).then((r) => { if (alive) { setConv(r.conversation); setLines(r.lines ?? []); } }).catch(() => {});
    return () => { alive = false; };
  }, [key, cleared]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (conv == null) return undefined;
    return onBotEvent('bot.message', (msg) => { if (msg?.conversation === conv) setLines((l) => mergeLine(l, msg)); });
  }, [conv]);
  useMarkRead(item, lines);
  // Who is answering in this conversation now (a bot, or one of the group's).
  const live = Object.values(states).filter((s) => (s.busy || s.queued) && (group ? s.conversation === conv : s.bot === bot?.id));
  const speaking = live.map((s) => ({ ...s, who: botsById.get(s.bot) })).filter((s) => s.who);
  const scroll = useAutoScroll([lines.length, speaking.map((s) => `${s.partial}${s.tools?.length ?? 0}`).join(''), key]);
  const members = group && grp ? (grp.members ?? []).map((id) => botsById.get(Number(id?.id ?? id))).filter(Boolean) : [];
  const memberKey = members.map((b) => b.id).join(',');
  const mentionOptions = useMemo(() => members.map((b) => ({ token: `@${b.name}`, label: b.name, hint: b.is_chief ? t('bots.f.chief') : '', icon: <BotFace bot={b} size={20} still /> })), [memberKey, t]); // eslint-disable-line react-hooks/exhaustive-deps

  const back = <BackToList to="bot-chats" />;
  const bare = (title, body) => <div className="flex min-h-0 min-w-0 flex-1 flex-col"><ChatBar back={back} title={<span className="truncate text-[16px] font-medium">{title}</span>} />{body}</div>;
  if (!loaded) return bare(t('nav.botChat'), error ? <BotsDown error={error} /> : <Loading />);
  if (!bots.length) return bare(t('nav.botChat'), <NoBots />);
  if (!target) return bare(t('nav.botChat'), <p className="text-muted-foreground p-8 text-center text-sm">{t('bots.gone')}</p>);

  const send = async () => {
    const msg = text.trim(); if (!msg || sending) return;
    setText(''); setSending(true);
    const r = await act(botCall(group ? 'bots.groups.send' : 'bots.send', { id: target.id, text: msg }));
    setSending(false);
    if (r === undefined) { setText(msg); return; }
    if (conv == null) setConv(r.conversation);
    botCall(group ? 'bots.groups.chat' : 'bots.chat', { id: target.id }).then((x) => setLines(x.lines ?? [])).catch(() => {});
    loadInboxSoon();
  };
  const busy = speaking.some((s) => s.busy);
  // 3.7: a bot that runs on an Orb that does not answer now.
  const home = bot ? homeOf(bot) : null;
  const ra = bot ? replicaActions(bot) : null;
  const status = group
    ? (speaking.length ? t('chats.typing', { name: speaking[0].who.name }) : members.map((b) => b.name).join(', '))
    : home && !home.online ? t('home.offlineStatus', { name: home.kind === 'server' ? t('home.badge.server') : home.name }) : bot.paused ? t('bots.paused') : busy ? t('chats.working') : speaking.length ? t('bots.chat.queued') : bot.role_text || t('bots.noRole');
  const pill = (
    <button type="button" onClick={() => setInfo(!info)} className={cn('press flex min-w-0 cursor-pointer items-center gap-2.5 rounded-xl py-1 pr-3 pl-1 text-left', info ? 'bg-accent' : 'hover:bg-accent/60')} aria-expanded={info} aria-label={t('chats.openInfo', { name: target.name })} data-testid="bot-chat-head">
      {group ? <GroupFace group={grp} bots={bots} size={36} /> : <BotFace bot={bot} busy={busy} size={36} chief={bot.is_chief} />}
      <span className="min-w-0">
        <span className="flex items-center gap-1.5"><span className="truncate text-[15px] font-semibold" data-testid="bot-chat-title">{target.name}</span>{item?.muted ? <BellOff className="text-muted-foreground size-3.5 shrink-0" aria-label={t('chats.muted')} /> : null}</span>
        <span className={cn('block truncate text-[12.5px]', busy || (group && speaking.length) ? 'text-primary' : 'text-muted-foreground')} data-testid="bot-chat-status">{status}</span>
      </span>
    </button>
  );
  const more = (
    <DropdownMenu modal={false}>
      <Tip label={t('chats.more')}><DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label={t('chats.more')} data-testid="bot-chat-more"><Ellipsis /></Button></DropdownMenuTrigger></Tip>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={() => setInfo(true)} data-testid="more-info"><Info />{group ? t('chats.groupInfo') : t('chats.botInfo')}</DropdownMenuItem>
        {item ? <DropdownMenuItem onSelect={() => inboxAct('inbox.mute', { kind: item.kind, id: item.id, muted: !item.muted })} data-testid="more-mute">{item.muted ? <Bell /> : <BellOff />}{item.muted ? t('chats.unmute') : t('chats.mute')}</DropdownMenuItem> : null}
        {bot && ra?.change ? <DropdownMenuItem onSelect={async () => { await act(botCall('bots.pause', { id: bot.id, paused: !bot.paused })); loadBotsSoon(); loadInboxSoon(); }} data-testid="more-pause">{bot.paused ? <Play /> : <Pause />}{bot.paused ? t('chats.resumeBot') : t('chats.pauseBot')}</DropdownMenuItem> : null}
        {bot && manage && ra?.change ? <DropdownMenuItem onSelect={() => go({ view: 'bots', id: bot.id })} data-testid="more-edit"><Pencil />{t('bots.edit')}</DropdownMenuItem> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const mention = () => { setText((v) => `${v}${v && !/\s$/.test(v) ? ' ' : ''}@`); setTimeout(() => document.querySelector('[data-testid=bot-chat-input]')?.focus(), 30); };
  const plus = (
    <DropdownMenu modal={false}>
      <Tip label={t('chats.add')}><DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" className="rounded-full" aria-label={t('chats.add')} data-testid="composer-plus"><Plus /></Button></DropdownMenuTrigger></Tip>
      <DropdownMenuContent align="start" side="top" className="w-56">
        {group ? <DropdownMenuItem onSelect={mention} data-testid="plus-mention"><AtSign />{t('chats.mentionSomeone')}</DropdownMenuItem> : null}
        <DropdownMenuItem onSelect={() => go({ view: 'bot-reminders' })} data-testid="plus-reminder"><Bell />{t('chats.newReminder')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const dark = isDark();
  const rows = withDays(lines, { locale, today: t('chats.today'), yesterday: t('chats.yesterday') });
  const close = () => setInfo(false);
  return (
    <div className="flex min-h-0 min-w-0 flex-1" data-testid="bot-chat">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ChatBar back={back} title={pill}>{more}</ChatBar>
        <div ref={scroll.ref} onScroll={scroll.onScroll} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-5 sm:px-5" data-testid="bot-chat-lines">
            {!lines.length && !speaking.length ? (
              <div className="flex flex-col items-center gap-3 pt-10 text-center">
                {group ? <GroupFace group={grp} bots={bots} size={80} label={t('bots.av.group', { name: grp.name })} /> : <BotFace bot={bot} size={80} chief={bot.is_chief} label={t('bots.av.aria', { name: bot.name })} />}
                <h2 className="text-xl">{group ? t('bots.chat.helloGroup', { name: grp.name }) : t('bots.chat.hello', { name: bot.name })}</h2>
                <p className="text-muted-foreground max-w-md text-sm">{group ? t('chats.groupMentionHint') : bot.role_text || t('bots.chat.hint')}</p>
              </div>
            ) : rows.map((r, i) => {
              if (r.day) return <div key={`d${r.day}`} className="bg-muted text-muted-foreground mx-auto rounded-full px-3 py-0.5 text-[12px] font-medium first-letter:uppercase" data-testid="day-separator">{r.label}</div>;
              const prev = rows[i - 1]?.line;
              const first = !prev || prev.role !== 'bot' || prev.meta?.bot !== r.line.meta?.bot || ['relay', 'reminder', 'bot_card', 'bot_question'].includes(prev.meta?.kind);
              return <Line key={r.line.id} m={r.line} group={group} botsById={botsById} first={first} me={me} dark={dark} />;
            })}
            {speaking.map((s) => (
              <div key={s.bot} className="flex gap-2.5" data-testid="bot-typing">
                <BotFace bot={s.who} busy size={group ? 32 : 28} className="mt-0.5" />
                <div className="bot-bubble min-w-0 max-w-[85%]">
                  <div className="mb-1 text-xs font-semibold" style={group ? { color: nameColor(s.who, dark) } : undefined}>{s.who.name}</div>
                  {s.partial ? <Markdown>{s.partial}</Markdown> : null}
                  {s.busy ? <LiveActivity chat={{ ...s, queued: 0 }} testid="bot-activity" /> : <div className="text-muted-foreground flex items-center gap-2 text-[13px]"><Spinner className="size-3.5" />{t('bots.chat.queued')}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="px-4 sm:px-5">
          {/* The PC shows it in the chat list beside; the phone, here. */}
          {bot ? <ReplicaBar bot={bot} homes={homes} /> : null}
        </div>
        <Composer value={text} onChange={setText} onSend={send} onStop={bot && busy ? () => act(botCall('bots.stop', { id: bot.id })) : undefined} busy={busy} disabled={sending || (ra && !ra.talk)} testid="bot-chat-input"
          mentions={group ? mentionOptions : false} bottom={plus}
          placeholder={group ? t('bots.chat.placeholderGroup', { name: grp.name }) : ra && !ra.talk ? t('home.cannotTalk') : home && !home.online ? t('home.placeholderOffline', { name: bot.name }) : bot.paused ? t('bots.chat.placeholderPaused', { name: bot.name }) : t('bots.chat.placeholder', { name: bot.name })} />
      </div>
      {info ? (group ? <GroupInfo group={grp} item={item} onClose={close} /> : <BotInfo bot={bot} item={item} onClose={close} />) : null}
    </div>
  );
}
