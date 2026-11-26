// Which local speech-to-text engines this PC has. Read-only and quick: the PATH and the usual install folders. Detection
// is only «the file exists»: it never runs a program found on the PC, never downloads, installs or uses the network.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const exists = (file) => { try { return fs.statSync(file).isFile(); } catch { return false; } };
const isDir = (dir) => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } };

// Command names of the Whisper family: whisper.cpp (whisper-cli; the older «main» is too generic to look for) and the
// faster-whisper front ends. OpenAI's own «whisper» is left out: it downloads its model on first use.
const WHISPER_NAMES = ['whisper-cli', 'whisper-cpp', 'whisper-ctranslate2', 'faster-whisper-xxl'];

function inPath(names, env, platform) {
  // .cmd and .bat are skipped: they need a shell, and Orb starts programs directly (execFile)
  const exts = platform === 'win32' ? ['.exe', ''] : [''];
  for (const dir of String(env.PATH ?? env.Path ?? '').split(path.delimiter).filter((d) => d && path.isAbsolute(d))) {
    for (const name of names) for (const ext of exts) { const file = path.join(dir, name + ext); if (exists(file)) return file; }
  }
  return null;
}

export function handyCandidates(platform, env, home) {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
    const programs = env.ProgramFiles ?? 'C:\\Program Files';
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
// The first ggml model found (smallest name first), or null.
function findModel(dirs) {
  for (const dir of dirs) {
    if (!isDir(dir)) continue;
    try { const name = fs.readdirSync(dir).filter((n) => /^ggml-.+\.bin$/i.test(n)).sort()[0]; if (name) return path.join(dir, name); } catch { /* unreadable folder: no model there */ }
  }
  return null;
}

// → { handy: {found, file}, whisper: {found, file, model, modelFile} } (file is shown only under «Ver detalles técnicos»).
export async function detectEngines({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const handyFile = handyCandidates(platform, env, home).find(exists) ?? inPath(['handy'], env, platform);
  const whisperFile = inPath(WHISPER_NAMES, env, platform);
  const modelFile = whisperFile ? findModel(whisperModelDirs(env, home)) : null;
  return {
    handy: { found: Boolean(handyFile), file: handyFile },
    whisper: { found: Boolean(whisperFile), file: whisperFile, model: Boolean(modelFile), modelFile }
  };
}

// How long a transcription may take before it is given up (a long clip on a slow PC; the CLI is killed after that).
export const TRANSCRIBE_TIMEOUT_MS = 120_000;

// Starts a program directly (never through a shell) and gives its output; kills it after timeoutMs.
export function runCli(file, args, { timeoutMs = TRANSCRIBE_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) { const e = new Error(String(stderr || error.message).slice(0, 300)); e.code = error.killed ? 'timeout' : 'failed'; reject(e); return; }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

const failure = (code) => Object.assign(new Error(code), { code });

// The command line for each kind of Whisper program. whisper.cpp reads the model file given; the faster-whisper
// front ends are told to use only models already on disk, so they never download anything.
export function whisperCommand(file, { wav, model, outDir }) {
  const name = path.basename(file).toLowerCase().replace(/\.exe$/, '');
  if (name === 'whisper-ctranslate2' || name === 'faster-whisper-xxl') {
    return { args: [wav, '--output_dir', outDir, '--output_format', 'txt', '--local_files_only', 'True'], read: path.join(outDir, `${path.basename(wav, '.wav')}.txt`) };
  }
  return { args: ['-m', model, '-f', wav, '-nt', '-np', '-l', 'auto'], read: null };
}

// Writes the recording to a private temporary folder, runs the Whisper program found on this PC over it and returns the
// text. The folder is removed whatever happens. Errors carry a code: noEngine, noModel, timeout, failed, empty.
export async function transcribeWav(wav, { detect = detectEngines, run = runCli, timeoutMs = TRANSCRIBE_TIMEOUT_MS } = {}) {
  const found = (await detect()).whisper;
  if (!found?.found) throw failure('noEngine');
  const cpp = !/ctranslate2|faster-whisper/i.test(path.basename(found.file));
  if (cpp && !found.modelFile) throw failure('noModel');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-dictado-'));
  try {
    const file = path.join(dir, 'voz.wav');
    fs.writeFileSync(file, wav);
    const cmd = whisperCommand(found.file, { wav: file, model: found.modelFile, outDir: dir });
    let out;
    try { out = await run(found.file, cmd.args, { timeoutMs }); } catch (error) {
      if (error.code === 'timeout') throw failure('timeout');
      throw failure(!cpp && /local|not found|cannot find|no such file/i.test(error.message) ? 'noModel' : 'failed');
    }
    let text = out?.stdout ?? '';
    if (cmd.read) { try { text = fs.readFileSync(cmd.read, 'utf8'); } catch { text = ''; } }
    // whisper.cpp may print timestamps or [BLANK_AUDIO] markers: only the words are kept.
    text = text.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) throw failure('empty');
    return text.slice(0, 20_000);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* the OS cleans its temp folder */ }
  }
}
