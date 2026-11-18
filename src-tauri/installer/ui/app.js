'use strict';
// The installer's screens. The program (Rust) does everything real and sends events here; this file only draws them and
// sends back what the user chose. Nothing is loaded from the network and no inline script or style is used (strict CSP).
(function () {
  const ICONS = {
    hand: '<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    'circle-check': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    circle: '<circle cx="12" cy="12" r="10"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    'hard-drive': '<path d="M22 12H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M6 16h.01"/><path d="M10 16h.01"/>',
    'refresh-cw': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    'triangle-alert': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    'rotate-ccw': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    'loader-circle': '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
    minus: '<path d="M5 12h14"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  };
  const ico = (n, cls) => `<svg class="ico ${cls || ''}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : ''));
  // fill() puts the values in as they are; whoever draws the result escapes it once (esc), never twice.
  const post = (m) => { try { window.ipc.postMessage(JSON.stringify(m)); } catch { /* no host: a plain browser */ } };

  const state = {
    ready: false, screen: 'hola', test: false, lang: null,
    version: '', electron: null, defaultDir: '', dir: '', dirChanged: false, dirErr: null, free: null, drive: '',
    shortcuts: true, starting: false, stuck: false, phase: null, log: [], done: null, openAfter: true, dialog: false,
  };
  const L = () => window.ORB_TEXTS[state.lang || (/^es/i.test(navigator.language || '') ? 'es' : 'en')];
  const busy = () => state.screen === 'copia';
  const el = document.getElementById('win');

  function fmtBytes(n) {
    const gb = n / 1073741824;
    return gb >= 10 ? `${Math.round(gb)} GB` : gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(n / 1048576)} MB`;
  }

  function bar(t, sub) {
    return `<header class="bar" data-drag><div><span class="wordmark" role="img" aria-label="Orbe"><span aria-hidden="true">ORB</span><span class="wordmark-dot" aria-hidden="true"></span><span class="wordmark-e" aria-hidden="true">E</span></span></div>
      <div class="bar-center"><span class="name">${esc(t.title)}</span><span class="sub">${esc(sub)}</span></div>
      <div class="wc"><button data-act="minimize" aria-label="${esc(t.minimize)}">${ico('minus', 'sm')}</button><button class="x" data-act="close" aria-label="${esc(t.close)}" ${busy() && !state.stuck ? 'disabled' : ''}>${ico('x', 'sm')}</button></div></header>`;
  }

  function rail(t, cur, failed) {
    const icons = ['hand', 'folder', 'download', 'circle-check'];
    const items = t.rail.map((name, i) => {
      const cls = i < cur ? 'done' : i === cur ? (failed ? 'cur err' : 'cur') : '';
      const icon = i < cur ? 'check' : failed && i === cur ? 'triangle-alert' : icons[i];
      return `<li class="${cls}" ${i === cur ? 'aria-current="step"' : ''}><span class="dot">${ico(icon, 'sm')}</span>${esc(name)}</li>`;
    }).join('');
    return `<nav class="rail"><ol class="steps" aria-label="Pasos">${items}</ol><p class="rail-note">${esc(fill(t.railNote, { v: state.version }))}</p></nav>`;
  }

  const shell = (t, sub, cur, failed, content, foot) =>
    `${bar(t, sub)}${state.test ? `<div class="testbar" role="status">${esc(t.testBanner)}</div>` : ''}<div class="body">${rail(t, cur, failed)}<div class="content">${content}</div></div><footer class="foot">${foot}</footer>`;

  function hola(t) {
    const e = state.electron;
    const notice = e ? `<div class="notice">${ico('refresh-cw')}<span><b>${esc(fill(e.version ? t.foundElectron : t.foundElectronNoV, { e: e.version }))}</b>${esc(fill(t.foundElectronP, { v: state.version }))}</span></div>` : '';
    return shell(t, fill(t.step, { n: 1 }), 0, false,
      `<h1 class="h">${esc(t.welcome)}</h1><p class="p">${esc(t.welcomeP)}</p>
       <div class="lcard"><div class="setting"><div class="lab"><b>${ico('user', 'sm')}${esc(t.userOnly)}</b><span>${esc(t.userOnlyP)}</span></div></div>
       <div class="setting"><div class="lab"><b>${ico('hard-drive', 'sm')}${esc(t.local)}</b><span>${esc(t.localP)}</span></div></div></div>${notice}`,
      `<button class="btn ghost" data-act="ask-cancel">${esc(t.cancel)}</button><span class="grow"></span><button class="btn pri" data-act="to-donde">${esc(t.next)}${ico('arrow-right', 'sm')}</button>`);
  }

  function donde(t) {
    const hint = state.dirErr
      ? `<p class="hint bad">${ico('info', 'sm')}${esc(state.dirErr === 'admin' ? t.dirAdmin : state.dirErr === 'notempty' ? t.dirNotEmpty : state.dirErr === 'electron' ? t.dirElectron : t.dirInvalid)}</p>`
      : state.free != null ? `<p class="hint">${esc(fill(t.free, { d: state.drive, n: fmtBytes(state.free) }))}</p>` : '';
    return shell(t, fill(t.step, { n: 2 }), 1, false,
      `<h1 class="h">${esc(t.where)}</h1>
       <div class="fld"><label for="dir">${esc(t.folder)}</label><div class="row"><div class="field ${state.dirErr ? 'bad' : ''}">${ico('folder')}<input id="dir" value="${esc(state.dir)}" spellcheck="false" aria-label="${esc(t.folder)}"></div><button class="btn out" data-act="pick">${esc(t.change)}</button></div>${hint}</div>
       <div class="lcard"><div class="setting"><div class="lab"><b>${esc(t.shortcuts)}</b><span>${esc(t.shortcutsP)}</span></div><div class="ctl"><button class="sw" role="switch" data-act="toggle-shortcuts" aria-checked="${state.shortcuts}" aria-label="${esc(t.shortcuts)}"></button></div></div></div>`,
      `<button class="btn ghost" data-act="ask-cancel">${esc(t.cancel)}</button><span class="grow"></span><button class="btn out" data-act="to-hola">${ico('arrow-left', 'sm')}${esc(t.back)}</button><button class="btn pri" data-act="install" ${state.dirErr || state.starting ? 'disabled' : ''}>${ico(state.starting ? 'loader-circle' : 'download', 'sm ' + (state.starting ? 'spin' : ''))}${esc(state.starting ? t.installingBtn : t.install)}</button>`);
  }

  function copia(t) {
    const order = ['preparando', 'instalando', 'terminando'];
    const at = Math.max(0, order.indexOf(state.phase));
    const tasks = order.map((p, i) => {
      const cls = i < at ? 'done' : i === at ? 'cur' : '';
      const icon = i < at ? 'circle-check' : i === at ? 'loader-circle' : 'circle';
      const [name, note] = t.phases[p];
      return `<li class="${cls}">${ico(icon, 'sm ' + (i === at ? 'spin' : ''))}<span>${esc(name)}<small>${esc(note)}</small></span></li>`;
    }).join('');
    const lines = state.log.map((l) => fill(t.log[l.key] || l.key, { a: l.arg })).join('\n');
    return shell(t, fill(t.step, { n: 3 }), 2, false,
      `<h1 class="h">${esc(t.installing)}</h1><div class="progress" role="progressbar" aria-label="${esc(t.installing)}"><i></i></div><p class="hint">${esc(state.stuck ? t.stuckP : t.working)}</p>
       <ul class="tasks">${tasks}</ul>
       <details class="log"><summary>${esc(t.details)}</summary><pre>${esc(lines)}</pre></details>`,
      `${state.stuck ? `<button class="btn out" data-act="close">${esc(t.closeThis)}</button>` : `<button class="btn ghost" disabled>${esc(t.cancel)}</button>`}<span class="grow"></span><button class="btn pri" disabled>${ico('loader-circle', 'sm spin')}${esc(t.installingBtn)}</button>`);
  }

  function listo(t) {
    const can = state.done && state.done.can_open;
    return shell(t, fill(t.step, { n: 4 }), 3, false,
      `<div class="res"><span class="big">${ico('circle-check')}</span><h1 class="h">${esc(t.done)}</h1><p class="p">${esc(t.doneP)}</p></div>
       ${can ? `<div class="lcard"><div class="setting"><div class="lab"><b>${esc(t.openNow)}</b><span>${esc(t.openNowP)}</span></div><div class="ctl"><button class="sw" role="switch" data-act="toggle-open" aria-checked="${state.openAfter}" aria-label="${esc(t.openNow)}"></button></div></div></div>` : ''}`,
      `<span class="grow"></span><button class="btn pri" data-act="finish">${esc(t.finish)}</button>`);
  }

  function errorTexts(t) {
    const d = state.done || {};
    const v = d.version || (state.electron && state.electron.version) || '';
    const dir = state.electron && state.electron.dir ? state.electron.dir : '';
    const vars = { v, d: dir, c: d.code, w: (t.verifyWhat && t.verifyWhat[d.what]) || '' };
    let e;
    if (d.kind === 'refused') e = t.err[d.reason] || t.err.desinstalador;
    else if (d.kind === 'open') e = t.err.abierto;
    else if (d.kind === 'verify') e = t.err.verify;
    else if (d.unconfirmed) e = t.err.unconfirmed;
    else e = d.code == null ? t.err.failedNoCode : t.err.failed;
    // «Orb sigue abierto» has a text with the version and one without it
    const body = e.length === 3 && !v ? e[2] : e[1];
    return { title: fill(e[0], vars), body: fill(body, vars) };
  }

  function error(t) {
    const d = state.done || {};
    const { title, body } = errorTexts(t);
    const untouched = d.kind === 'refused' ? t.untouched : d.kind === 'open' || d.kind === 'verify' ? t.untouchedPlain : '';
    return shell(t, t.failedSub, 2, true,
      `<div class="res err"><span class="big">${ico('triangle-alert')}</span><h1 class="h">${esc(title)}</h1><p class="p">${esc(body)}</p></div>
       ${untouched ? `<p class="hint">${ico('info', 'sm')}${esc(untouched)}</p>` : ''}`,
      `<button class="btn ghost" data-act="close">${esc(t.close)}</button><span class="grow"></span>${d.classic ? `<button class="btn out" data-act="classic">${esc(t.classicBtn)}</button>` : ''}<button class="btn pri" data-act="install">${ico('rotate-ccw', 'sm')}${esc(t.retry)}</button>`);
  }

  function dialog(t) {
    return `<div class="scrim"><div class="dialog" role="alertdialog" aria-label="${esc(t.cancelQ)}"><div class="dialog-h">${esc(t.cancelQ)}</div><div class="dialog-b"><p class="p">${esc(t.cancelP)}</p></div><div class="dialog-f"><button class="btn out" data-act="keep">${esc(t.keep)}</button><button class="btn danger" data-act="close">${esc(t.cancelDo)}</button></div></div></div>`;
  }

  function render() {
    if (!state.ready) return;
    const t = L();
    // a redraw must not close the details the user opened, nor lose what is typed in the folder field
    const logOpen = !!(el.querySelector('.log') || {}).open;
    document.documentElement.lang = state.lang || (/^es/i.test(navigator.language || '') ? 'es' : 'en');
    const screens = { hola, donde, copia, listo, error };
    el.innerHTML = screens[state.screen](t) + (state.dialog ? dialog(t) : '');
    el.dataset.screen = state.screen;
    if (logOpen) { const d = el.querySelector('.log'); if (d) d.open = true; }
  }

  // The screen of the installation only comes up when the program says it has started ('started'); a folder it refuses brings the
  // page back to «Where to install» with the reason ('done' of kind 'dir').
  function startInstall() {
    state.starting = true; state.dialog = false;
    post({ cmd: 'install', dir: state.dirChanged ? state.dir : '', shortcuts: state.shortcuts });
    if (state.screen === 'donde') render();
  }

  const actions = {
    minimize: () => post({ cmd: 'minimize' }),
    close: () => { if (!busy() || state.stuck) post({ cmd: 'close' }); },
    'ask-cancel': () => { state.dialog = true; render(); },
    keep: () => { state.dialog = false; render(); },
    'to-donde': () => { state.screen = 'donde'; render(); },
    'to-hola': () => { state.screen = 'hola'; render(); },
    'toggle-shortcuts': () => { state.shortcuts = !state.shortcuts; render(); },
    'toggle-open': () => { state.openAfter = !state.openAfter; render(); },
    pick: () => post({ cmd: 'pick_dir' }),
    install: startInstall,
    classic: () => { state.starting = true; post({ cmd: 'classic' }); },
    finish: () => { if (state.openAfter && state.done && state.done.can_open) post({ cmd: 'launch' }); post({ cmd: 'close' }); },
  };

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b && !b.disabled && actions[b.dataset.act]) actions[b.dataset.act]();
  });
  el.addEventListener('mousedown', (e) => {
    if (e.button === 0 && e.target.closest('[data-drag]') && !e.target.closest('button')) post({ cmd: 'drag' });
  });
  el.addEventListener('input', (e) => {
    if (e.target.id === 'dir') { state.dir = e.target.value; state.dirChanged = true; }
  });
  el.addEventListener('change', (e) => {
    if (e.target.id === 'dir') post({ cmd: 'check_dir', dir: state.dir });
  });
  // The browser's own shortcuts (reload, print, find, save, view source, developer tools, zoom) do nothing here: a reload in the
  // middle of an installation would leave the page without its state.
  document.addEventListener('keydown', (e) => {
    const k = String(e.key).toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    if (/^f(3|5|7|12)$/.test(k) || (ctrl && ['r', 'p', 'f', 's', 'u', 'g', 'j', 'o', '+', '-', '=', '0'].includes(k)) || (ctrl && e.shiftKey && ['i', 'j', 'c', 'r'].includes(k)) || (e.altKey && (k === 'arrowleft' || k === 'arrowright'))) e.preventDefault();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.dialog) { state.dialog = false; render(); }
  });
  // Nothing in this window opens a menu or navigates away.
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  function onEvent(m) {
    switch (m.ev) {
      case 'init':
        Object.assign(state, { ready: true, version: m.version, electron: m.electron, defaultDir: m.default_dir, dir: m.default_dir, free: m.free, drive: m.drive || '', test: m.test, lang: m.lang || null });
        break;
      case 'dir':
        if (m.dir != null) { state.dir = m.dir; state.dirChanged = m.dir !== state.defaultDir; }
        state.dirErr = m.error || null; state.free = m.free; state.drive = m.drive || '';
        break;
      case 'started':
        Object.assign(state, { starting: false, stuck: false, screen: 'copia', phase: 'preparando', log: [], done: null });
        break;
      case 'stuck': state.stuck = true; break;
      case 'phase': state.phase = m.phase; break;
      case 'log': state.log.push({ key: m.key, arg: m.arg }); break;
      case 'done':
        state.starting = false;
        if (m.kind === 'dir') { state.screen = 'donde'; state.dirErr = m.error || 'invalid'; break; }
        state.done = m;
        state.screen = m.kind === 'ok' ? 'listo' : 'error';
        state.openAfter = true;
        break;
      case 'restore':
        // after a reload of the page: Rust keeps the state of the installation
        if (m.running) { Object.assign(state, { starting: false, stuck: !!m.stuck, screen: 'copia', phase: m.phase || 'preparando', log: m.log || [], done: null }); render(); }
        else if (m.done) onEvent(m.done);
        return;
      default: return;
    }
    render();
  }

  window.orbInst = { event: onEvent, state };
  post({ cmd: 'ready' });
})();
