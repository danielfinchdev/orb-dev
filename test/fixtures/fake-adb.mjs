// A stand-in for Android's adb (3.8.2): the tests never run the real one, nor reach a phone. It answers the commands
// src/engine/host/android.mjs sends and writes each one (its arguments, one JSON line) to FAKE_ADB_LOG.
//   FAKE_ADB_DIR   its state: mdns.txt (what `adb mdns services` lists), installed (an app was installed)
//   FAKE_ADB_CODE  the pairing password or code it accepts (any, when not set)
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dir = process.env.FAKE_ADB_DIR ?? '.';
if (process.env.FAKE_ADB_LOG) fs.appendFileSync(process.env.FAKE_ADB_LOG, `${JSON.stringify(args)}\n`);
const out = (s) => process.stdout.write(s);
const a = args[0] === '-s' ? args.slice(2) : args;
const installed = () => fs.existsSync(path.join(dir, 'installed'));

if (a[0] === 'devices') out('List of devices attached\n192.168.1.20:41000\tdevice product:shiba model:Pixel_8 device:shiba transport_id:1\n\n');
else if (a[0] === 'mdns') { let t = ''; try { t = fs.readFileSync(path.join(dir, 'mdns.txt'), 'utf8'); } catch { /* none */ } out(`List of discovered mdns services\n${t}`); }
else if (a[0] === 'pair') {
  if (!process.env.FAKE_ADB_CODE || a[2] === process.env.FAKE_ADB_CODE) out(`Successfully paired to ${a[1]} [guid=adb-R5CT10ABCD-xyz]\n`);
  else { process.stderr.write('Failed: Wrong password or connection was dropped.\n'); process.exit(1); }
} else if (a[0] === 'connect') out(`connected to ${a[1]}\n`);
else if (a[0] === 'disconnect' || a[0] === 'kill-server') out('');
else if (a[0] === 'install') { fs.writeFileSync(path.join(dir, 'installed'), '1'); out('Performing Streamed Install\nSuccess\n'); }
else if (a[0] === 'uninstall') out('Success\n');
else if (a[0] === 'exec-out' && a[1] === 'screencap') {
  // A PNG's signature and its IHDR (1080×2400): enough for the size Orb reads.
  const png = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  png.writeUInt32BE(13, 8); png.write('IHDR', 12, 'latin1'); png.writeUInt32BE(1080, 16); png.writeUInt32BE(2400, 20);
  process.stdout.write(png);
} else if (a[0] === 'logcat') out('11-08 10:00:00.000  123  123 I MiApp: arrancada\n11-08 10:00:01.000  123  123 E MiApp: fallo de prueba\n');
else if (a[0] === 'shell' && a[1] === 'pm') out(`package:/data/app/~~a/com.otra.app-1/base.apk=com.otra.app\n${installed() ? 'package:/data/app/~~b/com.ejemplo.app-2/base.apk=com.ejemplo.app\n' : ''}`);
else if (a[0] === 'shell' && a[1] === 'pidof') out('4321\n');
else if (a[0] === 'shell' && a[1] === 'monkey') out('Events injected: 1\n');
else if (a[0] === 'shell') out(`shell: ${a.slice(1).join(' ')}\n`);
else { process.stderr.write(`fake adb: unknown ${a.join(' ')}\n`); process.exit(1); }
