# 21. The agents' browser

Part of [How Orb works](../ARCHITECTURE.md).

- Agents open and test websites, including `localhost`, with the `orb_browser_*` tools: open, read, click, type,
  screenshot, scroll, wait and close.
- It has none of your sessions, and pages cannot open dialogs.
- A **mini window** at the top right shows what they do live.
  - 3.8.2: **«Señalar elemento»**: the user clicks on the page's picture (`point:<x>,<y>`, two fractions checked by
    `pip.rs`); the engine finds the element in Orb's isolated world (`browser-point.mjs`: a short CSS selector, at most
    300 characters of its text) and photographs just that part of the view. Both go to that conversation's message box
    on this PC (`browser:pointed`, window only); nothing is sent until the user sends it.
  - 3.8.2: **«Grabar»**: the screencast keeps running while recording (also with the mini window hidden) and, on stop
    (or after 3 minutes / 120 MB, when the page closes or when Orb locks), the frames become a 5 fps Motion-JPEG AVI
    (`browser-record.mjs`, no encoder) saved among that chat's attachments. No new DevTools method:
    `browser_rules.rs` is unchanged.
- Files:
  - `src/engine/browser/browser-protocol.mjs` (the actions, page scripts and pipe every driver shares);
  - 3.8.1, Tauri: the browser lives in the engine (`src/engine/browser/host-browser.mjs`, `agent-browser.mjs`, the DevTools
    driver `browser-cdp.mjs`). Its pages are hidden WebView2 views in a browser environment of their own
    (`src-tauri/src/browser.rs`), with no DevTools port: Rust passes the engine's DevTools calls with
    `CallDevToolsProtocolMethod` over the engine's stdio channel and enforces the limits (http(s) only, no other app's
    protocol, no new windows, permissions, downloads or HTTP sign-in prompts, sound off: `browser_rules.rs`). The pages
    live on a thread of their own (an STA with its own message loop), never on the window's UI thread, so a page
    flooding DevTools events cannot slow Orb's window; a page past the flood limits (events, console lines or bytes a
    second) is closed and the agent told. The mini window is `src-tauri/src/pip.rs`, fed by a screencast with one frame
    in flight;
  - the tools in `src/mcp/server.mjs`;
  - `src/engine/browser/browser-key.mjs`.
