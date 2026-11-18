// A direct conversation with one agent, live: the answer streams as it is written, commands and changed
// files appear as the agent works, risky actions wait for a click (approval cards), messages written meanwhile correct the
// agent on the fly or wait in a queue, and the context meter shows how full the conversation is. Task runs open here too.
import { lazy, memo, Suspense, useEffect, useMemo, useState } from 'react';
import { Info, PanelRight, FolderOpen, Archive, Trash2, Pencil, Terminal, ChevronRight, ChevronUp, FileText, Search, Globe, Wrench, FilePlus2, FileEdit, FileMinus2, ImageIcon, Film, Music, FileArchive, File as FileIcon, FileCode, X, ClipboardCheck, CircleAlert, ShieldAlert, Check, CheckCheck, GitFork, Play, Bot, ListOrdered, ArrowUp as ArrowUpIcon, ArrowDown, CornerDownRight, Gamepad2, Smartphone, Shuffle, SquareTerminal } from 'lucide-react';
import { unlockCore } from '@/lib/core-access.js';
import { notifyError, notifyOk } from '@/lib/notify.js';
import { TypingMarkdown, TypedMarkdown } from '@/components/markdown.jsx';
import { PageHeader } from '@/components/page.jsx';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { confirm, form } from '@/components/dialogs.jsx';
import { renameChat, useReadOnOpen } from '@/views/orb/inbox.jsx';
import { useDraft } from '@/lib/draft.js';
import { useAddToChat, appendToBox } from '@/lib/add-to-chat.js';
import { BackToList } from '@/components/chat-bar.jsx';
import { ContextSlot } from '@/components/context-slot.jsx';
import { ColdNotice } from '@/components/conversation/cold-notice.jsx';
import { ChatModes } from '@/components/chat-modes.jsx';
import { SubagentList } from '@/components/subagents.jsx';
import { SideChats } from '@/components/chat-side.jsx';
import { TaskChanges } from '@/components/task-changes.jsx';
import { TurnChanges } from '@/components/turn-changes.jsx';
import { ChatPanel } from '@/components/chat-panel.jsx';
import { SessionInfo } from '@/views/orb/info.jsx';
import { takeComments, putBackComments, useComments } from '@/lib/turn-comments.js';
import { SecretCards } from '@/components/secret-card.jsx';
import { PrCards, PrPanel, usePr } from '@/components/pr-card.jsx';
import { CommitDialog, CommitMenuItem } from '@/components/commit-dialog.jsx';
import { offerWorktreeRemoval } from '@/components/worktree-removal.jsx';
import { HtmlPages } from '@/components/html-page.jsx';
import { takePoints, onPoints } from '@/lib/browser-points.js';
import { TerminalPanel } from '@/components/terminal-panel.jsx';
import { onTerminalPaste } from '@/lib/terminal-paste.js';
import { NotificationBell } from '@/components/notification-center.jsx';
import { useCatalog, modelsOf, modelLabel, AgentChip } from '@/components/brain-picker.jsx';
import { WorkspacePills } from '@/components/workspace-pills.jsx';
import { stepText, bareTool } from '@/components/chat-live.jsx';
import { readableInput, readableCommand } from '@/lib/tools.js';
import { GeneratedImage, openImage } from '@/components/image-viewer.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Textarea, Empty } from '@/components/ui/basic.jsx';
import { Select, Collapsible, CollapsibleTrigger, CollapsibleContent, Tip, BubbleTip, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/overlay.jsx';
import { useStore, call, act, go, newChat, bridge, refresh, getState, fullPc, openGames, addPending, dropPending, pendingShown, usePending } from '@/lib/store.js';
import { useShortcut } from '@/lib/keys.js';
import { AGENT, PERMISSION, REASONING, DECISION, CAN_STEER as AGENT_CAN_STEER, CAN_COMPACT, options } from '@/lib/labels.js';
import { baseName, cn } from '@/lib/utils.js';
import { useT, t, useLocale, currentLocale } from '@/lib/i18n.js';
import { sameBlock } from '@/lib/memo.js';
import { toBlocks, subagentState } from '@/lib/session-blocks.js';
import { summaryText } from '@/lib/tool-summary.js';
import { kindOf, playableType } from '../../shared/attach-kind.mjs';
import { canCapture, captureFrame } from '@/lib/window-capture.js';
import { useAutoScroll, Composer } from '@/components/conversation/composer.jsx';
import { MessageBox } from '@/components/conversation/message-box.jsx';
import { EditButton, RewindLine } from '@/components/edit-message.jsx';
import { BarClock, BarPause, BarHeading, COMPACT_AT, CompactButton } from '@/components/conversation/bar.jsx';
import { ContextMeter } from '@/components/conversation/context-meter.jsx';
import { AutonomySwitch } from '@/components/autonomy-switch.jsx';
import { TurnFlow } from '@/components/conversation/turn-card.jsx';
import { onOpenChanges, onOpenPanel } from '@/lib/open-changes.js';
import { AttachMenu } from '@/components/conversation/attach-menu.jsx';
import { TaskStatus } from '@/components/task-state.jsx';
import { quiet } from '@/lib/quiet.js';
import { MoreButton, IconButton } from '@/components/ui/primitives.jsx';
import { ConversationTrail, useTrailScroll } from '@/components/conversation/trail.jsx';

// An icon that says what the tool does (reading, writing, searching, the web, a command…).
function toolIcon(name = '') {
  if (/^(Write|Edit|MultiEdit|NotebookEdit|edit|write|applyPatch)/i.test(name)) return FileEdit;
  if (/^(Read|read)/.test(name)) return FileText;
  if (/^(Glob|Grep|glob|grep|ls|LS)|Búsqueda/.test(name)) return Search;
  if (/^(WebFetch|WebSearch|orb:browser)|browser/i.test(name)) return Globe;
  if (/^(Bash|Comando|shell|run_terminal)/i.test(name)) return Terminal;
  return Wrench;
}

// a tool's name as people read it: the tools of Orb (and of Opti Bot, in its old conversation) by what they do («Creando una tarea»), the
// agents' own (Read, Bash…) as they are, never «mcp__opti__opti_propose» or «ToolSearch».
function toolName(t, name) {
  const bare = bareTool(name);
  if (!bare) return t('session.tool');
  if (/^(orb|opti)_|^tool_?search$/i.test(bare) || bare !== String(name)) return stepText(t, { name: bare });
  return /^[A-Za-z][\w .-]{0,30}$/.test(bare) ? bare : t('session.tool');
}

function ToolBlock({ b }) {
  const t = useT();
  const error = b.result?.error;
  const Icon = toolIcon(bareTool(b.call?.name));
  const input = readableInput(b.call?.input, b.call?.name);
  const raw = String(b.call?.input ?? '');
  return (
    <Collapsible className={cn('bg-card rounded-xl border text-control', error && 'border-destructive/40')}>
      <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left">
        <ChevronRight className="text-muted-foreground size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        <Icon className="text-muted-foreground size-3.5" />
        <span className="font-medium">{toolName(t, b.call?.name)}</span>
        <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs">{input}</span>
        {!b.result ? <span className="bg-info size-1.5 animate-pulse rounded-full" /> : error ? <CircleAlert className="text-destructive size-3.5" /> : null}
      </CollapsibleTrigger>
      <CollapsibleContent>
        {/* The whole call (a long command, the data it sent) only when unfolded. */}
        {raw && readableCommand(raw) !== input ? <pre className="text-muted-foreground mx-3 mb-1.5 max-h-40 overflow-auto px-1 font-mono text-micro whitespace-pre-wrap break-all">{readableCommand(raw)}</pre> : null}
        <pre className="bg-muted mx-3 mb-3 max-h-80 overflow-auto rounded-lg px-3 py-2 font-mono text-xs whitespace-pre-wrap break-words">{b.result?.output || (b.result ? t('session.noOutput') : t('session.working'))}</pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

// A run of tool calls as one folded line («Leyó 3 archivos, ejecutó 2 comandos»); unfolded, each call as always.
function ToolGroup({ b }) {
  const t = useT();
  const text = summaryText(b.steps.map((x) => x.call?.name), t);
  const failed = b.steps.filter((x) => x.result?.error).length;
  return (
    <Collapsible className="text-control" data-testid="tool-group">
      <CollapsibleTrigger className="group text-muted-foreground hover:text-foreground flex w-full cursor-pointer items-center gap-2 px-1 py-1 text-left" aria-label={t('tools.sum.toggle', { summary: text })}>
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        <span className="min-w-0 truncate">{text}</span>
        {failed ? <span className="text-destructive flex shrink-0 items-center gap-1 text-xs"><CircleAlert className="size-3.5" />{t('tools.sum.failed', { n: failed })}</span> : null}
      </CollapsibleTrigger>
      <CollapsibleContent><div className="mt-1 grid gap-2">{b.steps.map((x) => <ToolBlock key={x.key} b={x} />)}</div></CollapsibleContent>
    </Collapsible>
  );
}

// a subagent as one folding row: its name, model and state; unfolded, what it was asked, the steps it took and
// its answer.
const SUB_STATE = { running: 'bg-info animate-pulse', done: 'bg-success', failed: 'bg-destructive', stopped: 'bg-muted-foreground' };
function SubagentBlock({ b, defaultOpen }) {
  const t = useT();
  const a = b.call.agent;
  const state = subagentState(b);
  return (
    <Collapsible defaultOpen={defaultOpen} className={cn('bg-card rounded-xl border text-control', state === 'failed' && 'border-destructive/40')} data-testid="subagent">
      <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left">
        <ChevronRight className="text-muted-foreground size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        <Bot className="text-muted-foreground size-3.5" />
        <span className="font-medium">{a.name ?? t('session.subagent')}</span>
        {a.model ? <Badge variant="secondary" className="font-normal">{a.model}</Badge> : null}
        <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">{a.description ?? ''}</span>
        {b.steps.length ? <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{t('session.subagentSteps', { n: b.steps.length })}</span> : null}
        <span className={cn('size-1.5 shrink-0 rounded-full', SUB_STATE[state])} role="img" aria-label={t(`session.subagentState.${state}`)} data-state={state} />
      </CollapsibleTrigger>
      <CollapsibleContent className="grid gap-1.5 px-3 pb-3">
        {b.steps.map((s) => (s.type === 'subagent' ? <SubagentBlock key={s.key} b={s} /> : <ToolBlock key={s.key} b={s} />))}
        {b.result?.output ? <pre className="bg-muted max-h-80 overflow-auto rounded-lg px-3 py-2 font-mono text-xs whitespace-pre-wrap break-words">{b.result.output}</pre> : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

// «Claude Code · claude-sonnet-5-5», «Codex · gpt-6-luna» (the line an agent writes when it starts) with the names
// the rest of the app uses.
function statusText(body, agent, catalog) {
  const m = /^(.+?) · ([\w.:\-/[\]]+)$/.exec(String(body ?? ''));
  return m ? `${AGENT[agent] ?? m[1]} · ${modelLabel(catalog, agent, m[2])}` : body;
}

// «Traspasado de Claude a Codex · ver lo que se pasó»: the exact text the new agent received.
function HandoffLine({ body = {} }) {
  const t = useT();
  return (
    <Collapsible className="text-muted-foreground text-center text-xs" data-testid="handoff-line">
      <span>{t('session.handoffLine', { from: AGENT[body.from] ?? body.from, to: AGENT[body.to] ?? body.to })} · </span>
      <CollapsibleTrigger className="cursor-pointer underline-offset-2 hover:underline">{t('session.handoffSeen')}</CollapsibleTrigger>
      <CollapsibleContent className="bg-muted/40 mt-2 rounded-xl px-3.5 py-2.5 text-left whitespace-pre-wrap break-words">
        {body.truncated ? <div className="mb-1 italic">{t('session.handoffCut')}</div> : null}
        {body.summary}
      </CollapsibleContent>
    </Collapsible>
  );
}

const FILE_ICON = { add: FilePlus2, delete: FileMinus2 };
// an attachment's icon by what it is (src/shared/attach-kind.mjs).
const ATTACH_ICON = { image: ImageIcon, video: Film, audio: Music, pdf: FileText, document: FileText, archive: FileArchive, text: FileCode };
function AttachIcon({ file, className }) { const I = ATTACH_ICON[kindOf(file)] ?? FileIcon; return <I className={className} />; }
// an attachment of a message. On the PC a picture opens in the image viewer and a PDF in the file viewer
// (file-viewer.jsx, loaded when first opened); so does audio or video the window can play. The rest, and
// everything on the phone, is its name.
const FileViewer = lazy(() => import('@/components/file-viewer.jsx'));
function AttachChip({ file, sessionId }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const kind = kindOf(file) === 'image' && !/\.(png|jpe?g|webp|gif)$/i.test(file) ? 'other' : kindOf(file);
  const chip = 'inline-flex items-center gap-1 rounded-md bg-white/15 px-2 py-0.5 text-xs';
  const label = <><AttachIcon file={file} className="size-3" />{baseName(file)}</>;
  if (bridge.mobile || !(['image', 'pdf'].includes(kind) || playableType(file))) return <span className={chip}>{label}</span>;
  return (
    <>
      <button type="button" className={cn(chip, 'cursor-pointer hover:bg-white/25')} onClick={() => (kind === 'image' ? openImage(file) : setOpen(true))} aria-label={t('viewer.open', { name: baseName(file) })} data-testid="attach-open">{label}</button>
      {open ? <Suspense fallback={null}><FileViewer sessionId={sessionId} path={file} onClose={() => setOpen(false)} /></Suspense> : null}
    </>
  );
}

// The blocks are made again from the items whenever one arrives: a block whose content is the same is not drawn again
// (nor while the agent's answer streams, which redraws the view many times a second): lib/memo.js › sameBlock.
const Block = memo(function Block({ b, agent, who, brain, sessionId, project, catalog }) {
  const t = useT();
  const userName = useStore((st) => st.app?.config?.userName?.trim() || '');
  const locale = useLocale();
  const usageLine = useStore((st) => st.app?.config?.ui?.usageLine !== false);
  if (b.type === 'tool') return <ToolBlock b={b} />;
  if (b.type === 'toolgroup') return <ToolGroup b={b} />;
  if (b.type === 'subagent') return <SubagentBlock b={b} />;
  if (b.type === 'item' && b.item.kind === 'approval') return <ApprovalCard sessionId={sessionId} body={b.item.body} />;
  if (b.type === 'item' && b.item.kind === 'opti_action') return <OptiOldCard body={b.item.body} />;
  if (b.type === 'item' && b.item.kind === 'image') return <div className="flex gap-3"><AgentIcon agent={agent} className="mt-1 size-5" /><GeneratedImage body={b.item.body} sessionId={sessionId} project={project} /></div>;
  if (b.type === 'files') return <div className="flex flex-wrap gap-1.5">{b.files.map((f, i) => { const I = FILE_ICON[f?.change] ?? FileEdit; return <Badge key={i} variant="info" className="font-mono font-normal"><I />{f?.path}</Badge>; })}</div>;
  if (b.type === 'item' && b.item.kind === 'handoff') return <HandoffLine body={b.item.body} />;
  if (b.type === 'item' && b.item.kind === 'rewind') return <RewindLine sessionId={sessionId} item={b.item} />;
  const it = b.item; const body = it.body;
  if (it.role === 'user') {
    const textBody = typeof body === 'string' ? body : body?.text ?? '';
    const images = typeof body === 'object' && body?.images ? body.images : [];
    const long = textBody.length > 1200 && /^Encargo de /.test(textBody);
    return (
      <MessageBox user name={userName || t('chat.you')} at={it.at} actions={long ? undefined : <EditButton sessionId={sessionId} item={it} />}>
        {typeof body === 'object' && body?.steer ? <div className="mb-1 flex items-center gap-1 text-micro opacity-80"><CornerDownRight className="size-3" />{t('session.steered')}</div> : null}
        {long ? <Collapsible><CollapsibleTrigger className="cursor-pointer text-left underline-offset-2 hover:underline">{textBody.split('\n')[0]} ({t('session.seeFullTask')})</CollapsibleTrigger><CollapsibleContent className="mt-2 text-control opacity-90">{textBody}</CollapsibleContent></Collapsible> : textBody}
        {images.length ? <div className="mt-2 flex flex-wrap gap-1.5">{images.map((p) => <AttachChip key={p} file={p} sessionId={sessionId} />)}</div> : null}
      </MessageBox>
    );
  }
  if (it.kind === 'text' && it.role === 'assistant') return <MessageBox name={who ?? AGENT[agent]} at={it.at} icon={<AgentIcon agent={agent} className="size-5 shrink-0" />}><TypedMarkdown tail={`session:${sessionId}`}>{body}</TypedMarkdown></MessageBox>;
  if (it.kind === 'reasoning') return <div className="text-muted-foreground border-l-2 pl-3 text-control italic whitespace-pre-wrap line-clamp-4">{body}</div>;
  if (it.kind === 'usage') {
    // Ajustes › Apariencia can hide it (shown by default).
    if (!usageLine) return null;
    const parts = [body?.costUsd != null ? `$${Number(body.costUsd).toFixed(3)}` : null, body?.inputTokens != null ? `${t('session.tokensIn', { n: (body.inputTokens + (body.cacheReadTokens ?? 0) + (body.cacheWriteTokens ?? 0)).toLocaleString(locale) })}${body.cacheReadTokens ? ` (${t('session.tokensCached', { n: body.cacheReadTokens.toLocaleString(locale) })})` : ''}` : null, body?.outputTokens != null ? t('session.tokensOut', { n: body.outputTokens.toLocaleString(locale) }) : null].filter(Boolean);
    return parts.length ? <div className="text-muted-foreground text-right text-micro">{parts.join(' · ')}</div> : null;
  }
  if (it.role === 'error') return <div className="bg-destructive/10 text-destructive rounded-xl px-3.5 py-2.5 text-control whitespace-pre-wrap break-words">{typeof body === 'string' ? body : JSON.stringify(body)}</div>;
  if (it.kind === 'status' && typeof body === 'string') return <div className="text-muted-foreground text-center text-xs">{statusText(body, brain ?? agent, catalog)}</div>;
  return <div className="text-muted-foreground text-center text-xs">{typeof body === 'string' ? body : JSON.stringify(body)}</div>;
}, (prev, next) => sameBlock(prev.b, next.b) && prev.agent === next.agent && prev.brain === next.brain && prev.sessionId === next.sessionId && prev.project === next.project && prev.catalog === next.catalog);

// a proposal Opti Bot left in its conversation before «Monitoreo del equipo» was removed: read only, as it
// ended.
const OLD_STATUS = { done: ['done', 'success'], running: ['expired', 'secondary'], pending: ['expired', 'secondary'], failed: ['failed', 'secondary'], cancelled: ['failed', 'secondary'], denied: ['denied', 'secondary'], expired: ['expired', 'secondary'] };
function OptiOldCard({ body = {} }) {
  const t = useT();
  const [label, tone] = OLD_STATUS[body.status] ?? OLD_STATUS.expired;
  const target = body.action === 'end_process' ? `${body.label || body.name || ''} (${body.pid})` : body.action === 'disable_startup' ? body.label || body.name : '';
  return (
    <div className="bg-card rounded-xl border px-3.5 py-3 text-control" data-testid="opti-old">
      <div className="flex items-start gap-2.5">
        <ShieldAlert className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{t('session.optiOld', { action: t(`session.opti.${body.action}`) })}{target ? <span className="text-muted-foreground font-normal"> · {target}</span> : null}</div>
          {body.reason ? <div className="text-muted-foreground mt-0.5">{body.reason}</div> : null}
          {body.result ? <div className="mt-1.5 whitespace-pre-wrap">{body.result}</div> : null}
        </div>
        <Badge variant={tone}>{t(`session.optiStatus.${label}`)}</Badge>
      </div>
    </div>
  );
}

// An approval card: the agent wants to do something risky and waits for the user's click.
export function ApprovalCard({ sessionId, body, compact = false }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const answer = async (decision) => { setBusy(true); await act(call('sessions.approve', { id: sessionId, request: body.id, decision })); setBusy(false); };
  const done = body.status && body.status !== 'pending' ? DECISION[body.status] : null;
  return (
    <div className={cn('rounded-xl border px-3.5 py-3 text-control', done ? 'bg-card' : 'border-warning/50 bg-warning/10')} data-testid="approval-card">
      <div className="flex items-start gap-2.5">
        <ShieldAlert className={cn('mt-0.5 size-4 shrink-0', done ? 'text-muted-foreground' : 'text-warning-ink')} />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{done ? t('session.askedFor') : t('session.wantsThis')}</div>
          <div className="bg-muted mt-1.5 rounded-md px-2.5 py-1.5 font-mono text-xs break-all whitespace-pre-wrap">{body.title}</div>
          {body.reason ? <div className="text-muted-foreground mt-1.5 text-xs">{t('session.reason', { reason: body.reason })}</div> : null}
          {done ? <Badge variant={done[1]} className="mt-2">{done[0]}</Badge> : (
            <div className={cn('mt-2.5 flex flex-wrap gap-2', compact && 'gap-1.5')}>
              <Button size="sm" disabled={busy} onClick={() => answer('allow')} data-testid="approve-allow"><Check />{t('session.allow')}</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => answer('always')}><CheckCheck />{t('session.allowAlways')}</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => answer('deny')} data-testid="approve-deny"><X />{t('session.deny')}</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Details of a conversation: where it works, git, where it comes from, its task.
// The account of a conversation by its name, only when its agent has more than one (otherwise the agent's name says it).
const accountName = (accounts = [], s) => (accounts.filter((a) => a.agent === s.agent).length > 1 ? accounts.find((a) => a.id === (s.account ?? s.agent))?.label ?? null : null);

async function showDetails(s, task) {
  let info = null;
  if (s.project) { try { info = await call('projects.info', { name: s.project }); } catch { info = null; } }
  const parent = s.parent_id ? getState().sessions.find((x) => x.id === s.parent_id) : null;
  const Row = ({ k, children }) => <><dt className="text-muted-foreground">{k}</dt><dd className="min-w-0 break-all">{children}</dd></>;
  await form(t('session.details'), {
    wide: true,
    body: () => (
      <dl className="grid grid-cols-[130px_1fr] gap-x-4 gap-y-2 text-control">
        <Row k={t('session.agent')}>{AGENT[s.agent]}{s.model ? ` · ${s.model}` : ''} · {t('session.reasoningOf', { level: REASONING[s.reasoning]?.toLowerCase() ?? s.reasoning })}</Row>
        <Row k={t('session.account')}>{(getState().app?.config?.accounts ?? []).find((a) => a.id === (s.account ?? s.agent))?.label ?? s.account}</Row>
        <Row k={t('session.permissions')}>{PERMISSION[s.permission]}</Row>
        <Row k={t('session.folder')}><span className="font-mono text-xs">{s.cwd}</span></Row>
        {info?.git ? <Row k="Git">{t('session.branch')} <span className="font-mono">{info.branch}</span> · {info.changes ? t('session.unsaved', { n: info.changes }) : t('session.noChanges')}{info.remote ? ` · ${info.remote}` : ''}{info.ahead ? ` · ${t('session.unpushed', { n: info.ahead })}` : ''}</Row> : s.project ? <Row k="Git">{t('session.noGit')}</Row> : null}
        {info?.prs?.length ? <Row k="Pull requests">{info.prs.map((p) => <a key={p.number} className="mr-2 cursor-pointer underline-offset-2 hover:underline" onClick={() => bridge.openExternal(p.url)}>#{p.number} {p.title}</a>)}</Row> : null}
        {s.context?.size ? <Row k={t('session.context')}><ContextMeter context={s.context} /></Row> : null}
        {task ? <Row k={t('session.task')}><a className="cursor-pointer underline-offset-2 hover:underline" onClick={() => go({ view: 'tasks', id: task.id })}>#{task.id} {task.title}</a> · <TaskStatus task={task} plain /></Row> : null}
        {parent ? <Row k={t('session.forkedFrom')}><a className="cursor-pointer underline-offset-2 hover:underline" onClick={() => go({ view: 'session', id: parent.id })}>{parent.title}</a></Row> : null}
        <Row k={t('session.agentConversation')}><span className="font-mono text-xs">{s.cli_session ?? t('session.notStarted')}</span></Row>
        <Row k={t('session.created')}>{new Date(s.created_at).toLocaleString(currentLocale())}</Row>
      </dl>
    ),
    ok: t('session.close'), onOk: () => true
  });
}

// the text the agent is writing now, the only part of the conversation that follows each streamed piece: the
// pieces of a frame are drawn together and typed on screen (TypingMarkdown; the saved item goes on from there), and its
// finished blocks are not parsed again. It empties
// when the agent's text arrives as an item (in the same frame the item is drawn) or the turn ends.
function LivePartial({ id, agent, running }) {
  const t = useT();
  const [partial, setPartial] = useState('');
  useEffect(() => {
    let buffer = ''; let frame = null;
    const flush = () => { frame = null; if (!buffer) return; const add = buffer; buffer = ''; setPartial((p) => (p + add).slice(-6000)); };
    const offDelta = bridge.on('session:delta', (d) => {
      if (d.id !== id) return;
      buffer += String(d.text ?? '');
      frame ??= document.hidden ? setTimeout(flush, 100) : requestAnimationFrame(flush);
    });
    const offItem = bridge.on('session:item', (it) => { if (it.session_id === id && it.role === 'assistant' && it.kind === 'text') { buffer = ''; setPartial(''); } });
    return () => { offDelta(); offItem(); if (frame != null) { cancelAnimationFrame(frame); clearTimeout(frame); } };
  }, [id]);
  useEffect(() => { if (!running) setPartial(''); }, [running]);
  if (partial) return <div className="flex gap-3" data-testid="partial"><AgentIcon agent={agent} className="mt-1 size-5" /><div className="min-w-0 flex-1 opacity-90"><TypingMarkdown text={partial} tail={`session:${id}`} /></div></div>;
  return running ? <div className="text-muted-foreground flex items-center gap-2 text-control"><span className="bg-info size-2 animate-pulse rounded-full" />{t('session.agentWorking', { agent: AGENT[agent] })}</div> : null;
}

// What the user wrote, as the engine keeps it (a text, or { text, images }).
const userText = (it) => (typeof it.body === 'string' ? it.body : it.body?.text ?? '');

export function SessionView({ route }) {
  const t = useT();
  const sessions = useStore((s) => s.sessions);
  const tasks = useStore((s) => s.tasks);
  const app = useStore((s) => s.app);
  const [archived, setArchived] = useState(null);
  const s = sessions.find((x) => x.id === route.id) ?? archived;
  useReadOnOpen(route.id);
  const [items, setItems] = useState([]);
  const [more, setMore] = useState(false);
  const [queue, setQueue] = useState([]);
  const draft = useDraft();
  // text sent here by «Añadir al chat» (a selected text)
  useAddToChat((text) => draft.set((prev) => appendToBox(prev, text)));
  const [images, setImages] = useState([]);
  const PAGE = 200;
  // the user's terminal under the chat (this PC only), and a command pasted into it from the chat.
  const [terminal, setTerminal] = useState(false);
  // «Cambios» of this chat turn by turn (a direct chat in a project folder), and the comments waiting for the next message.
  // the chat's side panel (Ficha, Cambios, PR): the tab that is open (null: closed), the tab it opens on next and the turn «Revisar» asked for
  const [panel, setPanel] = useState(null);
  const [permAsk, setPermAsk] = useState(null); // the «Móvil» chip asks the permissions menu to open on the phone's switch
  const [lastTab, setLastTab] = useState('info');
  const [changesTurn, setChangesTurn] = useState(null);
  const [commitOpen, setCommitOpen] = useState(false);
  const openTab = (tab) => { setPanel(tab); setLastTab(tab); };
  // «Revisar» on a turn card opens Changes on that turn
  useEffect(() => onOpenChanges(({ session, turn }) => { if (session === route.id) { setChangesTurn({ turn, at: Date.now() }); openTab('changes'); } }), [route.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // «Información» in a chat's row menu opens this chat on its Ficha (only where the panel exists: a chat with a project, on the PC).
  useEffect(() => onOpenPanel(({ session, tab }) => { if (session === route.id && s?.kind === 'chat' && Boolean(s?.project) && fullPc()) openTab(tab); }), [route.id, s?.kind, s?.project]); // eslint-disable-line react-hooks/exhaustive-deps
  const pendingComments = useComments(route.id);
  const hasPanel = s?.kind === 'chat' && Boolean(s?.project) && fullPc(); // s is missing while a deleted chat's route is still open
  const pr = usePr(s);
  useEffect(() => { setPanel(null); setChangesTurn(null); setCommitOpen(false); }, [route.id]);
  // Ctrl+D opens the panel on Cambios, or closes it when it is already there
  useShortcut('changes.toggle', (e) => { e.preventDefault(); if (panel === 'changes') setPanel(null); else { setChangesTurn(null); openTab('changes'); } }, { enabled: hasPanel });
  const [termDraft, setTermDraft] = useState('');
  useEffect(() => (fullPc() ? onTerminalPaste((line) => { setTerminal(true); setTermDraft(line); }) : undefined), [route.id]);
  useEffect(() => { setTerminal(false); setTermDraft(''); }, [route.id]);
  // what the user pointed at in the agents' browser for this chat: its picture and a line, not sent yet.
  useEffect(() => {
    const take = () => {
      const got = takePoints(route.id); if (!got.length) return;
      setImages((prev) => [...new Set([...prev, ...got.map((p) => p.path)])].slice(0, 10));
      draft.set((prev) => [prev.trim(), ...got.map((p) => p.text)].filter(Boolean).join('\n'));
      notifyOk(t('session.pointAdded'));
    };
    take();
    return onPoints((id) => { if (id === String(route.id)) take(); });
  }, [route.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let alive = true;
    setItems([]); setQueue([]);
    if (!sessions.some((x) => x.id === route.id)) call('sessions.list', { archived: true }).then((all) => alive && setArchived(all.find((x) => x.id === route.id) ?? null)).catch(quiet);
    // Merged with what arrived live meanwhile: on the phone the live events come by another connection and can get here
    // before this answer (a live copy of an item is the newer one).
    call('sessions.items', { id: route.id, limit: PAGE }).then((r) => {
      if (!alive) return;
      setItems((prev) => { const byId = new Map(r.map((x) => [x.id, x])); for (const p of prev) byId.set(p.id, p); return [...byId.values()].sort((a, b) => a.id - b.id); });
      setMore(r.length >= PAGE);
    }).catch(quiet);
    call('sessions.queue', { id: route.id }).then((q) => alive && setQueue(q)).catch(quiet);
    const offItem = bridge.on('session:item', (it) => {
      if (it.session_id !== route.id) return;
      setItems((prev) => { const i = prev.findIndex((p) => p.id === it.id); if (i >= 0) { const next = prev.slice(); next[i] = it; return next; } return [...prev, it]; });
    });
    const offReset = bridge.on('session:reset', (e) => { if (e.id === route.id) call('sessions.items', { id: route.id, limit: PAGE }).then((r) => { setItems(r); setMore(r.length >= PAGE); }).catch(quiet); });
    const offQueue = bridge.on('session:queue', (q) => { if (q.id === route.id) setQueue(q.queue); });
    return () => { alive = false; offItem(); offReset(); offQueue(); };
  }, [route.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const tb = useT(); // H4a B2: «Resultado» in the language on screen
  const blocks = useMemo(() => toBlocks(items, tb), [items, tb]);
  // what the user sent and the engine has not saved yet shows at once (lib/store.js › addPending).
  const pending = usePending(`session:${route.id}`);
  const unsaved = pendingShown(pending, items.filter((it) => it.role === 'user' && it.kind === 'text').map((it) => ({ id: it.id, text: userText(it) })));
  useEffect(() => { for (const p of pending) if (!unsaved.includes(p)) dropPending(p.id); }, [pending, unsaved]);
  // (The streamed text grows the lines' height: the ResizeObserver of useAutoScroll follows it.)
  const scroll = useAutoScroll([blocks.length, items.at(-1)?.id, unsaved.length]);
  const trail = useTrailScroll(scroll);
  const catalog = useCatalog();
  const [compacting, setCompacting] = useState(false);
  // the next message the engine proposes when a turn ends (Ajustes, off by default): grey in the box, Tab takes it
  const [suggestion, setSuggestion] = useState('');
  useEffect(() => { setSuggestion(''); return bridge.on('session:suggest', (e) => { if (e.id === route.id) setSuggestion(e.text); }); }, [route.id]);
  const turnRunning = s?.status === 'running';
  useEffect(() => { if (turnRunning) setSuggestion(''); }, [turnRunning]);
  const dropSuggestion = () => { setSuggestion(''); call('sessions.suggestCancel', { id: route.id }).catch(quiet); };
  if (!s) return <Empty title={t('session.gone')} className="flex-1" />;
  const task = s.task_id ? tasks.find((x) => x.id === s.task_id) : null;
  const running = s.status === 'running';
  // the agent's real models by their names (the catalog), and the conversation's own model even if it is not listed
  // (the selector showed an empty box when it was not among the options).
  const listed = modelsOf(catalog?.find((a) => a.id === s.agent), s.account).filter((m) => m.id);
  const models = [...(listed.length ? listed.map((m) => ({ value: m.id, label: m.label })) : (app?.config?.agents?.[s.agent]?.models ?? []).map((m) => ({ value: m, label: m })))];
  if (s.model && !models.some((m) => m.value === s.model)) models.unshift({ value: s.model, label: modelLabel(catalog, s.agent, s.model) });
  const modelName = (id) => models.find((m) => m.value === id)?.label ?? modelLabel(catalog, s.agent, id);
  const stalled = ['interrupted', 'limited'].includes(s.status) && s.kind === 'chat';
  // with several accounts of the agent (Codex Go, Codex Pro), the one this conversation uses, by its name.
  const who = accountName(app?.config?.accounts, s) ?? AGENT[s.agent];

  const loadOlder = async () => {
    const first = items[0]?.id; if (!first) return;
    const older = await act(call('sessions.items', { id: s.id, before: first, limit: PAGE }));
    if (older) { setItems((prev) => [...older, ...prev]); setMore(older.length >= PAGE); }
  };
  const addImages = (paths) => setImages((prev) => [...new Set([...prev, ...(paths ?? []).filter(Boolean)])].slice(0, 10));
  const capture = async () => {
    try {
      const dataUrl = await captureFrame(); if (!dataUrl) return;
      const saved = await act(call('images.mark', { dataUrl })); if (saved?.path) addImages([saved.path]);
    } catch { notifyError(t('session.captureFailed')); }
  };
  // The files' real paths (a promise); the list is read before the event ends. any file in Orb for Windows (a
  // linked device attaches pictures only: they are uploaded to the PC first).
  const fromTransfer = (dt) => Promise.all([...(dt?.files ?? [])].filter((f) => !bridge.mobile || /^image\//.test(f.type)).map((f) => bridge.pathForFile(f))).then((p) => p.filter(Boolean));
  // While the agent works, Enter corrects it on the fly (it reads the message at its next step) and Ctrl+Enter queues
  // the message for after the turn. Agents that cannot be corrected on the fly always queue.
  const send = async ({ alt = false } = {}) => {
    const msg = draft.message().trim(); if (!msg && !images.length) return;
    const mode = running ? (alt ? 'queue' : 'auto') : 'auto';
    const said = msg || t('session.lookAtFiles'); const sentImages = images;
    // the box empties at once and, when the agent is free (the message starts a turn), the message shows at once;
    // while it works the message may go to the queue instead, which shows it when the engine says so.
    draft.set(''); draft.clearBlocks(); setImages([]);
    const mine = running ? null : addPending(`session:${s.id}`, said, items.at(-1)?.id ?? 0);
    const taken = takeComments(s.id);
    const r = await act(call('sessions.send', { id: s.id, text: said, images: sentImages, mode, comments: taken.length ? taken : undefined }));
    if (r === undefined || r?.queued) { if (mine) dropPending(mine); }
    if (r === undefined) { putBackComments(s.id, taken); draft.set((now) => (now.trim() ? now : msg)); setImages((now) => (now.length ? now : sentImages)); return; }
    if (r?.steered) notifyOk(t('session.steerSent'));
    else if (r?.queued) notifyOk(s.kind === 'task' && !running ? t('session.resentTask') : t('session.queuedToast'));
  };
  // the same «Renombrar» as the list's ⋯ (views/orb/inbox.jsx).
  const rename = () => renameChat({ kind: 'session', id: s.id, title: s.title }, t);
  const fork = async () => { const copy = await act(call('sessions.fork', { id: s.id }), t('session.forked')); if (copy) { await refresh().catch(quiet); go({ view: 'session', id: copy.id }); } };
  // «Continuar con otro agente»: a copy with the agent chosen, which gets a summary of this conversation.
  const others = (app?.agentsAvailable ?? Object.keys(app?.config?.agents ?? {})).filter((a) => a !== s.agent && AGENT[a]);
  const switchAgent = async () => {
    const copy = await form(t('session.switchAgent'), {
      description: t('session.switchAgentDesc'), initial: { agent: others[0] },
      body: (v, set) => <Select className="w-full" value={v.agent} onValueChange={(agent) => set({ agent })} options={others.map((a) => ({ value: a, label: AGENT[a] }))} data-testid="switch-agent-pick" />,
      ok: t('session.switchAgentOk'), onOk: (v) => call('sessions.fork', { id: s.id, agent: v.agent })
    });
    if (copy?.id) { await refresh().catch(quiet); go({ view: 'session', id: copy.id }); }
  };
  // «Pasar este chat a otro agente»: the same chat, the same folder and permission; the summary travels in the next message.
  const handoff = async () => {
    const out = await form(t('session.handoff'), {
      description: t('session.handoffDesc'), initial: { agent: others[0] },
      body: (v, set) => <Select className="w-full" value={v.agent} onValueChange={(agent) => set({ agent })} options={others.map((a) => ({ value: a, label: AGENT[a] }))} data-testid="handoff-pick" />,
      ok: t('session.handoffOk'), onOk: (v) => call('sessions.handoff', { id: s.id, agent: v.agent })
    });
    if (out?.id) await refresh().catch(quiet);
  };
  const editQueued = (q, patch) => act(call('sessions.editQueued', { id: s.id, queueId: q.id, ...patch }));
  // «Compactar» in the composer's slot when the context is at 70 % or more and the agent can compact (Claude, Codex).
  const compactable = s.kind === 'chat' && CAN_COMPACT[s.agent] === true && (compacting || (!running && s.context?.size > 0 && s.context.used / s.context.size >= COMPACT_AT));
  // «Usar mi móvil Android», a switch inside «Más opciones» of the permissions (never on the phone itself; included in «Acceso total al PC»).
  // Granting it asks for the master password; taking it back asks nothing.
  const androidRow = bridge.mobile || (!s.project && s.permission === 'total') ? [] : [{ key: 'android', testid: 'session-android', Icon: Smartphone, label: t('session.android'), tip: s.android ? t('session.androidOn') : t('session.androidOff'), checked: Boolean(s.android), onToggle: async () => {
    if (s.android) { act(call('sessions.revokeGrant', { id: s.id, grant: 'android' })); return; }
    const unlock = await unlockCore('android');
    if (unlock) act(call('sessions.grantAndroid', { id: s.id, unlock }));
  } }];
  const compact = async () => { setCompacting(true); try { await act(call('sessions.compact', { id: s.id })); } finally { setCompacting(false); } };
  const pictures = images.map((p) => <Badge key={p} variant="secondary" className="gap-1.5 font-normal"><AttachIcon file={p} />{baseName(p)}<button className="cursor-pointer" onClick={() => setImages(images.filter((x) => x !== p))} aria-label={t('session.remove')}><X className="size-3" /></button></Badge>);

  return (
    <div className="flex min-h-0 flex-1">
      {/* two full-height columns: the conversation (its header is as wide as it is) and the panel (its own 56 px strip). */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* like the chat's: the clock on the left, the conversation's title (and under it its project and agent) in the
          middle, its controls on the right. */}
      <PageHeader className="topbar-chat"title={<BarClock />} back={<BackToList to={s.kind === 'chat' ? 'chats' : 'tasks'} />}
        center={<BarHeading title={s.title} project={s.project} onRename={s.kind === 'chat' ? rename : null} renameLabel={t('session.renameTip')}
          extra={<span className="bar-title-agent"><AgentIcon agent={s.agent} className="size-3.5" />{who}{s.model ? ` · ${modelName(s.model)}` : ''}</span>} />}>
        <BarPause />
        <NotificationBell />
        {hasPanel ? <BubbleTip title={t('panel.button')} text={t('panel.buttonTip')}><IconButton label={t('panel.button')} active={panel !== null} onClick={() => (panel ? setPanel(null) : openTab(lastTab === 'pr' && !pr ? 'info' : lastTab))} data-testid="turn-changes-toggle"><PanelRight /></IconButton></BubbleTip> : null}
        {s.kind === 'chat' ? null : (<>
          {task ? <TaskStatus task={task} /> : null}
          <Button variant="outline" size="sm" onClick={() => go({ view: 'tasks', id: s.task_id })}><ClipboardCheck />{t('session.viewTask', { id: s.task_id })}</Button>
        </>)}
        {/* only the bell and pause stay on the bar; the folder, the details, fork, archive, delete and the games go into ⋯. */}
        <DropdownMenu modal={false}>
          <BubbleTip title={t('chats.more')}><DropdownMenuTrigger asChild><MoreButton label={t('chats.more')} data-testid="session-more" /></DropdownMenuTrigger></BubbleTip>
          <DropdownMenuContent align="end" className="w-[250px]">
            {s.kind === 'chat' && s.project && fullPc() ? <><CommitMenuItem onOpen={() => setCommitOpen(true)} /><DropdownMenuSeparator /></> : null}
            {bridge.mobile ? null : <DropdownMenuItem onSelect={() => act(bridge.openPath(s.cwd))} data-testid="open-folder"><FolderOpen />{t('session.openFolder')}</DropdownMenuItem>}
            {fullPc() ? <DropdownMenuItem onSelect={() => setTerminal(!terminal)} data-testid="session-terminal"><SquareTerminal />{terminal ? t('session.menu.terminalHide') : t('session.menu.terminalShow')}</DropdownMenuItem> : null}
            <DropdownMenuItem onSelect={() => showDetails(s, task)} data-testid="details"><Info />{t('session.detailsShort')}</DropdownMenuItem>
            <DropdownMenuItem disabled={running} onSelect={fork} data-testid="fork"><GitFork />{t('session.fork')}</DropdownMenuItem>
            {others.length ? <DropdownMenuItem disabled={running} onSelect={switchAgent} data-testid="switch-agent"><Shuffle />{t('session.menu.switchAgent')}</DropdownMenuItem> : null}
            {others.length && s.kind === 'chat' ? <DropdownMenuItem disabled={running} onSelect={handoff} data-testid="handoff"><Shuffle />{t('session.handoff')}</DropdownMenuItem> : null}
            {s.kind === 'chat' ? <DropdownMenuItem onSelect={async () => { const ok = await act(call('sessions.update', { id: s.id, archived: !s.archived })); if (!s.archived) { if (ok) await offerWorktreeRemoval(s, t); go('chat'); } }} data-testid="archive"><Archive />{s.archived ? t('session.restore') : t('session.archive')}</DropdownMenuItem> : null}
            {fullPc() ? <DropdownMenuItem onSelect={openGames} data-testid="bar-games"><Gamepad2 />{t('bar.games')}</DropdownMenuItem> : null}
            {s.kind === 'chat' ? <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={async () => { if (await confirm(t('session.deleteTitle'), t('session.deleteBody') + (await hasWorktree(s) ? ` ${t('session.wt.deleteKept')}` : ''), { ok: t('session.delete'), danger: true })) { await act(call('sessions.remove', { id: s.id })); go('chat'); } }} data-testid="delete"><Trash2 />{t('session.menu.delete')}</DropdownMenuItem>
            </> : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </PageHeader>
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={trail.ref} onScroll={scroll.onScroll} className="chat-fade min-h-0 flex-1 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]">
        {/* as wide as the text box, whose edges the messages line up with (see the same column in chat.jsx) */}
        <div className="lazy-lines mx-auto flex max-w-[calc(var(--chat-max-width)+2.5rem)] flex-col gap-3.5 py-6 pr-[calc(1.25rem-var(--sb-w))] pl-5">
          {more ? <Button variant="ghost" size="sm" className="self-center" onClick={loadOlder}><ChevronUp />{t('session.older')}</Button> : null}
          {blocks.length || unsaved.length ? <TurnFlow blocks={blocks} session={s} running={running} onFork={s.kind === 'chat' ? fork : null} forkDisabled={running} renderBlock={(b) => <Block key={b.key} b={b} agent={s.agent} who={who} brain={s.agent} catalog={catalog} sessionId={s.id} project={s.project} />} />
            : <Empty title={t('session.emptyTitle', { agent: AGENT[s.agent] })}>{t('session.workIn')} <span className="font-mono text-xs">{s.cwd}</span> {t('session.withPerm', { perm: PERMISSION[s.permission] })}</Empty>}
          {unsaved.map((p) => <Block key={p.id} b={{ type: 'item', key: p.id, item: { id: p.id, session_id: s.id, role: 'user', kind: 'text', body: p.text, at: p.at } }} agent={s.agent} who={who} brain={s.agent} catalog={catalog} sessionId={s.id} project={s.project} />)}
          <LivePartial key={s.id} id={s.id} agent={s.agent} running={running} />
          {/* a task's conversation ends with the files it changed (nothing while it runs). */}
          {task && !['running', 'queued'].includes(task.status) ? <TaskChanges taskId={task.id} version={`${task.status}:${task.updated_at}`} /> : null}
          {stalled ? (
            <div className="bg-card flex flex-wrap items-center gap-3 rounded-xl border px-3.5 py-3 text-control">
              <span className="min-w-0 flex-1">{s.status === 'limited' ? t('session.stalledLimit') : t('session.stalledHalf')}</span>
              <Button size="sm" onClick={() => act(call('sessions.resume', { id: s.id }))}><Play />{t('session.continue')}</Button>
            </div>
          ) : null}
        </div>
      </div>
      <ConversationTrail scrollRef={trail.node} />
      </div>
      {s.kind === 'chat' ? <SubagentList blocks={blocks} sessionId={s.id} renderBlock={(b) => <SubagentBlock key={b.key} b={b} defaultOpen />} /> : null}
      {s.kind === 'chat' ? <SideChats id={s.id} /> : null}
      {s.kind === 'chat' ? <ChatModes id={s.id} /> : null}
      {queue.length ? (
        <div className="mx-auto w-full max-w-[calc(var(--chat-max-width)+2.5rem)] shrink-0 px-5 pb-2" data-testid="queue">
          <div className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-xs"><ListOrdered className="size-3.5" />{t('session.queueTitle')}</div>
          <div className="grid gap-1.5">
            {queue.map((q, i) => (
              <div key={q.id} className="bg-card flex items-center gap-2 rounded-lg border px-3 py-1.5 text-control">
                <span className="text-muted-foreground tabular-nums">{i + 1}.</span>
                <span className="min-w-0 flex-1 truncate">{q.text}</span>
                <Tip label={t('session.up')}><Button variant="ghost" size="icon-sm" aria-label={t('session.up')} disabled={i === 0} onClick={() => editQueued(q, { move: 'up' })}><ArrowUpIcon /></Button></Tip>
                <Tip label={t('session.down')}><Button variant="ghost" size="icon-sm" aria-label={t('session.down')} disabled={i === queue.length - 1} onClick={() => editQueued(q, { move: 'down' })}><ArrowDown /></Button></Tip>
                <Tip label={t('session.edit')}><Button variant="ghost" size="icon-sm" aria-label={t('session.edit')} onClick={() => form(t('session.editQueued'), { initial: { text: q.text }, body: (v, set) => <Textarea autoFocus rows={4} value={v.text} onChange={(e) => set({ text: e.target.value })} />, ok: t('session.save'), onOk: (v) => call('sessions.editQueued', { id: s.id, queueId: q.id, text: v.text }) })}><Pencil /></Button></Tip>
                <Tip label={t('session.remove')}><Button variant="ghost" size="icon-sm" aria-label={t('session.remove')} onClick={() => editQueued(q, { remove: true })}><X /></Button></Tip>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {/* a secret the agent asked for, typed only here (never in the chat). */}
      <SecretCards sessionId={s.id} />
      <PrCards sessionId={s.id} />
      {fullPc() ? <HtmlPages sessionId={s.id} /> : null}
      {terminal && fullPc() ? <TerminalPanel dir={s.cwd} draft={termDraft} onDraftTaken={() => setTermDraft('')} onClose={() => setTerminal(false)} /> : null}
      {pendingComments.length ? <div className="text-muted-foreground mx-auto w-full max-w-[calc(var(--chat-max-width)+2.5rem)] shrink-0 px-5 pb-1.5 text-xs" data-testid="pending-comments">{t('turns.pending', { n: pendingComments.length })}</div> : null}
      <Composer draft={draft} onSend={send} suggestion={suggestion} onSuggestionDone={dropSuggestion} attached={images.length > 0} notice={s.kind === 'chat' && CAN_COMPACT[s.agent] === true ? <ColdNotice id={`s${s.id}`} agent={s.agent} used={s.context?.used} lastAt={s.updated_at} busy={running} compacting={compacting} onCompact={compact} onFresh={() => newChat(s.project ?? undefined)} /> : null} onStop={() => act(call('sessions.stop', { id: s.id }))} busy={running} testid="session-input"
        placeholder={running ? (AGENT_CAN_STEER[s.agent] ? t('session.phSteer', { agent: AGENT[s.agent] }) : t('session.phWait', { agent: AGENT[s.agent] })) : s.kind === 'task' ? t('session.phTask') : t('session.phChat')}
        onPaste={(e) => { fromTransfer(e.clipboardData).then((f) => { if (f.length) addImages(f); }); }}
        onDrop={(e) => { fromTransfer(e.dataTransfer).then(addImages); }}
        above={s.kind === 'chat' && ((s.project && fullPc()) || compactable) ? <>
          {/* where this chat works (Local or its worktree and the branch it started from; fixed once started) and «Compactar»: in a project's chat on the PC both are always there («Compactar» disabled, with its reason, until the context is full). */}
          {s.project && fullPc() ? <WorkspacePills project={s.project} chat={s.id} branch={s.branch ?? ''} value={{ mode: 'local', base: '' }} onChange={() => {}} /> : null}
          {s.project && fullPc()
            ? <span className="ml-auto"><CompactButton onCompact={compact} busy={compacting} reason={compactable ? null : CAN_COMPACT[s.agent] !== true ? t('msg.sessions.cannotCompact', { label: AGENT[s.agent] }) : running ? t('msg.orch.compactBusy') : t('compact.noRoom')} /></span>
            : <ContextSlot className="ml-auto" items={[compactable ? { key: 'compact', node: <CompactButton onCompact={compact} busy={compacting} /> } : null]} />}
        </> : null}
        top={images.length ? <div className="flex min-w-0 flex-wrap items-center gap-2">{pictures}</div> : null}
        bottom={<>
          {/* «+»: attach a file and, on the PC, capture a window (the system's picker) as a picture. */}
          <AttachMenu onAttach={async () => addImages(await bridge.pickAttachments())} onCapture={fullPc() && canCapture() ? capture : null} />
          {/* the permissions, the model and the reasoning around the box, like the chat's brain (the bar keeps the title). */}
          {s.kind === 'chat' ? (<>
            {/* «Acceso total» of a project's chat also asks for the master password every time and goes when
                Orb locks; taken back, the chat returns to its permission before, then takes the one chosen. */}
            {/* «Auto» / «Preguntar» at one click, the other levels and «Usar mi móvil Android» under «Más opciones» (the phone may switch between levels, never to «total», and has no switch for its phone). */}
            {s.project ? <AutonomySwitch value={s.permission} testid="session-permission" disabled={bridge.mobile && s.permission === 'total'} more={options(PERMISSION).filter((o) => o.value !== 'auto' && o.value !== 'editar' && (!bridge.mobile || o.value !== 'total'))} extra={androidRow} request={permAsk} onChange={async (permission) => {
              if (permission === 'total') { const unlock = await unlockCore('fullAccess'); if (unlock) act(call('sessions.grantTotal', { id: s.id, unlock }), t('session.permissionsChanged')); return; }
              if (s.permission === 'total') { const back = await act(call('sessions.revokeGrant', { id: s.id, grant: 'total' })); if (!back || back.permission === permission) return; }
              act(call('sessions.update', { id: s.id, permission }), permission === 'auto' ? t('session.autoOn') : permission === 'editar' ? t('session.askOn') : t('session.permissionsChanged'));
            }} />
              /* without a project, «Solo lectura» or «Acceso total al PC» (the master password every time; it goes
                 when Orb locks). Never from the phone. */
              : <AutonomySwitch main={[]} value={s.permission === 'total' ? 'total' : 'leer'} testid="session-permission" disabled={bridge.mobile} more={[{ value: 'leer', label: PERMISSION.leer }, { value: 'total', label: t('session.fullPc') }]} extra={androidRow} request={permAsk} onChange={async (permission) => {
                if (permission !== 'total') { act(call('sessions.revokeGrant', { id: s.id, grant: 'total' }), t('session.permissionsChanged')); return; }
                const unlock = await unlockCore('fullAccess');
                if (unlock) act(call('sessions.grantTotal', { id: s.id, unlock }), t('session.permissionsChanged'));
              }} />}
            {s.permission === 'total' ? <Tip label={t('session.fullPcTip')}><span tabIndex={0} className="inline-flex h-[var(--ctl)] shrink-0 items-center gap-1.5 rounded-[var(--r-ctl)] bg-warning-soft px-2 text-control whitespace-nowrap text-warning-ink" data-testid="session-fullpc"><ShieldAlert className="size-4" />{t('session.fullPcChip')}</span></Tip> : null}
            {/* says that the phone is in use and opens the permissions on its switch, where it is taken back. */}
            {s.android && !(!s.project && s.permission === 'total') ? <button type="button" onClick={() => setPermAsk({ at: Date.now(), focus: 'android' })} title={t('session.androidChipTip')} className="inline-flex h-[var(--ctl)] cursor-pointer items-center gap-1.5 rounded-[var(--r-ctl)] bg-success-soft px-2 text-control text-success outline-none focus-visible:ring-2 focus-visible:ring-ring/50" data-testid="session-android-chip"><Smartphone className="size-4" />{t('session.androidChip')}</button> : null}
          </>) : null}
          <span className="ml-auto" aria-hidden="true" />
          {s.context ? <span className="text-muted-foreground text-xs"><ContextMeter context={s.context} /></span> : null}
          {s.kind === 'chat' ? (<>
            {/* one chip for the agent, its model and its reasoning; its menu lists the models, the levels and «Guía de modelos». */}
            <AgentChip catalog={catalog} agent={s.agent} account={s.account} models={models} model={s.model ?? ''} modelName={models.length ? modelName(s.model || models[0].value) : ''} reasoning={s.reasoning ?? 'medium'}
              onModel={(model) => act(call('sessions.update', { id: s.id, model }), t('session.modelSet', { model: modelName(model) }))} onReasoning={(reasoning) => act(call('sessions.update', { id: s.id, reasoning }))} />
          </>) : null}
        </>} />
      </div>
      {hasPanel ? (
        <ChatPanel open={panel !== null} tab={panel === 'pr' && !pr ? 'info' : panel ?? lastTab} onTab={openTab} onClose={() => setPanel(null)} prNumber={pr?.number ?? null}>
          {(panel ?? lastTab) === 'changes' ? <TurnChanges session={s} turn={changesTurn?.turn} turnAt={changesTurn?.at} />
            : (panel ?? lastTab) === 'pr' && pr ? <PrPanel session={s} pr={pr} />
              : <SessionInfo session={s} task={task} onRename={rename} line={t('panel.info.agentLine', { agent: who, model: s.model ? modelName(s.model) : '—', perm: PERMISSION[s.permission] ?? s.permission })} />}
        </ChatPanel>
      ) : null}
      {hasPanel ? <CommitDialog project={s.project} session={s.id} open={commitOpen} onOpenChange={setCommitOpen} /> : null}
    </div>
  );
}

// A chat in a worktree (src/engine/chat-worktrees.mjs): archiving it offers to remove its folder (offerWorktreeRemoval).
const hasWorktree = async (s) => { try { return (await call('worktrees.status', { id: s.id })).has === true; } catch { return false; } };
