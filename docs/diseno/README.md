# Diseño de Orb.dev

Aquí van las referencias visuales y los diagramas de cada funcionalidad, para implementarlas.

| Qué | Dónde | Formato |
|---|---|---|
| Una funcionalidad concreta (qué quieres, cómo se ve, cuándo está terminada) | Un **issue** en GitHub con la plantilla «Funcionalidad» | Texto, con capturas, GIF y vídeos arrastrados dentro del issue |
| Diagramas de flujo o de pantallas | `docs/diseno/diagramas/` | `.excalidraw` (el archivo de Excalidraw) y su exportación `.png` |
| Capturas, maquetas de pantallas, estética (colores, tipografías) | `docs/diseno/referencias/<funcionalidad>/` | `.png`, `.jpg`, `.webp`, `.svg` |
| Animaciones | `docs/diseno/animaciones/` | `.gif`, `.mp4` (cortos), `.json` de Lottie |
| Archivos muy grandes (vídeos largos, exportaciones de Figma) | Una carpeta compartida de Google Drive y su enlace en el issue | Lo que sea |

Normas:
- Un issue por funcionalidad. Si es grande, se divide en issues pequeños.
- Nombres de archivo con la funcionalidad delante: `chat-tarjeta-permiso.png`, `bandeja-animacion.gif`.
- La estética de la app es la referencia (shadcn/ui, Tailwind, fuente Outfit y el robot). Un cambio de diseño debe seguir lo que
  ya hay, salvo que el issue diga lo contrario.
