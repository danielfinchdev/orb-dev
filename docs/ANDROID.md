# The Orb app for Android

The same phone UI, as a native app: it scans your Orb's QR with the camera, notifies you of new messages, takes
dictation with the microphone and receives what you share from other apps ("Share with Orb"). No Play Store needed:
it is installed from the APK file.

## Installing it on the phone

1. Copy `Orb-<version>-android.apk` (the repository's `dist/` folder) to the phone: over USB, through Google Drive or
   by sending it to yourself on Telegram or by email.
2. On the phone, open the file from the **Files** app (or from the download).
3. The first time, Android asks to allow **installing unknown apps** for the app you open it with (Files, Drive,
   Chrome…). Tap **Settings**, turn on **Allow from this source** and go back.
4. Tap **Install**. If Google Play Protect warns that it does not know the app, tap **Install anyway**.

To update it, install the new APK on top: the link and the settings are kept. APKs built on this PC are always signed
with the same key; if the key changes (another PC), uninstall the app first.

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

## Notifications, dictation and sharing

- **Notifications**: the app offers them right after linking; later, in **More → This phone**. They arrive while
  Android keeps the app open in the background; if Android closes it, you see them when you open it again.
- **Messages**: each chat's notification shows Orb's picture, the chat's
  name and the text as chosen in **Settings › Magic Link** (on the lock screen); new messages of the same chat join one
  notification. **Reply** writes back from the notification; on a card, **Approve** and **Reject** answer it (a
  sensitive card opens the app instead), also when they start the app. Muted chats do not notify. Tapping opens that
  chat.
- **No app lock**: the phone is protected by its encrypted link with the PC and by the phone's own screen lock.
- **Updates**: when your Orb needs a newer app, the app says so instead of failing.
- **Dictation**: the microphone button, next to **Send**. It uses the phone's own speech recognition.
- **Share with Orb**: in any app, **Share → Orb**. Text and links appear in the chat, ready to send; images are
  uploaded encrypted to your Orb and the chat gets their path.

## Building the app (on the PC)

```
npm run android:build         # dist/Orb-<version>-android.apk (release, signed)
npm run android:build:debug   # dist/Orb-<version>-android-debug.apk
```

It needs, in `%LOCALAPPDATA%\orb-build-cache` (nothing installed and no administrator rights):

- `jdk21\`: Eclipse Temurin JDK 21 as a .zip, unpacked.
- `sdk\`: the Android command-line tools in `sdk\cmdline-tools\latest`, and with them
  `sdkmanager --sdk_root=<cache>\sdk "platform-tools" "platforms;android-36" "build-tools;36.0.0"` (licences are
  accepted with `yes | sdkmanager --licenses`).
- `gradle\`: created by the first build (Gradle comes with its own wrapper, checked against its SHA-256).
- `keys\`: the signing key `orb-release.jks` and its password, created on the first build. **Keep them safe**: without
  them, the next version will not install on top of the previous one.

The project is in `android-app/` (Capacitor); the app's side of the UI is `src/ui/lib/app-bridge.js` and what it reads
from the QR, `src/ui/lib/link-payload.js`.

## Still missing

- Notifications with the app fully closed (Firebase push, with its Google account and `google-services.json`).
- Shared images reach the chat as a path; Orb's chat cannot attach images yet.
