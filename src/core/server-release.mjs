// 3.7: the Orb Server release this app installs (src/core/server-install.mjs). WS1's release step (npm run dist:server /
// release:sign) writes the real values here; in a development build they stay empty and the command's hash is a
// placeholder that sha256sum refuses.
export const SERVER_RELEASE = { version: null, url: null, sha256: null };
