// The product's name in one place: Orb.dev. To rename it, change these values and the same ones in package.json
// (productName, build.appId, build.productName, artifact names); `npm run check` warns if they differ. Each user can still
// call their assistant whatever they like (that name lives in their orb.json).
export const PRODUCT = {
  name: 'Orb.dev', // window titles, notifications, installer
  assistant: 'Orb', // the assistant's default name (and so its folder: D:\\Orb)
  appId: 'dev.orb.app' // Windows' id of the app (notifications, taskbar); must match build.appId
};
