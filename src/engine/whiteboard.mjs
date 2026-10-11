// 2.7: the Pizarra of each project, saved inside the project in its own folder `pizarra/`:
//   pizarra.excalidraw   the drawing (Excalidraw's own format, so excalidraw.com can open it too)
//   imagenes/<id>.<ext>  the pictures put on the drawing (kept apart from the drawing, not inside it)
//   pizarra.png          the drawing as a picture, for the assistant and the agents to look at
//   PIZARRA.md           what the assistant reads first: the texts of the drawing and the attachments with their notes
//   adjuntos/            files attached in the side panel (photos, videos, documents) and adjuntos.json with their notes
// The folder stays out of git (.git/info/exclude, local only): it is the user's working material, not the project's code.
import fs from 'node:fs';
import path from 'node:path';
import { tr } from '../core/context.mjs';

const MB = 1024 * 1024;
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', json: 'application/json', csv: 'text/csv', zip: 'application/zip',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', fig: 'application/octet-stream', psd: 'image/vnd.adobe.photoshop' };
const EXT_OF = Object.fromEntries(Object.entries(MIME).filter(([e]) => !['jpeg'].includes(e)).map(([e, m]) => [m, e]));
const mimeOf = (file) => MIME[path.extname(file).slice(1).toLowerCase()] ?? 'application/octet-stream';
const kindOf = (mime) => (mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'file');
const safeName = (name) => String(name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim().slice(0, 120) || 'archivo';
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };

