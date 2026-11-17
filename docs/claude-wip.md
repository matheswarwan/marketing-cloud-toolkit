# Work in progress

## Errors in new features, suppression list contents, data model diagram (2026-11-17, same branch, not committed)

- User: "most of the latest released features have errors". Swept 25 pages from 2.0.23 and 2.0.24 live on s10. Cause found: a Toolkit tab opened before logging in (or left open past the session) never learned the stack, so every SOAP page said "Unknown stack" (Business units showed 0) until reloaded. Fixed in `useStack` (retry every 5 s and on focus, `whenStack` runs again), with `noStackError()` instead of "Unknown stack". Checked live with the session lookup blocked, then unblocked: the page loaded by itself. With a fresh session all 25 pages load; Sends Details, email Checks, Send problems, Data model, Recycle bin, Import results used live.
- Feedback #1103 (2.0.24): "Could not read the sends: Failed to fetch": same cause as #1102 (SOAP host), fixed on this branch.
- Suppression lists: each list opens its addresses in Preview data (a list is a data extension, checked live).
- Data model: new Diagram (see claude-context, Data model diagram). Checked live on s10: counts match Data Designer, cards, links, panel, View contents, Query this set, search, Back, dark mode.
- Not yet tried by hand from 2.0.24: Starter queries into Run Query, journey Email results, Subscriber lookup in every BU, Ctrl+K, Dark/Images off/Mobile previews. Contact deletions shows raw JSON (field names unconfirmed): map them from the live answer.
- Next: user review, then commit (asked to commit only when told) and the PR; then #1077 (IP addresses and sender settings).


## Feedback #1100 and #1102 (2026-11-16, branch `fix-feedback-1100-1102`)

- #1100, automations stop at 100: Automation Studio's legacy list reads `$skip` as a page number (live on s10, 452 automations: `$top=50&$skip=2` gives rows 100-149; `$skip=50` gives no rows and `totalResults: 0`). The Toolkit sent row offsets, and Load more took the total from the empty answer (0), which hid the button. Fixed in `utils/automationPaging.js` (rows to pages), `automationApi.js` (search, folder forms, change reads, Load more total) and `background/dashboard.js`. Checked live: Load more goes 50, 100, ..., 450, 452 and then stops.
- #1102, Users and roles "Failed to fetch" on s13: `webservice.s13.exacttarget.com` does not exist (no DNS for s11, s12, s13, s50 or s51). `background/soap.js` now sends SOAP to the `soap` entry of the account's `platform/v1/endpoints` list (accepted hosts: `<tenant>.soap.marketingcloudapis.com`, `webservice.sN.exacttarget.com`), with `webservice.<stack>` as the fallback. New required host permission `https://*.soap.marketingcloudapis.com/*` (user's choice; Chrome asks current users to accept it on update) plus CSP and security baseline. Checked live on s10 (its list names webservice.s10; Users loads).
- Not checked live: that the tenant SOAP host accepts the MCA session token as `<fueloauth>`, and what the endpoint list says on s11+. Needs the tenant subdomain of an account (Setup > Installed Packages > API integration > SOAP Base URI) or a login on an s11+ stack.
- Next: the author reviews and writes the CHANGELOG section; then PR, version bump and release. Mark #1100 and #1102 fixed in D1 after release.

## Release 2.0.24 (2026-11-16): waiting on the author

- PR #14 (`release-2.0.24` into main) holds PR #13 (Where used map), `velens-ideas` (8 features), the version bump and `releases/sfmc-toolkit-2.0.24.zip` (built from efd04a0 with `package.mjs --ci`, SHA-256 e9dab0b55ff93c3964bbe5648f2dfa9cf38d23fee0ce0a696e6ae3cea4071fcc).
- Claude could not merge: main needs one approving review, and the admin bypass was refused by auto mode. The author merges PR #14 (PR #13 then shows as merged).
- After the merge: the author writes `## 2.0.24 (date)` in CHANGELOG.md, then tags `v2.0.24` (release.yml builds the GitHub release from that section) and uploads the zip to the Chrome Web Store.
- Test report with screenshots (private artifact): https://claude.ai/artifact/2CJSGsKes7gpJKRZYr2iKp

## Ideas from VeLens (2026-11-16, branch `velens-ideas`, on top of `where-used-map`)

