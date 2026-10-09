# Móvil desde cualquier sitio: puente en la nube (en espera)

**Estado:** en espera. Decidido el 9 de octubre de 2026: la 2.3.3 deja el móvil por la wifi de casa y por Tailscale, todo
gratis; el puente queda para más adelante.

## Qué resolvería

Hoy, para usar Orb fuera de casa hace falta Tailscale en el PC y en el móvil. Con el puente, el móvil llegaría al PC desde
cualquier red sin instalar nada: el PC y el móvil se conectan los dos **hacia fuera** a un pequeño servidor en internet
que solo pasa mensajes. No hay que abrir puertos en el router.

## Cómo sería

- **Dónde:** un Cloudflare Worker con un Durable Object por PC, en la cuenta gratuita de Cloudflare de quien lo use, con
  la dirección gratuita `…workers.dev` (no hace falta dominio propio).
- **Conexión:** el motor de Orb abre un WebSocket hacia el puente al activar «Desde cualquier sitio». El móvil abre la
  web app servida por el puente (HTTPS) y otro WebSocket; el puente empareja los dos por el identificador del PC.
- **Cifrado de extremo a extremo:** el mismo protocolo de la 2.3.3 (`src/core/mobile-crypto.mjs`): clave del PC en el
  QR, clave propia de cada móvil, mensajes sellados con XChaCha20-Poly1305. El puente solo ve mensajes que no puede
  leer, el identificador del PC y el tamaño del tráfico.
- **La web app:** el puente sirve la misma interfaz del móvil (sus archivos van firmados por el PC, para que el puente no
  pueda cambiarla sin que el móvil lo note).
- **Avisos:** los mismos de la 2.3.3 (Web Push enviado por el PC). Al ir por HTTPS funcionan siempre, también en iPhone
  con la app en la pantalla de inicio.
- **Instalación del puente:** Orb lo despliega en la cuenta de Cloudflare de la persona (inicio de sesión de Cloudflare
  en el navegador, una vez). La cuenta y el inicio de sesión los hace la persona; Orb no ve su contraseña.

## Coste

| Uso | Coste |
|---|---|
| Una persona con su PC y su móvil | 0 € (plan gratuito de Cloudflare: unas 100.000 peticiones al día; los mensajes de WebSocket cuentan 1 de cada 20 y una conexión parada no gasta) |
| Superar el plan gratuito | El puente deja de responder hasta el día siguiente; no se cobra nada |
| Muchas personas usando un mismo puente | Plan de pago de Cloudflare desde unos 5 USD al mes, o un puente por persona (cada una en su cuenta) |

## Lo que falta decidir antes de hacerlo

1. Si cada persona usa su propio puente (su cuenta de Cloudflare) o hay un puente común de Orb.
2. Cómo firma el PC los archivos de la web app que sirve el puente.
3. Qué hace el móvil cuando el PC está apagado (mensaje claro y reintento).
