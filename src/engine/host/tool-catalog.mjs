// The programs Orb can install for the user beyond the agents, and everything that decides what may be installed.
// Nothing here comes from the user, an agent or a project file: the winget ids below are the whole list, and the install
// text for each one is built from this table only (a key that is not in it throws). winget checks the installer's hash on
// its own, and nothing here switches that check off. The one step that does not go through winget (Playwright's browser,
// npm) is a fixed command with a pinned version, so it does not follow «latest».
import fs from 'node:fs';
import path from 'node:path';

// tool id → winget package id. Checked against `winget show --id <id> -e --source winget`.
export const WINGET_IDS = Object.freeze({
  git: 'Git.Git', node: 'OpenJS.NodeJS.LTS', gh: 'GitHub.cli', tailscale: 'Tailscale.Tailscale',
  uv: 'astral-sh.uv', rg: 'BurntSushi.ripgrep.MSVC', pwsh: 'Microsoft.PowerShell', jq: 'jqlang.jq', gitLfs: 'GitHub.GitLFS',
  java: 'Microsoft.OpenJDK.21', androidSdk: 'Google.AndroidStudio',
  rustup: 'Rustlang.Rustup', go: 'GoLang.Go', dotnet: 'Microsoft.DotNet.SDK.8', bun: 'Oven-sh.Bun', docker: 'Docker.DockerDesktop',
  buildTools: 'Microsoft.VisualStudio.2022.BuildTools', pnpm: 'pnpm.pnpm'
});
const ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;
const COMMON = '-e --source winget --accept-package-agreements --accept-source-agreements --disable-interactivity';
// C++ workload for Rust and npm native modules; the Build Tools installer takes its own arguments through --override.
const OVERRIDE = { buildTools: "'--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'" };

export function wingetId(key) {
  const id = Object.hasOwn(WINGET_IDS, key) ? WINGET_IDS[key] : null;
  if (!id || !ID_SHAPE.test(id)) throw new Error(`not an installable tool: ${String(key).slice(0, 40)}`);
  return id;
}
export function wingetInstall(key) {
  const id = wingetId(key);
  return OVERRIDE[key] ? `winget install --id ${id} ${COMMON} --override ${OVERRIDE[key]}` : `winget install --id ${id} ${COMMON} --silent`;
}
export function wingetUpgrade(key) { return `winget upgrade --id ${wingetId(key)} ${COMMON} --silent`; }

// The tools added in this group of the page. `group` places them; `after: ['node']` makes the plan add Node when it is missing.
// Playwright is pinned to the version this repo's own dependency (playwright-core) uses; only Chromium is fetched.
export const PLAYWRIGHT_VERSION = '1.63.0';
export const EXTRA_ITEMS = [
  { id: 'uv', label: 'Python + uv', group: 'rec', wingetKey: 'uv' },
  { id: 'rg', label: 'ripgrep', group: 'rec', wingetKey: 'rg' },
  { id: 'pwsh', label: 'PowerShell 7', group: 'rec', wingetKey: 'pwsh' },
  { id: 'jq', label: 'jq', group: 'rec', wingetKey: 'jq' },
  { id: 'gitLfs', label: 'Git LFS', group: 'rec', wingetKey: 'gitLfs' },
  { id: 'pnpm', label: 'pnpm', group: 'rec', wingetKey: 'pnpm' },
  { id: 'java', label: 'Java (OpenJDK)', group: 'mobile', wingetKey: 'java' },
  { id: 'androidSdk', label: 'Android Studio', group: 'mobile', wingetKey: 'androidSdk' },
  { id: 'rustup', label: 'Rust', group: 'lang', wingetKey: 'rustup' },
  { id: 'go', label: 'Go', group: 'lang', wingetKey: 'go' },
  { id: 'dotnet', label: '.NET SDK', group: 'lang', wingetKey: 'dotnet' },
  { id: 'bun', label: 'Bun', group: 'lang', wingetKey: 'bun' },
  { id: 'docker', label: 'Docker Desktop', group: 'lang', wingetKey: 'docker' },
  { id: 'buildTools', label: 'Build Tools C++', group: 'lang', wingetKey: 'buildTools' },
  { id: 'playwright', label: 'Playwright', group: 'lang', install: `npx --yes playwright@${PLAYWRIGHT_VERSION} install chromium`, after: ['node'] }
];

