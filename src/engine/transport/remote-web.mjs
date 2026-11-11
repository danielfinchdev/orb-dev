// Static web assets of the phone link: content types, security headers and the installed app's service worker.
import { open } from '../../shared/mobile-crypto.mjs';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; manifest-src 'self'; worker-src 'self'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

// The installed app's service worker: shows the notifications the PC sends and opens the app when one is tapped.
// one notification per chat (tag): new lines join it (the last five, and how many in the title);
// the sender's picture (icon); «Responder» opens the chat; «Aprobar» / «Rechazar» answer the card right there with a
// one-time token of this device (POST /api/note-action); a card whose text is hidden opens the chat. Tapping opens the
// exact chat (an open window is told: postMessage { orbOpen }; else /#abrir=…).
export const SERVICE_WORKER = `self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',()=>{});
self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{}}catch{}
e.waitUntil((async()=>{const tag=d.tag||'orb';let lines=[],count=0;
try{for(const n of await self.registration.getNotifications({tag})){const x=n.data||{};lines=x.lines||[];count=x.count||0;n.close()}}catch{}
lines=lines.concat([d.body||'']).slice(-5);count+=1;
const body=d.hidden?(d.body||''):lines.join('\\n');const title=(d.title||'Orb')+(count>1?' ('+count+')':'');
return self.registration.showNotification(title,{body,tag,renotify:true,icon:d.icon||'/icon.png',badge:'/icon.png',
actions:(d.actions||[]).slice(0,2).map(a=>({action:a.id,title:a.title})),
data:{url:d.url||'/',route:d.route||null,lines,count,acts:d.acts||{},card:d.card||null,actions:d.actions||[]}})})())});
const openApp=(route,approve)=>{const o={route:route||null,approve:approve||null};
return self.clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>{for(const c of l){if('focus' in c){c.postMessage({orbOpen:o});return c.focus()}}
return self.clients.openWindow(route?'/#abrir='+encodeURIComponent(JSON.stringify(o)):'/')})};
self.addEventListener('notificationclick',e=>{e.notification.close();const d=e.notification.data||{};const a=e.action||'';
const def=(d.actions||[]).find(x=>x.id===a);
if((a==='allow'||a==='deny')&&d.acts&&d.acts[a]&&!(def&&def.open)){
e.waitUntil(fetch('/api/note-action',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:d.acts[a]})})
.then(r=>r.ok?r.json():null).then(x=>{if(!x||!x.ok)return openApp(d.route)}).catch(()=>openApp(d.route)));return}
e.waitUntil(openApp(d.route,a==='allow'&&def&&def.open?d.card:null))});`;

export { HEADERS, TYPES };
