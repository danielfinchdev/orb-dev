// 3.7 (Orb Server, WS6): whether a vault item belongs to the page that is open: the anti-phishing rule. A sign-in is
// only ever typed into a page whose address matches one of the item's own URIs, and:
//   · by default (and for «Host») the exact host: the same name and port. «accounts.example.com» is not «example.com»,
//     «examp1e.com» is not «example.com», and an internationalised lookalike (punycode) is a different name;
//   · the base domain («Domain» in Bitwarden: example.com and any of its subdomains) only when the item says so, with
//     the public suffixes below (so «github.io» or «co.uk» is never one site);
//   · «Starts with» and «Exact» as Bitwarden does them; «Regular expression» is never used (too easy to get wrong);
//     «Never» is never;
//   · never over plain http, except an item whose URI is itself http:// on a private IP address, and only on exactly
//     that address and port (a router, a NAS at home).
// Pure functions: the worker checks them before it hands out anything, and fill.mjs again before it types.
import net from 'node:net';

// Bitwarden's URI match types (login.uris[].match). null = the account's default, which Orb takes as «Host».
export const MATCH = Object.freeze({ DOMAIN: 0, HOST: 1, STARTS_WITH: 2, EXACT: 3, REGEX: 4, NEVER: 5 });

// A bundled subset of the Public Suffix List (https://publicsuffix.org): the multi-label suffixes people meet most,
// and the hosting platforms where every subdomain belongs to someone else. Anything not here: the last label is the
// suffix (example.com → com). When in doubt this errs on the safe side: a base-domain match is only ever narrower.
export const PUBLIC_SUFFIXES = new Set([
  // country second levels
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk', 'nhs.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'asn.au', 'id.au', 'co.nz', 'org.nz', 'net.nz', 'govt.nz',
  'com.br', 'net.br', 'org.br', 'gov.br', 'com.mx', 'org.mx', 'gob.mx', 'com.ar', 'gob.ar', 'com.co', 'gov.co', 'com.pe', 'gob.pe', 'cl', 'gob.cl',
  'com.es', 'nom.es', 'org.es', 'gob.es', 'edu.es', 'com.pt', 'gov.pt', 'org.pt',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'co.kr', 'or.kr', 'go.kr', 'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'com.tw', 'org.tw', 'gov.tw', 'com.hk', 'org.hk', 'gov.hk', 'com.sg', 'gov.sg',
  'co.in', 'net.in', 'org.in', 'gov.in', 'ac.in', 'co.za', 'org.za', 'gov.za', 'com.tr', 'gov.tr', 'co.il', 'org.il', 'gov.il', 'com.ua', 'gov.ua', 'com.pl', 'net.pl', 'org.pl', 'gov.pl',
  'co.at', 'or.at', 'gv.at', 'com.ru', 'org.ru', 'com.eg', 'com.sa', 'com.my', 'com.ph', 'com.vn', 'co.th', 'in.th', 'co.id', 'or.id',
  // platforms where each subdomain is someone else's site
  'github.io', 'gitlab.io', 'herokuapp.com', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev', 'web.app', 'firebaseapp.com', 'appspot.com',
  'blogspot.com', 'wordpress.com', 'azurewebsites.net', 'cloudapp.net', 'cloudfront.net', 's3.amazonaws.com', 'elasticbeanstalk.com', 'onrender.com', 'fly.dev',
  'glitch.me', 'repl.co', 'ngrok.io', 'ngrok-free.app', 'trycloudflare.com', 'duckdns.org', 'ddns.net', 'no-ip.org', 'dyndns.org', 'myftp.org', 'ts.net', 'myshopify.com', 'sharepoint.com'
]);

const ipVersion = (h) => net.isIP(String(h ?? '').replace(/^\[|\]$/g, ''));
// A private address: 10/8, 172.16/12, 192.168/16, 127/8, 100.64/10 (CGNAT, Tailscale); ::1, fc00::/7, fe80::/10.
export function isPrivateIp(host) {
  const h = String(host ?? '').replace(/^\[|\]$/g, '').toLowerCase();
  const v = net.isIP(h);
  if (v === 4) {
    const [a, b] = h.split('.').map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (v === 6) return h === '::1' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h);
  return false;
}

