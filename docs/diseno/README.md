# Orb.dev design

This is where the visual references and diagrams for each feature go, so they can be implemented.

| What | Where | Format |
|---|---|---|
| A specific feature (what you want, what it looks like, when it is done) | A GitHub **issue** with the "Feature" template | Text, with screenshots, GIFs and videos dragged into the issue |
| Flow or screen diagrams | `docs/diseno/diagramas/` | `.excalidraw` (the Excalidraw file) and its `.png` export |
| Screenshots, screen mockups, look and feel (colours, typefaces) | `docs/diseno/referencias/<feature>/` | `.png`, `.jpg`, `.webp`, `.svg` |
| Animations | `docs/diseno/animaciones/` | `.gif`, `.mp4` (short), Lottie `.json` |
| Screenshots of the current screens, with a code (A1, B2…) | `docs/diseno/capturas/` (index in `INDICE.md`) | `.jpg`; only on the PC, not pushed to GitHub |
| Very large files (long videos, Figma exports) | A shared Google Drive folder, linked in the issue | Anything |

Rules:
- One issue per feature. If it is big, split it into small issues.
- File names start with the feature: `chat-tarjeta-permiso.png`, `bandeja-animacion.gif`.
- The app's look is the reference (shadcn/ui, Tailwind, the Outfit typeface and the robot). A design change should follow
  what is already there, unless the issue says otherwise.
