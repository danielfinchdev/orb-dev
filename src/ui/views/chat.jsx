// The star view: the conversation with the assistant. Under the message box: the working project, the assistant's model
// (Sonnet / Opus) and the "Orquestador" box (ticked = only coordinates; unticked = free mode, works directly).
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Square, RotateCcw, Pause, Play, Wrench, Check, CheckCheck, PencilLine, ShieldAlert, X, ExternalLink, AtSign } from 'lucide-react';
import { Robot } from '@/components/robot.jsx';
import { Markdown } from '@/components/markdown.jsx';
import { PageHeader } from '@/components/page.jsx';
import { ProjectPicker } from '@/components/project-actions.jsx';
import { LiveTasksStrip } from '@/components/live-tasks.jsx';
import { confirm } from '@/components/dialogs.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Spinner } from '@/components/ui/basic.jsx';
import { Select, Checkbox, Tip } from '@/components/ui/overlay.jsx';
import { useStore, call, act, setState, go } from '@/lib/store.js';
import { ContextMeter } from './session.jsx';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';

const SUGGESTIONS = ['chat.suggestion1', 'chat.suggestion2', 'chat.suggestion3', 'chat.suggestion4'];

export function useAutoScroll(deps) {
  const ref = useRef(null);
  const stick = useRef(true);
  useEffect(() => { const el = ref.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  const onScroll = () => { const el = ref.current; if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140; };
  return { ref, onScroll };
}

// "@" picker: while typing @word, a list of tasks, conversations and logs to attach as context (token @tarea:12…).
function useMentions(value, onChange, ta) {
  const [options, setOptions] = useState(null);
  const [index, setIndex] = useState(0);
  const caret = ta.current?.selectionStart ?? value.length;
  const match = /(^|\s)@([\wÀ-ɏ-]*)$/.exec(value.slice(0, caret));
  const query = match ? match[2].toLowerCase() : null;
  useEffect(() => { if (query !== null && !options) call('mentions.options').then(setOptions).catch(() => setOptions([])); }, [query !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = query === null ? [] : (options ?? []).filter((o) => `${o.label} ${o.hint}`.toLowerCase().includes(query)).slice(0, 8);
  useEffect(() => setIndex(0), [query]);
  const pick = (o) => {
    const before = value.slice(0, caret).replace(/@[\wÀ-ɏ-]*$/, `${o.token} `);
    onChange(before + value.slice(caret));
    requestAnimationFrame(() => { const el = ta.current; if (el) { el.focus(); el.selectionStart = el.selectionEnd = before.length; } });
  };
  const onKey = (e) => {
    if (!list.length) return false;
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => (i + 1) % list.length); return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => (i - 1 + list.length) % list.length); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(list[index]); return true; }
    if (e.key === 'Escape') { e.preventDefault(); onChange(value.slice(0, caret).replace(/@[\wÀ-ɏ-]*$/, '') + value.slice(caret)); return true; }
    return false;
  };
  return { list, index, pick, onKey };
}

export function Composer({ value, onChange, onSend, onStop, busy, placeholder, top, bottom, disabled, onPaste, onDrop, testid, canSend, mentions = true }) {
  const t = useT();
  const ta = useRef(null);
  useEffect(() => { const el = ta.current; if (!el) return; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 260)}px`; }, [value]);
  const [dropping, setDropping] = useState(false);
  const m = useMentions(value, onChange, ta);
  return (
    <div className="shrink-0 px-5 pb-5">
      <div className={cn('bg-card relative mx-auto max-w-3xl rounded-2xl border shadow-sm transition-shadow focus-within:shadow-md focus-within:ring-[3px] focus-within:ring-ring/25', dropping && 'ring-primary ring-2')}
        onDragOver={onDrop ? (e) => { e.preventDefault(); setDropping(true); } : undefined} onDragLeave={() => setDropping(false)} onDrop={onDrop ? (e) => { e.preventDefault(); setDropping(false); onDrop(e); } : undefined}>
        {mentions && m.list.length ? (
          <div className="bg-popover text-popover-foreground absolute right-3 bottom-full left-3 z-20 mb-2 overflow-hidden rounded-xl border shadow-lg" data-testid="mention-list">
            <div className="text-muted-foreground border-b px-3 py-1.5 text-[11px]">{t('chat.mentionHeader')}</div>
            {m.list.map((o, i) => (
              <button key={o.token} onMouseDown={(e) => { e.preventDefault(); m.pick(o); }} className={cn('flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-[13px]', i === m.index ? 'bg-accent' : 'hover:bg-accent/60')}>
                <AtSign className="text-muted-foreground size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">{o.label}</span><span className="text-muted-foreground shrink-0 text-[11px]">{o.hint}</span>
              </button>
            ))}
          </div>
        ) : null}
        {top ? <div className="flex flex-wrap items-center gap-2 px-3 pt-3">{top}</div> : null}
        <textarea ref={ta} data-testid={testid} value={value} disabled={disabled} rows={2} placeholder={placeholder} onPaste={onPaste}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (mentions && m.onKey(e)) return; if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onSend({ alt: e.ctrlKey || e.metaKey }); } }}
          className="placeholder:text-muted-foreground block w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[14.5px] leading-relaxed outline-none" />
        <div className="flex items-center gap-2 px-3 pb-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{bottom}</div>
          {busy && onStop ? <Tip label={t('chat.stop')}><Button size="icon-sm" variant="secondary" onClick={onStop} aria-label={t('chat.stop')}><Square className="size-3.5 fill-current" /></Button></Tip> : null}
          <Button size="icon-sm" className="rounded-full" onClick={() => onSend({ alt: false })} disabled={disabled || !(canSend ?? value.trim())} aria-label={t('chat.send')} data-testid="send"><ArrowUp /></Button>
        </div>
      </div>
    </div>
  );
}

function Message({ m, name, onChanges }) {
  const t = useT();
  if (m.role === 'usuario') return <div className="bg-bubble text-bubble-foreground ml-auto max-w-[80%] rounded-2xl rounded-br-md px-4 py-2.5 whitespace-pre-wrap break-words">{m.body}</div>;
  if (m.role === 'orb') {
    const report = m.meta?.kind === 'report' && m.meta.tasks?.length ? m.meta : null;
    return (
      <div className="flex gap-3">
        <Robot size={32} still className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="text-muted-foreground mb-1 text-xs">{name}</div>
          <Markdown>{m.body}</Markdown>
          {report ? (
            <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="report-actions">
              {report.accepted ? <Badge variant="success"><Check />{t('chat.accepted', { ids: report.tasks.map((id) => `#${id}`).join(', ') })}</Badge> : (<>
                <Button size="sm" onClick={() => act(call('chat.accept', { id: m.id }), t('chat.acceptDone'))}><Check />OK</Button>
                <Button size="sm" variant="outline" onClick={() => onChanges(report.tasks)}><PencilLine />{t('chat.requestChanges')}</Button>
                <span className="text-muted-foreground text-xs">{t('chat.tasksList', { ids: report.tasks.map((id) => `#${id}`).join(', ') })}</span>
              </>)}
            </div>
          ) : null}
        </div>
      </div>
    );
  }
  if (m.meta?.kind === 'approval' || m.meta?.kind === 'task-approval') return <ChatApproval m={m} />;
  return <div className="bg-muted/70 text-muted-foreground mx-auto max-w-[88%] rounded-xl px-3.5 py-2 text-center text-[13px] whitespace-pre-wrap">{m.body}</div>;
}

