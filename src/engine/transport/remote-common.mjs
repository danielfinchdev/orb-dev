// Constants and limits shared by the phone link and its helper modules.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RENDERER = path.resolve(process.env.ORB_RENDERER || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'renderer'));
const SESSION_DAYS = 30; // a phone unused for this long has to be paired again
const PAIR_MINUTES = 5;
const UPLOAD_MAX = 10 * 1024 * 1024;
const UPLOADS_TOTAL = 300 * 1024 * 1024; // phone pictures kept at most (oldest go first), and never older than 7 days
const UPLOADS_DAYS = 7;
const STREAM_BACKLOG = 1024 * 1024; // a live-event stream that stops reading is dropped instead of filling the memory
const STREAMS_PER_DEVICE = 3;
const NETWORK_CHECK_MS = 60_000; // the Wi-Fi address can change (another network, DHCP): checked every minute
const now = () => new Date().toISOString();

// What a phone or a browser may call: the methods src/domain/security/permissions.mjs marks 'remote'. Never by the kind a device
// says it is, and nothing with total access.
// what the owner may choose when making a QR (the kind of device it is for).
export const PAIR_KINDS = ['phone', 'browser'];

const PAIR_FAILS_MAX = 20; // wrong attempts (all addresses together) that cancel the code on screen
// wrong master passwords one code allows (they do not use it up); then a new code is needed.
export const PAIR_PASSWORD_TRIES = 5;

export { NETWORK_CHECK_MS, PAIR_FAILS_MAX, PAIR_MINUTES, RENDERER, SESSION_DAYS, STREAMS_PER_DEVICE, STREAM_BACKLOG, UPLOADS_DAYS, UPLOADS_TOTAL, UPLOAD_MAX, now };
