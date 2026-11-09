// 3.8.3: the big development tools some projects need (Flutter, the Android SDK, a JDK), as they really are on this PC.
// Up to 3.8.2 nothing checked them: an old note in the logs said Flutter lived in core\herramientas\flutter, the user's
// PATH still pointed there after a clean install removed it, and the coordinator cannot look inside core, so nobody could
// tell that it was gone.
//
// Where these tools live: in their own standard places, outside Orb's folder (the Android SDK where Android Studio puts it,
// %LOCALAPPDATA%\Android\Sdk; Flutter in a folder of the user such as %USERPROFILE%\flutter or C:\src\flutter, as its own
// guide says), so every agent and the user's own terminal can run them and reinstalling or repairing Orb never takes them
// away (the clean install of 8 Nov emptied core, Flutter with it). Not in core: it is closed to agents except
// core\herramientas (src/core/guard.mjs › OPEN_INTERNAL), which is for the small tools Orb downloads itself (adb, ffmpeg,
// the music); a tool found there still counts, since agents can run it. Not loose at the top of Orb's folder either (each
// folder there is a category or a project).
//
// Only file checks (no program is started): cheap enough for every briefing.
import fs from 'node:fs';
import path from 'node:path';
import { ctx } from '../platform/context.mjs';
import { categoryOf } from '../platform/paths.mjs';
import { sdkRoots } from './android.mjs';

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
    if (t.inCore) return `- ${t.label}: no disponible para los agentes (está dentro de core, en ${t.inCore}, donde no podéis entrar)${gone}. Si hace falta, dile a ${user} que lo instale fuera de la carpeta de Orb (${t.url}).`;
    return `- ${t.label}: no instalado${gone}. Si hace falta, díselo a ${user}: se instala desde ${t.url}, fuera de la carpeta de Orb. No lo busques en core.`;
  };
  return `## Herramientas de desarrollo de este PC (las acaba de comprobar Orb: esto manda sobre lo que digan las bitácoras o notas anteriores)\n${list.map(line).join('\n')}`;
}

// Whether a task's brief needs them: a mobile or multiplatform project, or a brief that names these tools.
export const needsDevTools = (project, text = '') => ['android', 'ios', 'multi'].includes(String((project?.path && categoryOf(ctx.home ?? '', project.path)) ?? ''))
  || /\b(flutter|dart|android|gradle|apk|aab|kotlin|jdk|java)\b/i.test(String(text));
