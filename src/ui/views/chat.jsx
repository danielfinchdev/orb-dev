// The star view: the conversation with the assistant. Under the message box: the working project, the assistant's model
// (Sonnet / Opus) and the "Orquestador" box (ticked = only coordinates; unticked = free mode, works directly).
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Square, RotateCcw, Pause, Play, Wrench, Check, PencilLine } from 'lucide-react';
import { Robot } from '@/components/robot.jsx';
import { Markdown } from '@/components/markdown.jsx';
import { PageHeader } from '@/components/page.jsx';
import { ProjectPicker } from '@/components/project-actions.jsx';
import { confirm } from '@/components/dialogs.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Spinner } from '@/components/ui/basic.jsx';
import { Select, Checkbox, Tip } from '@/components/ui/overlay.jsx';
import { useStore, call, act, setState } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';

const SUGGESTIONS = ['Crea un proyecto «mi-web» con una página de inicio sencilla', '¿Cómo van las tareas?', 'Revisa el proyecto y dime qué mejorarías', 'Resume las bitácoras de esta semana'];

export function useAutoScroll(deps) {
  const ref = useRef(null);
  const stick = useRef(true);
  useEffect(() => { const el = ref.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  const onScroll = () => { const el = ref.current; if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140; };
  return { ref, onScroll };
}

export function Composer({ value, onChange, onSend, onStop, busy, placeholder, top, bottom, disabled, onPaste, onDrop, testid, canSend }) {
  const ta = useRef(null);
  useEffect(() => { const el = ta.current; if (!el) return; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 260)}px`; }, [value]);
  const [dropping, setDropping] = useState(false);
  return (
    <div className="shrink-0 px-5 pb-5">
      <div className={cn('bg-card mx-auto max-w-3xl rounded-2xl border shadow-sm transition-shadow focus-within:shadow-md focus-within:ring-[3px] focus-within:ring-ring/25', dropping && 'ring-primary ring-2')}
        onDragOver={onDrop ? (e) => { e.preventDefault(); setDropping(true); } : undefined} onDragLeave={() => setDropping(false)} onDrop={onDrop ? (e) => { e.preventDefault(); setDropping(false); onDrop(e); } : undefined}>
        {top ? <div className="flex flex-wrap items-center gap-2 px-3 pt-3">{top}</div> : null}
        <textarea ref={ta} data-testid={testid} value={value} disabled={disabled} rows={2} placeholder={placeholder} onPaste={onPaste}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onSend(); } }}
          className="placeholder:text-muted-foreground block w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[14.5px] leading-relaxed outline-none" />
        <div className="flex items-center gap-2 px-3 pb-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{bottom}</div>
          {busy && onStop ? <Tip label="Detener"><Button size="icon-sm" variant="secondary" onClick={onStop} aria-label="Detener"><Square className="size-3.5 fill-current" /></Button></Tip> : null}
          <Button size="icon-sm" className="rounded-full" onClick={onSend} disabled={disabled || !(canSend ?? value.trim())} aria-label="Enviar" data-testid="send"><ArrowUp /></Button>
        </div>
      </div>
    </div>
  );
}

function Message({ m, name, onChanges }) {
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
              {report.accepted ? <Badge variant="success"><Check />Aceptado · tareas {report.tasks.map((t) => `#${t}`).join(', ')}</Badge> : (<>
                <Button size="sm" onClick={() => act(call('chat.accept', { id: m.id }), '¡Hecho! Lo apunto en la bitácora')}><Check />OK</Button>
                <Button size="sm" variant="outline" onClick={() => onChanges(report.tasks)}><PencilLine />Pedir cambios</Button>
                <span className="text-muted-foreground text-xs">Tareas {report.tasks.map((t) => `#${t}`).join(', ')}</span>
              </>)}
            </div>
          ) : null}
        </div>
      </div>
    );
  }
  return <div className="bg-muted/70 text-muted-foreground mx-auto max-w-[88%] rounded-xl px-3.5 py-2 text-center text-[13px] whitespace-pre-wrap">{m.body}</div>;
}

