// Share page content script (security review, 2026-10-28).
// Runs on https://sfmc-share-worker.mathes-btech.workers.dev/share/* pages. Reads the
// query the share service embedded in the page and offers to import it into Saved
// queries. Nothing is imported until the user clicks Import (a real click, not one
// the page itself fakes), and never when the admin policy disableShare is on.

(function () {
  const meta = document.getElementById('sfmc-qs-meta');
  if (!meta) return;

  const name = String(meta.dataset.name || '').slice(0, 200);
  const queryText = String(meta.dataset.queryText || '');
  if (!queryText || queryText.length > 100000) return;

  function setStatus(cls, message) {
    const bar = document.getElementById('sfmc-status');
    const text = document.getElementById('sfmc-status-text');
    if (bar) bar.className = 'status-bar ' + cls;
    if (text) text.textContent = message;
  }

  function importQuery() {
    const timeStamp = Date.now();
    const records = {};
    records['sql_' + timeStamp] = {
      id: 'sql_' + timeStamp,
      queryText,
      timeStamp,
      url: window.location.href,
      name: name || new Date(timeStamp).toDateString() + ' ' + new Date(timeStamp).toLocaleTimeString(),
      isFavourite: false,
    };
    chrome.runtime.sendMessage({ type: 'IMPORT_SHARED_QUERY', records }, () => {
      if (chrome.runtime.lastError) return setStatus('no-ext', 'Could not import. Make sure the Marketing Cloud Toolkit extension is installed.');
      setStatus('imported', 'Query imported into Marketing Cloud Toolkit (Saved queries).');
    });
  }

  function offerImport() {
    const host = document.getElementById('sfmc-status') || document.body;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Import into Marketing Cloud Toolkit';
    button.style.cssText = 'margin-left:12px;padding:4px 10px;border-radius:6px;border:1px solid #0070d2;background:#0070d2;color:#fff;font:inherit;cursor:pointer';
    button.addEventListener('click', (e) => {
      if (!e.isTrusted) return; // only the user's own click
      button.remove();
      importQuery();
    });
    setStatus('ready', 'Marketing Cloud Toolkit is installed. Review the SQL, then import it if you want it in Saved queries.');
    host.appendChild(button);
  }

  try {
    chrome.storage.managed.get('disableShare', (p) => {
      void chrome.runtime.lastError;
      if (p && p.disableShare === true) return setStatus('no-ext', 'Importing shared queries is turned off by your organization\'s policy.');
      offerImport();
    });
  } catch (e) {
    offerImport();
  }
})();
