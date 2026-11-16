// The phone's «Pizarra»: Excalidraw in the local web view. The drawing lives on the PC; this page only edits the copy
// the app hands over and reports changes back through the closed set of messages of `OrbHost.post`:
//   page -> app: {type:'load'} | {type:'save', elements, appState, files, png?, flush?} | {type:'close'}
//   page -> app: {type:'flushed'} answers the app's {type:'flush'} once everything has been sent
//   app -> page: window.orbReceive({type:'scene', scene:{elements, appState, files}}) | {type:'flush'} | {type:'saved', files:[ids]} | {type:'unsent'}
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw, exportToBlob, MainMenu } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

window.EXCALIDRAW_ASSET_PATH = new URL('./excalidraw/', document.baseURI).href;

const params = new URLSearchParams(location.search);
const dark = params.get('theme') === 'dark';
document.documentElement.classList.toggle('dark', dark);

const host = () => (window.OrbHost && typeof window.OrbHost.post === 'function' ? window.OrbHost : null);
const post = (msg) => { try { host()?.post(JSON.stringify(msg)); } catch { /* the app is gone */ } };

const blobToDataURL = (blob) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(blob); });

// The drawing as a PNG (white background, light colours, so it reads the same whatever the theme); '' when empty.
async function drawingPng(elements, appState, files) {
  const live = elements.filter((e) => !e.isDeleted);
  if (!live.length) return '';
  const blob = await exportToBlob({ elements: live, appState: { ...appState, exportBackground: true, exportWithDarkMode: false, viewBackgroundColor: '#ffffff' }, files, mimeType: 'image/png', exportPadding: 32, maxWidthOrHeight: 2048 });
  return blobToDataURL(blob);
}

// The Board of the current scene registers its entry points here for the app's messages.
const board = { flush: null, saved: null, unsent: null };

const THROTTLE_MS = 700;
const PNG_EVERY_MS = 8000;

function Board({ scene }) {
  const latest = useRef(null);
  // A picture counts as sent only once the app confirms the PC has it; until then it is in flight and not offered again.
  const sentFiles = useRef(new Set(Object.keys(scene.files ?? {})));
  const inFlight = useRef(new Set());
  const timer = useRef(0);
  const lastPng = useRef(0);
  const dirty = useRef(false);
  const api = useRef(null);

  const send = useCallback(async ({ flush = false } = {}) => {
    clearTimeout(timer.current);
    const cur = latest.current;
    if (!cur || !dirty.current) return; // an untouched board is never saved: it would overwrite what the PC has since
    const { elements, appState, files } = cur;
    const fresh = {};
    for (const [id, f] of Object.entries(files ?? {})) {
      if (!sentFiles.current.has(id) && !inFlight.current.has(id) && typeof f?.dataURL === 'string') { fresh[id] = { mimeType: f.mimeType, dataURL: f.dataURL }; inFlight.current.add(id); }
    }
    let png;
    if (flush || Date.now() - lastPng.current > PNG_EVERY_MS) {
      try { png = await drawingPng(elements, appState, files); lastPng.current = Date.now(); } catch { png = undefined; }
    }
    dirty.current = false;
    post({ type: 'save', elements: elements.filter((e) => !e.isDeleted), appState: { viewBackgroundColor: appState.viewBackgroundColor, gridSize: appState.gridSize, gridModeEnabled: appState.gridModeEnabled }, files: fresh, ...(png === undefined ? {} : { png }), flush });
  }, []);

  const onChange = useCallback((elements, appState, files) => {
    const prev = latest.current;
    // Excalidraw also calls on pointer moves and selections: only a real change of the drawing counts.
    const version = elements.reduce((s, e) => s + e.version, 0);
    const same = prev && prev.version === version && Object.keys(files ?? {}).length === Object.keys(prev.files ?? {}).length;
    latest.current = { elements, appState, files, version };
    if (same || !prev) return; // the first call is the loaded drawing itself
    dirty.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => send(), THROTTLE_MS);
  }, [send]);

  useEffect(() => {
    // The system back gesture and the app's back arrow: save everything with its picture, then ask the app to leave.
    window.orbBack = () => { send({ flush: true }).then(() => post({ type: 'close' })); return true; };
    board.flush = () => send({ flush: true }).then(() => post({ type: 'flushed' }));
    board.saved = (ids) => { for (const id of ids) { inFlight.current.delete(id); sentFiles.current.add(id); } };
    board.unsent = () => { inFlight.current.clear(); dirty.current = true; }; // a failed save is retried on leaving
    const hidden = () => { if (document.visibilityState === 'hidden') send({ flush: true }); };
    document.addEventListener('visibilitychange', hidden);
    const id = setTimeout(() => window.dispatchEvent(new Event('resize')), 120);
    return () => { clearTimeout(id); clearTimeout(timer.current); document.removeEventListener('visibilitychange', hidden); delete window.orbBack; board.flush = board.saved = board.unsent = null; };
  }, [send]);

  return (
    <Excalidraw
      excalidrawAPI={(a) => { api.current = a; }}
      initialData={{ elements: scene.elements, appState: { ...scene.appState, collaborators: new Map() }, files: scene.files, scrollToContent: true }}
      theme={dark ? 'dark' : 'light'}
      langCode="es-ES"
      onChange={onChange}
      // No libraries, no collaboration, no external embeds or links: the page has no network anyway.
      validateEmbeddable={false}
      renderTopRightUI={() => null}
      UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: false, saveAsImage: false } }}>
      <MainMenu>
        <MainMenu.DefaultItems.ClearCanvas />
        <MainMenu.DefaultItems.ChangeCanvasBackground />
      </MainMenu>
    </Excalidraw>
  );
}

function App() {
  const [scene, setScene] = useState(null);
  useEffect(() => {
    window.orbReceive = (msg) => {
      if (!msg) return;
      if (msg.type === 'scene' && msg.scene && Array.isArray(msg.scene.elements)) {
        // Pictures the phone sent travel without id and date: Excalidraw needs both back.
        const files = {};
        for (const [id, f] of Object.entries(msg.scene.files ?? {})) files[id] = { ...f, id, created: f.created ?? Date.now() };
        setScene({ elements: msg.scene.elements, appState: msg.scene.appState ?? {}, files });
      } else if (msg.type === 'flush') board.flush?.();
      else if (msg.type === 'saved' && Array.isArray(msg.files)) board.saved?.(msg.files);
      else if (msg.type === 'unsent') board.unsent?.();
    };
    post({ type: 'load' });
    return () => { delete window.orbReceive; };
  }, []);
  return scene ? <Board scene={scene} /> : null;
}

createRoot(document.getElementById('root')).render(<App />);
