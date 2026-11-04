# Orb design system

The rules every screen of Orb follows: the PC window, the phone (browser and Android app) and the Bots mode. It is
the reference for building UI and the checklist for reviewing it. When this document and a screen disagree, the screen
is the bug. When this document is silent, follow the closest existing pattern and add the rule here.

Related: [WRITING-GUIDE.md](WRITING-GUIDE.md) (copy), [LEARNINGS-3.5.md](LEARNINGS-3.5.md) (where the motion and touch
rules come from), `src/ui/app.css` (tokens), `src/ui/themes.css` (visual themes), `src/ui/glass.css` (Android glass).

## 1. Principles

1. **For the average person, not the developer.** Orb is used by people who do not know what a token, a branch or an
   MCP is. Every screen is understandable without reading documentation. Technical detail lives one level deeper
   (a details row, God mode, Ajustes › Avanzado), never on the first screen.
2. **Coherent and cohesive.** The same need is solved with the same component everywhere (section 4). Same words for
   the same thing (section 7). Things that look the same behave the same and live in the same place.
3. **Restraint.** Every element earns its place. One primary action per view. No decoration that competes with content.
   Prefer removing a control to explaining it. Simplicity is not minimalism: hiding the core action to look clean is a
   failure too.
4. **Only the necessary helper text.** Not none, not everywhere. A subtitle or hint is allowed when, without it, an
   average user would make a wrong choice or not understand the consequence (privacy, cost, something irreversible).
   One line. Never repeat what the title or the control already says; never explain the same thing twice on a screen.
5. **Professional tone.** Clear, calm, polished copy, like a commercial app. Informal "tú" in Spanish, never colloquial,
   never imitating the owner's chat style (section 7).
6. **Purposeful motion.** Motion explains (where something came from, what changed) or gives feedback. Frequent actions
   get little or none. Nothing is animated "because it looks nice" (section 6).
7. **Native feel on touch.** Instant press feedback, 44 px targets, no hover-only affordances, safe areas respected
   (section 6.3).
8. **Accessible by default.** WCAG AA contrast (text 4.5:1, large text and UI parts 3:1), focus rings on every control,
   accessible names on icon buttons, reduced motion and reduced transparency honoured.
9. **Calm activity.** While an agent or bot works, one line ("Revisando los enlaces · 12 s") that can expand; never a
   stream of tool calls. Answers read on a phone screen first.

## 2. Layout map: what lives where

### 2.1 PC window

```
┌──────────────┬──────────────────────────────────────────────────────────┐
│ Sidebar head │ Top bar: [title / clock]   [center: context]  [icons][—▢×]│
│ ORB·E ☀ ⇤    ├──────────────────────────────────────────────────────────┤
│ [Orb | Bots] │                                                          │
│ [+ Nuevo]    │                  Screen content                          │
│ [Buscar]     │                                                          │
│ Nav          │                                                          │
│ Sections     │              (chat: messages + composer)                 │
│ (lists)      │                                                          │
├──────^───────┤                                                          │
│ icons  bug v │                                                          │
└──────────────┴──────────────────────────────────────────────────────────┘
```

- **Sidebar head**: wordmark (or assistant name), day/night, fold sidebar. Nothing else. The current user is **not**
  here.
- **Mode switch** `Orb | Bots` below the head. Then the mode's primary action (`Nuevo chat` / `Nuevo bot`), search, the
  navigation and the collapsible lists (Por aprobar, Proyectos, Conversaciones / Tus bots, Grupos).
