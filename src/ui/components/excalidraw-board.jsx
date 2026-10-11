// 2.7: the Pizarra's canvas: Excalidraw itself (MIT), loaded only when the Pizarra opens (it is big). Its fonts are served
// from the app (vite.config.mjs copies them to excalidraw/fonts), so it works without internet.
import { useEffect, useMemo, useRef } from 'react';
import { Excalidraw, exportToBlob, MainMenu } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

if (typeof window !== 'undefined') window.EXCALIDRAW_ASSET_PATH = new URL('./excalidraw/', document.baseURI).href;

const blobToDataURL = (blob) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(blob); });

// The drawing as a PNG (white background, light colours, so it reads the same whatever the theme); '' when empty.
export async function drawingPng(elements, appState, files) {
  const live = elements.filter((e) => !e.isDeleted);
  if (!live.length) return '';
  const blob = await exportToBlob({ elements: live, appState: { ...appState, exportBackground: true, exportWithDarkMode: false, viewBackgroundColor: '#ffffff' }, files, mimeType: 'image/png', exportPadding: 32, maxWidthOrHeight: 4096 });
  return blobToDataURL(blob);
}

// onChange(elements, appState, files) after every change; the canvas keeps its own state (no re-render from outside).
export default function ExcalidrawBoard({ initial, dark, lang, onChange, onApi, menu }) {
  const api = useRef(null);
  const data = useMemo(() => ({ elements: initial.elements, appState: { ...initial.appState, collaborators: new Map() }, files: initial.files, scrollToContent: true }), []); // eslint-disable-line react-hooks/exhaustive-deps
  // Excalidraw measures its box when it mounts (still settling inside the page): told again a moment later, so a wide
  // canvas gets the desktop tools (left panel, zoom) and not the phone's bar.
  useEffect(() => { const id = setTimeout(() => window.dispatchEvent(new Event('resize')), 120); return () => { clearTimeout(id); api.current = null; }; }, []);
  return (
    <Excalidraw
      excalidrawAPI={(a) => { api.current = a; onApi?.(a); }}
      initialData={data}
      theme={dark ? 'dark' : 'light'}
      langCode={lang === 'en' ? 'en' : 'es-ES'}
      onChange={onChange}
      UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: { saveFileToDisk: true }, toggleTheme: false } }}>
      <MainMenu>
        <MainMenu.DefaultItems.Export />
        <MainMenu.DefaultItems.SaveAsImage />
        <MainMenu.DefaultItems.ClearCanvas />
        <MainMenu.Separator />
        {menu}
        <MainMenu.DefaultItems.ChangeCanvasBackground />
      </MainMenu>
    </Excalidraw>
  );
}
