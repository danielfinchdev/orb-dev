// The product's name in one place: Orb.dev. To rename it, change these values and the same ones in package.json
// (productName, build.appId, build.productName, artifact names); `npm run check` warns if they differ. Each user can still
// call their assistant whatever they like (that name lives in their orb.json).
export const PRODUCT = {
  name: 'Orb.dev', // window titles, notifications, installer
  assistant: 'Orb', // the assistant's default name (and so its folder: D:\\Orb)
  appId: 'dev.orb.app' // Windows' id of the app (notifications, taskbar); must match build.appId
};

// A name that is safe as a folder name on Windows (the assistant's folder and project folders). Here, without Node, so the
// first-run screen shows exactly the folder that will be created.
export function folderName(name, fallback = PRODUCT.assistant) {
  const clean = String(name ?? '').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/[. ]+$/g, '').trim().slice(0, 60);
  if (!clean || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean)) return fallback;
  return clean;
}