- **Sidebar footer** (as in 3.5, owner's decision): a small arrow on the separator line folds/unfolds it; folded, one
  row of icon buttons with tooltips `Ajustes · Agentes · Memorias · Tutoriales`, and on the right the bug (report a
  problem) and the version; unfolded, the same as a list with names. No separate user block. **With 2+ users** the gear
  shows the current user's initial and opens a small menu upwards (header: avatar, name, `Admin` badge): `Ajustes`,
  `Mi perfil`, `Cambiar de usuario`, separator, `Bloquear`. With one user the gear opens Ajustes directly. A linked
  browser with the PC layout has no Ajustes: there the initial is the first icon and its menu has `Mi perfil` and
  `Bloquear`.
- **Top bar** (56 px): left, the screen title (chat: the clock); center, the context (chat: the conversation title and
  its project, or the working project); right, at most three icon buttons of that screen, then the window controls.
  A screen's primary action may be a labelled button at the right (`Nuevo bot`, `Nuevo proyecto`); secondary actions go
  into an overflow menu (`⋯`) when there are more than two.
- **Content**: max width 48 rem for reading screens (chat), list + detail for Tareas and Proyectos, card grid for Bots.
- **Floating extras**: notifications (top center, one at a time, under the bell afterwards), the companion robot (only
  on Tareas, Proyectos, Memorias), the guided tour.

### 2.2 Chat composer (all chats: assistant, direct agent session, bot)

```
┌────────────────────────────────────────────────────────────────┐
│ [▢ Elegir proyecto ⇕] [contextual action slot]                 │  top row
│ Escribe a Orbe…                                                │  text
│ [✳ Claude · Sonnet 5.5 ⌄] [🧠] [⚙ ●]              [62 %] [🎤] [↑]│  bottom row
└────────────────────────────────────────────────────────────────┘
```

- **Top row**: the project picker, and immediately to its right **one contextual action slot** (`ContextSlot`). The
  slot shows at most one suggestion, chosen by priority:
  1. `Compactar` when the conversation's context use is at or above 70 % (assistant lanes: renew/compact the lane;
     direct sessions: the agent's own compaction). Soft button with an icon; tooltip says what it does and that nothing
     of the conversation is lost from the history.
  2. `Iniciar test` on a new chat at the first opening of the day, until the user writes (existing rule).
  3. Empty otherwise. Future suggestions plug into the same slot with their own priority; never two at once.
  The slot appears with a 150 ms fade + 2 px rise and leaves with a fade; it never pushes the text field.
- **Bottom row**, left to right: the **model picker** (agent icon + model name); the **reasoning button**, a brain icon
  button (`icon-sm`, ghost) opening a menu `Bajo · Medio · Alto · Extra` with only the levels the chosen model
  supports, the current one ticked, and a tooltip per option with typical tasks and a relative usage cost
  ("Uso bajo / medio / alto / muy alto"; no invented numbers); the **orchestrator**: an icon (Workflow) + a small switch,
  only on a new conversation, with a tooltip that explains it. Right side: the context meter (only when known),
  dictation (Android), stop (while busy), send.
- On the phone the bottom row keeps one line: model picker shows the model only, brain and orchestrator are icons.
- The bot chat uses the same component without the project picker, brain or orchestrator.

### 2.3 Settings (dialog on the PC, screens on the phone)

Six sections. Each section is a vertical stack of cards; each card = title, at most one line of description, controls.

| Section | Icon (lucide) | Contents |
|---|---|---|
| General | `SlidersHorizontal` | Assistant (name, your name, language), working folder, Apariencia (theme, day/night, motion, font), Actualizaciones |
| Magic Link | `Radar` (wifi/radar style) | Usuarios (admin only, 2+ users or to add one), Dispositivos (link a device with QR, linked devices), Orbs enlazados |
| Agentes y uso | `Cpu` | Agents and accounts, tasks and spending (the "ahorro ↔ uso" slider), conversation reset, test of the day |
| Datos | `DatabaseBackup` | Backups, recovery code, restore, move Orb (admin only) |
| Avanzado | `Wrench` | Herramientas (browser, MCP, Android), God mode, Monitoreo |
| Acerca de | `Info` | Version, Contribuye (support, report a problem), Más aplicaciones, licence |

`Mi perfil` is **not** a settings section: it opens from the initial in the sidebar footer and from the phone's
menu ☰. With a single user, profile fields (your name, language) live in General.

**Usuarios screen rules**: one explanation per screen (the section subtitle, or the card description, not both); per
user: avatar, name, role badge (`Admin` or nothing; never `Dueño`/`Persona`), one summary line ("2 dispositivos · visto
hoy") and at most three counters that matter (bots, chats, proyectos) with correct plurals (`Intl.PluralRules`); no
internal words ("turnos"); actions in an overflow menu (Editar, Permisos, Quitar PIN, Pausar bots **or** Reanudar bots
depending on state, Eliminar in red after a separator).

### 2.4 Phone (browser and Android app)

```
┌───────────────────────────┐   ┌────────────────────┐
│ ☰ Title           [🔔][⏸] │   │ robot Orbe       ✕ │  drawer ☰, from the left
│                           │   │ [ Orb  |  Bots ]   │
│        content            │   │ (A) Ana  Mi perfil │  2+ users, then Bloquear
│                           │   │ Programadas …      │  the mode's other screens
│ ╭───────────────────────╮ │   │ AJUSTES            │
│ │ Orbe Chats Tareas Proy│ │   │ Este móvil, Magic  │
│ ╰───────────────────────╯ │   │ Link, Modo oscuro  │
└───────────────────────────┘   └────────────────────┘
```

- **No mode switch on screen** (owner's decision). Every screen's bar starts with the menu ☰ (top left, 40 px target),
  then the title and at most two icon buttons on the right.
- **Drawer ☰** (`components/mobile-menu.jsx`; on Android a glass sheet from the left): the robot, the assistant's name
  and close; `Orb | Bots`; with 2+ users the user card (avatar + name → `Mi perfil`, then `Bloquear`); the current
  mode's other screens (Orb: Programadas, Pizarra, Memorias, Tutoriales; Bots: Grupos, Memoria, Servidor, Ajustes de
  bots); group `Ajustes`: Este móvil, Magic Link, Modo oscuro. Any choice closes it.
- **Tabs**: four, the current mode's main screens. Orb `Orbe · Chats · Tareas · Proyectos`; Bots
  `Chat · Bots · Recordatorios · Casa`. Badges: a number for things waiting on the user (dark text on `warning`), a dot
  for activity.
- PC-only things (Ajustes dialog, Agentes, God mode, games, themes) never appear on the phone.
- Dialogs become bottom sheets on the phone (Android glass) and full-width dialogs in a phone browser.

### 2.5 Next: Orb as a messaging app (approved direction, mockups only)

The approved direction for the next version: the whole app works like a messaging app with two zones, **Bots**
(everyday tasks) and **Orb** (programming). The terminal stays a terminal. The mockups are in
`docs/diseno/maquetas/mensajeria.html` (`node scripts/maquetas.mjs` saves them as screenshots); until it is built,
sections 2.1–2.4 describe the shipped app.

- **Desktop and wide browser, three panes.** Left: the head and `Orb | Bots` as today, search + new (bot or chat),
  the zone's other places as four labelled icons (Bots: Recordatorios, Casa, Memoria, Servidor; Orb: Tareas,
  Proyectos, Programadas, Pizarra), then the chat list; the sidebar footer exactly as in 2.1. Center: the conversation.
  Right: the info panel, opened by clicking the name in the chat header and closed with ✕.
- **Chat list.** Bots: pinned bots as big avatars on top only (not repeated below; chief with a star badge, unread dot), then user-made
  sections («Trabajo», «Casa»…, collapsible, «Nueva sección») and «Sin asignar»; each row avatar, name, last message
  (a forward icon when one bot wrote to another), time and unread dot. Orb: chats with Orbe grouped by project, each
  row with its latest progress (a live task, «Esperando tu aprobación», «Completada · 4 archivos»).
- **Conversation.** Bubbles with time; day separators; inline system lines for routines and reminders; approval cards
  with Rechazar / Aprobar; Orb: a running task as one live line, and the wave-1 composer.
- **Info panel / profile.** Bot: big avatar, name, role, Editar; Cerebro, Herramientas, Apps conectadas, Rutinas,
  Biblioteca; Notificaciones switch with one line; Pausar, Compartir, Eliminar (red, last). Orb chat: Proyecto, Modelo,
  Razonamiento, Orquestador; «Tareas de este chat» with their state; Archivos, Exportar, Eliminar. Projects and groups
  get the same kind of profile.
- **Phone.** Opens on the zone's chat list; ☰ top left (zone switch, user, Ajustes and the places that are not tabs);
  three tabs per zone (Bots: Chats · Recordatorios · Casa; Orb: Chats · Tareas · Proyectos); a floating button to
  create. Android in the glass language: the chat header is a glass pill over the colour field.
- **Bot avatars** (`docs/diseno/maquetas/avatares.js`). Original art: soft rounded bodies (nube, gota, judía, mochi,
  flor, estrella, canto, gominola, bollo, corazón, hoja, cápsula) in ten bright, nearly flat colours with a small
  highlight, and a simple dark face drawn for each body (dots, tall ovals, big glossy eyes, wide beans; spacing, blush
  and a tiny smile vary), so the set is Orb's own and cute rather than robot-like. Deterministic SVG
  from shape + colour (+ seed for blink timing). States: idle (breathing, random blink, looking around), new message
  (one bounce), working (wiggle, eyes up), paused (closed eyes, slow breathing, a «z»), approved (hop, smiling eyes).
  Reduced motion or low power: static. Chosen at creation (big live preview, 12-shape grid, 10-colour row, name,
  «Crear bot»). The chief is marked only by a star badge on its avatar. Never emoji or third-party characters.

## 3. Tokens

All values come from CSS variables in `app.css` (light `:root`, dark `.dark`), redefined per visual theme in
`themes.css`. Never hard-code a colour in a component; use the role.

### 3.1 Spacing (4 px grid)

`2 · 4 · 6 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 56` px (Tailwind `0.5 1 1.5 2 3 4 5 6 8 10 14`).
- Inside a control: 6–12. Between related controls: 8. Between cards: 16. Screen padding: 20 (PC), 16 (phone).
- Section gap inside a card: 16; card padding 20 (PC), 16 (phone).

### 3.2 Radii

`--radius` = 12.8 px. Derived: `sm` 8.8, `md` 10.8, `lg` 12.8, `xl` 16.8, `2xl` 22.8.
- Controls (button, input, select): `lg`. Small controls (`sm`, `xs`): `md`.
- Cards and list groups: `xl`; dialogs and the composer: `2xl` (16–24 px). Pills, chips, avatars, tab capsules: full.
- Android glass: controls 12, cards 22, composer 26, sheets 28, tab bar full.

### 3.3 Typography

Font: Outfit (UI), Geist Mono (code, paths). Body 14.5 px / 1.5.

| Role | Size / weight / tracking | Use |
|---|---|---|
| Display | 24 px / 500 / -0.01em | Chat greeting, wizard question |
| Title | 16 px / 500 | Top bar title, dialog title (18 px) |
| Large title (phone glass) | 22 px / 600 / -0.015em | Phone screen bar |
| Card title | 15 px / 500 | Card heading |
| Body | 14.5 px / 400 | Text, messages |
| Control | 13–14 px / 500 | Buttons, menu items |
| Caption | 12–13 px / 400 muted | Descriptions, hints, meta |
| Micro | 11 px / 500–600 | Section labels (uppercase only in sidebar lists), tab labels, badges |

Numbers that change (counters, times, percentages) use `tabular-nums`. Inputs are 16 px on touch screens. Line length
for reading text ≤ 65 ch.

### 3.4 Colour roles

| Role | Light | Dark | Use |
|---|---|---|---|
| `background` / `foreground` | near-white / ink | near-black / near-white | Page and text |
| `card`, `popover` | white | raised dark | Surfaces |
| `primary` | periwinkle blue | lighter blue | Primary action, selection, links, focus |
| `secondary`, `muted`, `accent` | soft greys with a blue hue | | Secondary buttons, quiet fills, hover |
| `muted-foreground` | grey ≥ 4.5:1 on background | | Captions, meta |
| `success`, `warning`, `info`, `destructive` | | | States only; never decoration |
| `border`, `input`, `ring` | | | Hairlines, field borders (≥ 3:1), focus |
| `bubble` | | | User's chat bubble |

Status colours as text sit on their own 12–18 % tint (badges). White text on `warning` is forbidden (fails AA): use dark
text. Each visual theme must keep these contrasts (checked by `contraste-temas`).

### 3.5 Elevation

| Level | Shadow | Use |
|---|---|---|
| 0 | none, hairline border | Lists, inline groups |
| 1 | `shadow-xs` | Cards, inputs, outline buttons |
| 2 | `shadow-sm` → `shadow-md` on focus | Composer |
| 3 | `shadow-md` | Menus, selects, popovers, tooltips |
| 4 | `shadow-xl` + scrim `black/45` | Dialogs, sheets |

### 3.6 Blur

- PC: one backdrop-filter for the scene pane (`.scene-frost`) and the translucent top bar; menus and dialogs are solid.
  Never one blur per message or per card.
- Android glass: see section 8 (budget: the tab bar plus one transient layer).

## 4. Components: one canonical answer per need

All in `src/ui/components/ui/` unless noted. Do not build a one-off when one of these fits.

| Need | Component | Rules |
|---|---|---|
| Action | `Button` (`default` primary, `outline`, `secondary`, `ghost`, `soft`, `danger`, `link`) | One `default` per view or card. Destructive confirm uses `destructive`; a destructive entry point uses `danger`. Infinitive verb label. Loading: spinner inside, label stays, button disabled. |
| Icon-only action | `Button size="icon-sm"` + `BubbleTip` | Always `aria-label` and a tooltip with the same title. Ghost by default. 32 px (PC), 40–44 px target (phone). |
| Tooltip | `BubbleTip` (title + optional one-line text) | Only informs, never holds controls. Not the only way to learn something essential. |
| Rich hover card | `RichTip` | Sidebar conversation preview only. |
| On/off | `Switch` | Applies at once (no Save). Label to the left on rows, to the right inline. **Small switch** (`size="sm"`, 28×16, thumb 12) for inline toolbars like the composer; regular elsewhere. |
| Several choices | `Checkbox` / `DropdownMenuCheckboxItem` | |
| One of few (≤ 4, visible) | Segmented `TabsList` or option cards (wizard) | |
| One of many | `Select` (form) or `DropdownMenu` (toolbar) | |
| Menu of actions | `DropdownMenu` | Grows from its trigger. Destructive item last, after a separator, red. |
| Ask / confirm | `confirm()` / `form()` (`dialogs.jsx`) on `Dialog` | Confirm only irreversible or costly actions. Title is a question or the action; buttons say the verb ("Eliminar", not "Sí"). |
| Grouped settings | `Card` + `CardHeader/Title/Description/Content` | One description line. Save button only when changes are not applied instantly; then one per card, at the end. |
| List of things | Rows in a `Card` or a list group (`bg-card/80 rounded-2xl border p-2`) | Row: icon or avatar, title, one meta line, trailing status or chevron. Actions on hover (PC) or in an overflow menu (both). |
| Nothing to show | `Empty` (icon, title, one line, optional action) | Says what will appear here and how to get it. One empty state per screen, not one per pane. |
| Something happened | `notify()` (sonner) | One at a time, under the bell afterwards. Errors stay until closed. |
| Status label | `Badge` (`success`, `warning`, `destructive`, `info`, `secondary`) | Short state words from WRITING-GUIDE ("En curso", "Completada"). |
| Person | `PersonDot` (initials) | `shrink-0`. Same size per context: 20 (lists), 28 (menus), 40 (cards). |
| Bot | Bot avatar (emoji/icon in a soft circle) | |
| Agent | `AgentIcon` | Brand marks of the agents only next to their name. |
| Progress | `Spinner` (unknown), bar (known %) | |
| Page frame | `PageHeader` + `PageBody` (`page.jsx`) | |
| Text field | `Input`, `Textarea`, `Field` (label + control + hint) | Label above. Placeholder is an example, never the label. |
| Mode | `ModeSwitch` | Only `Orb | Bots`. |

## 5. Iconography

- One family: **lucide-react**, stroke 2 (1.75 at 20 px+), sizes 14 (inline, small buttons), 16 (buttons, menus), 20
  (tabs, headers), 24 (empty states inside a 44 px tile).
- One icon = one meaning across the app (e.g. `FolderKanban` = projects, `ListTodo` = tasks, `Brain` = reasoning,
  `Workflow` = orchestrator, `Radar` = Magic Link, `Bot` = bots). No two meanings for one icon, no two icons for one
  meaning.
- Icons support a label; they replace it only for universal actions (close, send, search, more, day/night) or in dense
  toolbars where a tooltip names them.
- Coloured icons only for brands (agents) and states. Navigation icons are `muted-foreground`, `primary` when active.
- Emoji only as user content (bot avatars chosen by the user), never as UI chrome.

## 6. Motion and touch

### 6.1 Should it animate?

| Frequency | Motion |
|---|---|
| Hundreds a day (typing, keyboard shortcuts, switching chats) | None |
| Tens a day (hover, tabs, mode switch, toggles) | ≤ 150 ms, colour/opacity, or a short slide of a marker |
| Occasional (menus, dialogs, sheets, toasts, the slot) | 150–320 ms, enter/exit |
| Rare (first run, celebrations, the robot) | May delight; still interruptible |

### 6.2 Values

- Curves: `--ease-out` `cubic-bezier(0.23, 1, 0.32, 1)` for enter/exit; `--ease-in-out` for movement on screen;
  `--ease-drawer` `cubic-bezier(0.32, 0.72, 0, 1)` for sheets. Never `ease-in`.
- Durations: press 90–160 ms; tooltip 125–200; menu 150–250; dialog 200; sheet 320. UI stays under 300 ms except sheets.
- Enter from `scale(0.95–0.97)` + transparent, never from `scale(0)`. Menus grow from their trigger; dialogs from the
  centre; sheets rise from the bottom edge and leave the same way.
- Only `transform` and `opacity` (and colours). No `transition: all`.
- Reduced motion (system, or Apariencia «mínima»): fades stay, slides and scaling go.

### 6.3 Touch

- Targets ≥ 44×44 px (the visible shape may be smaller; pad the hit area).
- Feedback on press (`:active`, scale 0.97), not on release. Hover styles only for real pointers.
- No tap highlight, no text selection on controls, `touch-action: manipulation`.
- Respect `env(safe-area-inset-*)`. Inputs 16 px. Right keyboard (`inputmode`, `enterkeyhint`, no autocorrect on codes).
- No hover-only features: anything shown on hover on the PC is also reachable by tap (overflow menu).

## 7. Copy

Full rules in [WRITING-GUIDE.md](WRITING-GUIDE.md). The essentials for reviewers:

- Spanish first, "tú", neutral-professional. English equally polished, not literal.
- Buttons: infinitive verb + object if needed ("Guardar", "Añadir usuario"). States: short ("En curso").
- No exclamation marks, emojis, slang, buzzwords, or internal names (no "lane", "turno", "WS", "engine", "taller" in
  UI copy unless it is the feature's public name).
- Correct plurals always (`1 bot`, `2 bots`; `1 grupo`, never `1 grupos`).

### Names (fixed)

| Concept | es | en |
|---|---|---|
| The program | Orb | Orb |
| The robot / assistant | Orbe (default name, user can change) | Orbe |
| People using one Orb | Usuarios / usuario | Users / user |
| The person who administers | Admin | Admin |
| The bots mode and items | Bots / bot | Bots / bot |
| Linking devices and Orbs | Magic Link | Magic Link |
| Expert view | God mode | God mode |
| PC health | Monitoreo | Monitoring |
| Agent instructions | instrucciones | instructions |
| Delete | Eliminar | Delete |

Never: Dueño, Persona/Personas (in UI), equipo (for the PC), encargo, Borrar.

## 8. Android glass (the Android app only)

An original translucent-material language for the Android app (`vite build --mode android`): layered surfaces that let
a soft colour field show through, light catching their top edge, large radii and a floating tab bar. It uses no platform
assets, fonts or icons: Outfit and lucide as everywhere else. Implementation: `src/ui/glass.css` (all rules under
`html.glass`) and `src/ui/lib/glass.js`, loaded by `main.jsx` only when `import.meta.env.MODE === 'android'`; the PC and
browser bundles do not contain it.

### 8.1 Materials

| Material | Light | Dark | Blur | Used by |
|---|---|---|---|---|
| Colour field | three soft pools (periwinkle, lilac, sky) over `background` | indigo, plum, navy | — | Behind every screen (static) |
| Thin | white 58 % | slate 56 % | 22 px + saturate 180 % | Tab bar |
| Regular | white 66 % | slate 60 % | none (in flow) | Cards, list groups, composer, mode switch |
| Thick | white 86 % | slate 86 % | 22 px + saturate 180 % | Sheets, menus, selects |
| Solid | white 97 % | slate 97 % | — | Selected segment, fields |

Every glass surface has: a 1 px inner top highlight (`--glass-edge`), a hairline outline (`--glass-stroke`) and a soft
coloured shadow; floating ones a deeper shadow. **Never glass on glass**: what sits inside a card uses hairlines only.

### 8.2 Components

- **Drawer ☰**: thick material with blur from the left edge, radius 28 on its right corners, inner groups in regular
  material; while open it is the one transient blurred layer.
- **Floating tab bar**: inset 12 px from the sides and 10 px above the safe area, 62 px tall, full radius, thin
  material with blur. Active tab: primary colour and a 14 % primary capsule behind the icon. Labels 10.5 px / 600.
  Count badges with dark text on `warning`.
- **Top**: the screen bar has no surface: ☰, then a large title (22 px / 600) on the field (inside the drawer the
  `Orb | Bots` switch is a regular-material capsule with a solid sliding thumb); content scrolling under it fades over 14 px instead of being cut.
- **Cards**: regular material, radius 22, no blur.
- **Composer**: regular material, radius 26, focus = 1.5 px ring at 55 %; it sits above the tab bar.
- **Sheets**: every dialog on the phone is a bottom sheet: full width, radius 28 at the top, a 36×5 grabber, thick
  material with blur, a dimming scrim without blur, buttons 44 px high. Rises in 320 ms with `--ease-drawer`, leaves the
  same way.
- **Menus and selects**: thick material with blur, radius 16, items 40 px.
- **Press**: scale 0.96 + brightness 0.96 in 90 ms on press (feels physical); back with ease-out. Real haptics
  (Capacitor Haptics) only for commit moments (approve, send) when added; never on every tap.

### 8.3 Performance budget (Android WebView)

- `backdrop-filter` only on layers floating over moving content: the tab bar, plus **one** transient layer (sheet, menu
  or select). Never on in-flow surfaces: over a static field a blur looks the same and costs a repaint.
  `test/glass.e2e.mjs` fails if more than one blurred layer is on screen at rest, or more than two with a menu or sheet.
- The colour field is static gradients; the animated scene and its frosted pane are off.
- Blur radius ≤ 22 px (under the 20–24 px range where WebViews start dropping frames when animating).

### 8.4 Fallbacks and accessibility

- `html.glass-lite` (set by `glass.js` on phones with ≤ 4 cores, ≤ 3 GB memory or data saver), the system's
  `prefers-reduced-transparency: reduce`, `prefers-contrast: more`, or a WebView without `backdrop-filter`: no blur at
  all and materials at 90–100 % opacity (high contrast: solid surfaces with a visible border).
- Reduced motion or «mínima»: sheets fade in place instead of rising.
- Text on glass keeps ≥ 4.5:1 (labels are 66–70 % foreground, never lighter); the field pools are light enough in light
  mode and dark enough in dark mode that no material drops below that.

### 8.5 Screenshots

`node test/glass.e2e.mjs` builds the Android page, serves it as a linked phone (390×844) and writes
`test-results/diseno/glass-{light,dark}-*.png`: chat, project menu, chats, new chat, tasks, task, sheet, projects, menu ☰,
bot chat, bots.

## 9. Reviewer checklist

Use it on every UI change. A "no" is an issue; P1 if it breaks a principle for many users, P2 if visible and
confusing, P3 polish.

**Placement and structure**
- [ ] Each element is where section 2 says (sidebar footer as in 3.5, with the initial for 2+ users; settings in
      their six sections; composer rows as specified; phone ☰ drawer and four tabs).
- [ ] One primary action per view/card; secondary actions are quieter or in an overflow menu.
- [ ] Nothing is explained twice on the same screen; helper text is present only where a wrong choice is likely.
- [ ] PC-only features do not appear on the phone; hover-only features have a tap path.

**Components and tokens**
- [ ] The canonical component from section 4 is used (no one-off buttons, switches, menus, empty states).
- [ ] Spacing on the 4 px grid; radii and type sizes from section 3; colours by role, no literals.
- [ ] Icons from lucide, one meaning each, with accessible names and tooltips when alone.
- [ ] Empty, loading, error and very long content states exist (long names truncate with a tooltip, numbers use
      `tabular-nums`, counts pluralise).

**Copy**
- [ ] Professional "tú" tone, no colloquialisms, no internal jargon, no exclamation marks or emojis.
- [ ] Fixed names from section 7 (Usuarios, Admin, Orbe, Bots, Magic Link); English locale reviewed too.
- [ ] Buttons are verbs; errors say what failed and what to do.

**Motion and touch**
- [ ] Motion has a purpose and follows 6.1–6.2 (no `ease-in`, no `transition: all`, under 300 ms, from 0.95+).
- [ ] Reduced motion keeps fades only.
- [ ] Touch targets ≥ 44 px on the phone; press feedback on `:active`; safe areas respected; inputs 16 px.

**Accessibility**
- [ ] Text ≥ 4.5:1, UI parts ≥ 3:1, in light and dark and in each visual theme.
- [ ] Visible focus ring on every control; keyboard path works; dialogs trap and return focus.

**Android glass (Android build only)**
- [ ] Blur budget respected (tab bar + one transient layer); no glass on glass.
- [ ] Fallbacks work (lite, reduced transparency, high contrast); screenshots regenerated in light and dark.