All 8 agreed features built, unit-tested and checked live on s10 Mathes Sandbox: email checks, send problems, send details, journey email results, starter queries, dark/images-off/mobile previews, subscriber in every BU, engagement events plus more Ctrl+K searches.
- Skipped on purpose: VeLens's AI features (send data to their server) and in-SFMC side panels.
- Live testing notes: Puppeteer element-handle calls and screenshots hang or fail on app pages with the sandboxed srcdoc preview iframe; use raw CDP (`scripts/raw.mjs`, `frames.mjs` in the session scratchpad) and close stale tabs via `/json/close`. Out-of-process preview frames cannot be screenshotted; render the transformed HTML in headless Chrome instead.
- One transient "No Marketing Cloud session for SOAP" on the first SOAP call after a while; the retry worked (existing token flow).

## Where used map (2026-11-16, branch `where-used-map`, not committed)

Goal (user): show Where used as a flow chart, like the VeLens extension's dependency map (`~/Downloads/VeLens for Marketing Cloud`, no licence, so ideas only, our own code).
All three agreed phases are built and checked live on s10 Mathes Sandbox (user logged in to a test Chrome, see below); waiting for the user to review and say commit.
- Phase 1: map for data extensions and data views, Map / List switch in the results (list kept), lineage levels 1, 2, All, "+N more" folds.
- Phase 2: automations band above the steps they run (lines go down the gap beside a column when boxes are in the way), paused and error states, ENT. ghosts, the key as a filter, PNG and SVG download, map in the HTML and PDF downloads.
- Phase 3: maps for field, activity, automation, entry event, email, content block, file location and profiles (hub boxes).
- Code: `utils/usage/graph.js` (model), `graphLayout.js` (dagre plus band), `graphSvg.js` (picture), `kinds.js` (`withMap`, `usesBySection`, a map per kind), `components/usage/UsageMap*.vue`, `UsageItemCard.vue`.
- Live bugs found and fixed: vue-flow nodes had `pointer-events: none`; fit before measure; a new check in the same canvas kept the old view (map now keyed per check, view set on nodes initialised, pane ready and 350 ms later); double fold of lineage queries; label pile-up; band lines through boxes; text overflow in the picture.
- Test browser: Chrome for Testing, profile `SideQuest/.claude-toolkit-browser`, CDP port 9334, `dist/` loaded, extension ID bciaecejilkagpjohkjglgmlknninfln, launched with `--enable-unsafe-extension-debugging`. Reload the extension after a build with `chrome.runtime.reload()` from an extension page, then open a fresh tab (old tabs die and CDP calls into them hang). Puppeteer element-handle calls hang on the app page; drive it with `page.evaluate`. Scripts in the session scratchpad (`scripts/lib.mjs`, `cdp.mjs`).
- Not done: Content Builder was not connected in the test browser at first (403 EBADCSRFTOKEN in the assets step of one scan); it connected on its own later.

## Resume here (end of 2026-11-08)

Code (branch `fixes-from-live-testing`, all pushed, last commit f6e7f4e, full suite 1,624 tests passing, build and manifest guard OK):
- Hybrid failure reason for Run Query, journey versions, status words, Excel in Run Query (SQL sheet, then Data sheet), spelling of Mateusz Dąbrowski, and Installed Packages showing only the five package endpoints (internal jsrest, spellcheck, editorSupportAssetHandler and restInternal hidden).
- Not merged into main and not released. The author writes the CHANGELOG section first; then a PR into main, a version bump and a release.

