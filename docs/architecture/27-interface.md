# 27. Interface

Part of [How Orb works](../ARCHITECTURE.md).

- **Sidebar:** the assistant; the four places Tasks, Projects, Scheduled and Whiteboard (`places` in `main.jsx`); "More"
  with God mode; and a footer of icons (Agents, Logs, Tutorials, feedback, music and Settings, each with its tooltip, no
  expandable footer). Below:
  - the **inbox**: "To approve" (permissions and approvals), "In progress" and "Issues" (tasks at their usage limit and
    interrupted or failed conversations; "Mark as resolved" removes them);
  - the **folders** (each project with its tasks and conversations) and "No folder".
  - File: `src/ui/components/sidebar.jsx`. The Tasks filters use the same names (`FILTERS` in
    `src/ui/views/tasks.jsx`): In progress (working or queued), To approve, Completed, Issues, All.
- **Look (Orb UI 2.0):** shadcn/ui, Tailwind and the Outfit font.
  - **Tokens:** `src/ui/tokens.css` holds the shadcn tokens (light, dark and the Tailwind mapping, the "Graphite" values:
    neutral greys, one warm accent) and is imported by `app.css` and by the Android app. No variable is ever renamed:
    a theme or a palette only restates tokens.
  - **Themes:** `src/ui/themes.css` imports `src/ui/themes/skins.css` (the tokens, veil and few pieces of each theme, in
    light `html[data-skin]` and dark `html.dark[data-skin]`, plus the palettes `html[data-palette]`) and
    `src/ui/themes/pieces.css` (what the shared pieces need that a Tailwind class cannot say). The base theme
    «predeterminado» has no rules of its own: it is `tokens.css`. The six themes (`SKINS` in `src/shared/appearance.mjs`)
    are predeterminado, cristal (light only), orb, vaporwave, candy and retro (dark only); the retired themes
    (Professional, Graphite, Palettes) have no CSS any more. The backdrops of orb, vaporwave, candy, retro and cristal are WebGL
    shaders (`src/ui/lib/shaders.js`, mounted once by `src/ui/components/scene.jsx`): half resolution, 30 fps at most,
    still while the window is hidden or under reduced motion, and harmless when WebGL is missing.
  - **Migration:** `migrateAppearance` (`src/shared/appearance.mjs`, run when `orb.json` is read: `src/platform/config-file.mjs`
    and `config.mjs`) takes an old `ui` object to the current model: Professional, Graphite and Palettes become
    «predeterminado» (Palettes picks the closest of the six palettes by its accent), Cloud becomes «candy», the 28
    palettes fall to the nearest of the six, the fonts and code fonts and colours that were retired fall to the first of
    their list, and `density`, `chatWidth` and `fontSize` are deleted (their values are fixed). `accent` and `contrast`
    are still accepted by the check of `orb.json` but nothing offers or applies them. The pass is pure and idempotent.
  - **"More options":** a setting of Orb that the screen of a view does not draw up front is never deleted: it goes into a row's
    "⋯" menu or into `MoreOptions` (`src/ui/views/settings/rows.jsx`), always at the end of its section (`fold` hides its
    rows behind the title; a section whose cards all have nothing to show hides the title too).
  - Base components in `src/ui/components/ui/` (buttons, cards, selects, checkboxes and switches with fixed dark mode).
  - Real agent logos in `agent-icon.jsx` (Simple Icons, CC0).
  - Animated robot in `robot.jsx`.
- **Mode** light, dark or system; interface **size** with Ctrl +, Ctrl - and Ctrl 0; **Ctrl J** opens a terminal in the
  folder.
