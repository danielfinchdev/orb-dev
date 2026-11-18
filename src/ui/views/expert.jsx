/* eslint no-use-before-define: ["error", { "functions": false, "classes": false, "variables": true }] */
// God mode / expert mode (PC only): an IDE-like view for demanding users. Files on the left; in the middle the assistant's
// chat and the files opened as tabs; on the right git (changes and history) and the other panels chosen in the header.
// Everything here only reads; the work is still done by the agents.
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, FilePlus2, Copy, File, FileCode2, FileJson, FileText, FlaskConical, Lock, Folder, FolderOpen, FolderTree, GitBranch, GitCompare, History, LoaderCircle, RefreshCw, X, LayoutPanelLeft, Cpu, Activity, Gauge, SquareTerminal, MessageSquare, FileDiff, Monitor, ImageIcon, Settings, LogOut, CircleCheck, ChevronUp } from 'lucide-react';
import { ChatView } from './chat.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Input, Spinner } from '@/components/ui/basic.jsx';
import { NotificationBell } from '@/components/notification-center.jsx';
import { PageHeader } from '@/components/page.jsx';
import { OpenInMenu, ActionsMenu } from '@/components/project-tools.jsx';
import { Select, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, Switch, BubbleTip } from '@/components/ui/overlay.jsx';
import { IconButton, MoreButton, SearchInput } from '@/components/ui/primitives.jsx';
import { form } from '@/components/dialogs.jsx';
import { notifyOk, notifyError } from '@/lib/notify.js';
import { ProjectIcon } from '@/components/project-icon.jsx';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { useStore, call, act, go, bridge, setState, getState, openTerminal } from '@/lib/store.js';
import { AGENT } from '@/lib/labels.js';
import { cn, errorText } from '@/lib/utils.js';
import { useHighlight } from '@/lib/use-highlight.js';
import { PatchView } from '@/components/patch-view.jsx';
import { t, useT, useLocale } from '@/lib/i18n.js';
import { stepText } from '@/components/chat-live.jsx';
import { activityLabel, activityDetail } from '@/lib/activity.js';
import { quiet } from '@/lib/quiet.js';
import { GitPanel, BranchMenu } from '@/components/expert-git.jsx';
import { TerminalPanel } from '@/components/terminal-panel.jsx';
import { TaskOutput } from '@/components/task-output.jsx';
import { onTerminalPaste, oneCommand } from '@/lib/terminal-paste.js';

// Labels are read when used (getters), so they follow the language chosen in Ajustes.
export const PANELS = {
  get explorer() { return t('expert.panel.explorer'); }, get git() { return t('expert.panel.git'); }, get history() { return t('expert.panel.history'); }, get running() { return t('expert.panel.running'); },
  get usage() { return t('expert.panel.usage'); }, get system() { return t('expert.panel.system'); }, get activity() { return t('expert.panel.activity'); }
};
const PANEL_ICON = { explorer: FolderTree, git: GitCompare, history: History, running: LoaderCircle, usage: Gauge, system: Cpu, activity: Activity };
const STATE_KEY = { nuevo: 'expert.state.nuevo', añadido: 'expert.state.añadido', borrado: 'expert.state.borrado', renombrado: 'expert.state.renombrado', cambiado: 'expert.state.cambiado' };
// the letter of a changed file beside its name, as in the tree and in git's list.
const STATE_LETTER = { nuevo: 'A', añadido: 'A', borrado: 'D', renombrado: 'R', cambiado: 'M' };
const STATE_TONE = { nuevo: 'text-success', añadido: 'text-success', borrado: 'text-destructive', renombrado: 'text-info', cambiado: 'text-warning-ink' };
const RIGHT_PANELS = ['git', 'history', 'running', 'usage', 'system', 'activity'];

