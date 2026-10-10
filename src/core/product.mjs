// The product's names in one place. Orb.dev is the development (this repository); the program is Orb (Orb.exe); its robot
// is Orbe (2.6; drawn as the Orb·E wordmark at the top of the sidebar). To rename the program, change these values and the same ones in package.json (productName, build.appId,
// build.productName, artifact names); `npm run check` warns if they differ. Each user can still call their assistant
// whatever they like (that name lives in their orb.json).
export const PRODUCT = {
  name: 'Orb', // the program: window titles, notifications, installer, Orb.exe
  assistant: 'Orbe', // the robot's default name
  folder: 'Orb', // the assistant's folder (D:\\Orb), whatever the assistant is called
  appId: 'dev.orb.app', // Windows' id of the app (notifications, taskbar, installer); must match build.appId
  // Until 2.3.3 the program was "Orb.dev": its app data (where the Orb folder is, interface size) stays in that folder
  // of %APPDATA% so an update finds everything where it was.
  dataDir: 'Orb.dev'
};

// The developer: GitHub (also where the releases live) and the contribution link (Ajustes → Contribuye).
export const AUTHOR = { github: 'danielfinchdev', url: 'https://github.com/danielfinchdev', repo: 'danielfinchdev/orb-dev', paypal: 'https://paypal.me/DanielFinch' };

// A name that is safe as a folder name on Windows (the assistant's folder and project folders). Here, without Node, so the
// first-run screen shows exactly the folder that will be created.
export function folderName(name, fallback = PRODUCT.folder) {
  const clean = String(name ?? '').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/[. ]+$/g, '').trim().slice(0, 60);
  if (!clean || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean)) return fallback;
  return clean;
}
