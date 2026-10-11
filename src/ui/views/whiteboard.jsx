// 2.7: the Pizarra: an Excalidraw canvas per project to draw, write and point at things, and a panel on the right for
// attachments (photos, videos, documents) with a note each. Everything is saved in <project>/pizarra as it changes, and
// the assistant reads it (PIZARRA.md and the drawing as a picture) when it plans the project's work.
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { PenTool, Paperclip, FolderOpen, Trash2, FileText, Film, Music, PanelRightClose, PanelRightOpen, Check, CloudUpload } from 'lucide-react';
import { PageHeader } from '@/components/page.jsx';
import { ProjectPicker } from '@/components/project-actions.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Empty, Spinner } from '@/components/ui/basic.jsx';
import { BubbleTip } from '@/components/ui/overlay.jsx';
import { confirm } from '@/components/dialogs.jsx';
import { useStore, call, act, bridge, isDark } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';

if (typeof window !== 'undefined') window.EXCALIDRAW_ASSET_PATH = new URL('./excalidraw/', document.baseURI).href;
const Board = lazy(() => import('@/components/excalidraw-board.jsx'));

const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const ICON = { video: Film, audio: Music, file: FileText };

// Follows the app's day / night while the Pizarra is open.
function useDark() {
  const [dark, setDark] = useState(isDark);
  useEffect(() => { const obs = new MutationObserver(() => setDark(isDark())); obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] }); return () => obs.disconnect(); }, []);
  return dark;
}

// The Pizarra of the project in use: changing project (here or anywhere) changes the Pizarra.
export function WhiteboardView() {
  const t = useT();
  const app = useStore((s) => s.app);
  const projects = useStore((s) => s.projects);
  const project = projects.find((p) => p.name === app.activeProject?.name) ?? null;
  return (
    <>
      <PageHeader icon={<PenTool className="text-primary size-5" />} title={t('wb.title')} meta={project ? t('wb.meta', { project: project.name, assistant: app.config.assistantName }) : t('wb.metaNone')}>
        <ProjectPicker />
      </PageHeader>
      {project ? <Whiteboard key={project.name} project={project.name} /> : <Empty icon={PenTool} title={t('wb.pickTitle')} className="m-auto">{t('wb.pickBody')}</Empty>}
    </>
  );
}