// How to see that one is there: the program that answers, and the places its installer leaves it when the PATH of this
// process has not caught up. Only `--version`-like calls run, and only on a fixed name or a fixed folder.
const env = (k) => process.env[k] ?? '';
const links = () => path.join(env('LOCALAPPDATA'), 'Microsoft', 'WinGet', 'Links');
const home = () => env('USERPROFILE');
const pf = () => env('ProgramFiles') || 'C:\\Program Files';
export const PROBES = {
  uv: { exe: 'uv', args: ['--version'], dirs: () => [path.join(home(), '.local', 'bin'), links()] },
  rg: { exe: 'rg', args: ['--version'], dirs: () => [links()] },
  pwsh: { exe: 'pwsh', args: ['--version'], dirs: () => [path.join(pf(), 'PowerShell', '7')] },
  jq: { exe: 'jq', args: ['--version'], dirs: () => [links()] },
  pnpm: { exe: 'pnpm', args: ['--version'], dirs: () => [path.join(env('LOCALAPPDATA'), 'pnpm'), links()] },
  gitLfs: { exe: 'git', args: ['lfs', 'version'], dirs: () => [path.join(pf(), 'Git', 'cmd')] },
  rustup: { exe: 'rustup', args: ['--version'], dirs: () => [path.join(home(), '.cargo', 'bin')] },
  go: { exe: 'go', args: ['version'], dirs: () => [path.join(pf(), 'Go', 'bin')] },
  dotnet: { exe: 'dotnet', args: ['--version'], dirs: () => [path.join(pf(), 'dotnet')] },
  bun: { exe: 'bun', args: ['--version'], dirs: () => [path.join(home(), '.bun', 'bin'), links()] },
  docker: { exe: 'docker', args: ['--version'], dirs: () => [path.join(pf(), 'Docker', 'Docker', 'resources', 'bin')] }
};
const isDir = (d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } };
export const playwrightInstalled = () => { const d = path.join(env('LOCALAPPDATA'), 'ms-playwright'); try { return isDir(d) && fs.readdirSync(d).some((n) => /^chromium/i.test(n)); } catch { return false; } };
export const vswhere = () => path.join(env('ProgramFiles(x86)') || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
export const androidStudioDir = () => path.join(pf(), 'Android', 'Android Studio');
export const hasAndroidStudio = () => isDir(androidStudioDir());

// Which tool a project file asks for. A project is only looked at on its top folder; the names are fixed.
const MARKERS = [
  { tool: 'uv', test: (n) => n === 'pyproject.toml' },
  { tool: 'rustup', test: (n) => n === 'Cargo.toml' },
  { tool: 'go', test: (n) => n === 'go.mod' },
  { tool: 'dotnet', test: (n) => /\.csproj$/i.test(n) },
  { tool: 'docker', test: (n) => n === 'Dockerfile' },
  { tool: 'flutter', test: (n) => n === 'pubspec.yaml' }
];
export function suggestionsFor(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return MARKERS.flatMap((m) => { const file = names.find(m.test); return file ? [{ tool: m.tool, file }] : []; });
}

// `winget upgrade` as a table → { toolId: { current, latest } } for the tools of the list only (anything else in it is ignored).
export function parseUpgrades(text) {
  const ids = Object.entries(WINGET_IDS).map(([k, v]) => [v.toLowerCase(), k]);
  // winget cuts a long Id with an ellipsis in a narrow table: a cut id names the tool only when one id starts with it
  const toolOf = (col) => {
    const c = col.toLowerCase();
    const exact = ids.find(([id]) => id === c);
    if (exact) return exact[1];
    const cut = c.replace(/(…|\.{3})$/, '');
    if (cut === c || cut.length < 6) return null;
    const hit = ids.filter(([id]) => id.startsWith(cut));
    return hit.length === 1 ? hit[0][1] : null;
  };
  const out = {};
  for (const line of String(text ?? '').split(/\r?\n/)) {
    // Read by tokens, not by runs of spaces: winget may leave a single space after the longest value of a column, and a name
    // holds spaces, but an Id and the versions never do, so the Id and the two tokens after it are the row's data.
    const cols = line.trim().split(/\s+/);
    const i = cols.findIndex((c) => toolOf(c));
    if (i < 0) continue;
    const rest = cols.slice(i + 1).filter((c) => !/^[<>~]+$/.test(c));
    const current = rest[0]?.replace(/^[<>~]+/, ''); const latest = rest[1];
    if (current && latest && /\d/.test(current) && /\d/.test(latest)) out[toolOf(cols[i])] = { current, latest };
  }
  return out;
}
