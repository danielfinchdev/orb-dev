# Orb on Linux (desktop app)

Since 3.7 the Orb app (the same one as on Windows) has Linux downloads. It is for a Linux **desktop** (GNOME, KDE,
Xfce…).

From [**Releases → latest**](https://github.com/danielfinchdev/orb-dev/releases/latest), x64 (most PCs) or arm64:

| File | What it is | Updates |
| --- | --- | --- |
| `Orb-<version>-linux-x86_64.AppImage` / `-arm64.AppImage` | One file, nothing to install. Works on most distributions. | Updates itself, like the Windows installer. |
| `Orb-<version>-linux-amd64.deb` / `-arm64.deb` | Package for Debian, Ubuntu, Linux Mint, Pop!_OS… | Orb tells you there is a new version and opens the download page. |

## AppImage

```bash
chmod +x Orb-*-linux-x86_64.AppImage
./Orb-*-linux-x86_64.AppImage
```

- Ubuntu 22.04 and later need FUSE 2 to open AppImages: `sudo apt install libfuse2` (on 24.04: `libfuse2t64`).
- Ubuntu 24.04 and later block the Chromium sandbox for apps outside a package (AppArmor). If the AppImage closes at once
  with a message about the "SUID sandbox", use the `.deb` (it brings its own AppArmor profile) or start it with
  `--no-sandbox`.
- Keep the file in a folder of yours (for example `~/Applications`): Orb replaces it with the new version there, so that
  folder must be writable.
- For a menu entry, use your desktop's AppImage tool (AppImageLauncher, Gear Lever…).

**Update:** Orb checks GitHub at start and every 4 hours. **Ajustes › Actualizaciones** shows a new version; «Actualizar»
downloads it and «Reiniciar y actualizar» swaps the file and opens the new one. Your data is not touched (and Orb makes a
backup of it first).

**Uninstall:** delete the `.AppImage` file.

## .deb

```bash
sudo apt install ./Orb-*-linux-amd64.deb
```

It adds Orb to the applications menu (category Development) with its icon. **Update:** when Orb says there is a new
version, download the new `.deb` and install it the same way, over the one you have; nothing is lost.
**Uninstall:** `sudo apt remove orb-dev`.

## Your data

The same as on Windows, in Linux places:

- The assistant's folder (projects, conversations, memories) is the one you choose on the first run, `~/Documents/Orb`
  by default. Uninstalling never deletes it.
- The app's settings for this PC (where that folder is, the interface size): `~/.config/Orb.dev/`.
- Orb's secret key is kept in the desktop's keyring (GNOME Keyring or KWallet). Without one, Orb keeps it in a file in
  its folder (agents still cannot read it) and says so once; install `gnome-keyring` or `kwallet` and restart Orb to
  protect it.

To remove everything after uninstalling: delete `~/.config/Orb.dev/` and, if you no longer want it, the assistant's
folder.

## What changes on Linux

- **Ctrl+J** opens your system's terminal (`x-terminal-emulator`) in the project's folder, or the one you choose in
  **Ajustes › Interfaz**: GNOME Terminal, Konsole, Xfce Terminal, kitty, Alacritty, XTerm or Warp. The project's actions
  open in that same terminal.
- **Abrir en** offers Cursor and VS Code when they are installed (also snap, Flatpak or `~/.local/bin`) and the file
  manager.
- Notifications use the desktop's own; the window draws its own buttons, as on Windows.
- The agents install from their official instructions (Orb's automatic installer and the PC maintenance tools are
  Windows only).
- Orb registers no file types or links.

## Building it yourself

On Linux, from the source: `npm ci && npm run dist:linux` (leaves the AppImage and the `.deb` in `dist/`). These can only
be built on Linux (the AppImage and `.deb` tools do not run on Windows); the release workflow builds them on Ubuntu
(`.github/workflows/release.yml`, job `linux`) and publishes them with the Windows files.
