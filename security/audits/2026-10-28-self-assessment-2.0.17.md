# Self-assessment: Marketing Cloud Toolkit 2.0.17 (commit c7dc4c3)

> **Not an independent audit.** A self-assessment by the developer with AI assistance (Claude), plus automated scans. Findings, ratings and fixes have not been verified by a third party.

- Version audited: 2.0.17 (`public/manifest.json`), repo `matheswarwan/sfmc-toolkit`, commit `c7dc4c3` (main), 2026-10-28.
- Also read: the share worker (`SFMCQuerySaver/sfmc-share-worker`, deployed as `sfmc-share-worker`) and the feedback worker (`sfmc-toolkit/workers/feedback`).
- Method: manual code review, `npm audit`, `npm outdated`, and grep sweeps of the source, the build (`dist/`) and the full git history (118 commits).
- **Not run yet** (not installed): gitleaks, semgrep, osv-scanner and retire.js. Their sections are marked "pending".
- This is a self-assessment, not an independent audit.
- Ratings are from an enterprise reviewer's point of view: **H** blocks approval, **M** will be questioned, **L** is cleanup.

## 1. Manifest

| Item | Value |
|---|---|
| permissions | storage, unlimitedStorage, webRequest, tabs, cookies |
| optional_permissions | notifications |
| host_permissions | `*.exacttarget.com`, `*.marketingcloudapps.com`, `*.marketingcloud.com`, `*.salesforce-marketingcloud.com`, `querystudio.herokuapp.com`, `querystudio2-dev-89f7e4653c61.herokuapp.com`, `sfmc-share-worker.mathes-btech.workers.dev`, `query-saver-feedback.mathes-btech.workers.dev`, `www.google-analytics.com` |
| content_scripts | `content.js`, `automationPanel.js`, `dashboardPanel.js` on the 4 SFMC domains **and on querystudio.herokuapp.com**; `share-handler.js` on `sfmc-share-worker.../share/*` |
| content_security_policy | not set (the MV3 default applies: `script-src 'self'; object-src 'self'`) |
| externally_connectable | not set (no web page can message the extension) |
| web_accessible_resources | none |
| `<all_urls>` | not used |

## 2. Findings

### High

**H1. Google Analytics telemetry, on by default, no opt-out.**
- Code: `src/background/analytics.js` and `src/utils/analytics.js`.
- Calls from: App.vue (`app_open`), WorkspacePage, and useQueryPanel (validate, run_start, run_complete with `row_count` and `duration_s`, run_fail, delete_de, delete_activity, delete_run, copy_artifact, share_query).
- What it sends: the GA4 Measurement Protocol with a random UUID kept in `sfmcqs_analytics_cid`, plus the extension version. It sends no SQL and no names.
- The GA4 `api_secret` is in the source and in history (commit `796e10d`). It is not a credential to data, but anyone holding it can send fake events.
- Proposal: remove GA completely, the host permission and the stored client id. Then delete the API secret in GA.

**H2. Feedback sends SFMC context by default and keeps it forever.**
- "Include technical details" is **ticked by default** (`FeedbackModal.vue:28`). The details are:
  - the stack and business unit (name and MID)
  - the current route
  - user agent, language, window and screen size, time
  - the last 20 SFMC API calls: host, path (which holds DE, query and automation IDs and keys), status, item counts
  - the last 5 API errors, with SFMC's error text, which can name DEs and fields
- The screenshot is optional, but it can be either of two things:
  - the extension page, which can show query results and contact rows (PII)
  - any browser tab, through `getDisplayMedia`, which can be an SFMC page
- There's no redaction step beyond the drawing tools, and no customer-data warning.
- The worker stores everything in D1, **plus the sender's IP address** (`CF-Connecting-IP`):
  - no retention limit and no deletion process
  - Workers Logs (observability) is on
  - CORS is `*`
- Some existing rows contain session cookies or tokens that senders pasted into their messages; they are deleted with the rest after 180 days (see the status table below).
- Proposal:
  - Make metadata and screenshots opt-in.
  - Show a payload preview.
  - Never send MIDs, DE names, SQL, results or SFMC URLs.
  - Stop storing the IP address.
  - Set a retention period with an auto-delete job, and add the policy flags.
  - Ask you before changing anything on the backend.

