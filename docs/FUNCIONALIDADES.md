# Cómo pedir una funcionalidad

Hay dos maneras, según lo grande que sea:

- **Algo pequeño o una corrección:** basta con decirlo en el chat. Si hablas de una pantalla concreta, usa su código de
  captura (por ejemplo «en E3 quita el campo De qué va»). Los códigos están en `diseno/capturas/INDICE.md`.
- **Una funcionalidad nueva:** un issue en GitHub con la plantilla **Funcionalidad**: Issues → New issue → Funcionalidad.
  Un issue por funcionalidad; si es grande, se divide en varios pequeños.

Los diseños (capturas, maquetas, diagramas, animaciones) se arrastran dentro del issue o se guardan en
[`diseno/`](diseno/README.md) y se enlazan desde él.

## La plantilla

Es la misma que usa GitHub (`.github/ISSUE_TEMPLATE/funcionalidad.md`). Si cambias una, cambia también la otra.

```markdown
## Qué quiero
En una o dos frases: qué tiene que hacer y para qué.

## Cómo se usa
Pasos de quien la usa: dónde pulsa, qué ve, qué pasa.

## Cómo se ve
Capturas, maquetas, GIF o vídeos. Un diagrama de Excalidraw: súbelo a docs/diseno/diagramas y enlázalo.

## Cuándo está terminada
- [ ] …
- [ ] …

## Qué no tocar
Lo que debe seguir igual.

## Pantalla o parte de la app
Chat, Tareas, Conversación, Agentes, Ajustes, Móvil… (ver docs/FUNCIONAMIENTO.md)
```

## Qué poner en cada parte

- **Qué quiero:** el objetivo, no la solución. «Poder usar Orb desde el móvil sin instalar nada» dice más que «añadir un
  servidor».
- **Cómo se usa:** el recorrido de la persona, paso a paso. Es lo que luego se prueba.
- **Cómo se ve:** cualquier imagen ayuda, aunque sea un dibujo a mano o una captura de otra app (por ejemplo la tarjeta de
  RustDesk que sirvió para el aviso de actualización).
- **Cuándo está terminada:** una lista de comprobaciones. Cada una se convierte en una prueba.
- **Qué no tocar:** lo que tiene que seguir igual (otra pantalla, un comportamiento que ya te gusta).
- **Pantalla o parte de la app:** dónde cambia, con su código de captura si lo hay, o el apartado de
  [`FUNCIONAMIENTO.md`](FUNCIONAMIENTO.md).

## Qué pasa después

1. Se implementa en una rama propia y se prueba (pruebas automáticas y, si toca, en la app instalada).
2. Se abre un pull request; la CI la prueba en Windows y Linux.
3. Al fusionarlo con una versión nueva en `package.json`, se publica la release y Orb avisa solo para actualizar.
4. [`NOVEDADES.md`](NOVEDADES.md) y [`FUNCIONAMIENTO.md`](FUNCIONAMIENTO.md) se actualizan en el mismo cambio.