function Whiteboard({ project }) {
  const t = useT();
  const dark = useDark();
  const lang = useStore((s) => s.app.config.language);
  const assistant = useStore((s) => s.app.config.assistantName);
  const [data, setData] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [panel, setPanel] = useState(() => { try { return localStorage.getItem('orb.wb.panel') !== '0'; } catch { return true; } });
  const [saving, setSaving] = useState('saved'); // saved | pending | saving
  const [dropping, setDropping] = useState(false);
  const latest = useRef(null); const savedFiles = useRef(new Set()); const timers = useRef({}); const lastPng = useRef(0);
  useEffect(() => {
    let alive = true;
    call('whiteboard.load', { project }).then((d) => { if (!alive) return; savedFiles.current = new Set(Object.keys(d.files ?? {})); setAttachments(d.attachments ?? []); setData(d); })
      .catch((e) => { if (alive) { toast.error(String(e.message ?? e)); setData({ elements: [], appState: {}, files: {}, attachments: [] }); } });
    return () => { alive = false; };
  }, [project]);
  useEffect(() => { try { localStorage.setItem('orb.wb.panel', panel ? '1' : '0'); } catch { /* storage unavailable */ } }, [panel]);

  // Saved a moment after each change; its picture (for the assistant) at most every 8 s, and always when leaving.
  const save = useCallback(async ({ withPng = false } = {}) => {
    const cur = latest.current; if (!cur) return;
    const { elements, appState, files } = cur;
    const fresh = Object.fromEntries(Object.entries(files ?? {}).filter(([id]) => !savedFiles.current.has(id)).map(([id, f]) => [id, { mimeType: f.mimeType, dataURL: f.dataURL }]));
    let png;
    if (withPng || Date.now() - lastPng.current > 8000) {
      try { const { drawingPng } = await import('@/components/excalidraw-board.jsx'); png = await drawingPng(elements, appState, files); lastPng.current = Date.now(); } catch { png = undefined; }
    }
    setSaving('saving');
    try {
      await call('whiteboard.save', { project, elements, appState: { viewBackgroundColor: appState.viewBackgroundColor, gridSize: appState.gridSize, gridModeEnabled: appState.gridModeEnabled }, files: fresh, png });
      for (const id of Object.keys(fresh)) savedFiles.current.add(id);
      setSaving(latest.current?.version === cur.version ? 'saved' : 'pending');
    } catch (e) { setSaving('pending'); toast.error(String(e.message ?? e)); }
  }, [project]);
  const onChange = useCallback((elements, appState, files) => {
    const prev = latest.current;
    latest.current = { elements, appState, files };
    // Excalidraw also calls on pointer moves and selections: only a real change of the drawing (or a new picture) saves.
    const version = elements.reduce((s, e) => s + e.version, 0);
    if (prev && prev.version === version && Object.keys(files ?? {}).length === Object.keys(prev.files ?? {}).length) { latest.current.version = version; return; }
    latest.current.version = version;
    if (!prev) return; // the first call is the loaded drawing itself
    setSaving('pending');
    clearTimeout(timers.current.save); timers.current.save = setTimeout(() => save(), 1200);
  }, [save]);
  useEffect(() => () => { clearTimeout(timers.current.save); if (latest.current) save({ withPng: true }); }, [save]);

  const attach = async (paths) => {
    const list = (paths ?? []).filter(Boolean); if (!list.length) return;
    const r = await act(call('whiteboard.attach', { project, paths: list }), t('wb.attached', { n: list.length }));
    if (r) setAttachments(r);
  };
  const pick = async () => attach(await bridge.pickFiles?.(t('sys.dialog.pickFiles')));
  const note = async (file, value) => { await act(call('whiteboard.note', { project, file, note: value })); setAttachments((a) => a.map((x) => (x.name === file ? { ...x, note: value } : x))); };
  const remove = async (file) => {
    if (!(await confirm(t('wb.removeTitle'), t('wb.removeBody', { name: file }), { ok: t('wb.remove'), danger: true }))) return;
    const r = await act(call('whiteboard.remove', { project, file })); if (r) setAttachments(r);
  };
  const openFolder = async () => { const dir = await act(call('whiteboard.folder', { project })); if (dir) act(bridge.openPath(dir)); };

  // Files dropped on the panel (from the Explorer) are attached; on the canvas, Excalidraw places pictures itself.
  const drop = (e) => { e.preventDefault(); setDropping(false); attach([...(e.dataTransfer?.files ?? [])].map((f) => bridge.pathForFile?.(f))); };

  const menu = null;
  return (
    <div className="relative flex min-h-0 flex-1" data-testid="whiteboard">
      <div className="wb-canvas relative min-w-0 flex-1" data-testid="whiteboard-canvas">
        {data ? (
          <Suspense fallback={<div className="grid h-full place-items-center"><Spinner /></div>}>
            <Board initial={data} dark={dark} lang={lang} onChange={onChange} menu={menu} />
          </Suspense>
        ) : <div className="grid h-full place-items-center"><Spinner /></div>}
        <div className="wb-status pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px]" data-testid="whiteboard-status">
          {saving === 'saved' ? <><Check className="size-3.5" />{t('wb.saved')}</> : <><CloudUpload className="size-3.5" />{t('wb.saving')}</>}
        </div>
      </div>
      {panel ? (
        // Floating over the canvas (as Excalidraw's own sidebar does), so the canvas keeps the whole width: below 730 px
        // Excalidraw switches to its phone tools.
        <aside className={cn('wb-panel absolute top-16 right-3 bottom-16 z-20 flex w-72 max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-2xl border', dropping && 'ring-primary ring-2 ring-inset')} onDragOver={(e) => { e.preventDefault(); setDropping(true); }} onDragLeave={() => setDropping(false)} onDrop={drop} data-testid="whiteboard-panel">
          <div className="flex items-center gap-2 border-b px-3 py-2.5">
            <Paperclip className="text-primary size-4" /><span className="flex-1 text-[13.5px] font-semibold">{t('wb.attachments')}</span>
            <BubbleTip title={t('wb.hidePanel')}><Button size="icon-xs" variant="ghost" onClick={() => setPanel(false)} aria-label={t('wb.hidePanel')}><PanelRightClose /></Button></BubbleTip>
          </div>
          <div className="grid gap-2 border-b p-3">
            <Button size="sm" variant="outline" onClick={pick} disabled={!bridge.pickFiles} data-testid="whiteboard-attach"><Paperclip />{t('wb.attach')}</Button>
            <p className="text-muted-foreground text-[11.5px] leading-snug">{bridge.mobile ? t('wb.attachPcOnly') : t('wb.attachHint')}</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {attachments.length ? attachments.map((a) => {
              const Icon = ICON[a.kind] ?? FileText;
              return (
                <div key={a.name} className="wb-item mb-2 grid gap-1.5 rounded-xl border p-2" data-testid="whiteboard-item">
                  <div className="flex items-center gap-2">
                    {a.thumb ? <img src={a.thumb} alt="" className="size-10 shrink-0 rounded-md border object-cover" /> : <span className="bg-muted grid size-10 shrink-0 place-items-center rounded-md"><Icon className="text-muted-foreground size-4" /></span>}
                    <div className="min-w-0 flex-1"><div className="truncate text-[12.5px] font-medium">{a.name}</div><div className="text-muted-foreground text-[11px]">{size(a.size)}</div></div>
                    {bridge.mobile ? null : <BubbleTip title={t('wb.remove')}><Button size="icon-xs" variant="ghost" onClick={() => remove(a.name)} aria-label={t('wb.remove')}><Trash2 /></Button></BubbleTip>}
                  </div>
                  <textarea defaultValue={a.note} rows={2} maxLength={2000} placeholder={t('wb.notePh', { assistant })} onBlur={(e) => { if (e.target.value !== a.note) note(a.name, e.target.value); }}
                    className="border-input bg-background/70 placeholder:text-muted-foreground focus-visible:ring-ring/40 w-full resize-y rounded-lg border px-2 py-1 text-[12px] outline-none focus-visible:ring-2" />
                </div>
              );
            }) : <p className="text-muted-foreground px-2 py-6 text-center text-[12px] leading-relaxed">{t('wb.noAttachments', { assistant })}</p>}
          </div>
          <div className="grid gap-1.5 border-t p-3">
            {/* Orb reads the Pizarra by itself (and hears when it changes): no button to ask it. */}
            {bridge.mobile ? null : <Button size="sm" variant="ghost" onClick={openFolder}><FolderOpen />{t('wb.openFolder')}</Button>}
          </div>
        </aside>
      ) : (
        <BubbleTip title={t('wb.showPanel')} side="left"><Button size="icon-sm" variant="outline" className="absolute top-16 right-3 z-20" onClick={() => setPanel(true)} aria-label={t('wb.showPanel')} data-testid="whiteboard-show-panel"><PanelRightOpen /></Button></BubbleTip>
      )}
    </div>
  );
}