- **Integrated terminal** (3.8.2, `src/engine/host/user-terminal.mjs`, `components/terminal-panel.jsx`): a chat's ⋯ menu ›
  «Mostrar terminal» docks the user's own terminal under it, in the chat's folder, with one tab per terminal (at most 4). It is
  the user's, not an agent's (no guard), so it is this PC's window only (`terminal.*` are `pc` methods; `terminal:data`
  is never sent to a phone) and never starts in core, Orb's data, the install folder or a protected folder. It runs
  System32's Windows PowerShell (`/bin/sh` or `$SHELL` elsewhere) with pipes, not a pseudo-console, so no native module
  is added: line-based commands work, full-screen programs (vim, less) do not; the engine's `ORB_*` variables never
  reach it; a line with non-ASCII characters goes as UTF-8 in base64 (`Invoke-Expression`, same scope). A ```bash /
  ```powershell block in the chat gets «Pegar en el terminal», which only fills the input line. Ctrl+J and the project
  actions keep opening Windows Terminal / Warp / PowerShell in a window of their own; «Abrir en una ventana aparte»
  calls that same `app.openTerminal`. Terminals close with the engine.
- **Wording:** tone and vocabulary in [`WRITING-GUIDE.md`](../WRITING-GUIDE.md).

## Performance (3.8.1)

- **Lazy screens** (`main.jsx`): only the chats, a conversation and the start's master password screen are in the
  entry chunk. The other screens, Settings, the games and the tour are lazy chunks (`lazyScreen` in `lib/lazy.js`) that
  load in the background once the app is up (`loadTheRest`, on the phone too); Settings and the games mount the first
  time they open and then stay (`OnceOpened`). A failed load (a phone's browser gets the files from the PC over the
  network) is not kept: the `ErrorBoundary` recognises it (`isLoadError`) and shows «Sin conexión» with «Reintentar»,
  which makes the screen again (`retryLoads`; the same file with a query if the browser kept the failure; after two
  failed retries, a reload). Settings, the games and the tour have their own boundary: they close and say why.
- **Long lists:** messages (`.lazy-lines`, all but the newest twelve) and chat rows (`.lazy-row`) use
  `content-visibility: auto` (app.css); the chat list draws its first 40 rows with the screen and the rest while idle
  (`useGrowing` in `views/orb/inbox.jsx`). A conversation at its bottom stays there when its lines change height
  (`useAutoScroll` in `chat.jsx`: a `ResizeObserver` while the user has not scrolled up).
- **Fewer redraws:** `Markdown` is memoised on its text, a refetched conversation keeps unchanged lines, an agent's
  blocks compare by content and a chat row only redraws when what it shows changes (`keepSame`, `sameBlock`,
  `sameItem` in `lib/memo.js`, tested in `test/memo-ui.test.mjs`); the models' catalog stays the same object while it
  does not change (`useCatalog`). `chat:state` events are applied once per frame, or within 100 ms and on
  `visibilitychange` when the window draws no frames (`frameBatch` in `lib/batch.js`). Memoised dates move on at
  midnight and with a new time zone (`lib/clock.js`, `useDay`), and the date formatters are cached per language and
  zone.