// A permission request in the chat: the assistant's own (free mode) or one of a task (answered here or in the task).
function ChatApproval({ m }) {
  const t = useT();
  const [state, setLocal] = useState(m.meta.status ?? 'pending');
  const task = m.meta.kind === 'task-approval';
  const answer = async (decision) => {
    const r = await act(task ? call('sessions.approve', { id: m.meta.session, request: m.meta.request, decision }) : call('chat.approve', { request: m.meta.id, decision }));
    if (r !== undefined) setLocal(decision === 'deny' ? 'denied' : 'allowed');
  };
  const done = state !== 'pending';
  return (
    <div className={cn('mx-auto w-full max-w-[88%] rounded-xl border px-3.5 py-2.5 text-[13px]', done ? 'bg-muted/50' : 'border-warning/50 bg-warning/10')}>
      <div className="flex items-start gap-2"><ShieldAlert className={cn('mt-0.5 size-4 shrink-0', done ? 'text-muted-foreground' : 'text-warning')} /><div className="min-w-0 flex-1 whitespace-pre-wrap break-words">{m.body}</div></div>
      <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
        {done ? <Badge variant={state === 'denied' ? 'destructive' : 'success'}>{state === 'denied' ? t('decision.denied') : t('decision.allowed')}</Badge> : (<>
          <Button size="sm" onClick={() => answer('allow')}><Check />{t('chat.allow')}</Button>
          <Button size="sm" variant="outline" onClick={() => answer('always')}><CheckCheck />{t('chat.always')}</Button>
          <Button size="sm" variant="outline" onClick={() => answer('deny')}><X />{t('chat.deny')}</Button>
        </>)}
        {task ? <Button size="sm" variant="ghost" onClick={() => go({ view: 'session', id: m.meta.session })}><ExternalLink />{t('chat.viewTask')}</Button> : null}
      </div>
    </div>
  );
}

