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
   anywhere).
2. In your Orb, open **Settings → Magic Link**, turn on access and tap **Pair over Wi-Fi** or **Pair over Tailscale**.
3. In the app, tap **Scan the QR code** and point at the QR. The first time, Android may take a few seconds to prepare
   the scanner.
4. Without a camera: tap **Link without the camera** and paste the QR link, or type the short code and your Orb's
   address (the short code comes with Magic Link).

The QR expires after 5 minutes and works only once. From then on everything is encrypted with a key of this phone's
own, kept in the Android keystore. To remove access, revoke it in your Orb (**Settings → Magic Link**).

## Notifications, dictation and sharing

- **Notifications**: turn them on in the app, in **More → This phone**. They arrive while Android keeps the app open in
  the background; if Android closes it, you see them when you open it again.
- **Messages** (3.6): each chat's notification shows who writes (the bot's avatar, Orb for the Orb zone), the chat's
  name and the text as you chose in **My profile**; new messages of the same chat join one notification. **Reply**
  writes back from the notification; on a card, **Approve** and **Reject** answer it (if you have a PIN and the card is
  sensitive, **Approve** opens the app to ask for it). Muted chats do not notify. Tapping opens that chat.
- **Reminders** (3.6): with notifications on, the app schedules your bots' reminders of the next two days on the
  phone itself, so they ring even with the app closed or offline. Their text shows only if you chose "everything" for
  the lock screen in **My profile**.
- **App lock** (3.6): if your person has a PIN, the app asks for it when it opens, or your fingerprint or face when the
  phone has one set up. The header says who the app is connected as.
- **Updates** (3.6): when your Orb needs a newer app, the app says so instead of failing.
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
- Linking with the short code depends on Magic Link (`/api/hello` on your Orb).
- Shared images reach the chat as a path; Orb's chat cannot attach images yet.