- **Refreshes as changes:** the lists of every refresh (`tasks.list`, `conversations.list`, `sessions.list`,
  `projects.list` and the chat list's `inbox.list`) take an optional `since: { epoch, v }`. The engine keeps one `Feed`
  per kind of caller (this PC; linked devices in a small cache of their own, so they never push the PC's feeds out),
  method and the parameters that change the list, normalised (any other is ignored) (`src/shared/feed.mjs`,
  `src/engine/feeds.mjs`): each row carries the version at which its JSON
  last changed, and gone rows, the order of the keys and the rest of the reply (`meta`) carry one too, so a caller gets
  only what moved since its version (`{ feed, epoch, v, base, rows, gone?, order?, meta? }`), or the whole list (`full`)
  when it is new, of another engine run or too far behind. In a feed, `tasks.list` rows are compact (no brief, result,
  folders or approval fields: the task's screen reads `tasks.get`). Without `since` every method answers as before
  (older phone apps), and `applyFeed` takes a plain reply whole (an older PC). `store.js` applies the replies
  (`applyFeed` keeps the same array and row objects when nothing moved), runs one refresh and one chat-list load at a
  time (`oneAtATime`) and groups the engine's events (120 ms after the last one, at most 1 s after the first). Parity
  is tested in `test/feed.test.mjs` (random changes, callers far behind, the engine, the phone's path stripping).
- **Robot:** a still robot has no compositor layer and builds the visor's code rows only the first time it shows them
  (`orb.jsx`, app.css). Avoid `will-change`, `backdrop-filter` and blend modes on elements repeated in long lists.
- **Idle animations:** while anything on screen moves (the robot floating, its LED, the «orb» theme's clouds) the
  compositor draws every frame, so what matters is the GPU cost of each frame, not style work (≈1–5 ms/s of style
  recalculation at rest). The robot's moves are compositor-only: `transform`/`translate`/`opacity` on HTML elements
  (looking around and peeking move an HTML box around the face's SVG, not the eyes' group; the visor's glint moves with `translate`, not
  `left`); only blinking and talking scale the SVG eyes on the main thread. A robot out of view or in a hidden window
  pauses its animations and schedules no blinks or gestures (`useOnScreen`: one shared `IntersectionObserver`,
  `data-away`). The robot floats and its LED pulses only while something happens (3.8.1, H4e: thinking, talking, a
  mood, agents working, the pointer over it, hello, a random moment every 30–90 s): `data-float`/`data-glow`, set by
  `orb.jsx` and taken away at the end of the sway or pulse in progress (`animationiteration`), where both are at rest,
  so it never jumps. At rest it only blinks (a few main-thread frames every 3–6 s): with nothing else moving the
  compositor draws ~2–10 frames a second instead of 60. Avoid full-screen `backdrop-filter` over anything that moves. Since 3.8.8 the themes'
  backdrops are not CSS scenes (clouds, bands, grids) but one WebGL canvas per window (`components/scene.jsx`,
  `lib/shaders.js`): half resolution, at most 30 frames a second, nothing drawn while the window is hidden, one still
  frame under reduced motion; the themes' CSS has no animated backdrop left, only small pieces such as Retro's cursor.
  The indeterminate progress bar slides with `translate`, not `left`.
- **Measuring:** `scripts/medir.mjs` (start, memory, CPU at rest, scrolling smoothness; `--hidden` keeps the window
  offscreen via `ORB_HIDDEN_WINDOW=1`; `--profile <dir>` saves a trace, CPU profiles, the compositor's layers and a
  heap snapshot; `--big` uses a large workspace and times refreshes on the Tasks screen; `--anim <s>` / `--anim-only` measure
  idle animations: main thread, renderer and GPU CPU and, with `--profile`, frames per second and GPU ms per frame,
  plus the robot floating under the pointer with its dropped frames; `--quiet-scene` pauses the theme's backdrop; `--css <file>` adds a style sheet to try a variant on the same build; `--ui <json>` saves an interface setting first, e.g. another theme) and `scripts/medir-motor.mjs`
  (the engine alone: start, memory, call latency and the bytes of a refresh, whole and as feeds, also as a phone gets it).

## What 3.8.2 adds to the chat and the lists

Every piece below adds to what Orb had; where it overlaps, Orb's own flow stays as it was and the new one uses its
menus, texts, permissions and themes.

- **Chat bar** (`views/chat.jsx`, `views/session.jsx`): only the bell and pause stay on the bar; the rest lives in its
  ⋯ menu (in a direct conversation: folder, terminal, details, fork, «Continuar con otro agente», archive, mini-games
  and delete).
  The list's ⋯ (`views/orb/inbox.jsx › useOrbActions`) gains «Renombrar» (the same `renameChat` the title uses) and
  «Posponer»: `inbox.snooze` hides a chat (and its unread count) until a time; the scheduler's tick brings it back with
  a notice (`scheduler.mjs › wakeSnoozed`); pinning and muting are unchanged.
- **Attach any file** (`src/engine/host/attachments.mjs`, `src/shared/attach-kind.mjs`): up to 10 files of 100 MB per message,
  copied into `<chat folder>\.orb-adjuntos\<stamp>\` (never into core). Pictures go natively to Claude and Codex;
  videos become frames (ffmpeg: Orb's pinned copy, the PATH's, or a pinned download the first time); documents and
  PDFs, their extracted text; the rest, its path. On the PC an attached picture opens in the image viewer and a PDF in
  `components/file-viewer.jsx` (pdf.js, `attachments.read`, PC only). «Capturar ventana» attaches one frame of a window
  the user picks (`lib/window-capture.js`, `getDisplayMedia`; nothing reaches the agents' tools).
- **Dictation** (`lib/mic.js`): the microphone between the usage ring and «Enviar» focuses the box and opens Windows
  voice typing (Win+H sent by Rust). Hidden on phones; a linked PC browser keeps the browser's own dictation.
- **Usage**: «Recargar el uso» in the ring's panel (`usage.refresh`, at most every 20 s in the window and the engine)
  and the «Uso» page (`views/usage.jsx`, `usage.history`: cost and tokens by day, agent and model, and each plan window
  with an even-pace mark). Shared pieces: `components/usage-bits.jsx`.
- **Messages**: `$$…$$` formulas (KaTeX) and ```mermaid diagrams (`components/rich-blocks.jsx`, loaded on demand, no
  eval: the CSP is unchanged); Claude and Codex subagents as folding rows (`lib/session-blocks.js`); `/clear` and
  `/compact` typed alone (`src/shared/slash.mjs`); the cost line can be hidden (Ajustes › Apariencia) and the time shows
  on hover.
- **Tasks**: «Cambios» lists the files a finished task changed with their diff (`tasks.diff`, read only, between the
  task's undo checkpoints; `components/task-changes.jsx` and the expert mode share `components/diff-view.jsx`).
  Schedules can run once or always in the same chat (`src/domain/schedules/schedules.mjs`).
- **Search**: the sidebar search also finds tasks by content (`tasks.search`); Ctrl+K on the PC
  (`components/command-palette.jsx`, `lib/palette.js`) uses the same search (`lib/search.js`) plus Orb's places, and
  opens only when nothing else took the key (project actions, the whiteboard, a dialog).
- **«Cristal» theme** (`src/ui/themes/skins.css`, `src/ui/themes/pieces.css`): a theme of its own (light only, it takes
  the palettes like the default one) with a glass material and a shader backdrop. It no longer derives from the retired
  Profesional theme.
- **Music** (Windows only; `src/engine/host/music.mjs`, `lib/music.js`): ♪ in the sidebar's foot and one track per
  mini-game, off by default; CC0 tracks pinned by size and SHA-256 and downloaded the first time to
  `core\herramientas\musica`; it stops when Orb locks or the window hides.

## Tutorials and guided tour

- **Tutorials** (`src/ui/views/tutorials.jsx`, "Tutorials" menu entry, `tutorials` view): cards per topic
  (`TUTORIALS`: id, icon, number of lines and the screen its button leads to with `go()` / `openSettings()`), keyboard
  shortcuts and FAQs in collapsibles, all filtered by the search box (ignoring accents and case). The strings are in
  `src/shared/locales/{es,en}/help.mjs` (`help.tut.<id>.title`, `.l1…`, `.go`; `help.key.<n>.k/.v`; `help.faq.<n>.q/.a`).
  To add a tutorial: an entry in `TUTORIALS` and its keys in both languages.
- **Guided tour** (`src/ui/components/tour.jsx`): the full-body robot (the one from the notices) walks through the app
  step by step. `TOUR_STEPS` lists each step with the `data-testid` of the control it highlights (a `.tour-spot` ring
  whose shadow darkens the rest without catching clicks), the view to show first (`go(view)`) and its strings
  (`help.tour.<id>.title/.text`). Steps whose control is not on screen are skipped (the context ring before the first
  reply, the side menu in narrow windows). Keyboard: Esc skips, ← → move, Tab stays in the bubble. Without animations
  the robot stays still; in the "professional" theme only the bubbles show (styled with the help bubbles' `--tip-*`
  variables, in `app.css`).
- It starts on its own on the first open after the welcome (`Shell` in `main.jsx`, never on the phone) and from "Replay
  the guided tour" in Tutorials (`startTour()` in `store.js`). When finished or skipped, `endTour()` saves
  `ui.tourDone: true` in `orb.json` (`config.save`; `validateConfig` accepts it as a boolean), so it is per assistant
  folder and does not show again. Tests that create a folder with `createHome` write `ui.tourDone` before opening the
  app; `test/app.e2e.mjs` does see it start, advances one step and skips it.

## Settings

- **Window over the app** (`SettingsDialog` in `src/ui/views/settings/index.jsx`), with sections on the left (`SECTIONS`) and,
  at the bottom, the developer's GitHub and the version. It opens with `openSettings(section)` from
  `src/ui/lib/store.js`; `go('settings')` opens it too. On the phone there is no Settings ("This phone").
- **Appearance** (`src/shared/appearance.mjs`): `ui.skin` (predeterminado, cristal, orb, vaporwave, candy, retro),
  `ui.palette` (the six palettes, only for predeterminado and cristal), `ui.font` (the theme's own, system, Outfit),
  `ui.codeFont` and `ui.codeTheme`. `applyAppearance()` puts them on `<html>` as `data-skin`, `data-palette`, `data-font`,
  `data-code-font` and `data-code-theme`, and the CSS reads them: `src/ui/themes.css` and `src/ui/themes/` (see Look
  above; only the «orb» theme has the robot, `robotSkin`: the others wear the plain ORB·E mark, and the plain themes
  `plainSkin` have no backdrop and no decorative motion), `src/ui/fonts.css` (typefaces, latin and latin-ext only) and
  `src/ui/code.css` (code colors). Light, dark or system is `ui.theme`; «system» follows Windows, and a theme that exists
  in one mode only (Retro dark, Glass light) ignores it without overwriting it. A phone or a linked browser wears only
  «orb» or the default (`phoneSkin`). The previous options for density, chat width, text size, accent and contrast, and the
  theme made of your own colours, are not offered any more; the zoom of the whole interface stays. Highlighting (`src/ui/lib/highlight.js`, highlight.js with
  common languages) is loaded the first time it is needed (`use-highlight.js`).
- **Window without the Windows title bar:** `titleBarStyle: 'hidden'`. Minimize, maximize and close are drawn by
  `src/ui/components/window-controls.jsx` (the `window_act` command and the `app:window-state` event:
  `src-tauri/src/window.rs`, `src/ui/lib/tauri-bridge.js`), styled per theme in `themes.css` (`.win-control`); `--wco-inset` is their fixed width with
  `html.has-win-controls`. The top bars (`.app-titlebar` in `app.css`) move the window
  (double-click: maximize) and leave room for the buttons (`--wco-inset`, `.wco-pad`). Without the Windows bar there is
  no menu bar (the old `ui.menuBar` setting is dropped when orb.json loads); its shortcuts (zoom, Ctrl+J, F11) live in
  `tauri-bridge.js`. F5 reloads the window (`main.jsx`, `lib/reload.js`): the engine keeps running and the unsent text
  of the message boxes comes back on the same screen.
- **Contribute and More apps** (`src/engine/host/feedback.mjs`, `app.feedbackSend` / `app.moreApps`, in the engine because the
  window does not go out to the internet; the screenshot and the picked files come from the app): the developer's PayPal; feedback via FormSubmit (to the developer's inbox) with up to 3 PNG/JPEG
  screenshots of the window or from files; and the other apps with their latest version from GitHub Releases.

## Whiteboard fonts (3.8.8)

The whiteboard (Excalidraw) never asks the internet for its drawing fonts. `src/ui/lib/excalidraw-assets.js` sets
`window.EXCALIDRAW_ASSET_PATH` to the app's own `excalidraw/` folder and must be the first import of any module that loads
Excalidraw (ES imports are hoisted, so a plain statement after the import would run too late). Two plugins of
`vite.config.mjs` do the rest: `orb-excalidraw-fonts` copies every font of `@excalidraw/excalidraw` (Xiaolai too, the
fallback of every family) to `excalidraw/fonts` in the build, and `orb-excalidraw-no-cdn` removes the `https://esm.sh/...`
address that Excalidraw always appends to the places it tries for each font. The toolbar is Orb's own
(`src/ui/components/wb-controls.jsx`), and a project's whiteboard keeps one general note, beside the drawing, that reaches
the assistant inside `PIZARRA.md` as the user's own words.
