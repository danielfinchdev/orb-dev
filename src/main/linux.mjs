// 3.7: the desktop app on Linux (AppImage and .deb). Pure pieces, without Electron, so they are tested in plain Node.

// How this copy runs on Linux: 'appimage' (it can replace itself with the next version: electron-updater reads
// latest-linux.yml), 'package' (.deb or the unpacked folder: the system's package manager or the user updates it, the
// app only says there is a new version) or null on other systems.
export function linuxKind(platform, env) {
  if (platform !== 'linux') return null;
  return env.APPIMAGE ? 'appimage' : 'package';
}

// Whether the system keeps the app's secret really encrypted. On Linux, safeStorage uses the desktop's keyring (GNOME
// Keyring, KWallet); without one it falls back to 'basic_text', a fixed key that protects nothing. Then the app keeps the
// secret in its own file, as before, and tells the user once how to get a keyring.
export function keyringWeak(platform, available, backend) {
  if (!available) return true;
  return platform === 'linux' && (backend === 'basic_text' || backend === 'unknown');
}
