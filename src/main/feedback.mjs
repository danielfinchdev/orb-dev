// Ajustes → Contribuye and Más aplicaciones, done in the main process (the window may not reach the internet).
// Feedback goes without any account through FormSubmit (formsubmit.co), which mails it with its screenshots to the author's
// inbox: the same inbox and setup as Open Control Edge. The endpoint is the random alias FormSubmit gives after
// activation, so no address is in the code. Nothing is sent without the user pressing «Enviar».
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { translate } from '../core/i18n.mjs';

export const AUTHOR = { github: 'danielfinchdev', url: 'https://github.com/danielfinchdev', paypal: 'https://paypal.me/DanielFinch' };
const FORM_ALIAS = '1ee33dd306d01e9d63121af2b9fd1a2a'; // the same FormSubmit inbox as Open Control Edge
export const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_MESSAGE = 5000;
const TYPES = ['error', 'idea', 'otro'];

// Other apps by the same author: the latest release of each, from GitHub (public repositories).
const APPS = [{ id: 'open-control-edge', name: 'Open Control Edge', repo: 'danielfinchdev/open-control-edge' }];

const isPng = (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const toImage = (name, bytes) => ({ name: String(name).slice(0, 80), type: isPng(bytes) ? 'image/png' : 'image/jpeg', data: bytes.toString('base64') });

// A PNG or JPEG of at most 5 MB, by its first bytes (not its extension); null otherwise.
export function readImage(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || !st.size || st.size > MAX_IMAGE_BYTES) return null;
    const bytes = fs.readFileSync(file);
    return isPng(bytes) || isJpeg(bytes) ? toImage(path.basename(file), bytes) : null;
  } catch { return null; }
}

// The app's window as a PNG (scaled down to at most 1920 px wide).
export async function captureWindow(win) {
  let image = await win.webContents.capturePage();
  const { width } = image.getSize();
  if (width > 1920) image = image.resize({ width: 1920, quality: 'best' });
  const bytes = image.toPNG();
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return null;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return toImage(`captura-${stamp}.png`, bytes);
}

// Sends the feedback. Returns true when FormSubmit accepted it; throws with a short reason otherwise.
export async function sendFeedback({ type, message, contact, images } = {}, { version, language }) {
  const T = (key) => translate(language === 'en' ? 'en' : 'es', key);
  const text = String(message ?? '').trim();
  if (!text) throw new Error(T('sys.feedback.empty'));
  const kind = TYPES.includes(type) ? type : 'otro';
  const form = new FormData();
  form.append('_subject', `Orb: ${kind}`);
  form.append('_template', 'table');
  form.append('_captcha', 'false');
  // Field names in plain ASCII: the mail shows them as they are.
  form.append('Tipo', kind);
  form.append('Mensaje', text.slice(0, MAX_MESSAGE));
  form.append('Version', String(version));
  form.append('Windows', `${os.type()} ${os.release()}`);
  form.append('Idioma', language === 'en' ? 'en' : 'es');
  const mail = String(contact ?? '').trim();
  if (mail.includes('@') && mail.length <= 120) { form.append('Contacto', mail); form.append('_replyto', mail); }
  for (const [i, img] of (Array.isArray(images) ? images : []).slice(0, MAX_IMAGES).entries()) {
    const bytes = Buffer.from(String(img?.data ?? ''), 'base64');
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || !(isPng(bytes) || isJpeg(bytes))) continue;
    form.append(`captura${i + 1}`, new Blob([bytes], { type: isPng(bytes) ? 'image/png' : 'image/jpeg' }), String(img.name || `captura${i + 1}.png`).slice(0, 80));
  }
  let res;
  try {
    // The plain endpoint, not /ajax/: only the plain one forwards attachments. FormSubmit only answers requests that come
    // from a web page: the author's GitHub page is where the form lives (as in Open Control Edge).
    res = await fetch(`https://formsubmit.co/${FORM_ALIAS}`, {
      method: 'POST', body: form, redirect: 'manual', signal: AbortSignal.timeout(60_000),
      headers: { accept: 'text/html', origin: 'https://github.com', referer: AUTHOR.url, 'user-agent': `Orb/${version}` }
    });
  } catch (error) {
    throw new Error(T(error?.name === 'TimeoutError' ? 'sys.feedback.timeout' : 'sys.feedback.offline'));
  }
  const body = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // A thank-you page that says so; anything else (activation, captcha, error page) is not a delivery.
  if (!/submitted successfully/i.test(body)) throw new Error(T('sys.feedback.failed'));
  return true;
}

// The other apps with their latest version and the download of its installer (or the release page).
export async function moreApps(version) {
  return Promise.all(APPS.map(async (a) => {
    const page = `https://github.com/${a.repo}/releases/latest`;
    try {
      const res = await fetch(`https://api.github.com/repos/${a.repo}/releases/latest`, { headers: { accept: 'application/vnd.github+json', 'user-agent': `Orb/${version}` }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(String(res.status));
      const r = await res.json();
      const assets = Array.isArray(r.assets) ? r.assets : [];
      const setup = assets.find((x) => /setup|install|instalador/i.test(x.name) && /\.(exe|msi|msix)$/i.test(x.name)) ?? assets.find((x) => /\.(exe|msi|msix)$/i.test(x.name));
      return { ...a, version: String(r.tag_name ?? '').replace(/^v/, ''), date: r.published_at ?? null, download: setup?.browser_download_url ?? page, page };
    } catch { return { ...a, version: null, date: null, download: page, page }; }
  }));
}
