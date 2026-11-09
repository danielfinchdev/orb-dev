// A stand-in for the Android SDK's emulator (3.8.2, T3 3.17): the tests never start a real one. It lists two AVDs and
// writes each run (its arguments and whether Orb's own variables reached it) to FAKE_EMULATOR_LOG.
import fs from 'node:fs';

const args = process.argv.slice(2);
const leaked = Object.keys(process.env).filter((k) => /^ORB_/i.test(k) || k.toUpperCase() === 'ANDROID_USER_HOME');
if (process.env.FAKE_EMULATOR_LOG) fs.appendFileSync(process.env.FAKE_EMULATOR_LOG, `${JSON.stringify({ args, leaked })}\n`);
if (args[0] === '-list-avds') process.stdout.write('INFO    | Storing crashdata in: C:\tmp\nPixel_8_API_35\nMedium_Phone\n');