**H3. Session material is read and kept.** None of it is sent outside SFMC, but each item will be flagged:
- **Core CSRF tokens** are sniffed from SFMC's own request headers (`csrf.js`, webRequest `extraHeaders`) and **persisted in `chrome.storage.local` (`_csrfTokens`)**, so they survive browser restarts.
- **Contact Builder request headers, including `authorization`,** are copied from SFMC's own requests (`pageHeaders.js`) into `chrome.storage.session` (memory only, 30 minutes). They're never logged.
- **The MCA Bearer token** is minted by opening `update-token.json` in an inactive tab. `content.js` reads the JSON and the token stays in service worker memory (`mcaToken.js`, `tokenCache`).
- **Cookies:**
  - `scanCookieStacks` reads the names and expiry of exacttarget.com cookies to find the stack.
  - `getAppCsrf` reads the value of the `_csrf` cookie (Content Builder's double-submit token).
  - The session cookies themselves are only sent by the browser to SFMC.
- **The SSO JWT** is decoded in `content.js` for the stack, org ID and REST endpoints. Only those fields are kept, and they're logged to the console.
- Proposal:
  - Keep tokens in memory or session storage only, never `local`.
  - Remove the console logs.
  - Document each item in the security summary.
  - Look at whether Contacts can work without copying `authorization`. If not, put Contacts behind a policy flag.

**H4. webRequest reads request bodies and headers across all SFMC hosts.**

| Listener | URLs | Reads | Purpose | On by default |
|---|---|---|---|---|
| `noteRequestStack` | `*.exacttarget.com`, `*.marketingcloudapps.com` | URL | which stack a tab uses | yes |
| `sniffCsrf` | `*.exacttarget.com` | request headers (`extraHeaders`) | CSRF token for writes | yes |
| `sniffPageHeaders` | `*.marketingcloudapps.com/contactsmeta/*` | request headers incl. `authorization` | Contacts search | yes |
| `captureQueryStudio` | Query Studio 1 and 2 `/query/create` | request body (SQL) | save Query Studio runs | yes |
| `captureEmail` | Content Builder `asset/v1/content/assets/*` | request body (email content) | Saved Emails | yes |
| `captureActivity` (+ onCompleted) | `AutomationStudioFuel3/*` | request body (SQL / SSJS) | Saved Activities | yes |
| `logActivityRequest` (+ onCompleted) | **every** `*.marketingcloudapps.com` and `*.exacttarget.com` request | method, URL without query values, top-level body keys of writes | diagnostic log (#129) | yes |

- Proposal:
  - Remove the diagnostic logger.
  - Make the three capture features opt-in (Saved Emails, Saved Activities, Query Studio capture), each with a policy flag.
  - Keep the stack and CSRF listeners, with written justifications.
  - Dropping webRequest altogether would remove the capture features, Contacts and the CSRF that every write needs. See decision D1 below.

**H5. A third-party "dev" host and a content script on a third-party site.**
- `querystudio2-dev-89f7e4653c61.herokuapp.com` is a **required** host (since 2.0.10), used only to read SQL from Query Studio 2's `/query/create` requests.
- `content.js` is injected into `querystudio.herokuapp.com`, which isn't an SFMC domain. On that site it patches `fetch`/XHR and can probe `SSO.aspx`.
- Proposal: drop both from the default build. Query Studio capture becomes an optional host that's requested only when the user turns it on. Never inject `content.js` outside SFMC domains.

**H6. Share sends SQL to a public, unauthenticated store.**
- What leaves the browser: `{ name, queryText }` goes to `sfmc-share-worker.../api/share`.
- Storage: Cloudflare KV, 24 hours.
- Access:
  - Anyone with the link can read it, and CORS is `*`.
  - **The slug is 8 hex characters (32 bits),** so links can be enumerated.
  - There's no size limit and no rate limit.
- On by default and one click: the Saved queries preview copies a link straight away, with no warning.
- SQL can contain PII as literals, for example `WHERE Email = 'jane@...'`.
- **Stored XSS on the share page:** `renderPage` writes `JSON.stringify(data.queryText)` inside a `<script>`, so `</script>` in the SQL breaks out.
- `share-handler.js` **imports every opened share link into the user's saved queries without asking**.
- Proposal:
  - Make share opt-in, with a warning about what leaves the browser, and add a `disableShare` policy.
  - Ask before importing.
  - On the worker: longer random IDs, a size limit, a fix for the XSS, and a no-index header. The worker changes need your OK.

### Medium

- **M1. `tabs` is probably unnecessary.**
  - `chrome.tabs.query`, `create`, `update`, `remove` and `onUpdated` work without it.
  - The `url` field is visible for tabs on hosts the extension already has permission for, which is all the SFMC tabs.
  - Used for: finding SFMC tabs, minting the token, warming up app sessions, opening the app.
  - Proposal: drop it and test that stack detection still works.
- **M2. Host permissions for the share, feedback and GA endpoints aren't needed.**
  - Both workers answer with `Access-Control-Allow-Origin: *`, so extension pages can call them without a host permission.
  - The share content script's `matches` entry grants its own access.
  - Proposal: remove those hosts from `host_permissions`.
- **M3. The service worker doesn't check who sends a message.**
  - Any of the extension's content scripts (on every SFMC page) can send `SFMC_FETCH` (any URL on a permitted host, with SFMC credentials), `SAVE_RECORDS`, `IMPORT_SHARED_QUERY` and the rest.
  - Page scripts can't reach these (isolated world, no `externally_connectable`), so this is defense in depth.
  - Proposal: allow only the message types each content script needs. Everything else must come from extension pages.
- **M4. Query results are kept in SFMC.**
  - Run Query writes results into new DEs.
  - Retention is off by default, and "Delete Toolkit runs" is manual.
  - Proposal: default retention on (for example 1 day), and an admin policy.
- **M5. SFMC data stored locally, with no global off switch or Clear all.**
  - `chrome.storage.local` holds:
    - SQL text and run history (stack, DE and query activity IDs, names and URLs)
    - Saved Emails (email content versions)
    - Saved Activities (SQL and SSJS versions)
    - watches and notices, settings, builder state
    - the CSRF tokens (H3)
  - IndexedDB `toolkit-where-used` holds SQL, names and paths per stack and BU.
  - `localStorage` holds UI preferences only.
  - **Query results are not persisted.** Previews and Run Query rows stay in memory.
  - Proposal: a `disableHistory` policy, per-feature toggles, and a "Clear all".
- **M6. No explicit CSP in the manifest.** The default MV3 CSP still blocks inline and remote code. Proposal: set an explicit strict CSP. The print iframe (`exportDoc.js` `printDoc`) isn't sandboxed (its content is escaped), so sandbox it.
- **M7. The store listing doesn't match the code.**
  - The data-use text says website content "is not sent anywhere except back to the user's own Marketing Cloud account", but share and feedback both send some.
  - The listing names CloudKettle and Ateko as publisher, email and privacy policy.
  - Covered by Phase 3.
- **M8. Library versions** (retire.js pending):
  - `npm audit` reports 0 vulnerabilities, production and dev.
  - Bundled: vue 3.5.44, jszip 3.10.1 (3.10.2 available), html-to-image 1.11.11 (1.11.13 available), node-sql-parser 5.4.0, sql-formatter 15.9.0, hyparquet 1.31.3 (1.31.5), and xlsx 0.20.3 from SheetJS's CDN tarball.
  - Likely cause of Spin's "outdated JS libs": scanners that match `xlsx` by name compare it with the npm registry's 0.18.5, which has CVEs that 0.20.3 fixes. jszip 3.10.1 is the other usual flag.
  - Proposal: update to the latest patch versions and confirm with retire.js.
- **M9. Repo contents that matter for provenance and for going public:**
  - 19 release zips are committed (`.git` is 48 MB).
  - `CLAUDE.md` is tracked and holds internal developer notes (feedback row numbers, endpoints, tooling). I found no client names in it.
  - `legacy/` holds old Query Saver and Automation Viewer auth code.

### Low

- **L1.** `content.js` patches `window.fetch` and XHR, but it runs in the content-script isolated world, so it never sees the page's traffic. It's dead code that looks like interception. Remove it; keep the DOM scan for the SSO JWT.
- **L2.** The Cloudflare account ID, D1 database ID and KV namespace ID are in tracked files: `workers/feedback/*.sh`, `wrangler.toml` and README, plus the share worker's `wrangler.toml`. These are identifiers, not secrets. Remove them before the repo goes public.
- **L3.** The GA4 `api_secret` is in history (`796e10d`). Rotate it in GA when GA is removed; rewriting history isn't needed.
- **L4.** 21 feedback screenshots (`workers/feedback/feedback-*.jpg`) sit **untracked** in the repo folder (left by `show-screenshot.sh`). They aren't in git history, but they may show client data. Move them out and add them to `.gitignore`.
- **L5.** CloudKettle and Ateko references:
  - `mathes.kanagarajan@cloudkettle.com` in `FeedbackModal.vue:155` and `README.md:75`
  - "Created by Mathes, Ateko" in `CreatorCredit.vue`, `public/dashboardPanel.js:162` and `AppSidebar.test.js`
  - the store listing (publisher, email, ateko.com privacy policy)
  - The extension doesn't link to a privacy policy at all.
- **L6.** Console logging on SFMC pages: the stack and hostname from the JWT, and the MCA token capture notice (not the token itself).

### Good already

- No `eval`, `new Function`, string `setTimeout`, `executeScript`, remote `import()` or injected `<script>` in `src/`, `public/` or the built `dist/`.
- No `innerHTML` and no `v-html`. Email, journey and CloudPage previews are `sandbox`ed iframes.
- No `externally_connectable` and no web-accessible resources.
- Query results aren't stored locally.
- `npm audit` is clean.
- No JWT-like strings and no feedback exports or `.sql` dumps anywhere in the git history.
- Every commit is by the personal account or Dependabot.

## 3. Every outbound destination (production code)

| Destination | From | Payload | Trigger |
|---|---|---|---|
| `mc.<stack>.exacttarget.com` / `.marketingcloudapps.com` and the app hosts (`content-builder.`, `jbinteractions.`, `mc-data-ui.`, `cloud-pages.`) | service worker `fetchProxy.js`, `stack.js`, `sessions.js`, `businessUnit.js` | SFMC API calls with the user's session (cookies, CSRF, Bearer) | user actions, stack and session probes, preloads |
| `www.google-analytics.com/mp/collect` | `background/analytics.js` | event name, random client id, version, small counts | automatic (H1) |
| `sfmc-share-worker.mathes-btech.workers.dev/api/share` | `useQueryPanel.js`, `QueryPreviewModal.vue` | `{ name, queryText }` | Share click (H6) |
| `query-saver-feedback.mathes-btech.workers.dev/feedback` | `FeedbackModal.vue` | message, details, kind, screen route, app, version, optional name and email, metadata (ticked by default), optional screenshot | Send feedback (H2) |
| `querystudio.herokuapp.com`, `querystudio2-dev-...herokuapp.com` | none (no requests are sent) | n/a: request bodies are only read via webRequest (H5) | n/a |
| `diagramforce.com` | Query Builder "Open in Diagramforce" (opens a tab and sends a diagram via `postMessage`) | the query's tables, columns and joins as a diagram | user click |
| `linkedin.com`, `mateuszdabrowski.pl`, `developer.salesforce.com` | links only | none | user click |

There's no WebSocket, `sendBeacon`, tracking pixel or EventSource. The only `new Image` loads a local screenshot data URL.

**Diagramforce** sends query structure (DE and column names) to a third-party site when the user clicks it. It needs disclosure and a policy flag, and wasn't in your list.

## 4. What the two workers receive and keep

- **Share worker:** `{ name, queryText }`. It's stored in KV under an 8-hex-character slug for 24 hours, readable through `GET /api/share/<slug>` and `/share/<slug>` by anyone. It doesn't log the IP address itself; whatever the Cloudflare platform logs is outside the code.
- **Feedback worker:** `message`, `details`, `kind`, `screen`, `version`, `app`, `name`, `email`, `metadata` (JSON), a screenshot (data URL, in `<table>_screenshots`), the **IP address**, and `created_at`. It has size limits and keeps rows indefinitely; Workers Logs is on.
- **Reading the feedback:** only through `wrangler` with your Cloudflare login. There's no read endpoint.

## 5. Permission decisions for Phase 2

| Permission | Code paths | Needed? | Proposal |
|---|---|---|---|
| webRequest | table in H4 | yes, for CSRF (every SFMC write), stack per tab, Contacts, the capture features | keep, narrow the listeners, drop the diagnostic logger, capture opt-in (or D1) |
| cookies | `stack.js` `scanCookieStacks` (names, expiry), `csrf.js` `getAppCsrf` (`_csrf` value), `sessions.js` (cookie present?) | yes, for Content Builder writes (email revert, Saved Activities restore) and stack detection | keep with justification, or drop email revert and cookie stack detection (D2) |
| tabs | `queryTabs`, `createTab`, `removeTab`, `tabs.onUpdated`/`get`/`update`/`getCurrent` | probably not (M1) | drop and test |
| storage | everything stored | yes | keep |
| unlimitedStorage | Saved Emails versions can pass 10 MB | only for Saved Emails | drop it and cap the email versions, or keep with justification (D3) |
| notifications (optional) | `background/watches.js` | only when the user turns on desktop notifications | keep as optional, plus a policy flag |
| GA, share and feedback hosts | see section 3 | no (CORS `*`) | remove |
| `querystudio.herokuapp.com`, QS2 dev host | `captureQueryStudio`, `content.js` injection | only for Query Studio capture | remove from the default; optional and opt-in |

## 6. Decisions I need from you before Phase 2

- **D1.** Keep the capture features (Saved Emails, Saved Activities, Query Studio saving) as opt-in, or remove them? Removing them shrinks webRequest to the CSRF and stack listeners.
- **D2.** Keep `cookies`? Without it, Content Builder writes (email revert, activity restore) and cookie-based stack detection go away.
- **D3.** Keep `unlimitedStorage`, or cap the stored versions?
- **D4.** Keep Share at all? If yes, the worker fixes need your OK (XSS, slug length, size limit). The worker lives in the archived SFMCQuerySaver repo, so it may need to move.
- **D5.** Retention for feedback rows, and dropping the IP address column (backend changes).
- **D6.** Should Contacts keep copying Contact Builder's `authorization` header, or go behind a policy flag that's off by default?
- **D7.** The publisher name to use in PRIVACY.md (your full name?), and the contact email for SECURITY.md (your personal Gmail or another address).

## 7. Scanner results (2026-10-28, via Docker; raw output in `security-scans-2026-10-28/`, chmod 700, outside the repo)

| Tool | Scope | Result |
|---|---|---|
| gitleaks (latest, `--redact`) | Toolkit history (106 commits) | 2 hits: the **GA4 api_secret** (`src/background/analytics.js:4`, commit `796e10d`, real) and a long property name in `journeysCloudPages.test.js` (false positive) |
| gitleaks | Toolkit working tree (incl. ignored folders) | 5 hits: the GA4 secret in `analytics.js`, `legacy/qs-background.js` and `dist/background.js`; the same test false positive; one in `.npm-cache` (a package tarball, not ours) |
| gitleaks | SFMCQuerySaver history (share worker's repo, archived) | 10 hits: the GA4 secret (2, in old `dist/background.js`), and 8 SFMC object keys (`customerKey`, `targetKey`, `legacyKey`) from a real org in old notes (`docs/Internal API.txt`, `Mathes-Requirements.md`, `Issues-to-fix.md`). The keys identify objects, they aren't credentials. The notes' auth sections hold placeholders only (checked). |
| semgrep (p/javascript, p/secrets, p/xss, p/owasp-top-ten) | Toolkit `src/`, `public/`, `workers/`, `legacy/`; share worker | 0 findings in 273 files. **Limits:** semgrep doesn't analyse `.vue` files, and it missed the share page's stored XSS (HTML built in a template string), so it doesn't replace the manual review. |
| osv-scanner | Toolkit `package-lock.json` (276 packages) | **xlsx 0.20.3: GHSA-4r6h-8v6p-xvw6 (prototype pollution, 7.8) and GHSA-5pgg-2g8v-p4x9 (ReDoS, 7.5)**, listed with no fixed version. SheetJS says these were fixed in 0.19.3 and 0.20.2, but the fixes only shipped from its own CDN, so OSV (and most scanners, likely Spin.AI) flag every version. No other findings. |
| osv-scanner | share worker `package-lock.json` (104 packages) | 27 advisories, **all dev-only** (wrangler toolchain: undici 16, sharp 3, ws 2, @fastify/busboy 2, esbuild, defu, zod). None of it is in the deployed worker code; updating wrangler clears them. |
| retire.js 5.7.0 | built `dist/` (current) and the 2.0.15 store zip | no known-vulnerable libraries detected |
| npm audit | Toolkit, prod and dev | 0 vulnerabilities |

**Changes to the findings above:**
- **M8 becomes "xlsx is flagged by OSV-based scanners".** The real risk is low because the installed 0.20.3 has the fixes. To stop the flag for good:
  - Replace xlsx: the Excel export could use a small writer built on the already-bundled jszip, and Excel import in Create DE needs a reader.
  - Or keep xlsx and document why the scanner result is a false positive.
- Add **L7:** the share worker's dev toolchain is outdated (27 dev-only advisories).
- The GA4 secret appears in 3 places in the working tree and in the history of both repos. Removing GA and deleting the secret in Google Analytics closes it; no history rewrite is needed.

## Status after the fixes (2.0.18, unreleased; commits on main 2026-10-28)

| Finding | Status | Commit |
|---|---|---|
| H1 Google Analytics | Removed | `8da45f8` |
| H2 Feedback defaults and retention | Details and screenshots opt-in, payload preview, Hide/Crop and a customer-data check; service stores no IP, trims old metadata, deletes after 180 days | `719ec3c`, `f5bb6a0` (deployed) |
| H3 Session material | CSRF in session storage only; content script logging removed; documented | `714d779` |
| H4 webRequest breadth | Request log removed; capture features opt-in; Contacts header reading behind `disableContacts` | `77d46f5`, `f05798b` |
| H5 Third-party hosts | Query Studio hosts optional (`*.herokuapp.com`, asked on opt-in); no content script outside SFMC | `96ce68c` |
| H6 Share | Opt-in with preview and warning, import on click; service hardened (128-bit ids, limits, CSP, XSS fixed) | `285c67e`, `cb72df9` (deployed) |
| M1 `tabs` | Removed | `96ce68c` |
| M2 Worker and GA hosts | Removed from host permissions | `96ce68c`, `8da45f8` |
| M3 Message senders | Content scripts limited to their own messages | `06a6f45` |
| M4 Results kept in SFMC | Open: retention for result DEs stays a user setting (off by default) | |
| M5 Local storage controls | Keep query history switch, `disableHistory` policy, Clear all covers every store | `f05798b` |
| M6 CSP | Explicit strict CSP | `96ce68c` |
| M7 Store listing | Checklist in `docs/store-listing-checklist.md` | |
| M8 Libraries | Patch updates; xlsx documented | `c0e76b9` |
| M9 Repo contents | Open: Phase 4 (going public) | |
| `unlimitedStorage` (D3) | Removed; email versions capped | `4ace348` |
| L1 Dead fetch/XHR patch | Removed | `714d779` |
| L3 GA secret | Code removed; the secret must be deleted in Google Analytics by the owner | |
| L5 Former employer references | Removed from PRIVACY.md, the feedback form and README; the "Created by Mathes, Ateko" credit is kept as the owner asked | `621a333` |
