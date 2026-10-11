// 2.7: Monitoreo del equipo › Red. The Wi-Fi this PC is on, the networks around, the devices of the same network and
// the Android phones and TVs reachable by adb. Read only and real: Windows' own answers (netsh, the neighbour table);
// a value Windows does not give is null. Finding devices sends one ping to each address of this PC's own /24 network
// (never other networks, never ports); the Android side runs fixed adb commands on devices the user paired.
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { powershell } from './pc-health.mjs';

const IS_WIN = process.platform === 'win32';
const run = (cmd, args, timeoutMs = 20000) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ ok: !error, out: String(stdout ?? ''), err: String(stderr ?? error?.message ?? '') }));
});
// netsh answers in the language of Windows: each field is found by its name in Spanish or English.
const FIELDS = {
  ssid: /^SSID$/i, bssid: /^(AP )?BSSID/i, state: /^(Estado|State)$/i, signal: /^(Señal|Signal)$/i, rssi: /^Rssi$/i, band: /^(Banda|Band)$/i,
  channel: /^(Canal|Channel)$/i, radio: /^(Tipo de radio|Radio type)$/i, auth: /^(Autenticación|Authentication)$/i, cipher: /^(Cifrado|Cipher)$/i,
  rx: /^(Velocidad de recepción|Receive rate)/i, tx: /^(Velocidad de transmisión|Transmit rate)/i, iface: /^(Nombre|Name)$/i, description: /^(Descripción|Description)$/i
};
const parseBlock = (lines) => {
  const out = {};
  for (const line of lines) {
    const i = line.indexOf(':'); if (i < 0) continue;
    const key = line.slice(0, i).trim(); const value = line.slice(i + 1).trim();
    for (const [name, re] of Object.entries(FIELDS)) if (!(name in out) && re.test(key)) out[name] = value;
  }
  return out;
};
const pct = (v) => { const n = parseInt(String(v ?? ''), 10); return Number.isFinite(n) ? n : null; };
const mbps = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };

// The Wi-Fi in use (null on a cable, or without Wi-Fi).
export async function wifi() {
  if (!IS_WIN) return null;
  const r = await run('netsh', ['wlan', 'show', 'interfaces']);
  if (!r.ok) return null;
  const f = parseBlock(r.out.split(/\r?\n/));
  if (!f.ssid) return null;
  return { ssid: f.ssid, signalPct: pct(f.signal), rssi: pct(f.rssi), band: f.band ?? null, channel: pct(f.channel), radio: f.radio ?? null, security: f.auth ?? null, cipher: f.cipher ?? null, rxMbps: mbps(f.rx), txMbps: mbps(f.tx), adapter: f.description ?? null };
}

// The networks within reach (Windows may need location permission to list them: then none, and why).
export async function nearby() {
  if (!IS_WIN) return { networks: [], blocked: false };
  const r = await run('netsh', ['wlan', 'show', 'networks', 'mode=bssid']);
  if (!r.ok) return { networks: [], blocked: /ubicaci|location/i.test(r.out + r.err) };
  const blocks = r.out.split(/\r?\n(?=SSID \d+ :)/).filter((b) => /^SSID \d+ :/.test(b.trim()));
  const networks = blocks.map((b) => {
    const lines = b.split(/\r?\n/); const name = lines[0].replace(/^SSID \d+ :/, '').trim();
    const f = parseBlock(lines.slice(1));
    return { ssid: name || null, signalPct: pct(f.signal), security: f.auth ?? null, band: f.band ?? null, channel: pct(f.channel) };
  }).filter((n) => n.ssid || n.signalPct != null);
  return { networks: networks.sort((a, b) => (b.signalPct ?? 0) - (a.signalPct ?? 0)).slice(0, 40), blocked: false };
}

// This PC on its network: its address, the router, and the devices Windows knows of on it (its neighbour table).
// sweep: first one ping to every address of the own /24, so the table has everything that answers.
export async function devices({ sweep = false } = {}) {
  if (!IS_WIN) return { me: null, devices: [] };
  const me = await powershell("$c = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1; if ($c) { [pscustomobject]@{ Ip = $c.IPv4Address.IPAddress | Select-Object -First 1; Prefix = ($c.IPv4Address.PrefixLength | Select-Object -First 1); Gateway = $c.IPv4DefaultGateway.NextHop | Select-Object -First 1; Interface = $c.InterfaceAlias; Index = $c.InterfaceIndex } | ConvertTo-Json -Compress }");
  if (!me?.Ip) return { me: null, devices: [] };
  const base = String(me.Ip).split('.').slice(0, 3).join('.');
  if (sweep && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(base)) await powershell(`$t = 1..254 | ForEach-Object { (New-Object System.Net.NetworkInformation.Ping).SendPingAsync('${base}.' + $_, 400) }; try { [Threading.Tasks.Task]::WaitAll($t) } catch {}; 'ok' | ConvertTo-Json`, { timeoutMs: 20000 });
  const rows = await powershell(`Get-NetNeighbor -AddressFamily IPv4 -InterfaceIndex ${Number(me.Index)} -ErrorAction SilentlyContinue | Where-Object { $_.State -in 'Reachable','Stale','Delay','Probe','Permanent' -and $_.LinkLayerAddress -and $_.LinkLayerAddress -ne '00-00-00-00-00-00' -and $_.LinkLayerAddress -ne 'FF-FF-FF-FF-FF-FF' -and $_.IPAddress -like '${base}.*' -and $_.IPAddress -notlike '*.255' } | Select-Object IPAddress, LinkLayerAddress, @{n='State';e={$_.State.ToString()}} | ConvertTo-Json -Compress`);
  const list = (Array.isArray(rows) ? rows : rows ? [rows] : []);
  // Names: what the network's DNS says of each address (often the router names them), a second at most each.
  const names = list.length ? await powershell(`$o = @{}; ${JSON.stringify(list.map((d) => d.IPAddress))} | ConvertFrom-Json | ForEach-Object { try { $n = (Resolve-DnsName -Name $_ -Type PTR -QuickTimeout -DnsOnly -ErrorAction Stop | Select-Object -First 1).NameHost; if ($n) { $o[$_] = $n } } catch {} }; $o | ConvertTo-Json -Compress`, { timeoutMs: 30000 }) : {};
  const devicesList = list.map((d) => {
    const mac = String(d.LinkLayerAddress).toLowerCase().replace(/-/g, ':');
    const second = parseInt(mac[1], 16);
    return { ip: d.IPAddress, mac, name: names?.[d.IPAddress] ?? null, privateMac: Number.isFinite(second) && (second & 2) === 2, router: d.IPAddress === me.Gateway, state: d.State };
  }).sort((a, b) => Number(b.router) - Number(a.router) || a.ip.split('.').map(Number)[3] - b.ip.split('.').map(Number)[3]);
  return { me: { ip: me.Ip, prefix: me.Prefix, gateway: me.Gateway, interface: me.Interface }, devices: devicesList };
}

