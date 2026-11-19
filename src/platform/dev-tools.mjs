// the big development tools some projects need (Flutter, the Android SDK, a JDK), as they really are on this PC.
// Checked for real because a note in the logs can say Flutter lives in core\herramientas\flutter while the user's PATH
// points there after a clean install removed it, and the coordinator cannot look inside core to tell that it is gone.
//
// Where these tools live: in their own standard places, outside Orb's folder (the Android SDK where Android Studio puts it,
// %LOCALAPPDATA%\Android\Sdk; Flutter in a folder of the user such as %USERPROFILE%\flutter or C:\src\flutter, as its own
// guide says), so every agent and the user's own terminal can run them and reinstalling or repairing Orb never takes them
// away (the clean install of 8 Nov emptied core, Flutter with it). Not in core: it is closed to agents except
// core\herramientas (src/domain/security/guard.mjs › OPEN_INTERNAL), which is for the small tools Orb downloads itself (adb, ffmpeg,
// the music); a tool found there still counts, since agents can run it. Not loose at the top of Orb's folder either (each
// folder there is a category or a project).
//
// The checks of the briefing are file checks only. The one program ever started is `java --version`, by the version report
// of «Prepara tu equipo» (devToolsReport): asynchronous, with a clean environment and a time limit, and its answer is kept
// for a while so opening the window again does not start it again.
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { ctx } from './context.mjs';
import { categoryOf } from './paths.mjs';
import { cleanEnv } from './proc.mjs';

// where the Android SDK may be (its variables, then Android Studio's default folder); android.mjs uses it too.
export function sdkRoots(env = process.env, platform = process.platform) {
  const home = env.USERPROFILE || env.HOME || '';
  return [env.ANDROID_SDK_ROOT, env.ANDROID_HOME,
    platform === 'win32' && env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Android', 'Sdk') : null,
    platform === 'darwin' && home ? path.join(home, 'Library', 'Android', 'sdk') : null,
    platform === 'linux' && home ? path.join(home, 'Android', 'Sdk') : null].filter((r) => r && path.isAbsolute(r));
}
// Where each one is installed from (its official page; Orb downloads none of them).
export const INSTALL_URL = Object.freeze({
  flutter: 'https://docs.flutter.dev/get-started/install',
  androidSdk: 'https://developer.android.com/studio',
  java: 'https://adoptium.net/'
});
const LABEL = { flutter: 'Flutter', androidSdk: 'Android SDK', java: 'Java (JDK)' };

const isFile = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
const isDir = (d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } };
const inside = (dir, root, win) => { if (!root) return false; const rel = path.relative(win ? root.toLowerCase() : root, win ? dir.toLowerCase() : dir); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };

// → [{ id, label, path (found and usable, or null), inCore (found only inside Orb's core), missing ([paths the PATH or a
//    variable names that do not exist]), url }]
export function checkDevTools({ env = process.env, platform = process.platform, core = ctx.paths?.core ?? null } = {}) {
  const win = platform === 'win32';
  const p = win ? path.win32 : path.posix;
  const home = env.USERPROFILE || env.HOME || '';
  const entries = String(env.PATH ?? env.Path ?? '').split(win ? ';' : ':').map((x) => x.trim().replace(/^"|"$/g, '')).filter((x) => x && p.isAbsolute(x));
  const exe = (name) => (win ? (name === 'flutter' ? 'flutter.bat' : `${name}.exe`) : name);
  const out = [];
  // One tool: its candidate folders (the PATH's first), the file that proves it, and the PATH entries that name it.
  const tool = (id, candidates, proves, named) => {
    const seen = new Set(); let found = null; let inCore = null;
    for (const dir of candidates.filter(Boolean)) {
      const key = win ? dir.toLowerCase() : dir; if (seen.has(key)) continue; seen.add(key);
      if (!proves(dir)) continue;
      if (core && inside(dir, core, win) && !inside(dir, p.join(core, 'herramientas'), win)) { inCore ??= dir; continue; }
      found = dir; break;
    }
    const missing = [...new Set(named.filter((d) => d && !isDir(d)))];
    out.push({ id, label: LABEL[id], path: found, inCore: found ? null : inCore, missing, url: INSTALL_URL[id] });
  };
  const flutterBins = [...entries.filter((d) => isFile(p.join(d, exe('flutter')))), env.FLUTTER_ROOT ? p.join(env.FLUTTER_ROOT, 'bin') : null,
    home && p.join(home, 'flutter', 'bin'), home && p.join(home, 'develop', 'flutter', 'bin'), win ? 'C:\\src\\flutter\\bin' : null,
    win && env.LOCALAPPDATA ? p.join(env.LOCALAPPDATA, 'flutter', 'bin') : null];
  tool('flutter', flutterBins, (d) => isFile(p.join(d, exe('flutter'))), [...entries.filter((d) => /flutter/i.test(d)), env.FLUTTER_ROOT]);
  const sdk = sdkRoots(env, platform);
  tool('androidSdk', sdk, (d) => ['platform-tools', 'platforms', 'cmdline-tools', 'build-tools'].some((x) => isDir(p.join(d, x))), [env.ANDROID_HOME, env.ANDROID_SDK_ROOT, ...entries.filter((d) => /android[\\/]+sdk/i.test(d))]);
  const studio = win && env.ProgramFiles ? p.join(env.ProgramFiles, 'Android', 'Android Studio', 'jbr', 'bin') : null;
  tool('java', [env.JAVA_HOME ? p.join(env.JAVA_HOME, 'bin') : null, ...entries.filter((d) => isFile(p.join(d, exe('java')))), studio], (d) => isFile(p.join(d, exe('java'))), [env.JAVA_HOME]);
  return out;
}

