// 3.7: the public half of the key that signs Orb Server's releases (manifest.json and install.sh, ed25519). The private
// half never enters this repository: the owner keeps it offline on his PC (%USERPROFILE%\.orb-release\release.key, or
// ORB_RELEASE_KEY) and signs each release there with `npm run release:sign`. `npm run release:keygen` makes the pair once
// and writes the public key here. While this is empty, Orb Server refuses every self-update (nothing can be verified).
export const RELEASE_PUBLIC_KEY = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAnlqmqM319Y3ajRPu8pS+9rKskFzwi4yXtjCeBd5cgPo=\n-----END PUBLIC KEY-----\n";