const size = (n) => (n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(1)} GB`);
const ago = (iso) => { const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000); return s < 60 ? t('expert.ago.now') : s < 3600 ? t('expert.ago.min', { n: Math.round(s / 60) }) : s < 86400 ? t('expert.ago.hour', { n: Math.round(s / 3600) }) : t('expert.ago.day', { n: Math.round(s / 86400) }); };
// The language shown in the viewer's status bar, from the file's extension (the viewer is read-only and does not detect more).
const LANGUAGE = { ts: 'TypeScript', tsx: 'TypeScript React', js: 'JavaScript', jsx: 'JavaScript React', mjs: 'JavaScript', cjs: 'JavaScript', json: 'JSON', md: 'Markdown', css: 'CSS', html: 'HTML', htm: 'HTML', rs: 'Rust', py: 'Python', go: 'Go', java: 'Java', kt: 'Kotlin', c: 'C', h: 'C', cpp: 'C++', cs: 'C#', rb: 'Ruby', php: 'PHP', sh: 'Shell', ps1: 'PowerShell', yml: 'YAML', yaml: 'YAML', toml: 'TOML', xml: 'XML', sql: 'SQL', swift: 'Swift', vue: 'Vue', svelte: 'Svelte', txt: 'Plain text' };
const languageOf = (path) => LANGUAGE[/\.([a-z0-9]+)$/i.exec(path ?? '')?.[1]?.toLowerCase()] ?? null;
const sumCounts = (by) => { const all = Object.values(by); return all.length ? { add: all.reduce((n, f) => n + f.add, 0), del: all.reduce((n, f) => n + f.del, 0) } : null; };
// The right end of the path bar: what is known for sure about the open file (its language, the lines it changed).
function StatusBar({ language, counts, info }) {
  const t = useT();
  const encoding = info?.encoding ? t(info.encoding === 'unknown' ? 'expert.encoding.unknown' : info.bom ? 'expert.encoding.utf8bom' : 'expert.encoding.utf8') : null;
  const parts = [language, encoding, info?.lines != null ? t('expert.nLines', { n: info.lines }) : null].filter(Boolean);
  if (!parts.length && !counts) return null;
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap" data-testid="expert-status">
      {parts.map((p, i) => <span key={p} data-testid={p === encoding ? 'expert-encoding' : undefined}>{i ? <span aria-hidden="true" className="mr-1.5">·</span> : null}{p}</span>)}
      {parts.length && counts ? <span aria-hidden="true">·</span> : null}
      {counts ? <span title={t('expert.lines', counts)}><span className="text-success">+{counts.add}</span> <span className="text-destructive">−{counts.del}</span></span> : null}
    </span>
  );
}
const splitPath = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? ['', p] : [p.slice(0, i), p.slice(i + 1)]; };
const fileIcon = (name) => (/\.(test|spec)\./.test(name) ? FlaskConical : /\.jsonc?$/i.test(name) ? FileJson : /\.(md|mdx|txt)$/i.test(name) ? FileText : /\.(jsx?|tsx?|mjs|cjs|rs|py|css|html?|go|java|cs|cpp|c|h|sh|ps1|toml|ya?ml)$/i.test(name) ? FileCode2 : File);

// Files and git are read again when something changes, but at most once every 5 seconds (git on a big project is slow).
function useCalmVersion(ms = 5000) {
  const version = useStore((s) => s.version);
  const [calm, setCalm] = useState(version);
  const last = useRef(0);
  useEffect(() => {
    const t = setTimeout(() => { last.current = Date.now(); setCalm(version); }, Math.max(0, ms - (Date.now() - last.current)));
    return () => clearTimeout(t);
  }, [version, ms]);
  return calm;
}

// «Historial» is opened from the git panel's «Ver todo» unless the user switched it on; every other panel is on unless switched off.
export const panelOn = (panels, id) => (id === 'history' ? panels.history === true : panels[id] !== false);
export async function savePanels(panels) {
  const config = await act(call('config.save', { patch: { expert: { panels } } }));
  if (config) setState({ app: { ...getState().app, config } });
}

// One block of the right column (git's .gsec): a small uppercase label with its count and action, then the rows.
function Sec({ label, count, action, testid, children }) {
  return (
    <section className="border-border flex flex-col gap-1.5 border-b px-3 py-2.5" data-testid={testid}>
      <div className="text-faint-foreground flex items-center gap-1.5 text-micro tracking-wide uppercase"><span className="min-w-0 flex-1 truncate">{label}</span>{count != null ? <span className="text-caption normal-case">{count}</span> : null}{action}</div>
      {children}
    </section>
  );
}
const Row = ({ className, children, ...props }) => <div className={cn('flex min-h-7 items-center gap-2 text-control', className)} {...props}>{children}</div>;
const Note = ({ children }) => <p className="text-muted-foreground py-1 text-caption">{children}</p>;
const Notice = ({ icon: Icon, title, children }) => (
  <div className="text-muted-foreground flex flex-col items-center gap-1.5 px-3 py-6 text-center">
    <Icon className="text-faint-foreground size-6" />
    <b className="text-foreground font-(family-name:--title) text-card-title font-semibold">{title}</b>
    {children ? <span className="text-control">{children}</span> : null}
  </div>
);

// ---- explorer
// `changes`: the git state of each file (the letter beside its name).
function Tree({ project, onOpen, onPick, version, current, changes, filter = '' }) {
  const t = useT();
  const [dirs, setDirs] = useState({});
  const [open, setOpen] = useState(() => new Set(['']));
  const load = useCallback(async (dir) => { try { const r = await call('expert.tree', { project, dir }); setDirs((d) => ({ ...d, [dir]: r })); } catch (e) { setDirs((d) => ({ ...d, [dir]: { error: errorText(e), entries: [] } })); } }, [project]);
  useEffect(() => { setDirs({}); setOpen(new Set([''])); }, [project]);
  useEffect(() => { for (const dir of open) load(dir); }, [project, version]); // eslint-disable-line react-hooks/exhaustive-deps
  // The search only looks at what the tree has already read (folders opened so far), by name without accents or case.
  const needle = filter.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const named = (e) => e.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(needle);
  const hits = (e) => named(e) || (e.kind === 'dir' && (dirs[e.path]?.entries ?? []).some(hits));
  const isOpen = (path) => open.has(path) || Boolean(needle && (dirs[path]?.entries ?? []).some(hits));
  const toggle = (dir) => { const next = new Set(open); if (next.has(dir)) next.delete(dir); else { next.add(dir); if (!dirs[dir]) load(dir); } setOpen(next); };
  const render = (dir, depth) => {
    const d = dirs[dir];
    const pad = { paddingLeft: `calc(6px + ${depth} * 14px)` };
    if (!d) return <div className="text-muted-foreground py-1 text-caption" style={pad}><Spinner className="size-3" /></div>;
    if (d.error) return <div className="text-destructive py-1 text-caption" style={pad}>{d.error}</div>;
    return d.entries.filter((e) => !needle || hits(e)).map((e) => {
      const dir = e.kind === 'dir'; const FileIcon = fileIcon(e.name); const state = !dir ? changes[e.path] : null;
      return (
        <div key={e.path}>
          <button type="button" onClick={() => { onPick?.(dir ? e.path : e.path.split('/').slice(0, -1).join('/')); if (dir) toggle(e.path); else if (!e.secret) onOpen(e.path); }} title={e.secret ? t('expert.secretFile') : `${e.path}${e.size != null ? ` · ${size(e.size)}` : ''}`} aria-selected={!dir && current === e.path ? true : undefined}
            className={cn('hover:bg-accent/60 flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-ctl pr-1.5 text-left text-control', !dir && current === e.path && 'bg-accent', e.secret && 'text-muted-foreground cursor-not-allowed', dir && e.name === 'node_modules' && 'text-faint-foreground')} style={pad}>
            {dir ? <><ChevronRight className={cn('text-muted-foreground size-3.5 shrink-0 transition-transform', isOpen(e.path) && 'rotate-90')} />{isOpen(e.path) ? <FolderOpen className="text-muted-foreground size-4 shrink-0" /> : <Folder className="text-muted-foreground size-4 shrink-0" />}</>
              : <><span className="w-3.5 shrink-0" />{e.secret ? <Lock className="text-muted-foreground size-4 shrink-0" /> : <FileIcon className="text-muted-foreground size-4 shrink-0" />}</>}
            <span className="min-w-0 flex-1 truncate">{e.name}</span>
            {e.secret ? <span className="text-faint-foreground text-micro">{t('expert.secret')}</span> : null}
            {state ? <span className={cn('w-4 text-center text-micro font-semibold', STATE_TONE[state])} title={STATE_KEY[state] ? t(STATE_KEY[state]) : state}>{STATE_LETTER[state] ?? '·'}</span> : null}
          </button>
          {dir && isOpen(e.path) ? render(e.path, depth + 1) : null}
        </div>
      );
    });
  };
  return <div className="px-1.5 pb-2" data-testid="expert-tree" role="tree" aria-label={project}>{render('', 0)}{dirs['']?.cut ? <div className="text-muted-foreground px-2 py-1 text-caption">{t('expert.andMore')}</div> : null}</div>;
}

// ---- viewers
// Coloured by the file's language and the code theme of Ajustes → Apariencia (lib/highlight.js, code.css).
const plain = (text) => text.split('\n').map((l) => (l ? [l] : []));
function CodeView({ text, path }) {
  const hl = useHighlight();
  const lines = useMemo(() => (hl ? hl.highlightLines(text, hl.languageFor(path), createElement) : plain(text)), [hl, text, path]);
  return (
    <div className="code-surface min-h-full w-max min-w-full py-1.5 text-caption leading-[1.7]">
      {lines.map((l, i) => <div key={i} className="code-line flex"><span className="code-gutter w-11 shrink-0 pr-2 text-right select-none">{i + 1}</span><span className="pr-4 pl-2 whitespace-pre">{l.length ? l : ' '}</span></div>)}
    </div>
  );
}
// A git diff as one block per hunk, each with the file it belongs to (the cards of components/patch-view.jsx). A file
// the engine shows whole (not tracked yet) has no «@@» line: its lines make one block with a header of its own. A file
// with no lines at all (a rename, a mode change) gets a block with the note git wrote about it.
function diffBlocks(text) {
  const blocks = []; const head = []; let path = ''; let cur = null; let hunks = 0;
  const closeFile = () => { if (path && !hunks) blocks.push({ path, note: head.filter((l) => /^(Binary|rename|copy|deleted|old mode|new mode)/.test(l)).join(' · ') }); head.length = 0; hunks = 0; };
  const all = String(text ?? '').split('\n');
  for (let i = 0; i < all.length; i++) {
    const l = all[i];
    if (l.startsWith('diff --git ')) { closeFile(); path = /^diff --git a\/.+ b\/(.+)$/.exec(l)?.[1] ?? ''; cur = null; continue; }
    if (l.startsWith('@@')) { cur = { path, patch: [l] }; blocks.push(cur); hunks++; continue; }
    if (cur) { cur.patch.push(l); continue; }
    if (/^\+\+\+ b\//.test(l)) { path = l.slice(6); if (all[i + 1] != null && !all[i + 1].startsWith('@@')) { cur = { path, patch: [], whole: true }; blocks.push(cur); hunks++; } continue; }
    head.push(l);
  }
  closeFile();
  return blocks.map((b) => {
    if (!b.whole) return { ...b, patch: b.patch?.join('\n') };
    const lines = b.patch.at(-1) === '' ? b.patch.slice(0, -1) : b.patch;
    return { ...b, patch: [`@@ -0,0 +1,${lines.length} @@`, ...lines].join('\n') };
  });
}
function DiffView({ text }) {
  const t = useT();
  const blocks = useMemo(() => diffBlocks(text), [text]);
  if (!text || !blocks.length) return <Notice icon={FileDiff} title={t('expert.noChanges')}>{t('expert.noChangesBody')}</Notice>;
  return (
    <div className="flex min-h-full flex-col gap-3.5 p-3.5" data-testid="expert-diff">
      {blocks.map((b, i) => (b.patch
        ? <PatchView key={i} text={b.patch} path={b.path} name={b.path} bodyClass="max-h-none" />
        : <div key={i} className="border-border bg-secondary text-muted-foreground rounded-card border px-2.5 py-1.5 font-mono text-caption">{b.path}{b.note ? ` · ${b.note}` : ''}</div>))}
    </div>
  );
}
// a picture of the project is shown as a picture (it said «binary file, cannot be shown as text»).
const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
function ImagePreview({ file, name }) {
  const t = useT();
  const [src, setSrc] = useState(null);
  useEffect(() => { let alive = true; setSrc(null); call('images.read', { path: file }).then((r) => alive && setSrc(r.dataUrl)).catch(() => alive && setSrc(false)); return () => { alive = false; }; }, [file]);
  if (src === false) return <Notice icon={ImageIcon} title={t('expert.cannotShow')}>{t('img.unavailable')}</Notice>;
  if (!src) return <div className="p-4"><Spinner /></div>;
  return <div className="grid min-h-full place-items-center p-4" data-testid="expert-image"><img src={src} alt={name} className="img-checker rounded-ctl max-h-[calc(100vh-10rem)] max-w-full border object-contain" /></div>;
}
function Viewer({ project, root, tab, version, onInfo }) {
  if (tab.kind !== 'diff' && root && IMAGE.test(tab.path)) return <ImagePreview file={`${root.replace(/[\\/]+$/, '')}/${tab.path}`} name={tab.path.split('/').pop()} />;
  return <TextViewer project={project} tab={tab} version={version} onInfo={onInfo} />;
}
function TextViewer({ project, tab, version, onInfo }) {
  const t = useT();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true; setError('');
    const req = tab.kind === 'diff' ? call('expert.diff', { project, path: tab.path || undefined }) : call('expert.read', { project, path: tab.path });
    req.then((r) => { if (!alive) return; setData(r); if (tab.kind !== 'diff') onInfo?.({ path: tab.path, encoding: r.encoding ?? null, bom: Boolean(r.bom), lines: r.lines ?? null }); }).catch((e) => alive && setError(errorText(e)));
    return () => { alive = false; };
  }, [project, tab.kind, tab.path, version]);
  if (error) return <Notice icon={File} title={t('expert.cannotShow')}>{error}</Notice>;
  if (!data) return <div className="p-4"><Spinner /></div>;
  if (tab.kind === 'diff') return <><DiffView text={data.diff} />{data.cut ? <p className="text-muted-foreground p-3 text-caption">{t('expert.cut')}</p> : null}</>;
  if (data.binary) return <Notice icon={File} title={t('expert.binary')}>{t('expert.binaryBody', { size: size(data.size) })}</Notice>;
  return <><CodeView text={data.text} path={tab.path} />{data.cut ? <p className="text-muted-foreground p-3 text-caption">{t('expert.firstKb', { size: size(data.size) })}</p> : null}</>;
}

// ---- right column
// git's status of the project, read once for the header, the tree's letters and the changes list.
function useGitStatus(project, version) {
  const [st, setSt] = useState(null);
  useEffect(() => { if (bridge.mobile || !project) return undefined; let alive = true; call('expert.status', { project }).then((r) => alive && setSt(r)).catch(() => alive && setSt({ repo: false, files: [] })); return () => { alive = false; }; }, [project, version]);
  return st;
}
function HistoryPanel({ project, version, onClose }) {
  const t = useT();
  const locale = useLocale();
  const [rows, setRows] = useState(null);
  useEffect(() => { let alive = true; call('expert.log', { project, limit: 60 }).then((r) => alive && setRows(r)).catch(() => alive && setRows([])); return () => { alive = false; }; }, [project, version]);
  return (
    <Sec label={t('expert.history')} testid="panel-history" action={onClose ? <IconButton small label={t('expert.close')} onClick={onClose} data-testid="expert-history-close"><X /></IconButton> : null}>
      {!rows ? <div className="p-1"><Spinner className="size-3" /></div> : !rows.length ? <Note>{t('expert.noCommits')}</Note> : rows.map((c) => (
        <Row key={c.hash} title={`${c.hash} · ${c.author} · ${new Date(c.date).toLocaleString(locale)}${c.refs ? ` · ${c.refs}` : ''}`}>
          <span className="text-faint-foreground font-mono text-caption">{c.hash.slice(0, 7)}</span><span className="min-w-0 flex-1 truncate">{c.subject}</span><span className="text-faint-foreground text-micro whitespace-nowrap">{ago(c.date)}</span>
        </Row>
      ))}
    </Sec>
  );
}
function RunningPanel() {
  const t = useT();
  const tasks = useStore((s) => s.tasks).filter((t) => t.status === 'running');
  const sessions = useStore((s) => s.sessions).filter((s) => s.status === 'running' && s.kind === 'chat');
  // a conversation answering now (whether it writes and its last step, not each streamed piece).
  const chat = useStore((s) => { const c = s.chats.find((x) => x.busy); const last = Array.isArray(c?.tools) ? c.tools.at(-1) : null; return c ? { busy: true, partial: Boolean(c.partial), step: last && typeof last === 'object' ? stepText(t, last) : '' } : null; });
  const name = useStore((s) => s.app.config.assistantName);
  return (
    <Sec label={t('expert.panel.running')} testid="panel-running">
      {!tasks.length && !sessions.length && !chat?.busy ? <Note>{t('expert.nothingRunning')}</Note> : null}
      {chat?.busy ? <Row><span className="bg-primary-text size-1.5 animate-pulse rounded-full" />{t(chat.partial ? 'expert.writing' : 'expert.thinking', { name })}{chat.step ? <span className="text-muted-foreground truncate">· {chat.step}</span> : null}</Row> : null}
      {tasks.map((t) => <button key={t.id} type="button" onClick={() => go({ view: 'tasks', id: t.id })} className="hover:bg-accent/60 flex min-h-7 w-full cursor-pointer items-center gap-2 rounded-ctl px-1 text-left text-control"><AgentIcon agent={t.assigned_to ?? t.agent} className="size-3.5" /><span className="min-w-0 flex-1 truncate">#{t.id} {t.title}</span><span className="text-faint-foreground text-micro">{t.project}</span></button>)}
      {sessions.map((s) => <button key={s.id} type="button" onClick={() => go({ view: 'session', id: s.id })} className="hover:bg-accent/60 flex min-h-7 w-full cursor-pointer items-center gap-2 rounded-ctl px-1 text-left text-control"><AgentIcon agent={s.agent} className="size-3.5" /><span className="min-w-0 flex-1 truncate">{s.title}</span><span className="text-faint-foreground text-micro">{AGENT[s.agent]}</span></button>)}
    </Sec>
  );
}
function Bar({ label, value, max, detail }) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1 text-caption">
      <div className="text-muted-foreground flex items-center justify-between gap-2"><span className="min-w-0 truncate">{label}</span><span className="shrink-0">{detail ?? `${pct}%`}</span></div>
      <div className="bg-muted h-1.5 overflow-hidden rounded-full"><div className={cn('h-full rounded-full transition-all', pct > 85 ? 'bg-destructive' : pct > 65 ? 'bg-warning' : 'bg-primary-text')} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
function UsagePanel({ version }) {
  const t = useT();
  const [rows, setRows] = useState([]);
  useEffect(() => { call('usage.get').then(setRows).catch(quiet); }, [version]);
  return <Sec label={t('expert.panel.usage')} testid="panel-usage">{rows.map((r) => <Bar key={r.account} label={r.label} value={r.used} max={r.max} detail={r.cooldownUntil && r.cooldownUntil > Date.now() ? t('expert.paused') : t('expert.usageOf', { used: r.used, max: r.max, h: r.windowHours })} />)}</Sec>;
}
function SystemPanel() {
  const t = useT();
  const [s, setS] = useState(null);
  useEffect(() => { let alive = true; const tick = () => call('expert.system').then((r) => alive && setS(r)).catch(quiet); tick(); const t = setInterval(tick, 3000); return () => { alive = false; clearInterval(t); }; }, []);
  return (
    <Sec label={t('expert.system')} testid="panel-system">
      {!s ? <div className="p-1"><Spinner className="size-3" /></div> : (
        <div className="flex flex-col gap-2" data-testid="expert-system">
          <Bar label={t('expert.cpu', { n: s.cores })} value={s.cpu ?? 0} max={100} detail={s.cpu == null ? t('expert.measuring') : `${s.cpu}%`} />
          <Bar label={t('expert.memory')} value={s.memory.total - s.memory.free} max={s.memory.total} detail={t('expert.memoryOf', { used: size(s.memory.total - s.memory.free), total: size(s.memory.total) })} />
          {s.disk ? <Bar label={t('expert.disk')} value={s.disk.total - s.disk.free} max={s.disk.total} detail={t('expert.diskFree', { size: size(s.disk.free) })} /> : null}
          <div className="text-muted-foreground flex flex-wrap gap-x-3 text-caption"><span>{t('expert.engine', { size: size(s.engine) })}</span><span>{t('expert.agentsWorking', { n: s.running })}</span><span className="truncate">{s.platform}</span></div>
        </div>
      )}
    </Sec>
  );
}
function ActivityPanel({ version }) {
  const t = useT();
  const locale = useLocale();
  const [rows, setRows] = useState([]);
  useEffect(() => { call('activity.list', { limit: 40 }).then(setRows).catch(quiet); }, [version]);
  return (
    <Sec label={t('expert.activity')} testid="panel-activity">
      {rows.map((r) => <Row key={r.id} className="items-start text-caption" title={`${r.kind} ${r.detail ?? ''}`}><span className="text-faint-foreground shrink-0 tabular-nums">{new Date(r.at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</span><span className="text-primary-text shrink-0">{AGENT[r.actor] ?? r.actor}</span><span className="min-w-0 truncate">{activityLabel(t, r.kind)}{r.task_id ? ` #${r.task_id}` : ''} <span className="text-muted-foreground">{activityDetail(t, r, locale, AGENT)}</span></span></Row>)}
    </Sec>
  );
}