// The base domain of a host name (one label plus its public suffix), or null (an IP address, or a bare suffix).
export function baseDomain(host) {
  const h = String(host ?? '').toLowerCase().replace(/\.$/, '');
  if (!h || ipVersion(h)) return null;
  const labels = h.split('.');
  if (labels.length < 2) return null;
  for (let i = 0; i < labels.length - 1; i++) {
    const suffix = labels.slice(i + 1).join('.');
    if (PUBLIC_SUFFIXES.has(suffix)) return labels.slice(i).join('.');
  }
  if (PUBLIC_SUFFIXES.has(h)) return null;
  return labels.slice(-2).join('.');
}

// A URI as Bitwarden keeps it («example.com», «https://example.com/login», «http://192.168.1.1:8080»). No scheme: https.
export function parseUri(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 2000) return null;
  let u; try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
  if (!['http:', 'https:'].includes(u.protocol) || !u.hostname || u.username || u.password) return null;
  return u;
}
const hostKey = (u) => `${u.hostname.toLowerCase()}:${u.port || (u.protocol === 'http:' ? '80' : '443')}`;
const noHash = (u) => { const c = new URL(u.href); c.hash = ''; return c.href; };

// Whether a page may receive any sign-in at all over its scheme: https, or http to a private IP of an item that says so.
export const pageSchemeOk = (page) => page?.protocol === 'https:' || (page?.protocol === 'http:' && isPrivateIp(page.hostname));

// How well one URI of an item matches the page: 0 = not at all, else 1 (domain) … 4 (exact).
export function uriScore(entry, pageUrl) {
  const page = typeof pageUrl === 'string' ? (() => { try { return new URL(pageUrl); } catch { return null; } })() : pageUrl;
  if (!page || !['http:', 'https:'].includes(page.protocol) || page.username || page.password) return 0;
  const u = parseUri(entry?.uri);
  if (!u) return 0;
  const type = entry?.match == null ? MATCH.HOST : Number(entry.match);
  if (type === MATCH.NEVER || type === MATCH.REGEX) return 0;
  // Plain http: only to exactly the private address (and port) the item names with http:// itself.
  if (page.protocol === 'http:') {
    if (u.protocol !== 'http:' || !isPrivateIp(page.hostname) || !isPrivateIp(u.hostname) || hostKey(u) !== hostKey(page)) return 0;
  }
  if (type === MATCH.EXACT) return noHash(u) === noHash(page) ? 4 : 0;
  if (type === MATCH.STARTS_WITH) return hostKey(u) === hostKey(page) && noHash(page).startsWith(noHash(u)) ? 3 : 0;
  if (type === MATCH.DOMAIN) {
    const a = baseDomain(u.hostname); const b = baseDomain(page.hostname);
    if (a && b) return a === b ? 1 : 0;
    return hostKey(u) === hostKey(page) ? 2 : 0; // an IP address: its own host only
  }
  // HOST (and the default): the same host name and the same port.
  return hostKey(u) === hostKey(page) ? 2 : 0;
}
export const itemScore = (item, pageUrl) => Math.max(0, ...(item?.uris ?? []).map((e) => uriScore(e, pageUrl)));

// The item to use on this page, or null. The best match wins; on a tie, the lowest uid (always the same one).
export function pickItem(items, pageUrl) {
  let best = null; let bestScore = 0;
  for (const it of items ?? []) {
    const s = itemScore(it, pageUrl);
    if (s > bestScore || (s && s === bestScore && String(it.uid) < String(best.uid))) { best = it; bestScore = s; }
  }
  return best;
}

// The host shown to the person (cards, notices): the page's host name, nothing of its path or query.
export const hostOf = (url) => { try { return new URL(String(url)).host.toLowerCase(); } catch { return ''; } };
// Whether the «site» the agent named is the open page (its host, or a parent domain of it, never another site).
export function siteIsPage(site, pageUrl) {
  const s = String(site ?? '').trim().toLowerCase();
  if (!s) return true;
  const u = parseUri(s); if (!u) return false;
  let page; try { page = new URL(pageUrl); } catch { return false; }
  const want = u.hostname.toLowerCase().replace(/^www\./, ''); const have = page.hostname.toLowerCase();
  return have === want || have === `www.${want}` || (have.endsWith(`.${want}`) && baseDomain(have) === baseDomain(want) && baseDomain(want) !== null && want.split('.').length >= baseDomain(want).split('.').length);
}
