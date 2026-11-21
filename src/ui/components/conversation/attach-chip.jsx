// What the user attached to a message of the chat with Orbe: the icon by kind and the name, as under an agent's message.
// The files live in Orb's own folder for that conversation, which the window's viewer does not open, so here they are labels.
import { ImageIcon, Film, Music, FileText, FileArchive, File as FileIcon, FileCode } from 'lucide-react';
import { kindOf } from '../../../shared/attach-kind.mjs';
import { baseName } from '@/lib/utils.js';

const ICON = { image: ImageIcon, video: Film, audio: Music, pdf: FileText, document: FileText, archive: FileArchive, text: FileCode };

export function AttachIcon({ file, className }) {
  const I = ICON[kindOf(file)] ?? FileIcon;
  return <I className={className} />;
}

export function AttachedFiles({ files }) {
  if (!Array.isArray(files) || !files.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" data-testid="message-attachments">
      {files.map((file) => (
        <span key={file} className="inline-flex items-center gap-1 rounded-md bg-white/15 px-2 py-0.5 text-xs" data-testid="message-attachment"><AttachIcon file={file} className="size-3" />{baseName(file)}</span>
      ))}
    </div>
  );
}
