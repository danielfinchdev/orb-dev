// 3.8.2: «Capturar ventana» of the composer (PC only). The user picks a window or a screen in the system's own picker,
// Orb keeps one frame of it as a PNG and stops the capture at once; the picture is attached like any other file. Only
// the user's click starts it: an agent never gets the screen (D7). Nothing in Rust: the window's web view has
// getDisplayMedia, and where it does not, the button is not shown.
export const canCapture = (nav = globalThis.navigator) => typeof nav?.mediaDevices?.getDisplayMedia === 'function';

// → a PNG data URL, or null when the user closed the picker.
export async function captureFrame({ nav = globalThis.navigator, doc = globalThis.document } = {}) {
  let stream;
  try { stream = await nav.mediaDevices.getDisplayMedia({ video: { displaySurface: 'window' }, audio: false }); }
  catch (error) { if (error?.name === 'NotAllowedError' || error?.name === 'AbortError') return null; throw error; }
  try {
    const video = doc.createElement('video');
    video.muted = true; video.srcObject = stream;
    await video.play();
    if (!video.videoWidth) await new Promise((resolve) => video.addEventListener('loadeddata', resolve, { once: true }));
    const canvas = doc.createElement('canvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    video.srcObject = null;
    return canvas.toDataURL('image/png');
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
}
