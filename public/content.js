(function () {
  'use strict';

  // ── SSO JWT detector ──────────────────────────────────────
  // SFMC loads a hidden JWT during every SSO handshake. The JWT payload
  // contains org.stackKey (e.g. "S51") and the REST base URL — giving us
  // a reliable, future-proof source of stack identity without a probe list.
  var _context = null;

  function decodeJwt(t) {
    try {
      var p = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(p + '==='.slice((p.length + 3) % 4)));
    } catch (e) { return null; }
  }

  function processJwt(jwt) {
    if (!jwt || jwt.length < 50) return;
    var pl = decodeJwt(jwt);
    if (!pl || !pl.request || !pl.request.rest) return;
    var rest = pl.request.rest;
    var org  = pl.request.organization || {};
    if (!rest.authEndpoint) return;

    var hostname  = window.location.hostname;
    // JWT org.stackKey is uppercase (e.g. "S51"); normalise to lowercase for URL construction
    var stackKey  = (org.stackKey || '').toLowerCase() || extractStackFromHostname(hostname);

    _context = {
      hostname:     hostname,
      stackKey:     stackKey,
      fuelBase:     'https://' + hostname + '/cloud/fuelapi',
      restBase:     (rest.apiEndpointBase || '').replace(/\/$/, ''),
      authEndpoint: rest.authEndpoint,
      orgId:        org.id   || null,
      region:       org.region || null,
    };

    chrome.runtime.sendMessage({ type: 'SFMC_CONTEXT_CAPTURED', context: _context });
  }

  function extractStackFromHostname(hostname) {
    // mc.s51.exacttarget.com → s51, mc.s51.marketingcloud.com → s51
    // mc.exacttarget.com has no stack (feedback #76): the JWT stackKey is the only source.
    var m = hostname.match(/^(?:mc|members|content-builder)\.(s?\d+)\./);
    return m ? m[1] : null;
  }

  // Content scripts run in an isolated world, so patching fetch or XHR here never saw
  // SFMC's own requests; the JWT is read from the page's DOM (scanDom) or from an
  // SSO.aspx request this script makes itself (probeSSO). Removed 2026-10-28.

  // DOM scan — pick up JWT inputs that landed before our script ran
  function scanDom() {
    document.querySelectorAll('input[name="jwt"]').forEach(function (el) {
      if (el.value && el.value.length > 50) processJwt(el.value);
    });
  }
  new MutationObserver(scanDom).observe(document.documentElement, { childList: true, subtree: true });
  scanDom();

  // Active probe: if no JWT was captured yet, request SSO.aspx on demand.
  function probeSSO(callback) {
    var appId = '8D08A262-A480-4E42-AAF3-F7D967FAD622';
    var url   = '/cloud/tools/SSO.aspx?restToken=1&deepLink=%2F&appId=' + appId;
    fetch(url, { credentials: 'include' })
      .then(function (r) { return r.text(); })
      .then(function (t) {
        var m = t.match(/name="jwt"\s+value="([^"]+)"/);
        if (m) processJwt(m[1]);
        callback(_context);
      })
      .catch(function (e) {
        console.warn('[SFMCQS] SSO probe failed:', e.message);
        callback(_context);
      });
  }

  // ── MCA token capture ─────────────────────────────────────
  // background.js opens an invisible tab pointed at .../update-token.json to complete
  // the silent OAuth SSO redirect (fetch can't follow it — no CORS on the hop). By the
  // time this content script runs, that redirect chain has already resolved and landed
  // on this exact URL, so a same-origin fetch of location.href returns the JSON body
  // directly — no need to scrape Chrome's JSON-viewer DOM (which can truncate long
  // string values like a JWT behind a "show more" affordance).
  if (/\/update-token\.json$/.test(location.pathname)) {
    fetch(location.href, { credentials: 'include' })
      .then(function (r) { return r.text() })
      .then(function (t) {
        var parsed = null
        try { parsed = JSON.parse(t) } catch (e) {}
        if (parsed && parsed.accessToken) {
          chrome.runtime.sendMessage({ type: 'MCA_TOKEN_CAPTURED', accessToken: parsed.accessToken })
        } else {
          console.warn('[SFMCQS] MCA token page had no accessToken')
        }
      })
      .catch(function (e) { console.warn('[SFMCQS] MCA token fetch failed:', e.message) })
  }

  // Message handler — background/popup can request the captured context at any time
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.type === 'REQUEST_SFMC_CONTEXT') {
      if (_context) {
        sendResponse({ ok: true, context: _context });
      } else {
        probeSSO(function (ctx) {
          sendResponse({ ok: !!ctx, context: ctx });
        });
      }
      return true; // keep channel open for async response
    }
  });
})();
