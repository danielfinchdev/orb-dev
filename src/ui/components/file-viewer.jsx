// 3.8.2: a PDF attached to a direct conversation, read inside Orb (pdf.js, loaded only when one is opened; its worker is
// bundled with the app, no WebAssembly and no eval, so the window's CSP stays as it is). Pages are drawn one after
// another into canvases; very long documents stop at MAX_PAGES with a note.
// 3.8.3: an audio or video attachment the window can play (core/attach-kind.mjs › playableType) plays here, from a blob:
// URL (the only media source the CSP allows), released when the viewer closes.
import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/overlay.jsx';
import { Spinner } from './ui/basic.jsx';
import { call } from '@/lib/store.js';
import { baseName } from '@/lib/utils.js';
import { playableType } from '../../core/attach-kind.mjs';
import { useT } from '@/lib/i18n.js';

const MAX_PAGES = 60;
let pdfLoad = null;
const loadPdf = () => (pdfLoad ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([pdfjs, worker]) => {
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}));
const bytesOf = (b64) => { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };

export default function FileViewer({ sessionId, path, onClose }) {
  const t = useT();
  const box = useRef(null);
  const [state, setState] = useState({ status: 'loading', pages: 0, media: null });
  useEffect(() => {
    let alive = true; let doc = null; let url = null;
    (async () => {
      try {
        const media = playableType(path);
        if (media) {
          const { base64, mime } = await call('attachments.read', { session: sessionId, path });
          url = URL.createObjectURL(new Blob([bytesOf(base64)], { type: mime }));
          if (alive) setState({ status: 'ready', pages: 0, media: { kind: mime.split('/')[0], url } });
          return;
        }
        const [{ base64 }, pdfjs] = await Promise.all([call('attachments.read', { session: sessionId, path }), loadPdf()]);
        doc = await pdfjs.getDocument({ data: bytesOf(base64), useWasm: false, isEvalSupported: false, disableFontFace: true, enableXfa: false }).promise;
        if (!alive) return;
        setState({ status: 'ready', pages: doc.numPages });
        const width = Math.min(900, (box.current?.clientWidth || 800) - 16);
        for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES) && alive; n++) {
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * (window.devicePixelRatio || 1) });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
          canvas.style.width = `${width}px`; canvas.className = 'mx-auto block rounded-md bg-white shadow-sm';
          canvas.setAttribute('aria-label', t('viewer.page', { n }));
          await page.render({ canvas, viewport }).promise;
          if (alive) box.current?.appendChild(canvas);
        }
      } catch { if (alive) setState({ status: 'error', pages: 0, media: null }); }
    })();
    return () => { alive = false; doc?.destroy?.(); if (url) URL.revokeObjectURL(url); };
  }, [sessionId, path, t]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[min(1000px,95vw)] gap-3" data-testid="file-viewer">
        <DialogTitle className="truncate">{baseName(path)}</DialogTitle>
        <DialogDescription className="sr-only">{t(playableType(path) ? `viewer.${playableType(path).split('/')[0]}` : 'viewer.pdf')}</DialogDescription>
        {state.status === 'loading' ? <div className="grid h-40 place-items-center"><Spinner /></div> : null}
        {state.status === 'error' ? <p className="text-muted-foreground py-6 text-center text-sm">{t('viewer.unavailable')}</p> : null}
        {state.media?.kind === 'video' ? <video src={state.media.url} controls className="max-h-[75vh] w-full rounded-xl bg-black" data-testid="viewer-media" /> : null}
        {state.media?.kind === 'audio' ? <audio src={state.media.url} controls className="w-full" data-testid="viewer-media" /> : null}
        <div ref={box} className="bg-muted/40 grid max-h-[75vh] gap-3 overflow-auto rounded-xl p-2" hidden={state.status !== 'ready' || Boolean(state.media)} />
        {state.pages > MAX_PAGES ? <p className="text-muted-foreground text-xs">{t('viewer.more', { n: MAX_PAGES, total: state.pages })}</p> : null}
      </DialogContent>
    </Dialog>
  );
}
