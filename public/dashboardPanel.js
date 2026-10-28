// Marketing Cloud Toolkit card on SFMC's Marketing Cloud Dashboard page (feedback #65, a trial):
// automations and journeys of the business unit (counts by status, what needs a
// look, watched items) with links into Marketing Cloud Toolkit. The service worker reads SFMC
// (DASHBOARD_SUMMARY, src/background/dashboard.js); this script only shows it.
// Off unless _dashboardPanel is true (Settings > Connection). When on, it replaces
// the content of SFMC's app frame (div.mc-app, which holds the dashboard's iframe):
// the iframes there are hidden, not removed, and shown again when the card goes
// (another SFMC app, Show SFMC dashboard, or Turn off). Runs in a shadow root.
(function () {
  'use strict';
  if (window.top !== window) return;

  var SETTING = '_dashboardPanel';
  var HOST_ID = 'sfmc-toolkit-dashboard-card';

  var host = null;
  var root = null;
  var enabled = false;
  var frame = null;
  var closedFor = '';
  var lastHref = '';
  var token = 0;

  function parse(href) {
    try {
      var url = new URL(href);
      var parts = url.hostname.split('.');
      if (parts[0] !== 'mc' || !/^s\d+$/i.test(parts[1] || '') || parts.slice(2).join('.') !== 'exacttarget.com') return null;
      var hash = decodeURIComponent(url.hash || '');
      return /^#app\/Marketing Cloud Dashboard(\/|$)/i.test(hash) ? { stack: parts[1].toLowerCase() } : null;
    } catch (e) {
      return null;
    }
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function send(message) {
    return new Promise(function (resolve, reject) {
      try {
        chrome.runtime.sendMessage(message, function (res) {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          if (!res) return reject(new Error('No reply from Marketing Cloud Toolkit.'));
          if (res.error) return reject(new Error(res.error));
          resolve(res);
        });
      } catch (e) {
        reject(new Error('Marketing Cloud Toolkit was updated. Reload this page to see the card.'));
      }
    });
  }

  function openApp(path) {
    send({ type: 'OPEN_APP', path: path }).catch(function (e) { showError(e.message); });
  }

  var CSS = [
    ':host{all:initial;display:block;height:100%;overflow:auto}',
    '.card{box-sizing:border-box;min-height:100%;display:flex;flex-direction:column;background:#fff;color:#1e293b;border:1px solid #e2e8f0;font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}',
    '.head{display:flex;align-items:center;gap:8px;padding:12px 20px;border-bottom:1px solid #e2e8f0}',
    '.title{font-weight:700;font-size:15px;flex:1;margin:0}.trial{font:600 10px/1 inherit;color:#0070d2;border:1px solid #cfe5fa;background:#eaf4fd;border-radius:999px;padding:3px 6px}',
    '.body{flex:1;padding:12px 20px;max-width:960px}',
    '.h{display:flex;align-items:baseline;gap:6px;font-weight:600;font-size:12px;margin:8px 0 4px}.h:first-child{margin-top:2px}.h .n{font-weight:400;color:#64748b}',
    '.stats{display:flex;gap:8px;margin:2px 0 4px}.stat{flex:1;border:1px solid #e2e8f0;border-radius:6px;padding:5px 7px}.stat b{display:block;font-size:17px}.stat span{font-size:11px;color:#64748b}.bad b{color:#b91c1c}',
    '.chips{display:flex;flex-wrap:wrap;gap:4px;margin:2px 0 4px}.chip{font-size:11px;background:#f1f5f9;border-radius:999px;padding:1px 7px}',
    '.item{display:block;width:100%;text-align:left;border:0;background:none;cursor:pointer;padding:3px 0;font:12px/1.35 inherit;color:inherit;border-bottom:1px solid #f1f5f9}.item:hover .nm{text-decoration:underline}',
    '.nm{font-weight:600;color:#005fb2}.why{display:block;color:#64748b;font-size:11px}',
    '.more{border:0;background:none;color:#0070d2;cursor:pointer;font:600 12px/1 inherit;padding:4px 0}',
    '.msg{color:#64748b;font-size:12px;padding:6px 0}.err{color:#b91c1c;font-size:12px;padding:4px 0}',
    '.foot{display:flex;align-items:center;gap:12px;padding:10px 20px;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b}',
    '.foot .sp{flex:1}.lk{border:0;background:none;color:#0070d2;cursor:pointer;font:600 11px/1 inherit;padding:0}',
    '@media (prefers-color-scheme: dark){.card{background:#0f172a;color:#e2e8f0;border-color:#1e293b}.head,.foot{border-color:#1e293b}.stat{border-color:#1e293b}.chip{background:#1e293b}.item{border-color:#1e293b}.nm{color:#7fb8ec}}',
  ].join('');

  var HIDDEN = 'data-sfmc-toolkit-hidden';

  // SFMC's app frame: the div that holds the current app's iframe. SFMC can keep
  // more than one div.mc-app (other apps' frames, hidden), so take the one shown,
  // the largest if several are.
  function shown(e) {
    for (var n = e; n && n.nodeType === 1; n = n.parentElement) {
      var cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
    return true;
  }

  function findFrame() {
    var best = null;
    var bestArea = -1;
    Array.prototype.forEach.call(document.querySelectorAll('div.mc-app'), function (d) {
      if (!shown(d)) return;
      var r = d.getBoundingClientRect();
      var area = r.width * r.height;
      if (area > bestArea) { best = d; bestArea = area; }
    });
    return best;
  }

  // Hides SFMC's iframes in the frame (again if SFMC adds or shows one).
  function hideFrames() {
    if (!frame) return;
    Array.prototype.forEach.call(frame.querySelectorAll('iframe'), function (f) {
      if (f.hasAttribute(HIDDEN)) { if (f.style.display !== 'none') f.style.display = 'none'; return; }
      f.setAttribute(HIDDEN, f.style.display || '');
      f.style.display = 'none';
    });
  }

  function showFrames() {
    Array.prototype.forEach.call(document.querySelectorAll('iframe[' + HIDDEN + ']'), function (f) {
      f.style.display = f.getAttribute(HIDDEN);
      f.removeAttribute(HIDDEN);
    });
  }

  function mount(target) {
    if (host && frame === target && target.contains(host)) { hideFrames(); return; }
    unmount();
    frame = target;
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'display:block;width:100%;height:100%;min-height:480px';
    root = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = CSS;
    var card = el('section', 'card');
    card.setAttribute('aria-label', 'Marketing Cloud Toolkit summary');
    var head = el('div', 'head');
    head.appendChild(el('p', 'title', 'Marketing Cloud Toolkit'));
    var trial = el('span', 'trial', 'Trial');
    trial.title = 'A trial: tell us what you think with Feedback in Marketing Cloud Toolkit';
    head.appendChild(trial);
    var back = el('button', 'lk', 'Show SFMC dashboard');
    back.type = 'button';
    back.title = "Show SFMC's own dashboard until this page is opened again";
    back.addEventListener('click', function () { closedFor = location.href; unmount(); });
    head.appendChild(back);
    var body = el('div', 'body');
    var foot = el('div', 'foot');
    var when = el('span', 'when', '');
    var sp = el('span', 'sp');
    var refresh = el('button', 'lk', 'Refresh');
    refresh.type = 'button';
    refresh.addEventListener('click', function () { load(true); });
    var off = el('button', 'lk', 'Turn off');
    off.type = 'button';
    off.title = 'Stop replacing the dashboard. Turn it back on in Marketing Cloud Toolkit: Settings > Connection.';
    off.addEventListener('click', function () { try { chrome.storage.local.set({ _dashboardPanel: false }); } catch (e) { /* gone */ } unmount(); });
    var credit = el('span', '', 'Created by ');
    var me = el('a', '', 'Matheswaran Kanagarajan');
    me.href = 'https://www.linkedin.com/in/mathesk/';
    me.target = '_blank';
    me.rel = 'noopener noreferrer';
    me.style.color = 'inherit';
    credit.appendChild(me);
    credit.appendChild(document.createTextNode(', Ateko'));
    foot.appendChild(when);
    foot.appendChild(sp);
    foot.appendChild(credit);
    foot.appendChild(refresh);
    foot.appendChild(off);
    card.appendChild(head);
    card.appendChild(body);
    card.appendChild(foot);
    root.appendChild(style);
    root.appendChild(card);
    hideFrames();
    frame.appendChild(host);
    load(false);
  }

  function unmount() {
    token++;
    if (host) host.remove();
    showFrames();
    host = null;
    root = null;
    frame = null;
  }

  function body() { return root && root.querySelector('.body'); }
  function showError(text) {
    var b = body();
    if (b) b.appendChild(el('div', 'err', text));
  }

  function stat(parent, n, label, bad) {
    var s = el('div', 'stat' + (bad ? ' bad' : ''));
    s.appendChild(el('b', '', Number(n || 0).toLocaleString()));
    s.appendChild(el('span', '', label));
    parent.appendChild(s);
  }

  function heading(b, text, count) {
    var h = el('div', 'h', text);
    if (count !== undefined) h.appendChild(el('span', 'n', '(' + count + ')'));
    b.appendChild(h);
  }

  function chips(b, list) {
    var c = el('div', 'chips');
    (list || []).forEach(function (s) { c.appendChild(el('span', 'chip', s.label + ' ' + s.count)); });
    b.appendChild(c);
  }

  function item(b, name, why, path) {
    var i = el('button', 'item');
    i.type = 'button';
    i.appendChild(el('span', 'nm', name));
    if (why) i.appendChild(el('span', 'why', why));
    i.addEventListener('click', function () { openApp(path); });
    b.appendChild(i);
  }

  function more(b, text, path) {
    var m = el('button', 'more', text);
    m.type = 'button';
    m.addEventListener('click', function () { openApp(path); });
    b.appendChild(m);
  }

  function render(s) {
    var b = body();
    if (!b) return;
    b.textContent = '';
    var a = s.automations;
    heading(b, 'Automations');
    if (a) {
      var st = el('div', 'stats');
      stat(st, a.total, 'automations');
      stat(st, a.failedLastRun, 'last run failed', a.failedLastRun > 0);
      stat(st, a.attentionCount, 'need a look', a.attentionCount > 0);
      b.appendChild(st);
      chips(b, a.byStatus);
      (a.attention || []).forEach(function (x) { item(b, x.name, x.reason, '/automations/' + encodeURIComponent(x.id)); });
      more(b, a.attentionCount > (a.attention || []).length ? 'All ' + a.attentionCount + ' in Automation overview' : 'Automation overview', '/automation-overview');
    } else {
      b.appendChild(el('div', 'err', 'Could not read the automations: ' + ((s.errors && s.errors.automations) || 'unknown error')));
    }
    var j = s.journeys;
    heading(b, 'Journeys');
    if (j) {
      var sj = el('div', 'stats');
      stat(sj, j.total, 'journeys');
      stat(sj, j.live, 'live');
      b.appendChild(sj);
      chips(b, j.byStatus);
      more(b, 'Journey overview', '/journey-overview');
    } else {
      b.appendChild(el('div', 'err', 'Could not read the journeys: ' + ((s.errors && s.errors.journeys) || 'unknown error')));
    }
    var w = s.watched || [];
    heading(b, 'Watched', w.length);
    if (!w.length) b.appendChild(el('div', 'msg', 'Nothing watched on this stack. Click Watch on an automation or journey in Marketing Cloud Toolkit.'));
    w.forEach(function (x) {
      var why = [x.status, x.lastRunStatus ? 'last run ' + x.lastRunStatus : ''].filter(Boolean).join(', ');
      item(b, x.name, (x.type === 'journey' ? 'Journey' : 'Automation') + (why ? ': ' + why : ''), (x.type === 'journey' ? '/journeys/' : '/automations/') + encodeURIComponent(x.id));
    });
    var when = root.querySelector('.when');
    if (when) when.textContent = (s.businessUnit ? s.businessUnit + ', ' : '') + 'read ' + new Date(s.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function load(force) {
    var ctx = parse(location.href);
    var b = body();
    if (!ctx || !b) return;
    var mine = ++token;
    b.textContent = '';
    b.appendChild(el('div', 'msg', 'Reading automations and journeys...'));
    send({ type: 'DASHBOARD_SUMMARY', stack: ctx.stack, force: !!force }).then(function (res) {
      if (mine !== token) return;
      render(res.summary || {});
    }).catch(function (e) {
      if (mine !== token) return;
      b.textContent = '';
      showError('Could not read SFMC: ' + e.message);
    });
  }

  // One console line per change of state, to debug the trial on a real page.
  var lastState = '';
  function report(state) {
    if (state === lastState) return;
    lastState = state;
    console.info('[Marketing Cloud Toolkit] dashboard trial: ' + state);
  }

  function check() {
    if (location.href !== lastHref) {
      if (closedFor && closedFor !== location.href) closedFor = '';
      lastHref = location.href;
    }
    var target = null;
    if (!enabled) report('off (Settings > Connection turns it on)');
    else if (!parse(location.href)) report('not the Marketing Cloud Dashboard page (' + location.hostname + ' ' + decodeURIComponent(location.hash).slice(0, 60) + ')');
    else if (closedFor === location.href) report('closed for this visit (Show SFMC dashboard)');
    else if (!(target = findFrame())) report('waiting for a visible div.mc-app (' + document.querySelectorAll('div.mc-app').length + ' found)');
    else report('shown in div.mc-app ' + (Array.prototype.indexOf.call(document.querySelectorAll('div.mc-app'), target) + 1) + ' of ' + document.querySelectorAll('div.mc-app').length + ' (' + target.querySelectorAll('iframe').length + ' iframe(s) hidden)');
    if (target) mount(target);
    else if (host || frame) unmount();
  }

  report('loaded');
  try {
    chrome.storage.local.get([SETTING], function (r) {
      enabled = !!(r && r[SETTING] === true);
      check();
    });
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === 'local' && SETTING in changes) { enabled = changes[SETTING].newValue === true; check(); }
    });
  } catch (e) { /* extension context gone */ }
  window.addEventListener('hashchange', check);
  window.addEventListener('popstate', check);
  setInterval(check, 1000);
})();