// ---- Android phones and TVs (adb). The adb of Orb (Ajustes › Herramientas › Android) or the one in PATH.
const SERIAL = /^[\w.:\-]{1,80}$/;
const HOSTPORT = /^\d{1,3}(\.\d{1,3}){3}:\d{2,5}$/;
export function adbDevices(adb) {
  return run(adb, ['devices', '-l']).then((r) => r.out.split(/\r?\n/).slice(1).map((l) => l.trim()).filter(Boolean).map((l) => {
    const [serial, state, ...rest] = l.split(/\s+/); const kv = Object.fromEntries(rest.map((x) => x.split(':')).filter((p) => p.length === 2));
    return { serial, state, model: kv.model?.replace(/_/g, ' ') ?? null, device: kv.device ?? null, wireless: /:\d+$|_adb-tls-connect/.test(serial) };
  }));
}
export async function adbPair(adb, hostport, code) {
  if (!HOSTPORT.test(hostport) || !/^\d{6}$/.test(code)) throw new Error('bad pairing data');
  const r = await run(adb, ['pair', hostport, code], 30000);
  return { ok: /success/i.test(r.out), detail: (r.out || r.err).trim().slice(0, 300) };
}
export async function adbConnect(adb, hostport) {
  if (!HOSTPORT.test(hostport)) throw new Error('bad address');
  const r = await run(adb, ['connect', hostport], 20000);
  return { ok: /connected to/i.test(r.out) && !/fail|unable|cannot/i.test(r.out), detail: (r.out || r.err).trim().slice(0, 300) };
}
// How a paired device is: model, Android, battery, memory, storage and the apps using the most memory.
export async function adbInfo(adb, serial) {
  if (!SERIAL.test(serial)) throw new Error('bad device');
  const sh = (cmd) => run(adb, ['-s', serial, 'shell', cmd], 20000).then((r) => (r.ok ? r.out : ''));
  const [props, battery, mem, df, top] = await Promise.all([
    sh('getprop ro.product.manufacturer; getprop ro.product.model; getprop ro.build.version.release; getprop ro.build.characteristics'),
    sh('dumpsys battery'), sh('cat /proc/meminfo'), sh('df /data'), sh('dumpsys meminfo -s 2>/dev/null | head -40')
  ]);
  const [maker, model, release, kind] = props.split(/\r?\n/).map((x) => x.trim());
  const b = (k) => { const m = battery.match(new RegExp(`${k}:\\s*(-?\\d+)`)); return m ? Number(m[1]) : null; };
  const kb = (k) => { const m = mem.match(new RegExp(`${k}:\\s*(\\d+)`)); return m ? Number(m[1]) : null; };
  const total = kb('MemTotal'); const avail = kb('MemAvailable');
  const dfLine = df.split(/\r?\n/).find((l) => /\/data/.test(l)); const parts = dfLine?.trim().split(/\s+/) ?? [];
  const apps = [...top.matchAll(/^\s*([\d,]+)K: (\S+) \(pid/mg)].slice(0, 8).map((m) => ({ app: m[2], memMb: Math.round(Number(m[1].replace(/,/g, '')) / 1024) }));
  return {
    serial, maker: maker || null, model: model || null, android: release || null, tv: /tv/i.test(kind ?? ''),
    battery: { levelPct: b('level'), tempC: b('temperature') != null ? b('temperature') / 10 : null, charging: /AC powered: true|USB powered: true|Wireless powered: true/.test(battery) },
    memory: total ? { totalMb: Math.round(total / 1024), usedPct: avail != null ? Math.round(100 * (1 - avail / total)) : null } : null,
    storage: parts.length >= 4 ? { totalKb: Number(parts[1]) || null, usedKb: Number(parts[2]) || null, usedPct: parseInt(parts[4], 10) || null } : null,
    topApps: apps
  };
}
export const adbAvailable = (p) => Boolean(p && fs.existsSync(p));
