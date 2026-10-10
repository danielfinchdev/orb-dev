# Textos de la app

Cómo se escriben los textos que ve quien usa Orb (`src/core/locales/es` y `en`). Se escribe primero el español; el inglés
se traduce después con el mismo tono.

## Nombres

- **Orb**: el programa (`Orb.exe`).
- **Orb·e**: el robot. Es su nombre por defecto; quien usa la app puede cambiarlo, así que en los textos va `{name}`.
- **Orb.dev**: el desarrollo (este repositorio). No aparece en la app.
- Título: «Orb·e: Tu director de bolsillo» / «Orb·e: Your pocket director».

## Tono

- Profesional, claro y neutro, como el de una app comercial. Tuteo.
- Los textos dicen qué hace algo o qué ha pasado y, si hace falta, qué hacer. No explican por qué está hecho así ni cómo
  funciona por dentro: eso va en [`FUNCIONAMIENTO.md`](FUNCIONAMIENTO.md).
- Etiquetas cortas y estándar. Botones con verbo en infinitivo («Guardar», «Añadir conector»). Estados cortos
  («Completada», «En curso», «Pendiente de aprobación»).
- Descripciones bajo un ajuste: una línea.
- Errores: «No se pudo… : {detalle}», «Falta…», «… no es válido».
- Sin exclamaciones, sin emojis, sin coloquialismos y sin palabras de moda («potente», «sin esfuerzo», «agéntico»…).
- Nada inexacto: no se promete lo que la app no garantiza.
- La única licencia: las frases de la barra de instalación («Tomando un café», «Regando tus plantas virtuales»…).

## Palabras

| Se dice | No se dice |
|---|---|
| PC | equipo (se confunde con el equipo de agentes) |
| Orb | el motor |
| instrucciones (lo que recibe cada agente) | encargo |
| Eliminar | Borrar |
| Claro / Oscuro / Predeterminado del sistema | Día / Noche / Como Windows |
| notificaciones | avisos |
| En curso | Trabajando, En marcha |
| Completada | Hecha |

Los términos técnicos habituales se mantienen: rama, commit, push, pull request, MCP, token, Tailscale.
