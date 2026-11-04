// Wake-on-LAN (3.5, Magic Link): the centre Orb wakes the workshop Orb (a laptop asleep or off) with a «magic packet»:
// 6 bytes 0xFF and then the network card's MAC address 16 times, sent as a UDP broadcast on the local network.
// The MAC addresses come from the workshop itself when it links (see macAddresses).
import os from 'node:os';
import dgram from 'node:dgram';

const VIRTUAL = /vethernet|virtualbox|vmware|hyper-v|wsl|docker|loopback|tailscale|zerotier|bluetooth|vpn|tap|tun|^br-|^veth|^virbr|^lo$/i;

// "aa:bb:cc:dd:ee:ff", "AA-BB-CC-DD-EE-FF" or "aabbccddeeff" → "aa:bb:cc:dd:ee:ff" (null when it is not a usable MAC).
export function normalMac(mac) {
  const hex = String(mac ?? '').toLowerCase().replace(/[^0-9a-f]/g, '');
  if (hex.length !== 12 || /^0+$/.test(hex) || /^f+$/.test(hex)) return null;
  return hex.match(/../g).join(':');
}

export function magicPacket(mac) {
  const m = normalMac(mac); if (!m) throw new Error(`MAC no válida: ${mac}`);
  const bytes = Buffer.from(m.replace(/:/g, ''), 'hex');
  const out = Buffer.alloc(6 + 16 * 6, 0xff);
  for (let i = 0; i < 16; i++) bytes.copy(out, 6 + i * 6);
  return out;
}

// This machine's physical network cards (cable and Wi-Fi), without virtual adapters or VPNs: what a centre needs to wake it.
export function macAddresses() {
  const out = new Set();
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL.test(name)) continue;
    for (const a of list ?? []) { if (a.internal) continue; const m = normalMac(a.mac); if (m) out.add(m); }
  }
  return [...out].slice(0, 8);
}

// The broadcast address of every local IPv4 network of this machine (plus the general one).
export function broadcastAddresses() {
  const out = new Set(['255.255.255.255']);
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL.test(name)) continue;
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal || !a.netmask) continue;
      const ip = a.address.split('.').map(Number); const mask = a.netmask.split('.').map(Number);
      out.add(ip.map((b, i) => (b | (~mask[i] & 255))).join('.'));
    }
  }
  return [...out];
}

// Sends the packet of each MAC to every broadcast address (ports 9 and 7). ORB_WOL_DRY=1 (tests) builds them only.
export async function wake(macs, { addresses = broadcastAddresses(), ports = [9, 7] } = {}) {
  const packets = [...new Set((macs ?? []).map(normalMac).filter(Boolean))].map((m) => ({ mac: m, packet: magicPacket(m) }));
  if (!packets.length) return { sent: 0, macs: 0 };
  if (process.env.ORB_WOL_DRY === '1') return { sent: packets.length * addresses.length * ports.length, macs: packets.length, dry: true };
  const socket = dgram.createSocket('udp4');
  let sent = 0;
  try {
    await new Promise((resolve, reject) => { socket.once('error', reject); socket.bind(0, () => { socket.off('error', reject); resolve(); }); });
    socket.setBroadcast(true);
    for (const { packet } of packets) for (const address of addresses) for (const port of ports) {
      await new Promise((resolve) => socket.send(packet, port, address, (error) => { if (!error) sent++; resolve(); }));
    }
  } finally { try { socket.close(); } catch { /* closed */ } }
  return { sent, macs: packets.length };
}
