// The link formats (QR v1/v2, JSON, short code + address) live in src/core/link-payload.mjs since 3.5, so the terminal
// client (src/terminal) and the server package use the same code as the page and the Android app.
export * from '../../core/link-payload.mjs';