export function ChatView() {
  const t = useT();
  const app = useStore((s) => s.app);
  const version = useStore((s) => s.version);
  const [rows, setRows] = useState([]);
  const [text, setText] = useState('');
  const name = app.config.assistantName;
  const chat = app.chat ?? {};
  const info = app.assistant ?? {};
  useEffect(() => { let alive = true; call('chat.list').then((r) => alive && setRows(r)).catch(() => {}); return () => { alive = false; }; }, [version]);
  const scroll = useAutoScroll([rows.length, chat.partial, chat.busy]);

  const send = async () => {
    const msg = text.trim(); if (!msg) return;
    setText('');
    if ((await act(call('chat.send', { text: msg }))) === undefined) setText(msg);
    else call('chat.list').then(setRows).catch(() => {});
  };
  const settings = async (patch) => { const r = await act(call('chat.settings', patch)); if (r) setState((s) => ({ app: { ...s.app, assistant: r } })); };
  const toggleOrchestrator = async (checked) => {
    if (!checked && !(await confirm(t('chat.freeMode'), t('chat.freeModeBody', { name }), { ok: t('chat.freeModeOk') }))) return;
    settings({ orchestrate: checked });
  };

  return (
    <>
      <PageHeader icon={<Robot size={30} mood={chat.busy ? (chat.partial ? 'talking' : 'thinking') : 'idle'} />} title={name}
        meta={<span className="inline-flex flex-wrap items-center gap-x-1.5">{info.orchestrate === false ? t('chat.freeMode') : t('chat.orchestrator')} · {info.modelLabel ?? ''}{(chat.context ?? info.context) ? <> · <ContextMeter context={chat.context ?? info.context} /></> : null}</span>}>
        {app.paused
          ? <Button variant="outline" size="sm" onClick={() => act(call('control.resume'), t('chat.resumed'))}><Play />{t('chat.resume')}</Button>
          : <Tip label={t('chat.pauseTip')}><Button variant="ghost" size="sm" onClick={() => act(call('control.pause'), t('chat.paused'))}><Pause />{t('chat.pause')}</Button></Tip>}
        <Button variant="ghost" size="sm" onClick={async () => { if (await confirm(t('chat.reset'), t('chat.resetBody', { name }), { ok: t('chat.reset') })) act(call('chat.reset')); }}><RotateCcw />{t('chat.reset')}</Button>
      </PageHeader>
      <div ref={scroll.ref} onScroll={scroll.onScroll} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-5 py-6">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 pt-10 text-center">
              <Robot size={130} mood="happy" />
              <h2 className="mt-2 text-2xl">{app.config.userName ? t('chat.helloUser', { user: app.config.userName, name }) : t('chat.hello', { name })}</h2>
              <p className="text-muted-foreground max-w-md">{t('chat.intro')}</p>
              <div className="mt-3 flex max-w-xl flex-wrap justify-center gap-2">{SUGGESTIONS.map((s) => <Button key={s} variant="outline" size="sm" className="h-auto rounded-full py-1.5 whitespace-normal" onClick={() => setText(t(s))}>{t(s)}</Button>)}</div>
            </div>
          ) : rows.map((m) => <Message key={m.id} m={m} name={name} onChanges={(ids) => setText(t('chat.changesFor', { ids: ids.map((id) => `#${id}`).join(', ') }))} />)}
          {chat.busy ? (
            <div className="flex gap-3">
              <Robot size={32} mood={chat.partial ? 'talking' : 'thinking'} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="text-muted-foreground mb-1 text-xs">{name}</div>
                {chat.partial ? <Markdown>{chat.partial}</Markdown> : null}
                <div className="text-muted-foreground mt-1 flex items-center gap-2 text-[13px]"><Spinner className="size-3.5" />{chat.tools?.length ? <><Wrench className="size-3.5" />{[...new Set(chat.tools)].slice(-4).join(', ')}</> : t('chat.thinking')}{chat.queued ? ` · ${t('chat.queued', { n: chat.queued })}` : ''}</div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <LiveTasksStrip />
      <Composer value={text} onChange={setText} onSend={send} onStop={() => act(call('chat.stop'))} busy={chat.busy} testid="chat-input"
        placeholder={chat.busy ? t('chat.placeholderBusy', { name }) : t('chat.placeholder', { name })}
        top={<ProjectPicker />}
        bottom={<>
          <Select size="sm" value={info.model} onValueChange={(v) => settings({ model: v })} title={t('chat.modelTitle')}
            options={(info.models ?? []).map((m) => ({ value: m.id, label: `${m.label} · ${info.reasoning === 'medium' ? t('chat.reasoningMedium') : info.reasoning}` }))} />
          <label className="flex cursor-pointer items-center gap-2 text-[13px]" title={t('chat.orchestratorHint')}>
            <Checkbox checked={info.orchestrate !== false} onCheckedChange={(v) => toggleOrchestrator(v === true)} data-testid="orchestrator-check" />{t('chat.orchestrator')}
          </label>
        </>} />
    </>
  );
}