// «Paneles visibles»: one switch per panel (the choice is saved in the settings).
function PanelsMenu() {
  const t = useT();
  const panels = useStore((s) => s.app.config.expert?.panels) ?? {};
  return (
    <DropdownMenu modal={false}>
      <BubbleTip title={t('expert.panelsWhich')} text={t('expert.panelsHint')}><DropdownMenuTrigger asChild><IconButton label={t('expert.panelsWhich')} data-testid="expert-panels"><LayoutPanelLeft /></IconButton></DropdownMenuTrigger></BubbleTip>
      <DropdownMenuContent align="end" className="w-75">
        <DropdownMenuLabel>{t('expert.panelsWhich')}</DropdownMenuLabel>
        {Object.entries(PANELS).map(([id, label]) => {
          const Icon = PANEL_ICON[id];
          return (
            <DropdownMenuItem key={id} onSelect={(e) => { e.preventDefault(); savePanels({ ...panels, [id]: !panelOn(panels, id) }); }}>
              <Icon /><span className="min-w-0 flex-1 truncate">{label}</span><Switch size="sm" checked={panelOn(panels, id)} aria-label={label} className="pointer-events-none" tabIndex={-1} />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ExpertView() {
  const t = useT();
  const app = useStore((s) => s.app);
  const projects = useStore((s) => s.projects);
  const tasks = useStore((s) => s.tasks);
  const [manual, setManual] = useState(0); // the refresh button reads everything again right away
  const version = `${useCalmVersion()}-${manual}`;
  const panels = app.config.expert?.panels ?? {};
  const on = (id) => panelOn(panels, id);
  const [historyAll, setHistoryAll] = useState(false); // «Ver todo» of the git panel
  const [project, setProject] = useState(app.activeProject?.name ?? projects[0]?.name ?? '');
  // the chat of God mode is a conversation of that project (the latest still open, or a new one in it).
  const conversations = useStore((s) => s.conversations) ?? [];
  const latest = (name) => conversations.find((c) => c.project === name && c.status === 'open')?.id ?? null;
  const [conversation, setConversation] = useState(() => latest(app.activeProject?.name ?? projects[0]?.name ?? ''));
  useEffect(() => { setConversation(latest(project)); setState({ expertProject: project }); }, [project]); // eslint-disable-line react-hooks/exhaustive-deps
  const info = projects.find((p) => p.name === project) ?? null;
  const [tabs, setTabs] = useState([]);
  const [fileQuery, setFileQuery] = useState('');
  const [current, setCurrent] = useState('chat');
  const st = useGitStatus(project, version);
  const changes = useMemo(() => Object.fromEntries((st?.files ?? []).map((f) => [f.path, f.state])), [st]);
  const lineCounts = useMemo(() => Object.fromEntries((st?.files ?? []).filter((f) => f.add != null).map((f) => [f.path, f])), [st]);
  useEffect(() => { if (!project && projects[0]) setProject(app.activeProject?.name ?? projects[0].name); }, [projects]); // eslint-disable-line react-hooks/exhaustive-deps
  const [term, setTerm] = useState(false);
  const [termDraft, setTermDraft] = useState('');
  const [launch, setLaunch] = useState(null);
  useEffect(() => { setTabs([]); setCurrent('chat'); setFileQuery(''); setTerm(false); setLaunch(null); setTermDraft(''); setHistoryAll(false); }, [project]);
  // The terminal dock (this PC's window only). It opens when the user asks (its button, an action or a command pasted from
  // the chat); closing it, leaving the view or changing project closes the shells it opened.
  useEffect(() => (bridge.mobile || !info?.path ? undefined : onTerminalPaste((line, from) => { if (from && !from.closest?.('[data-testid="expert-view"]')) return; setTerm(true); setTermDraft(line); })), [info?.path]);
  const runInTerminal = (a) => { setLaunch({ n: Date.now(), name: a.name, command: oneCommand(a.command), preview: Boolean(a.openPreview && a.preview) }); setTerm(true); };
  const openTab = (kind, path) => {
    const id = `${kind}:${path}`;
    if (!tabs.some((t) => t.id === id)) setTabs([...tabs, { id, kind, path, label: kind === 'diff' ? (path ? `Δ ${path.split('/').pop()}` : null) : path.split('/').pop() }].slice(-12));
    setCurrent(id);
  };
  const closeTab = (id) => { const rest = tabs.filter((t) => t.id !== id); setTabs(rest); if (current === id) setCurrent(rest.at(-1)?.id ?? 'chat'); };
  // The folder «Nuevo archivo» creates in: the last folder or file clicked in the tree (the project's root at first).
  const [pickedDir, setPickedDir] = useState('');
  const [fileInfo, setFileInfo] = useState(null);
  useEffect(() => { setPickedDir(''); setFileInfo(null); }, [project]);
  const newFile = async () => {
    const folder = pickedDir || t('expert.newFileRoot');
    const r = await form(t('expert.newFileTitle'), {
      description: t('expert.newFileDesc', { folder: pickedDir ? `${pickedDir}/` : folder }), initial: { name: '' },
      body: (v, setV) => <Input autoFocus autoComplete="off" spellCheck={false} aria-label={t('expert.fileName')} placeholder={t('expert.fileName')} value={v.name} onChange={(e) => setV({ name: e.target.value })} data-testid="expert-new-file-name" />,
      ok: t('expert.create'), okDisabled: (v) => !v.name.trim(),
      onOk: (v) => call('expert.createFile', { project, dir: pickedDir || undefined, name: v.name.trim() })
    });
    if (r) { notifyOk(t('expert.fileCreated', { name: r.name })); setManual((n) => n + 1); openTab('file', r.path); }
  };
  const copyPath = (p) => navigator.clipboard?.writeText(p).then(() => notifyOk(t('expert.pathCopied'))).catch(() => notifyError(t('app.copyFailed')));
  if (bridge.mobile) return <div className="m-auto"><Notice icon={Monitor} title={t('expert.pcOnly')}>{t('expert.pcOnlyBody')}</Notice></div>;
  const tab = tabs.find((x) => x.id === current);
  const showRight = RIGHT_PANELS.some(on) || historyAll;
  const running = tasks.find((x) => x.status === 'running' && x.project === project);
  // every task running in this project; the pill names the newest one (ids only grow).
  const runningHere = tasks.filter((x) => x.status === 'running' && x.project === project);
  const newest = runningHere.reduce((a, b) => (b.id > (a?.id ?? -1) ? b : a), null);
  const count = st?.repo ? (st.files.length ? t(st.files.length > 1 ? 'expert.changesOther' : 'expert.changesOne', { n: st.files.length }) : t('expert.clean')) : null;
  const meta = [project, st?.repo ? st.branch : null, count].filter(Boolean).join(' · ');
  const [dir, fileName] = tab ? splitPath(tab.path) : ['', ''];
  return (
    <>
      <PageHeader title={t('nav.expert')} meta={meta}>
        <BubbleTip title={t('expert.reload')}><IconButton label={t('expert.reload')} onClick={() => setManual((n) => n + 1)} data-testid="expert-reload"><RefreshCw /></IconButton></BubbleTip>
        <PanelsMenu />
        <NotificationBell />
        <DropdownMenu modal={false}>
          <BubbleTip title={t('nav.more')}><DropdownMenuTrigger asChild><MoreButton label={t('nav.more')} data-testid="expert-more" /></DropdownMenuTrigger></BubbleTip>
          <DropdownMenuContent align="end" className="w-60">
            {bridge.openTerminal ? <DropdownMenuItem onSelect={() => openTerminal(info?.path ?? undefined)} data-testid="expert-terminal"><SquareTerminal />{t('expert.openTerminal')}<span className="text-faint-foreground ml-auto text-caption">Ctrl+J</span></DropdownMenuItem> : null}
            <DropdownMenuItem onSelect={() => go('settings')} data-testid="expert-settings"><Settings />{t('nav.settings')}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => go('chat')} data-testid="expert-exit"><LogOut />{t('expert.exit')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </PageHeader>
      <div className="m-auto max-w-sm p-6 lg:hidden"><Notice icon={Monitor} title={t('expert.tooNarrow')}>{t('expert.tooNarrowBody')}</Notice></div>
      <div className="hidden min-h-0 flex-1 flex-col lg:flex" data-testid="expert-view">
        {/* the project's bar is a container: the narrower it is, the more it leaves out (its path, the running task, the
            words of its buttons), so nothing ever overflows. */}
        <div className="border-border @container/bar flex h-12 shrink-0 items-center gap-2 overflow-hidden border-b px-3.5" data-testid="expert-bar">
          {/* the project reads as plain text; the arrow shows on hover and the list still changes it */}
          <Select size="sm" value={project} onValueChange={setProject} title={t('expert.project')} className="-ml-1.5 w-auto max-w-52 min-w-0 shrink border-transparent bg-transparent px-1.5 font-medium hover:bg-accent data-[state=open]:bg-accent [&>svg]:opacity-0 hover:[&>svg]:opacity-100 focus-visible:[&>svg]:opacity-100 data-[state=open]:[&>svg]:opacity-100" placeholder={t('expert.pickProject')} options={projects.map((p) => ({ value: p.name, label: p.name, icon: <ProjectIcon name={p.name} small /> }))} />
          <span className="text-faint-foreground hidden min-w-0 flex-1 truncate font-mono text-caption @4xl/bar:inline" title={info?.path}>{info?.path}</span>
          <Badge className="shrink-0">{t('nav.expert')}</Badge>
          {st?.repo ? <BranchMenu project={project} st={st} version={version} reload={() => setManual((n) => n + 1)} /> : null}
          {runningHere.length ? (
            <button type="button" onClick={() => go({ view: 'tasks', id: newest.id })} className="bg-primary-soft text-primary-text hidden h-(--ctl-sm) min-w-0 shrink cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-caption font-medium @4xl/bar:inline-flex" data-testid="expert-agent-pill">
              <AgentIcon agent={newest.assigned_to ?? newest.agent} className="size-3.5 shrink-0" />
              <span className="truncate">{t(runningHere.length > 1 ? 'expert.workingOnMore' : 'expert.workingOn', { agent: AGENT[newest.assigned_to ?? newest.agent] ?? '', id: newest.id, n: runningHere.length - 1 })}</span>
            </button>
          ) : null}
          <div className="min-w-0 flex-1" />
          {/* the project in an editor, and its actions (commands of the user's own, with their shortcut). */}
          <ActionsMenu project={info} labelClassName="hidden @4xl/bar:inline" onRun={info?.path ? runInTerminal : undefined} />
          <OpenInMenu project={info} labelClassName="hidden @5xl/bar:inline" />
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => go('chat')} aria-label={t('expert.exit')} title={t('expert.exit')}><LogOut className="@4xl/bar:hidden" /><span className="hidden @4xl/bar:inline">{t('expert.exit')}</span></Button>
        </div>
        <div className="flex min-h-0 flex-1">
          {on('explorer') && project ? (
            <nav className="border-border flex w-60 shrink-0 flex-col border-r" aria-label={t('expert.files')} data-testid="panel-explorer">
              <div className="text-faint-foreground flex items-center gap-1 py-2 pr-2 pl-3 text-micro tracking-wide uppercase"><span className="flex-1 truncate">{t('expert.files')}</span>
                <BubbleTip title={t('expert.newFile')}><IconButton small label={t('expert.newFile')} onClick={newFile} data-testid="expert-new-file"><FilePlus2 /></IconButton></BubbleTip>
                <BubbleTip title={t('expert.reload')}><IconButton small label={t('expert.reload')} onClick={() => setManual((n) => n + 1)}><RefreshCw /></IconButton></BubbleTip>
              </div>
              <SearchInput value={fileQuery} onChange={setFileQuery} placeholder={t('expert.searchFiles')} title={t('expert.searchFilesHint')} className="mx-2 mb-1.5 w-auto" data-testid="expert-file-search" />
              <div className="min-h-0 flex-1 overflow-auto"><Tree project={project} version={version} filter={fileQuery} onPick={setPickedDir} current={tab?.kind === 'file' ? tab.path : null} changes={changes} onOpen={(p) => openTab('file', p)} /></div>
            </nav>
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* the tabs give way (their names cut with «…») instead of running off the edge with a scroll bar. */}
            <div className="border-border flex shrink-0 items-center gap-0.5 border-b px-2.5 py-2">
              <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]" role="tablist" aria-label={t('expert.openFiles')}>
                {[{ id: 'chat', label: app.config.assistantName, icon: MessageSquare }, ...tabs].map((tb) => {
                  const Icon = tb.icon ?? (tb.kind === 'diff' ? FileDiff : IMAGE.test(tb.path) ? ImageIcon : null);
                  const letter = tb.kind === 'file' ? STATE_LETTER[changes[tb.path]] : null;
                  return (
                    <div key={tb.id} role="tab" tabIndex={0} aria-selected={current === tb.id} title={tb.path} onClick={() => setCurrent(tb.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCurrent(tb.id); } }}
                      className={cn('ptab hover:text-foreground focus-visible:outline-ring inline-flex h-(--ctl-sm) max-w-52 cursor-pointer items-center gap-1.5 rounded-[calc(var(--r-ctl)-2px)] px-2 text-control outline-none focus-visible:outline-2', tb.id === 'chat' || tb.id === current ? 'shrink-0' : 'min-w-20 shrink', current === tb.id ? 'bg-accent text-foreground' : 'text-muted-foreground')}>
                      {Icon ? <Icon className="size-4 shrink-0" /> : null}
                      <span className="truncate">{tb.label ?? t('expert.allChanges')}</span>
                      {letter ? <span className={cn('text-micro font-semibold', STATE_TONE[changes[tb.path]])}>{letter}</span> : null}
                      {tb.id !== 'chat' ? <span role="button" aria-label={t('expert.close')} title={t('expert.close')} className="hover:bg-secondary -mr-1 grid size-5 shrink-0 cursor-pointer place-items-center rounded-ctl" onClick={(e) => { e.stopPropagation(); closeTab(tb.id); }}><X className="size-3.5" /></span> : null}
                    </div>
                  );
                })}
              </div>
              {tab?.kind === 'file' && !IMAGE.test(tab.path) ? <Button variant="ghost" size="sm" onClick={() => openTab('diff', tab.path)} title={t('expert.viewChangesHint')} data-testid="expert-view-changes"><FileDiff />{t('expert.viewChanges')}</Button> : null}
              {tab?.path ? (
                <DropdownMenu modal={false}>
                  <BubbleTip title={t('expert.fileMore')}><DropdownMenuTrigger asChild><MoreButton label={t('expert.fileMore')} data-testid="expert-file-more" /></DropdownMenuTrigger></BubbleTip>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem onSelect={() => copyPath(tab.path)} data-testid="expert-copy-path"><Copy />{t('expert.copyPath')}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
            {tab ? <div className="border-border text-muted-foreground flex shrink-0 items-center gap-1.5 border-b px-3.5 py-1.5 text-caption"><span className="font-mono">{dir ? `${dir.split('/').join(' › ')} ›` : null}</span><b className="text-foreground font-medium">{tab.kind === 'diff' && !tab.path ? t('expert.allChanges') : fileName}</b>
              <StatusBar language={tab.path ? languageOf(tab.path) : null} counts={tab.path ? lineCounts[tab.path] : sumCounts(lineCounts)} info={tab.kind === 'file' && fileInfo?.path === tab.path ? fileInfo : null} /></div> : null}
            {/* The chat stays mounted so switching tabs never loses what is being written. */}
            <div className={cn('min-h-0 flex-1 flex-col', current === 'chat' ? 'flex' : 'hidden')}><ChatView route={{ view: 'chat', id: conversation }} onConversation={setConversation} project={project || undefined} /></div>
            {tab ? <div className="min-h-0 flex-1 overflow-auto [&_.code-surface]:bg-background!" data-testid="expert-viewer"><Viewer project={project} root={info?.path} tab={tab} version={version} onInfo={setFileInfo} /></div> : null}
            {info?.path ? (term ? (
              <TerminalPanel key={project} dock dir={info.path} draft={termDraft} onDraftTaken={() => setTermDraft('')} onClose={() => { setTerm(false); setLaunch(null); }} launch={launch}
                readonly={{ label: running ? t('terminal.taskId', { id: running.id }) : t('terminal.task'), content: <TaskOutput task={running} /> }} />
            ) : (
              <div className="border-border bg-secondary flex shrink-0 items-center gap-1 border-t px-2 py-1" data-testid="terminal-strip">
                <SquareTerminal className="text-muted-foreground mx-1 size-4 shrink-0" /><span className="text-muted-foreground text-control">{t('terminal.tabs')}</span><span className="grow" />
                <BubbleTip title={t('terminal.open')}><IconButton small label={t('terminal.open')} onClick={() => setTerm(true)} data-testid="terminal-open"><ChevronUp /></IconButton></BubbleTip>
              </div>
            )) : null}
          </div>
          {showRight && project ? (
            <aside className="border-border flex w-75 shrink-0 flex-col overflow-y-auto border-l" aria-label={t('expert.git')}>
              {on('history') && !on('git') ? (
                <div className="border-border flex items-center gap-1.5 border-b py-2 pr-2 pl-3">
                  <div className="flex min-w-0 flex-1 flex-col"><b className="font-(family-name:--title) text-card-title font-semibold">{t('expert.git')}</b>
                    {st?.repo ? <span className="text-muted-foreground truncate text-caption">{[st.branch, st.ahead ? t(st.upstream ? 'expert.aheadOf' : 'expert.ahead', { n: st.ahead, base: st.upstream }) : null, st.behind ? t(st.upstream ? 'expert.behindOf' : 'expert.behind', { n: st.behind, base: st.upstream }) : null].filter(Boolean).join(' · ')}</span> : null}</div>
                </div>
              ) : null}
              {on('git') ? <GitPanel project={project} st={st} version={version} reload={() => setManual((n) => n + 1)} onDiff={(p) => openTab('diff', p)} onHistory={() => setHistoryAll(true)} ago={ago} /> : null}
              {on('history') || historyAll ? <HistoryPanel project={project} version={version} onClose={on('history') ? undefined : () => setHistoryAll(false)} /> : null}
              {on('running') ? <RunningPanel /> : null}
              {on('usage') ? <UsagePanel version={version} /> : null}
              {on('system') ? <SystemPanel /> : null}
              {on('activity') ? <ActivityPanel version={version} /> : null}
            </aside>
          ) : null}
        </div>
      </div>
    </>
  );
}