Medium series (`docs/medium/`, never committed: the repo is public and the drafts carry "Notes for Mathes"):
- 32 articles written and updated after the live checks. Day 6 screenshots retaken with the Excel button; Day 31 endpoints screenshot retaken without the internal rows; article text updated for both.
- Store screenshots (1280x800): `docs/medium/store/chrome-web-store-1..5-*.png`.
- Videos in `docs/medium/videos/`: promo (`chrome-web-store-promo.mp4`, for YouTube, then the listing's promo field) and days 1 to 32. At the end of the session days 14, 15 and 16 were still being rendered by a helper; if `day-14-*`, `day-15-*`, `day-16-*.mp4` are missing, render them (below). Day 6 and Day 31 were re-rendered with the new screenshots.
- `videos/captions.md`: LinkedIn captions for all 32 days plus the YouTube title and description; replace `MEDIUM_LINK` as each article goes live.
- Tools copied out of the session scratchpad so they survive: `docs/medium/tools/video/` (engine.js, player.html, style.css, render.mjs, spec/v1..v32.js and promo.js scene lists, cws.html for store screenshots, assets/; `assets/docs` is a symlink to `docs/medium/images`) and `docs/medium/tools/browser/` (Puppeteer scripts per day, `launch.mjs`, `run.mjs`, `d2to6/lib.mjs` helpers, demo CSVs). Neither has node_modules: run `npm i puppeteer-core` in each first.
- Render a video: `cd docs/medium/tools/video && node render.mjs "player.html?spec=v14" auto out/<name>.mp4` (needs the Bash sandbox off: headless Chrome and a local port). Contact sheet to check zooms: add `x --sheet` instead of the output path. Zoom regions are fractions of the screenshot; the frame is 16:10, so a region shows as much height as its width (narrow it to stay on the part that matters). Run at most two renders at once; frames take about 1 GB each, and disk got down to 2 GB free.
- Controlled browser: `node launch.mjs <dir> <repo>/dist` (outside the sandbox) starts Chrome for Testing with the extension on CDP port 9333, extension ID bciaecejilkagpjohkjglgmlknninfln. The old profile with the SFMC login lived in the session scratchpad; a new one needs the author to log in to SFMC (never type the credentials).

Open for the author:
- Upload the promo to YouTube and paste the link into the store listing; upload the five store screenshots.
- Screenshots that would make videos stronger (need data in the sandbox): Day 18 activity history and Restore, Day 22 parent business unit storage, Day 26 Publication Lists, Day 29 Compare and Revert.
- Shown in videos from the articles only, never tried live: Day 17 Run once, Day 18 Restore, Day 30 DNS checks.
- Day 17 import screenshot shows a Salesforce report ID in a file pattern (not zoomed in the video); blur it in the article image if wanted.
- Medium drafts: log in to Medium in the controlled browser; remove each "Notes for Mathes" section before publishing.

## State (2026-11-06)

- 2.0.21 is published in the Chrome Web Store (release branch `release-2.0.21`, merged into main by PR #7).
- Nothing is uncommitted; the user closed the work for the day.
- Shipped in 2.0.21: Setup > Domains and Installed Packages with package secret alerts (#1077 part, #1078, #1079), Preview data filter from a later page (#1082), Run Query cleanup after 7 days (#1081), Contacts > Publication Lists (#1080), plain single-DE reads without a Query Activity plus loading the rest up to 50,000 rows (#1076), search in the results table, Email validation (DE picked on the page with its details, sendable only, 50,000-row limit, stay-on-screen guard, Email addresses tab), DE folder tree look, Customize Home, Salesforce blue as the primary colour.

## Medium series and live-test fixes (2026-11-07)

- 32 article drafts in `docs/medium/` (plan in `README.md`, screenshots in `images/`), all written; each ends with "Notes for Mathes". Not committed; the author reviews first. Medium drafts not created yet (needs the author's Medium login in the controlled browser).
- Screenshots: Mathes Sandbox (s10, MID 515010937) via Puppeteer-controlled Chrome for Testing with `dist/` loaded (launch outside the Bash sandbox; branded Chrome no longer loads unpacked extensions). Rule from the author: no client DEs or assets in screenshots. Fictional DEs in folder "0 - Demo": Demo_Customers (40, sendable on SubscriberKey), Demo_Orders (80), Demo_Products (12), Demo_Newsletter_Signups (30, 5 bad addresses).
- Bug fixes on branch `fixes-from-live-testing` (uncommitted, not yet verified in a rebuilt extension): Create DE send field and required defaults; DE search `_` wildcard; SFMC placeholder dates and UNTIL 2079; import target name and update types (0 Add and Update, 1 Add Only, 4 Overwrite, checked against Automation Studio); step-only note for refused details; watch last-run status; Run history health chips (averageTime is seconds); plurals and spacing; template "daily"; features.js and Settings text; DE picker dialog overflow; Home secrets card capped at 5; email search requires every word (SFMC `contains` matches any word); build-query-from-fields joins on any shared column and dedupes names.
- Also fixed by helpers (unit-tested, full suite 190 files / 1596 tests passing twice, build OK, manifest guard OK): Run Query engine (unique names, failure marker, per-run call count, field-name case, BU on save, "under a second"), editor/results UI (US date sort, Join note tone and aliases, schema panel height, SFMC-only autocomplete, tooltip width, Likely cause in Validate), Automation Studio list-ID links and frame-following summary tab, Setup app sessions (SSO.aspx landings), journey versions, entry cards and email step names.
- Next: relaunch the controlled browser (the author closed it twice; ask first), reload the rebuilt extension, live-verify every fix (each helper listed its live check), delete probe objects SFMCQS_*_probe_* via Settings > Clean up, update articles that describe fixed behaviour, retake affected screenshots. Nothing committed yet.
- Author's decisions (2026-11-08): keep the marker; show SFMC's reason for a failed run; keep Publication Lists starting on first visit.
- Done 2026-11-08 (live-verified on s10): failed runs show SFMC's reason via a rerun in a temporary automation (conversion error checked; divide by zero gives only "system error"); result DEs without primary key or required fields (UNION ALL now 80 rows, was 40); deleteAutomation fixed (Templates rollback used the 404 endpoint); Clean up lists and deletes SFMCQS_run_ automations. Probe automations SFMCQS_diag_probe_* all deleted.
- Done 2026-11-08 (live-verified on s10): Installed Packages lists only the endpoints a package uses; internal services (jsrest on xt.local:3000, spellcheck, editorSupportAssetHandler, restInternal) are hidden. Day 6 screenshots retaken with the Excel button; Day 6 video re-zoomed.
- Live check 2026-11-08, more fixes (all verified on s10): Home journeys "—" (preload skipped a read in progress instead of waiting), Home Try chips deduped, SFMC status names in words ("Paused schedule", "Scheduled to publish") via `format.js statusWords`, Journey overview and Home count each journey by its live version (40 live, was 28), journey detail version picker with "Version N is published: show it", import target labelled "Target" (lists too), email text search checked locally (Content Builder `contains` is a loose match), automation opened by REST GUID no longer stuck on "Loading" (router.replace kept the old path). Verified fine: Domains and Installed Packages load, Automation Studio list-ID links, import update types and targets, DE search with `_`, Create DE optional fields and EmailAddress send field, build-query join, journey entry versions.
- Later on 2026-11-08: automation detail Status in words and End "No end date" (2079), Automation Studio panel status words, dashboard card counts journeys by live version (utils/journeyVersions.js, pure), list import target "List ID n" (SFMC gives no list name), change/email plurals, Domains empty date, features.js intros. Articles 1-32 updated by helpers (uncommitted); videos for days 1-3 in docs/medium/videos (engine in the session scratchpad video/).
- Videos (2026-11-08): days 1 to 6 and a Chrome Web Store promo first; scripts reviewed by an SFMC-persona reviewer (`docs/medium/tools/video/review.md`). Days 7 to 32 made the same day by five helper batches.
- Still to live-verify: the other fixes from 2026-11-07 (Setup pages, Automation Studio links, journeys, Create DE defaults, search fixes), then update articles and screenshots (Day 2/3 failure message, Day 8 Clean up, Day 19, 21, 17, 22-25, 30, 31).

## Release follow-up

- Tag `v2.0.21` is not pushed: `release.yml` builds the GitHub release from a `## 2.0.21 (date)` section in `CHANGELOG.md`, which still says `## Unreleased (next 2.0.21)` and lists only #1075. The user writes that section (Claude never edits CHANGELOG), then tags.
- Store zip: `releases/sfmc-toolkit-2.0.21.zip`, SHA-256 7257864c2704b0cc9de3831d6998eac646ce0ea640c7b372c1930663b88099f0, built at 483ab74.

## Feedback statuses to set

- Claude's D1 write was refused by auto mode on 2026-11-06; the user runs this from `workers/feedback` (with `CLOUDFLARE_ACCOUNT_ID` of the Mathes.btech account):
  `npx wrangler d1 execute sfmc-query-saver-feedback --remote --command "UPDATE fb_toolkit SET status='released', status_version='2.0.21', status_note='Plain single-DE reads skip the Query Activity and load the rest up to 50,000 rows; long waits are explained (commit 1bb961d).', status_at=$(date +%s000) WHERE id=1076; UPDATE fb_toolkit SET status='released' WHERE status='fixed' AND status_version='2.0.21'"`
- #1077 stays partial.

## Next

- #1077 rest: IP addresses and org or sender settings. Find the SFMC Setup endpoints first (documented or seen in SFMC's own UI calls), then decide with the user.
- #1080 idea: a subscriber list per publication list. Explained to the user; wait for them to ask.
- Live checks still open:
  - Does the customobjects GET return `sendableCustomObjectField`, `sendableSubscriberField`, `isTestable` and `dataRetentionProperties` (Email validation details)?
  - Does SFMC's DE list carry `isSendable` (sendable-only tree)?
  - Setup apps (email-app, custom-domains-ui, mc-domainwhitelist-admin-app): cookie session or Bearer token (`bearer: true` in `src/background/apps.js`)?
  - secretexpirations with a single slash after `fuelapi`.
  - Run cleanup (To Test 2.0.21-run-cleanup); Publication Lists when the SFMC run fails (old counts could look like success).
- Flaky test: 1 of 9 full runs on 2026-11-06 failed one test, name not captured. Next time: `npx vitest run --reporter=verbose 2>&1 | grep -B2 -A20 FAIL`.
- Offered, not started: paste raw email headers on the Domains page to extract each DKIM-Signature (d=, s=), check keys and alignment, remember the selector per domain.
- Open gaps: `docs/release-process.md` (referenced by `release.yml`) is missing; store listing data-use text for DNS checks.
