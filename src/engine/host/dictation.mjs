// Which local speech-to-text engines this PC has. Read-only and quick: the PATH and the usual install folders, and a
// version flag with a short timeout on command-line engines. It never downloads, installs or uses the network, and it
// never starts a window (Handy is a desktop app: it is found by its file, not run).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const exists = (file) => { try { return fs.statSync(file).isFile(); } catch { return false; } };
const isDir = (dir) => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } };

// Command names of the Whisper family: whisper.cpp (whisper-cli, older «main» is too generic to look for), OpenAI's
// whisper and faster-whisper front ends.
const WHISPER_NAMES = ['whisper-cli', 'whisper-cpp', 'whisper-ctranslate2', 'faster-whisper-xxl', 'faster-whisper', 'whisper'];

function inPath(names, env, platform) {
  const exts = platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of String(env.PATH ?? env.Path ?? '').split(path.delimiter).filter((d) => d && path.isAbsolute(d))) {
    for (const name of names) for (const ext of exts) { const file = path.join(dir, name + ext); if (exists(file)) return file; }
  }
  return null;
}

function handyCandidates(platform, env, home) {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
    const programs = env.ProgramFiles ?? 'C:\Program Files';
    return [path.join(local, 'Handy', 'handy.exe'), path.join(local, 'Programs', 'Handy', 'handy.exe'), path.join(local, 'Programs', 'handy', 'handy.exe'), path.join(programs, 'Handy', 'handy.exe')];
  }
  if (platform === 'darwin') return ['/Applications/Handy.app/Contents/MacOS/Handy', path.join(home, 'Applications', 'Handy.app', 'Contents', 'MacOS', 'Handy')];
  return [path.join(home, '.local', 'bin', 'handy'), '/usr/bin/handy', '/usr/local/bin/handy', '/opt/Handy/handy'];
}

// whisper.cpp reads a ggml model file; faster-whisper downloads its own, so only the former is looked for. The folder
// is only listed, never filled.
function whisperModelDirs(env, home) {
  const local = env.LOCALAPPDATA;
  return [env.WHISPER_MODEL_DIR, env.WHISPER_CPP_MODELS, path.join(home, '.cache', 'whisper'), path.join(home, 'whisper.cpp', 'models'), local ? path.join(local, 'whisper') : null].filter(Boolean);
}
function hasModel(dirs) {
  for (const dir of dirs) {
    if (!isDir(dir)) continue;
    try { if (fs.readdirSync(dir).some((n) => /^ggml-.+\.bin$/i.test(n) || /\.(pt|gguf)$/i.test(n))) return true; } catch { /* unreadable folder: no model there */ }
  }
  return false;
}

// Runs «<file> --version» and gives its first line; null when it fails or takes longer than timeoutMs. Scripts that
// need a shell (.cmd, .bat) are not run: Orb never starts programs through cmd.exe.
export function probeVersion(file, timeoutMs = 1500) {
  if (/\.(cmd|bat)$/i.test(file)) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      execFile(file, ['--version'], { timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 }, (error, stdout, stderr) => {
        const line = String(stdout || stderr || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean);
        resolve(line ? line.slice(0, 80) : null);
      });
    } catch { resolve(null); }
  });
}

// → { handy: {found, file}, whisper: {found, file, version, model} } (file is shown only under «Ver detalles técnicos»).
export async function detectEngines({ platform = process.platform, env = process.env, home = os.homedir(), probe = probeVersion } = {}) {
  const handyFile = handyCandidates(platform, env, home).find(exists) ?? inPath(['handy'], env, platform);
  const whisperFile = inPath(WHISPER_NAMES, env, platform);
  const version = whisperFile ? await probe(whisperFile) : null;
  return {
    handy: { found: Boolean(handyFile), file: handyFile },
    whisper: { found: Boolean(whisperFile), file: whisperFile, version, model: whisperFile ? hasModel(whisperModelDirs(env, home)) : false }
  };
}