export function whiteboard(board) {
  const folder = (name) => {
    const p = board.project(String(name ?? ''));
    if (!p?.path || !fs.existsSync(p.path)) throw new Error(tr('msg.board.noProject', { name: String(name ?? '').slice(0, 60) }));
    return { project: p, dir: path.join(p.path, 'pizarra') };
  };
  // The folder is created on first use, and kept out of the project's git (local exclude file, nothing committed).
  const ensure = ({ project, dir }) => {
    fs.mkdirSync(path.join(dir, 'imagenes'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'adjuntos'), { recursive: true });
    const exclude = path.join(project.path, '.git', 'info', 'exclude');
    try {
      if (fs.existsSync(path.join(project.path, '.git')) && fs.statSync(path.join(project.path, '.git')).isDirectory()) {
        const text = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
        if (!/^\/pizarra\/?$/m.test(text)) { fs.mkdirSync(path.dirname(exclude), { recursive: true }); fs.appendFileSync(exclude, `${text && !text.endsWith('\n') ? '\n' : ''}/pizarra/\n`); }
      }
    } catch { /* not a git folder we can write: nothing to exclude */ }
  };
  const notesFile = (dir) => path.join(dir, 'adjuntos', 'adjuntos.json');
  const inside = (dir, file) => { const f = path.resolve(dir, file); if (!f.startsWith(path.resolve(dir) + path.sep)) throw new Error(tr('msg.board.badFile')); return f; };

  function attachments(dir, { thumbs = true } = {}) {
    const base = path.join(dir, 'adjuntos'); if (!fs.existsSync(base)) return [];
    const notes = readJson(notesFile(dir), {});
    return fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isFile() && e.name !== 'adjuntos.json').map((e) => {
      const file = path.join(base, e.name); const st = fs.statSync(file); const mime = mimeOf(e.name);
      // A small preview for pictures (the panel shows it; big ones are only named).
      const thumb = thumbs && kindOf(mime) === 'image' && st.size <= 3 * MB && mime !== 'image/vnd.adobe.photoshop' ? `data:${mime};base64,${fs.readFileSync(file).toString('base64')}` : null;
      return { name: e.name, size: st.size, mime, kind: kindOf(mime), note: notes[e.name]?.note ?? '', addedAt: notes[e.name]?.addedAt ?? st.mtime.toISOString(), thumb };
    }).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }

  // What the assistant reads first: the texts of the drawing, its frames and links, and the attachments with their notes.
  function summary(project, dir, elements) {
    const live = elements.filter((e) => e && !e.isDeleted);
    const texts = live.filter((e) => e.type === 'text' && String(e.text ?? '').trim()).sort((a, b) => (a.y - b.y) || (a.x - b.x)).map((e) => String(e.text).trim().replace(/\n+/g, ' / '));
    const frames = live.filter((e) => e.type === 'frame' && e.name).map((e) => e.name);
    const links = live.filter((e) => e.link).map((e) => e.link);
    const count = (t) => live.filter((e) => e.type === t).length;
    const shapes = [['rectangle', 'rectángulos'], ['ellipse', 'elipses'], ['diamond', 'rombos'], ['arrow', 'flechas'], ['line', 'líneas'], ['freedraw', 'trazos a mano'], ['image', 'imágenes']].map(([t, w]) => [count(t), w]).filter(([n]) => n).map(([n, w]) => `${n} ${w}`).join(', ');
    const att = attachments(dir, { thumbs: false });
    return [`# Pizarra de ${project.name}`, '', `Actualizada: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}. El dibujo completo está en pizarra/pizarra.png (míralo: las formas y flechas dicen tanto como los textos).`,
      shapes ? `Contiene: ${shapes}.` : 'El dibujo está vacío.', '',
      '## Textos del dibujo (de arriba abajo)', ...(texts.length ? texts.map((x) => `- ${x}`) : ['- (ninguno)']),
      ...(frames.length ? ['', '## Marcos', ...frames.map((x) => `- ${x}`)] : []),
      ...(links.length ? ['', '## Enlaces', ...links.map((x) => `- ${x}`)] : []),
      '', '## Adjuntos (carpeta pizarra/adjuntos)', ...(att.length ? att.map((a) => `- ${a.name} (${a.kind}, ${(a.size / MB).toFixed(1)} MB)${a.note ? `: ${a.note.replace(/\n+/g, ' ')}` : ''}`) : ['- (ninguno)']), ''].join('\n');
  }
  const writeSummary = (project, dir) => {
    const scene = readJson(path.join(dir, 'pizarra.excalidraw'), null);
    fs.writeFileSync(path.join(dir, 'PIZARRA.md'), summary(project, dir, scene?.elements ?? []));
  };

  return {
    load({ project: name }) {
      const { dir } = folder(name);
      const scene = readJson(path.join(dir, 'pizarra.excalidraw'), null);
      const files = {};
      const imgs = path.join(dir, 'imagenes');
      if (fs.existsSync(imgs)) for (const f of fs.readdirSync(imgs)) {
        const id = path.basename(f, path.extname(f)); const file = path.join(imgs, f);
        if (!/^[\w-]{1,100}$/.test(id) || fs.statSync(file).size > 25 * MB) continue;
        files[id] = { id, mimeType: mimeOf(f), dataURL: `data:${mimeOf(f)};base64,${fs.readFileSync(file).toString('base64')}`, created: fs.statSync(file).mtimeMs };
      }
      return { elements: Array.isArray(scene?.elements) ? scene.elements : [], appState: scene?.appState ?? {}, files, attachments: attachments(dir), updatedAt: scene ? fs.statSync(path.join(dir, 'pizarra.excalidraw')).mtime.toISOString() : null };
    },
    // The drawing (only the pictures not saved yet travel with it) and, now and then, its picture.
    save({ project: name, elements, appState = {}, files = {}, png }) {
      const place = folder(name); const { project, dir } = place;
      if (!Array.isArray(elements)) throw new Error(tr('msg.board.badScene'));
      const json = JSON.stringify({ type: 'excalidraw', version: 2, source: 'orb', elements: elements.filter((e) => e && !e.isDeleted),
        appState: { viewBackgroundColor: typeof appState.viewBackgroundColor === 'string' ? appState.viewBackgroundColor.slice(0, 40) : undefined, gridSize: Number(appState.gridSize) || null, gridModeEnabled: appState.gridModeEnabled === true }, files: {} });
      if (json.length > 40 * MB) throw new Error(tr('msg.board.tooBig'));
      ensure(place);
      fs.writeFileSync(path.join(dir, 'pizarra.excalidraw'), json);
      for (const [id, f] of Object.entries(files && typeof files === 'object' ? files : {}).slice(0, 50)) {
        const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(String(f?.dataURL ?? ''));
        if (!/^[\w-]{1,100}$/.test(id) || !m || m[2].length > 34 * MB) continue;
        const ext = EXT_OF[m[1]] ?? 'bin';
        const file = path.join(dir, 'imagenes', `${id}.${ext}`);
        if (!fs.existsSync(file)) fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
      }
      if (typeof png === 'string' && png.length < 40 * MB) {
        const data = png.replace(/^data:image\/png;base64,/, '');
        if (data) fs.writeFileSync(path.join(dir, 'pizarra.png'), Buffer.from(data, 'base64'));
        else fs.rmSync(path.join(dir, 'pizarra.png'), { force: true }); // nothing drawn: no picture
      }
      writeSummary(project, dir);
      board.changed('whiteboard');
      return { ok: true, at: new Date().toISOString() };
    },
    // Files attached from the PC (paths from the window's own dialog or dropped on it): copied into adjuntos/.
    attach({ project: name, paths }) {
      const place = folder(name); const { project, dir } = place;
      if (!Array.isArray(paths) || !paths.length || paths.length > 20) throw new Error(tr('msg.board.attachRange'));
      ensure(place);
      const notes = readJson(notesFile(dir), {}); const added = [];
      for (const p of paths) {
        const src = String(p ?? ''); let st;
        try { st = fs.statSync(src); } catch { continue; }
        if (!path.isAbsolute(src) || !st.isFile()) continue;
        if (st.size > 500 * MB) throw new Error(tr('msg.board.fileTooBig', { name: path.basename(src) }));
        let base = safeName(path.basename(src)); const ext = path.extname(base); const stem = base.slice(0, base.length - ext.length);
        for (let i = 2; fs.existsSync(path.join(dir, 'adjuntos', base)); i++) base = `${stem} (${i})${ext}`;
        fs.copyFileSync(src, path.join(dir, 'adjuntos', base));
        notes[base] = { note: '', addedAt: new Date().toISOString() }; added.push(base);
      }
      fs.writeFileSync(notesFile(dir), JSON.stringify(notes, null, 2));
      writeSummary(project, dir); board.changed('whiteboard');
      return attachments(dir);
    },
    note({ project: name, file, note }) {
      const { project, dir } = folder(name);
      const f = inside(path.join(dir, 'adjuntos'), safeName(file)); if (!fs.existsSync(f)) throw new Error(tr('msg.board.badFile'));
      const notes = readJson(notesFile(dir), {});
      notes[path.basename(f)] = { ...(notes[path.basename(f)] ?? { addedAt: new Date().toISOString() }), note: String(note ?? '').slice(0, 2000) };
      fs.writeFileSync(notesFile(dir), JSON.stringify(notes, null, 2));
      writeSummary(project, dir); board.changed('whiteboard');
      return true;
    },
    // Taken out of the panel: moved to pizarra/.papelera (never deleted), so it can be brought back by hand.
    remove({ project: name, file }) {
      const { project, dir } = folder(name);
      const f = inside(path.join(dir, 'adjuntos'), safeName(file)); if (!fs.existsSync(f)) throw new Error(tr('msg.board.badFile'));
      const bin = path.join(dir, '.papelera'); fs.mkdirSync(bin, { recursive: true });
      fs.renameSync(f, path.join(bin, `${Date.now()}-${path.basename(f)}`));
      const notes = readJson(notesFile(dir), {}); delete notes[path.basename(f)];
      fs.writeFileSync(notesFile(dir), JSON.stringify(notes, null, 2));
      writeSummary(project, dir); board.changed('whiteboard');
      return attachments(dir);
    },
    folder({ project: name }) { const place = folder(name); ensure(place); return place.dir; },
    // For the assistant's briefing: does this project have a drawing or attachments, and since when.
    info(name) {
      try {
        const { dir } = folder(name); const scene = path.join(dir, 'pizarra.excalidraw');
        const n = attachments(dir, { thumbs: false }).length;
        if (!fs.existsSync(scene) && !n) return null;
        return { dir, updatedAt: fs.existsSync(scene) ? fs.statSync(scene).mtime.toISOString() : null, attachments: n };
      } catch { return null; }
    }
  };
}