// The lines for the coordinator's briefing and the agents' briefs (Spanish, like the rest of their instructions).
export function devToolsBrief(list = checkDevTools(), user = 'el usuario') {
  const line = (t) => {
    const gone = t.missing.length ? ` (el PATH o una variable apunta a ${t.missing.join(', ')}, que no existe)` : '';
    if (t.path) return `- ${t.label}: instalado en ${t.path}.`;
    if (t.inCore) return `- ${t.label}: no disponible para los agentes (está dentro de core, en ${t.inCore}, donde no puedes entrar)${gone}. Si hace falta, dile a ${user} que lo instale fuera de la carpeta de Orb (${t.url}).`;
    return `- ${t.label}: no instalado${gone}. Si hace falta, díselo a ${user}: se instala desde ${t.url}, fuera de la carpeta de Orb. No lo busques en core.`;
  };
  return `## Herramientas de desarrollo de este PC (las acaba de comprobar Orb: esto manda sobre lo que digan las bitácoras o notas anteriores)\n${list.map(line).join('\n')}`;
}

// Whether a task's brief needs them: a mobile or multiplatform project, or a brief that names these tools.
export const needsDevTools = (project, text = '') => ['android', 'ios', 'multi'].includes(String((project?.path && categoryOf(ctx.home ?? '', project.path)) ?? ''))
  || /\b(flutter|dart|android|gradle|apk|aab|kotlin|jdk|java)\b/i.test(String(text));

// ---- what «Prepara tu equipo» shows: each tool with its version, when it can be told.
// Nothing is installed or downloaded here and nothing but `--version` is ever run (Java only, when its `release` file says
// nothing); Flutter and the Android SDK are read from their own files, because `flutter --version` can start a download.
const firstLine = (f) => { try { return fs.readFileSync(f, 'utf8').split(/\r?\n/)[0].trim(); } catch { return ''; } };
const versionIn = (text) => String(text ?? '').match(/\d+(?:\.\d+)+/)?.[0] ?? null;
const maxVersion = (names) => names.map((n) => versionIn(n)).filter(Boolean).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).at(-1) ?? null;
const listDir = (d) => { try { return fs.readdirSync(d); } catch { return []; } };

// The version of a tool found at `where` (a folder from checkDevTools), or null when it cannot be read without running it.
export function toolVersion(id, where, { run = defaultRun, platform = process.platform, core = ctx.paths?.core ?? null } = {}) {
  if (!where) return null;
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (id === 'flutter') {
    const root = p.dirname(where); // .../flutter/bin → .../flutter
    const fromFile = versionIn(firstLine(p.join(root, 'version')));
    if (fromFile) return fromFile;
    try { return versionIn(JSON.parse(fs.readFileSync(p.join(root, 'bin', 'cache', 'flutter.version.json'), 'utf8')).frameworkVersion); } catch { return null; }
  }
  if (id === 'androidSdk') return maxVersion(listDir(p.join(where, 'build-tools')));
  if (id === 'java') {
    const home = p.dirname(where); // .../jdk/bin → .../jdk
    const release = (() => { try { return /JAVA_VERSION="?([\d._]+)/.exec(fs.readFileSync(p.join(home, 'release'), 'utf8'))?.[1] ?? null; } catch { return null; } })();
    if (release) return release;
    // Agents can write inside Orb's folder (core\herramientas included): a java.exe planted there must never be run by the engine.
    if (inside(where, core, platform === 'win32')) return null;
    return versionIn(run(p.join(where, platform === 'win32' ? 'java.exe' : 'java'), ['--version']));
  }
  return null;
}
// What `java --version` said, per executable, kept for PROBE_TTL_MS (a new install can be seen sooner with forgetProbes()).
const PROBE_TTL_MS = 10 * 60_000;
const probes = new Map();
export const forgetProbes = () => probes.clear();
const cachedRun = (file) => { const hit = probes.get(file); return hit && Date.now() - hit.at < PROBE_TTL_MS ? hit.out : null; };
function probeAsync(file, args) {
  return new Promise((resolve) => {
    try { execFile(file, args, { timeout: 5000, windowsHide: true, encoding: 'utf8', env: cleanEnv(), maxBuffer: 64 * 1024 }, (error, stdout, stderr) => resolve(error ? '' : `${stdout}
${stderr}`)); } catch { resolve(''); }
  });
}

// → [{ id, label, installed, version (or null), optional: true, url }]; the folder it was found in stays here (the window need not know it).
// A `run` given in the options (tests) answers synchronously; otherwise the program is asked without blocking the engine.
export async function devToolsReport(options = {}) {
  const out = [];
  for (const t of checkDevTools(options)) {
    const asked = [];
    const run = options.run ?? ((file, args) => { const hit = cachedRun(file); if (hit !== null) return hit; asked.push([file, args]); return ''; });
    let version = toolVersion(t.id, t.path, { ...options, run });
    if (!options.run && asked.length) {
      const [file, args] = asked[0];
      const said = await probeAsync(file, args);
      probes.set(file, { at: Date.now(), out: said });
      version = versionIn(said);
    }
    out.push({ id: t.id, label: t.label, installed: Boolean(t.path), version, optional: true, url: t.url });
  }
  return out;
}