export function ChatView() {
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
    const t = text.trim(); if (!t) return;
    setText('');
    if ((await act(call('chat.send', { text: t }))) === undefined) setText(t);
    else call('chat.list').then(setRows).catch(() => {});
  };
  const settings = async (patch) => { const r = await act(call('chat.settings', patch)); if (r) setState((s) => ({ app: { ...s.app, assistant: r } })); };
  const toggleOrchestrator = async (checked) => {
    if (!checked && !(await confirm('Modo libre', `Sin «Orquestador», ${name} podrá leer, ejecutar comandos y editar archivos directamente en la carpeta del proyecto, como un asistente de programación normal. Seguirá sin poder hacer push ni publicar.`, { ok: 'Activar modo libre' }))) return;
    settings({ orchestrate: checked });
  };

  return (
    <>
      <PageHeader icon={<Robot size={30} mood={chat.busy ? (chat.partial ? 'talking' : 'thinking') : 'idle'} />} title={name}
        meta={`${info.orchestrate === false ? 'Modo libre' : 'Orquestador'} · ${info.modelLabel ?? ''} · conversación ${info.turns ?? 0}/${info.maxTurns ?? 20}`}>
        {app.paused
          ? <Button variant="outline" size="sm" onClick={() => act(call('control.resume'), 'Tareas reanudadas')}><Play />Reanudar tareas</Button>
          : <Tip label="No se lanza ninguna tarea nueva hasta que reanudes"><Button variant="ghost" size="sm" onClick={() => act(call('control.pause'), 'Tareas en pausa')}><Pause />Pausar tareas</Button></Tip>}
        <Button variant="ghost" size="sm" onClick={async () => { if (await confirm('Nueva conversación', `${name} olvidará esta conversación (el tablero y las bitácoras siguen igual).`, { ok: 'Empezar de nuevo' })) act(call('chat.reset')); }}><RotateCcw />Nueva conversación</Button>
      </PageHeader>
      <div ref={scroll.ref} onScroll={scroll.onScroll} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-5 py-6">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 pt-10 text-center">
              <Robot size={130} mood="happy" />
              <h2 className="mt-2 text-2xl">Hola{app.config.userName ? `, ${app.config.userName}` : ''}. Soy {name}.</h2>
              <p className="text-muted-foreground max-w-md">Cuéntame qué quieres hacer. Preparo los encargos, los reparto entre los agentes, reviso lo que hacen y te aviso para que des el OK.</p>
              <div className="mt-3 flex max-w-xl flex-wrap justify-center gap-2">{SUGGESTIONS.map((s) => <Button key={s} variant="outline" size="sm" className="h-auto rounded-full py-1.5 whitespace-normal" onClick={() => setText(s)}>{s}</Button>)}</div>
            </div>
          ) : rows.map((m) => <Message key={m.id} m={m} name={name} onChanges={(ids) => setText(`Cambios para ${ids.map((t) => `#${t}`).join(', ')}: `)} />)}
          {chat.busy ? (
            <div className="flex gap-3">
              <Robot size={32} mood={chat.partial ? 'talking' : 'thinking'} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="text-muted-foreground mb-1 text-xs">{name}</div>
                {chat.partial ? <Markdown>{chat.partial}</Markdown> : null}
                <div className="text-muted-foreground mt-1 flex items-center gap-2 text-[13px]"><Spinner className="size-3.5" />{chat.tools?.length ? <><Wrench className="size-3.5" />{[...new Set(chat.tools)].slice(-4).join(', ')}</> : 'Pensando…'}{chat.queued ? ` · ${chat.queued} en cola` : ''}</div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <Composer value={text} onChange={setText} onSend={send} onStop={() => act(call('chat.stop'))} busy={chat.busy} testid="chat-input"
        placeholder={`Escribe a ${name}…`}
        top={<ProjectPicker />}
        bottom={<>
          <Select size="sm" value={info.model} onValueChange={(v) => settings({ model: v })} title="Modelo del asistente"
            options={(info.models ?? []).map((m) => ({ value: m.id, label: `${m.label} · ${info.reasoning === 'medium' ? 'medio' : info.reasoning}` }))} />
          <label className="flex cursor-pointer items-center gap-2 text-[13px]" title="Marcado: solo coordina y reparte encargos (ahorra). Desmarcado: modo libre, trabaja directamente.">
            <Checkbox checked={info.orchestrate !== false} onCheckedChange={(v) => toggleOrchestrator(v === true)} data-testid="orchestrator-check" />Orquestador
          </label>
        </>} />
    </>
  );
}
