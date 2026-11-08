# The Orb app for Android

The same phone UI, as a native app: it scans your Orb's QR with the camera, notifies you of new messages and
receives what you share from other apps ("Share with Orb"). No Play Store needed:
it is installed from the APK file.

## Installing it on the phone

1. Copy `Orb-<version>-android.apk` (the repository's `dist/` folder) to the phone: over USB, through Google Drive or
   by sending it to yourself on Telegram or by email.
2. On the phone, open the file from the **Files** app (or from the download).
3. The first time, Android asks to allow **installing unknown apps** for the app you open it with (Files, Drive,
   Chrome…). Tap **Settings**, turn on **Allow from this source** and go back.
4. Tap **Install**. If Google Play Protect warns that it does not know the app, tap **Install anyway**.

To update it, install the new APK on top: the link is kept. Every APK is signed with the same key (see «Building the
app»); an APK signed with another key does not install on top.

**Coming from Orb 3.8.0:** the 3.8.1 app is built with Tauri instead of Capacitor. It installs on top and stays linked
(the same package `dev.orb.app`, the same key and the same Android keystore entry), but its page has a new origin, so
the interface settings kept by the page (theme, last screen, game records) start again once. Notifications turn back
on by themselves when Android already allows them for Orb; otherwise the list of chats offers them. Update the PC first:
an Orb 3.8.0 on the PC does not let the 3.8.1 app in (the app's «PC is off» screen says so too).

## Linking it to your Orb

1. The phone has to reach your Orb: on the same home Wi-Fi, or with **Tailscale** on in the phone (works from
   anywhere). Your Orb must be on.
2. In your Orb, open **Settings → Magic Link**, turn on access and show the QR code (over Wi-Fi or Tailscale).
3. In the app, tap **Scan the QR code** and point at the QR. The first time, Android may take a few seconds to prepare
   the scanner. Without a camera: tap **Link without the camera** and paste the QR link, or type the short code and
   your Orb's address.
4. The app shows your Orb's fingerprint: it must be the same one the PC shows. With the short code you confirm it with
   **Coincide con la del PC** before going on.
5. Type your **master password**. The phone never sends it: it proves it knows it, and the PC proves it is your PC.
   A wrong password does not spend the code; after 5 wrong tries the code is cancelled and you make a new one.

The QR expires after 5 minutes and works only once. From then on everything is encrypted with a key of this phone's
own, kept in the Android keystore. To remove access, sign the phone out in your Orb (**Settings → Magic Link**).

**Coming from Orb 3.7:** a 3.7 app cannot link with Orb 3.8 (it says «Actualiza la app»): install the 3.8 APK. Phones
linked in 3.7 are unlinked once when the PC first opens 3.8; link them again with Magic Link.

## Using it

- **Back button**: closes the open sheet or menu, then goes back to the list (or to the chat a task was opened from),
  then to Chats; on Chats, press it twice to leave. While linking, it goes from the password back to scanning.
- **PC off or unreachable**: the app says so, shows when it last connected and retries on its own (3 s, 6 s, 12 s… up
  to 30 s; not while the app is in the background, and at once when you come back to it or the network returns).
  «Vincular con otro PC» asks first: linking again needs that PC on. With the app open, a connection that goes silent
  for a minute is taken for lost («Sin conexión con tu PC…») and comes back by itself. If Orb cannot start, the screen
  offers «Reintentar» and «Vincular con otro PC».
- PC-only things (Settings, agents' accounts, backups, `core`) are not on the phone.

## Notifications and sharing

- **Notifications**: after linking the app offers them in the list of chats (above the tabs, until you answer); later,
  in **More → This phone**. They arrive while
  Android keeps the app open in the background; if Android closes it, you see them when you open it again.
- **Messages**: each chat's notification shows Orb's picture, the chat's
  name and the text as chosen in **Settings › Magic Link** (on the lock screen); new messages of the same chat join one
  notification. **Reply** writes back from the notification; on a card, **Approve** and **Reject** answer it. These
  three are done by the app itself **without opening it**, also after Android closed the app, and **only with the phone
  unlocked** (Android asks to unlock first; before Android 12 the notification says to unlock): the notification says
  «Enviando…» and then whether it worked (a failure stays, with the reason; tapping it opens the chat). A sensitive card
  (its text hidden on the lock screen) and a task's approval open the app instead, which asks there. Muted chats do not
  notify. Tapping opens that chat.
- **No app lock**: the phone is protected by its encrypted link with the PC and by the phone's own screen lock. Each
  notification's button carries only a one-time token (no other app can make one up, also to open the app); the tokens
  of a notification go when one is used, all go when the notifications are cleared or the phone is unlinked, and any
  older than a day is refused.
- **Links** (a chat's links, «Descargar» of a new version, Tailscale) open in the phone's browser: the app's WebView only
  ever shows Orb's own page.
- **Updates**: when your Orb needs a newer app, the app says so instead of failing.
- **Dictation**: the phone keyboard's own microphone (since 3.8.2 the message box has no microphone button on the phone).
- **Share with Orb**: in any app, **Share → Orb**. Text and links appear in the chat, ready to send; images are
  uploaded encrypted to your Orb and the chat gets their path.

## Building the app (on the PC)

```
npm run android:build         # dist/Orb-<version>-android.apk (release, signed)
npm run android:build:debug   # dist/debug/Orb-<version>-android-debug.apk (never beside the one to publish)
```

Both build `aarch64` (every current Android phone) and check the APK: package `dev.orb.app`, `versionCode` =
major·1 000 000 + minor·1000 + patch (Tauri's scheme: 3.8.1 is 3008001, above Capacitor's 30800 for 3.8.0) and, for a
release, that it is signed with the certificate every Orb for Android has had (SHA-256 `ccd0fffa…ae6f00`).

It needs, in the build cache (`ORB_BUILD_CACHE`, by default `%LOCALAPPDATA%\orb-build-cache`; nothing installed and
no administrator rights):

- `jdk21\`: Eclipse Temurin JDK 21 as a .zip, unpacked.
- `sdk\`: the Android command-line tools in `sdk\cmdline-tools\latest`, and with them
  `sdkmanager --sdk_root=<cache>\sdk "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;29.0.14206865"`
  (licences are accepted with `yes | sdkmanager --licenses`; Gradle may add the platforms its plugins ask for).
- `gradle\`: created by the first build (Gradle comes with its own wrapper, checked against its SHA-256).
- `keys\`: the signing key `orb-release.jks` and its password `orb-release.pass`. **Keep them safe**: without them,
  the next version will not install on top of the previous one. The build never makes a new key: without them it stops.

And Rust (`rustup`, with the target `aarch64-linux-android`) in the `PATH`, or `RUSTUP_HOME`/`CARGO_HOME` set.

How it is made:

- `src-tauri/` is the same Tauri project as the desktop's; `src-tauri/src/mobile.rs` is the Android entry (no engine,
  no windows of its own) and `tauri.android.conf.json` the Android settings (the page in `src/renderer-android`, built
  with `vite build --mode android` by `scripts/android-web.mjs`, and its CSP, which lets it reach the PC).
- `src-tauri/gen/android/` is the Android project (versioned): the manifest, the icons (`npm run icon` draws them),
  the signing and Orb's Kotlin code in `app/src/main/java/dev/orb/app/`:
  - `OrbNativePlugin.kt`, the plugin «orb-native» the page calls: the keystore (`SecureStore.kt`, the same alias, file
    and format as 3.8.0), «Share with Orb» (`ShareIntent.kt`), the QR (Google's code scanner, no camera permission),
    dictation, minimize, and the notifications;
  - `Notes.kt` (the notifications and `NoteReceiver`, which answers a button without opening the app) and `PcCall.kt`
    (that call to the PC, encrypted by `src-tauri/src/phone_crypto.rs`, the same as `src/core/mobile-crypto.mjs`);
  - `MainActivity.kt`: the launch screen, edge to edge, and back handed to the page.
- The page's side is `src/ui/lib/app-bridge.js` and what it reads from the QR, `src/ui/lib/link-payload.js`.

## Still missing

- Receiving notifications while the app is closed (Firebase push, with its Google account and `google-services.json`).
  The buttons of a notification already shown do work with the app closed.
- Shared images reach the chat as a path; Orb's chat cannot attach images yet.
