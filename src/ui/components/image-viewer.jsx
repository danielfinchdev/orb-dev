// 2.7: pictures an agent makes (Codex image_gen) inside the conversation: a preview, and a viewer to look at it big, mark
// a zone with the mouse and say what to change there (the agent gets the picture and a copy with the zone outlined), and
// to save it in the project's imagenes folder.
import { useEffect, useRef, useState } from 'react';
import { Download, Expand, Crop, Send, X } from 'lucide-react';
import { Button } from './ui/button.jsx';
import { Spinner } from './ui/basic.jsx';
import { Dialog, DialogContent, DialogTitle } from './ui/overlay.jsx';
import { toast } from 'sonner';
import { call, act, getState, setState, useStore } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';

function useImage(file) {
  const [src, setSrc] = useState(null);
  useEffect(() => { let alive = true; call('images.read', { path: file }).then((r) => alive && setSrc(r.dataUrl)).catch(() => alive && setSrc(false)); return () => { alive = false; }; }, [file]);
  return src;
}

export function GeneratedImage({ body, sessionId, project }) {
  const t = useT();
  const src = useImage(body.path);
  const [open, setOpen] = useState(false);
  if (src === false) return <div className="text-muted-foreground text-xs">{t('img.unavailable')}</div>;
  return (
    <div className="grid gap-1.5" data-testid="generated-image">
      <button type="button" className="group relative w-fit max-w-full cursor-zoom-in overflow-hidden rounded-xl border" onClick={() => setOpen(true)} aria-label={t('img.open')}>
        {src ? <img src={src} alt={body.prompt ?? ''} className={cn('block max-h-80 max-w-full object-contain', body.transparent && 'img-checker')} /> : <span className="grid size-40 place-items-center"><Spinner /></span>}
        <span className="bg-background/80 absolute top-2 right-2 grid size-7 place-items-center rounded-lg opacity-0 transition-opacity group-hover:opacity-100"><Expand className="size-4" /></span>
      </button>
      {/* 3.2.1: what was asked for, in two lines (the whole prompt repeated under every picture filled the conversation). */}
      {body.prompt ? <div className="text-muted-foreground line-clamp-2 max-w-xl text-[11.5px] leading-snug" title={body.prompt}>{body.prompt}</div> : null}
      {open && src ? <ImageEditor src={src} body={body} sessionId={sessionId} project={project} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

// 3.2.1: a picture of this PC linked from a message ("Ver imagen editada"): the same viewer, to look at it and save it.
export const openImage = (file) => setState({ imagePreview: { path: String(file) } });
export function ImagePreviewHost() {
  const preview = useStore((s) => s.imagePreview);
  return preview ? <ImagePreview key={preview.path} body={preview} onClose={() => setState({ imagePreview: null })} /> : null;
}
function ImagePreview({ body, onClose }) {
  const t = useT();
  const src = useImage(body.path);
  useEffect(() => { if (src === false) { toast.error(t('img.unavailable')); onClose(); } }, [src]); // eslint-disable-line react-hooks/exhaustive-deps
  return src ? <ImageEditor src={src} body={body} sessionId={null} onClose={onClose} /> : null;
}

// The zone is a rectangle in the picture's own pixels; the marked copy dims what is outside it and outlines it.
function markedCopy(img, r) {
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.fillRect(0, 0, c.width, r.y); g.fillRect(0, r.y + r.h, c.width, c.height - r.y - r.h); g.fillRect(0, r.y, r.x, r.h); g.fillRect(r.x + r.w, r.y, c.width - r.x - r.w, r.h);
  g.strokeStyle = '#ff2d55'; g.lineWidth = Math.max(4, Math.round(c.width / 200)); g.strokeRect(r.x, r.y, r.w, r.h);
  return c.toDataURL('image/png');
}

function ImageEditor({ src, body, sessionId, project, onClose }) {
  const t = useT();
  const imgRef = useRef(null);
  const [zone, setZone] = useState(null); // in natural pixels
  const [drag, setDrag] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const toNatural = (e) => {
    const img = imgRef.current; const box = img.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - box.left, 0), box.width); const y = Math.min(Math.max(e.clientY - box.top, 0), box.height);
    return { x: Math.round((x / box.width) * img.naturalWidth), y: Math.round((y / box.height) * img.naturalHeight) };
  };
  const down = (e) => { if (e.button !== 0) return; e.preventDefault(); const p = toNatural(e); setDrag(p); setZone({ x: p.x, y: p.y, w: 0, h: 0 }); };
  const move = (e) => { if (!drag) return; const p = toNatural(e); setZone({ x: Math.min(p.x, drag.x), y: Math.min(p.y, drag.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) }); };
  const up = () => { setDrag(null); setZone((z) => (z && z.w > 8 && z.h > 8 ? z : null)); };
  const pct = (z) => { const img = imgRef.current; return { left: `${(z.x / img.naturalWidth) * 100}%`, top: `${(z.y / img.naturalHeight) * 100}%`, width: `${(z.w / img.naturalWidth) * 100}%`, height: `${(z.h / img.naturalHeight) * 100}%` }; };
  const save = async () => {
    const name = project ?? getState().app?.activeProject?.name;
    if (!name) return act(Promise.reject(new Error(t('img.noProject'))));
    const r = await act(call('images.save', { path: body.path, project: name, title: body.prompt ?? undefined }), t('img.saved', { project: name }));
    return r;
  };
  const ask = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const img = imgRef.current;
      const images = [body.path];
      let where = t('img.whole');
      if (zone) {
        const marked = await call('images.mark', { dataUrl: markedCopy(img, zone) });
        images.push(marked.path);
        const p = (n, total) => Math.round((n / total) * 100);
        where = t('img.zone', { x: p(zone.x, img.naturalWidth), y: p(zone.y, img.naturalHeight), w: p(zone.w, img.naturalWidth), h: p(zone.h, img.naturalHeight) });
      }
      const r = await act(call('sessions.send', { id: sessionId, text: t('img.editText', { where, change: text.trim() }), images }));
      if (r !== undefined) onClose();
    } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[min(1100px,95vw)] gap-3" data-testid="image-editor">
        <DialogTitle>{t('img.title')}</DialogTitle>
        <div className="bg-muted/40 grid max-h-[62vh] place-items-center overflow-auto rounded-xl p-2">
          <div className={cn('relative inline-block select-none', sessionId && 'cursor-crosshair')} onPointerDown={sessionId ? down : undefined} onPointerMove={move} onPointerUp={up} onPointerLeave={up} data-testid="image-canvas">
            <img ref={imgRef} src={src} alt={body.prompt ?? ''} draggable={false} className={cn('block max-h-[58vh] max-w-full object-contain', body.transparent && 'img-checker')} />
            {zone && imgRef.current ? <span className="pointer-events-none absolute rounded-sm border-2 border-[#ff2d55] shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]" style={pct(zone)} /> : null}
          </div>
        </div>
        {sessionId ? <p className="text-muted-foreground text-xs">{zone ? t('img.zoneHint') : t('img.markHint')}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          {sessionId ? <><input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') ask(); }} placeholder={zone ? t('img.changeZonePh') : t('img.changePh')} maxLength={1000}
            className="border-input bg-background focus-visible:ring-ring/40 h-9 min-w-0 flex-1 rounded-lg border px-3 text-sm outline-none focus-visible:ring-2" data-testid="image-change" />
          {zone ? <Button size="sm" variant="ghost" onClick={() => setZone(null)}><X />{t('img.clearZone')}</Button> : null}
          <Button size="sm" onClick={ask} disabled={!text.trim() || busy} data-testid="image-ask">{busy ? <Spinner className="size-3.5" /> : zone ? <Crop /> : <Send />}{t('img.ask')}</Button></> : null}
          <Button size="sm" variant="outline" onClick={save} data-testid="image-save"><Download />{t('img.save')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
