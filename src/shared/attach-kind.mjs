// 3.8.2: what an attached file is, by its extension. Shared by the engine (src/engine/attachments.mjs) and the
// interface (the attachment's icon), so it imports nothing.
const EXT = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'avif', 'svg', 'ico'],
  video: ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', '3gp', 'ts'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'wma', 'aiff', 'amr'],
  pdf: ['pdf'],
  document: ['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'doc', 'xls', 'ppt', 'epub'],
  archive: ['zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'jar', 'apk', 'aab', 'ipa'],
  text: ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'xml', 'html', 'htm', 'css', 'scss', 'less',
    'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'vue', 'svelte', 'py', 'rb', 'php', 'java', 'kt', 'kts', 'swift', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'go', 'rs',
    'dart', 'lua', 'r', 'sql', 'sh', 'bash', 'zsh', 'ps1', 'psm1', 'bat', 'cmd', 'gradle', 'properties', 'log', 'env', 'gitignore', 'dockerfile', 'srt', 'vtt', 'tex']
};
const KIND_OF = Object.fromEntries(Object.entries(EXT).flatMap(([k, list]) => list.map((e) => [e, k])));

// → image | video | audio | pdf | document | archive | text | other
export function kindOf(file) {
  const base = String(file ?? '').split(/[\\/]/).pop().toLowerCase();
  const ext = base.includes('.') ? base.split('.').pop() : base;
  return KIND_OF[ext] ?? 'other';
}

// 3.8.3: the audio and video Orb's window can play itself (WebView2's own formats), with their type: the attachment
// viewer opens these (src/ui/components/file-viewer.jsx); any other one stays a name. → mime | null
const PLAYABLE = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac' };
export function playableType(file) {
  const base = String(file ?? '').split(/[\/]/).pop().toLowerCase();
  return base.includes('.') ? PLAYABLE[base.split('.').pop()] ?? null : null;
}
