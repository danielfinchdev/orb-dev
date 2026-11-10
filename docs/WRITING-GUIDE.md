# App copy

How to write the text people see in Orb (`src/shared/locales/es` and `en`). Spanish is written first; English is
translated afterwards with the same tone. The examples below are the Spanish originals, since that is the source copy.

## Names

- **Orb**: the program (`Orb.exe`).
- **Orb·e**: the robot. It is its default name; users can change it, so strings use `{name}`.
- **Orb.dev**: the development project (this repository). It does not appear in the app.
- Title: «Orb·e: Tu director de bolsillo» / «Orb·e: Your pocket director».

## Tone

- Professional, clear and neutral, like a commercial app. Informal "you" (tuteo in Spanish).
- Copy says what something does or what happened and, if needed, what to do. It does not explain why it is built that
  way or how it works inside: that goes in [`ARCHITECTURE.md`](ARCHITECTURE.md).
- Short, standard labels. Buttons with an infinitive verb («Guardar», «Añadir conector»; in English, plain imperative:
  "Save", "Add connector"). Short states («Completada», «En curso», «Pendiente de aprobación»).
- Descriptions under a setting: one line.
- Errors: «No se pudo… : {detalle}», «Falta…», «… no es válido».
- No exclamation marks, no emojis, no slang and no buzzwords («potente», «sin esfuerzo», «agéntico»…).
- Nothing inaccurate: never promise what the app does not guarantee.
- The only exception: the phrases in the install bar («Tomando un café», «Regando tus plantas virtuales»…).

## Words

| Say | Don't say |
|---|---|
| PC | equipo (confused with the team of agents) |
| Orb | el motor (the engine) |
| instrucciones (what each agent receives) | encargo |
| Eliminar | Borrar |
| Claro / Oscuro / Predeterminado del sistema | Día / Noche / Como Windows |
| notificaciones | avisos |
| En curso | Trabajando, En marcha |
| Completada | Hecha |

Common technical terms are kept as they are: rama (branch), commit, push, pull request, MCP, token, Tailscale.
