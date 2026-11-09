// 3.8.2: a PDF attached to a direct conversation, read inside Orb (pdf.js, loaded only when one is opened; its worker is
// bundled with the app, no WebAssembly and no eval, so the window's CSP stays as it is). Pages are drawn one after
// another into canvases; very long documents stop at MAX_PAGES with a note.
import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/overlay.jsx';
import { Spinner } from './ui/basic.jsx';
import { call } from '@/lib/store.js';
import { baseName } from '@/lib/utils.js';
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
  const [state, setState] = useState({ status: 'loading', pages: 0 });
  useEffect(() => {
    let alive = true; let doc = null;
    (async () => {
      try {
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
      } catch { if (alive) setState({ status: 'error', pages: 0 }); }
    })();
    return () => { alive = false; doc?.destroy?.(); };
  }, [sessionId, path, t]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[min(1000px,95vw)] gap-3" data-testid="file-viewer">
        <DialogTitle className="truncate">{baseName(path)}</DialogTitle>
        <DialogDescription className="sr-only">{t('viewer.pdf')}</DialogDescription>
        {state.status === 'loading' ? <div className="grid h-40 place-items-center"><Spinner /></div> : null}
        {state.status === 'error' ? <p className="text-muted-foreground py-6 text-center text-sm">{t('viewer.unavailable')}</p> : null}
        <div ref={box} className="bg-muted/40 grid max-h-[75vh] gap-3 overflow-auto rounded-xl p-2" hidden={state.status !== 'ready'} />
        {state.pages > MAX_PAGES ? <p className="text-muted-foreground text-xs">{t('viewer.more', { n: MAX_PAGES, total: state.pages })}</p> : null}
      </DialogContent>
    </Dialog>
  );
}
