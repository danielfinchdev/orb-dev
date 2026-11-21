// Side-effect module: points Excalidraw at the fonts the app ships (vite.config.mjs copies them to excalidraw/fonts).
// It must be the FIRST import of any module that loads Excalidraw: ES imports are hoisted, so a plain statement
// below the import would run after Excalidraw has already read the path.
if (typeof window !== 'undefined') window.EXCALIDRAW_ASSET_PATH = new URL('./excalidraw/', document.baseURI).href;
