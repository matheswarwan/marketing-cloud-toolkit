# Changelog

All notable changes to Marketing Cloud Toolkit. Versions 2.0.0 and later are published to the Chrome Web Store as updates to the former SFMC Query Saver listing (1.x). Entries before 2.0.18 are the GitHub release notes, unchanged; "Checked headless" notes describe testing at the time.

## Unreleased (2.0.18)

Security and privacy review (October 2026). Details: `docs/security-summary.md`, `PRIVACY.md`, `security/audits/`.

**Permissions:** removed `tabs` and `unlimitedStorage`; removed the Google Analytics, share service, feedback service and both Query Studio hosts from the required host permissions (Query Studio is now the optional `*.herokuapp.com`, asked for only when the user turns on Save Query Studio runs); content scripts no longer run on querystudio.herokuapp.com. Chrome does not ask existing users to approve anything for this update.

**Changes users will notice:**
- Saved Emails, Saved Activities, saving Query Studio runs and Share are off until turned on in Settings.
- Share shows exactly what will be sent and asks first; opened share links offer an Import button instead of importing on their own.
- Feedback: technical details and screenshots are opt-in, Review and send shows the exact payload, screenshots have Hide and Crop and need a "no customer data" tick, capturing another tab shows a warning first.
- Settings > Keep query history: when off, runs are stored without their SQL.
- Privacy policy linked from Settings, Share and Feedback.

**Removed:** Google Analytics usage events; the Automation Studio request log on Saved Activities.

**Security:** explicit Content Security Policy; CSRF tokens kept in session storage only; the service worker accepts from content scripts only the messages they use; admin policies through Chrome managed storage (`docs/enterprise-deployment.md`); Saved Emails keeps 10 versions per email. Share service: random 128-bit link ids, size limits, strict page CSP, fix for a stored XSS on the share page. Feedback service: IP addresses no longer stored, technical details trimmed, rows deleted after 180 days.

**Fixed:** #1013 Reorder columns on Data Extensions; #1014 Query Studio 2 no longer tied to one Heroku host name; #1015 Saved Activities > Changes uses the same code editor look as Run Query (highlighting, line numbers, changed words marked, unchanged lines folded) and says when lines differ only in spaces or tabs.

**Other:** the creator credit shows the full name (Created by Matheswaran Kanagarajan, Ateko). The source is MIT licensed.

## 2.0.17 (2026-10-27)

Marketing Cloud Toolkit 2.0.17. No permission changes.

- Column values and duplicates (#1012): the chart icon by a column name in Preview data and Run Query results lists each distinct value with its row count (blanks and repeats counted, search, Copy); tick values to keep only those rows, or Duplicates only. Preview data adds Distinct values / Duplicates in SFMC, which open Run Query with a GROUP BY over the whole data extension.
- CloudPages View shows a landing page's code, read from the Web Page asset its thumbnailRefAssetId names (from a capture of SFMC's own calls).

Includes everything in 2.0.16. Checked headless (and in the SFMC Toolkit App's browser check); not yet checked against a live org.

## 2.0.16 (2026-10-27)

Marketing Cloud Toolkit 2.0.16. No permission changes.

- CloudPages: View shows a page's preview (scripts off), its HTML to copy or download, and the raw record; code resources show their code (feedback #1010, #1011).
- Journey HTML and PDF downloads include the journey canvas (#1009).
- Data Extensions: Description column, also in Excel and document downloads (#1008).
- Automation overview: run trends read past the newest 200 runs (#1007).
- Clean up SFMC is now called Delete Toolkit runs (#1006).
- Feedback form: email and LinkedIn as other ways to reach the developer.

Not checked against a live org: the CloudPages View field names (page HTML and code resource ID) are read from the likely fields; Raw JSON shows the real ones.

Rebuilt in place on 2026-10-27 (same version) with:

- Column values and duplicates (#1012): the chart icon by a column name in Preview data and Run Query results lists distinct values with counts; tick values to filter, Duplicates only, Copy; Preview data adds Distinct values / Duplicates in SFMC (GROUP BY in Run Query).
- CloudPages View shows a landing page's code, read from the Web Page asset its thumbnailRefAssetId names (from a capture of SFMC's own calls).

## 2.0.15 (2026-10-25)

Marketing Cloud Toolkit 2.0.15. Includes 2.0.14. No permission changes.

- Query Builder: opens in Visual (last view remembered); the SQL sits at the bottom as a bar you can open, resize, maximize or minimize; tables get short aliases from their names; ? icons, a Help panel and first-visit tips (feedback #150). From SQL also opens a Query Activity or a saved query (#160).
- Contacts: the count and search use the headers Contact Builder's own page sends (read from SFMC's own requests, kept for the browser session only, never logged); search up to 1,000 contact keys at once, pasted or from a file, with a CSV (#151).
- Create DE: field types sent as Contact Builder sends them (EmailAddress with length 254).
- Templates: data view archive keys cut to whole seconds (the _Click duplicate key), folder pickers, completion and error emails, the business unit's name and MID, dialogs instead of alerts, SQL shown and editable (#152 to #156).
- Run history: the failed step and SFMC's message, Why? reads the step's record, and the full JSON (#157).
- CloudPages: published pages show as Published (#158).

Not checked against a live org: the Contacts headers, notification emails, automation folders and the step records.

## 2.0.14 (2026-10-25)

Marketing Cloud Toolkit 2.0.14. Includes everything in 2.0.13. No permission changes.

Query Builder
- Visual mode is a Diagramforce-style canvas: tables as cards with field ticks, drag from a field to a field to join, a join label to edit, auto layout, fit, zoom and a minimap. List and Visual show the same query, and a table can join any earlier table.
- From SQL: paste a SELECT (or use Open in Query Builder in Run Query or on a saved query, or Apply to builder after editing the SQL) and it opens as tables and joins. Expressions the builder cannot model are kept as written.
- Subqueries in FROM as cards, UNION / EXCEPT / INTERSECT as tabs, nested AND/OR filter groups, SQL conditions, HAVING, expressions in GROUP BY and ORDER BY, output column order and names.
- Open in Diagramforce: the query as a data model or as lineage on diagramforce.com (only table and field names are sent).

Run Query
- Failed runs explain the error and the fix; when SFMC gives no reason, the risky parts of the SQL are listed.
- Fix all, stale results greyed after an edit, save results to a data extension, shared team snippets (Toolkit_Shared_Snippets data extension), Join from the schema search, SFMC calls per run.
- Save as query activity checks the target first: required fields, dropped columns, types, lengths, primary key and duplicate keys.

SQL checks
- QS045 to QS064: ORDER BY without TOP, comma joins, syntax and functions from other databases, aliases not in FROM, duplicate aliases, window function rules, aggregates in WHERE, IN subqueries with two columns, GROUP BY 1, ORDER BY positions and constants, DISTINCT with ORDER BY, invalid JSON literals, a trailing -- comment, expressions that fail the run on one bad row, double-quoted text, a LEFT JOIN undone by WHERE, _PushTag and _PushAddress without _APID.
- Settings > Lint rules > Copy rules for AI.

Not checked against a live SFMC org yet: table lookup for From SQL, save results, shared snippets and the target checks.

## 2.0.13 (2026-10-25)

Preview data (renamed from View rows) with Refresh, ticked rows, sort and column filters (#138, #139). Run once for Data Extracts, plus Imports, File Transfers and Scripts (not checked against SFMC) (#135, #136). Query Builder search finds data views (#137). Current date default for Date fields in Create DE (#133). Create DE sends field types by name, fixing Email Address fields (#134). No new permissions.
 Creator credit (Created by Mathes, Ateko) in the sidebar.

## 2.0.12 (2026-10-23)

- PDF in every Download menu (print dialog, Save as PDF) (#132).
- Create DE: when SFMC refuses an email primary key with a length error, one click makes it Text (254) and tries again (#131).
Tables on Automations, Journeys, Data Extensions and CloudPages sort by column and have per-column filters (#126). DE storage says when it needs the parent (Enterprise) business unit (#125). Salesforce blue instead of purple (#127). Sidebar order Queries, Data, Automation, Journey, Content (#128). Saved Activities: wider save patterns, a log of recent Automation Studio requests to copy when a save is missed (#129), and path words such as validate are no longer stored as activities (#130). No new permissions.

Running automations show a moving bar with the step they are on (checked every 5 seconds while the automation is open), statuses and activity types have icons, and long loads show progress bars (#123).

Create DE (#94): paste or upload a sample (CSV, TSV, TXT, JSON, Parquet, Excel) or start with no file, check the guessed field types, names, lengths, primary key, required and defaults, pick the folder (remembered), sendable, testable and data retention, review and create; the sample rows can be added too. Searches reconnect an SFMC app that has no session and otherwise say which app to log in to, with Retry (#93). Run Query: Save as query activity, a named Query Activity in a folder you pick writing to a new or existing data extension, created but never run (#88); the results data extension and Query Activity are named after a run (#91). Query Builder: drag to reorder or swap data extensions (#90); the DE search falls back to Contact Builder and $search so it finds every data extension (#89). Automation and Journey overview load quietly when the app is idle (#78). To do page hidden (#77). No new permissions compared with 2.0.11.

View rows of a data extension without running a query (#117): on the Data Extensions page, 50 at a time or Load all up to 50,000, filter, hide columns, CSV, Excel, Markdown and Copy for AI.

Saved Activities (#122): versions of SQL Query and Script activities saved in Automation Studio (the version before each edit and the saved one), with a side-by-side diff, Copy, Open in Run Query and Restore; Versions links on activity cards; Settings to turn it off and limit versions.

This is the build published on the Chrome Web Store. #133 to #139 shipped in 2.0.13.

## 2.0.11 (2026-10-21)

Renamed from SFMC Toolkit to Marketing Cloud Toolkit (feedback #71). Run Query: schema search beside the editor (#72) and Cmd/Ctrl+Enter to run the query or the selection (#75). Row counts next to data extensions on activity cards, Journey Entry and Where used (#72). Shared DEs get ENT. in generated SQL (#73). New tabs open next to the current tab (#74). Download menu on Automation overview and Journey overview (#69). Where used steps can be left out or skipped (#70). Dashboard trial uses the visible div.mc-app. Connects when SFMC is opened as mc.exacttarget.com (#76). No new permissions compared with 2.0.10.

## 2.0.10 (2026-10-21)

DE storage (feedback #68): GB and rows per data extension from Contact Builder's storage figures, storage per day, totals by business unit, CSV and Excel; row counts per DE when those figures cannot be read.
SFMC Toolkit card on the Marketing Cloud Dashboard page (trial, #65): automations and journeys by status, what needs a look, watched items. Settings > Connection turns it off.
Automation overview (with run trends) and Journey overview are kept while you move between sections (#66).
Feedback remembers your name and email (#65). Filter activities no longer send a request SFMC refuses (#67's report). SFMC's HTML error pages show as a short message.

No new permissions. Not yet checked against a live org: the storage calls (mc-data-ui) and the dashboard card on the real dashboard page.

## 2.0.9 (2026-10-21)

Watch journeys, and tick several automations or journeys to watch them together. Open in SFMC puts the automation, activity or journey back if SFMC drops the link after login. Contacts count fixed (Contact Key search still under investigation). Query Builder hides the SQL until Generate SQL. Automation overview run trends: smaller chart, click a day to see its runs. No new permissions.

## 2.0.8 (2026-10-20)

Contacts page (count, find by Contact Key), Open journey from Journey Entry, data view archive fixes (duplicate keys in Archive_Click, system error in Archive_Job), Where used finds data extensions named anywhere in content, journey details retry without the version on 404. No new permissions.

## 2.0.7 (2026-10-20)

Upload sfmc-toolkit-2.0.7.zip to the SFMC Query Saver item in the Chrome Web Store. No permission changes (one more script on the same SFMC pages).

- Automation Summary tab (feedback #45, from SFMC Automation Viewer): on an automation's page in Automation Studio, a tab on the right edge shows status, last run, schedule, next run and each step's activities, with Open in SFMC Toolkit. Off with Settings > Connection. If SFMC Automation Viewer is also installed, its own tab shows instead.
- Query Builder: two data views (for example _Click and _Job) get their join filled in straight away (feedback #52).

Not yet checked live: the tab on a real Automation Studio page.

## 2.0.6 (2026-10-20)

Upload sfmc-toolkit-2.0.6.zip to the SFMC Query Saver item in the Chrome Web Store (it includes 2.0.4 and 2.0.5). The only manifest change is an optional permission (notifications), so users are not asked to approve anything on update; the store review may ask about it (justification in docs/store-listing.md).

- Automation overview: every automation by status and last run, Needs a look, run trends per day from the run logs, watched automations (feedback #50).
- Watch an automation: paused, activated, runs, fails; checked when the Toolkit opens and at most every 15 minutes while you use SFMC; bell in the top bar, count on the toolbar icon, optional desktop notifications.
- Journey overview: journeys by status, and which live journeys send email, SMS, push or WhatsApp.
- Saved queries shows the business unit you are logged in to first (feedback #49).
- CloudPages Get URL reads a landing page's address from its content (feedback #51).

Not yet checked live: automation status values in the list and detail responses, the run log fields, journey definitions at scale.

## 2.0.5 (2026-10-20)

Upload sfmc-toolkit-2.0.5.zip to the SFMC Query Saver item in the Chrome Web Store (it includes everything in 2.0.4). No permission changes.

- Run history on each automation: last 7 to 180 days, 50 at a time, with status, duration, message, each run's full record and the health summary (feedback #41).
- Four more Automation Templates: Unengaged subscribers, Held and bouncing subscribers, Automation run log, Unsubscribes for CRM. Templates reading _Subscribers can use ENT._Subscribers in a child business unit.

Not yet checked live: the run history response fields (the HAR had no bodies) and the new templates' queries (SFMC checks them before anything is created).

## 2.0.4 (2026-10-20)

Upload sfmc-toolkit-2.0.4.zip to the SFMC Query Saver item in the Chrome Web Store. No permission changes since 2.0.3.

- Settings > Storage: what takes the space, by section and business unit; delete one part, or keep only the newest N versions of each email (feedback #47).
- Automations: tick automations (or none for all shown) and download them with every activity's details (#40).
- Data Extensions: Get count and Get all counts (#46).
- Templates: SFMC checks every query before anything is created, Delete what was created after a stopped run, data view archive stores email fields as text (#43, #44).
- Downloads are named business unit, content, date and time (#39).
- Journeys: readable step settings (SMS and others) and a resizable step panel (#42).
- Restart to update: when Chrome has downloaded a new version, a card offers to restart into it (#48).

Not yet checked against a live org: template creation after the check, row counts on every DE type, automation downloads of very large automations.

## 2.0.3 (2026-10-20)

Upload sfmc-toolkit-2.0.3.zip to the SFMC Query Saver item in the Chrome Web Store.

- Automation Templates (Automation > Templates): Orphan contacts (after Mateusz Dabrowski's Contact Deletion article) and Data view archive. The Toolkit creates the data extensions, Query activities and automation, shows everything first, and never schedules or runs them.
- Run this query on SQL activities: open in Run Query, or start the activity in SFMC (asks first).
- Target and result data extensions on activity cards link to Data Extensions and Contact Builder.
- Queries > Clean up SFMC: delete the data extensions and Query activities Run Query created (SFMCQS_ names only).
- Save Query Studio 2 runs (Settings > Running queries; optional permission, asked only when switched on).
- Optional data retention for new Run Query data extensions (off by default).
- Fixes: data extension search finds any part of a name, Load more automations, Filter activities on stacks that refuse sorting, Automation Studio opens the automation, exports with zero rows, the Where used panel no longer covers the feedback button, recent SFMC calls in feedback details.
- Build tools updated (Vite 8, Tailwind 4); npm audit clean.

Not yet checked against a live org: the template create calls, Run activity in SFMC, Clean up deletes, the Automation Studio link, Query Studio 2 capture after granting the permission.

## 2.0.2 (2026-10-16)

Upload `sfmc-toolkit-2.0.2.zip` to the SFMC Query Saver item in the Chrome Web Store. No new permissions.

- **Where used** (Data > Where used, and buttons on data extensions, fields, activities, automations and entry events). See what uses a data extension (with its lineage through queries, filters, imports and data extracts), a data view, a field, an activity, an email, a content block, a file location, or a sender profile, delivery profile or send classification, and what an automation touches. Covers SQL queries, imports, filters, data extracts, scripts, Send Email activities, automations, journeys, entry events, and emails, templates, content blocks and CloudPages (AMPscript and SSJS). Each step of the scan shows a progress bar; it keeps going in the background and reuses what it loaded for 30 minutes. Current business unit only.
- **Data Extensions:** the first 50 show straight away, Shared and Synchronized data extensions join in the background; tick rows to download or export only those.
- **Every SFMC search** shows 50 results, with Load 50 more.
- **Run Query:** the run summary shows the total row count.
- **Data Extensions:** names with spaces or dashes are found (feedback #22); SFMC on each row opens the data extension in Contact Builder (#24).
- **Where used** saves what it loads for each business unit, so later checks in any tab read only what changed (#26); the SQL and section toggles in its panel work (#25).

Where used relies on several SFMC responses that are not documented (see the repo's CLAUDE.md).

## 2.0.1 (2026-10-15)

Fixes from feedback on 2.0.0.

- Run Query: results showed only the first 2,500 rows. The results bar now says how many rows there are, with Load next 2,500 and Load all (up to 50,000).
- Query Builder: joins between system data views are filled in the way SFMC documents them (for example _Journey to _JourneyActivity on VersionID, _JourneyActivity to _Job and _Sent on JourneyActivityObjectID = TriggererSendDefinitionObjectID, tracking views on JobID, ListID, BatchID and SubscriberID).
- Feedback: when a screenshot can't be attached, the feedback is still sent, without it.

No new permissions. Upload `sfmc-toolkit-2.0.1.zip` in the Chrome Web Store dashboard as a new version of the item.

## 2.0.0 (2026-10-14)

First release of SFMC Toolkit, published as an update to the SFMC Query Saver listing on the Chrome Web Store (renamed). Marked pre-release until it is live in the store.

- Every feature of SFMC Query Saver and SFMC Automation Viewer in one full-tab app. Sidebar: Queries (Saved queries, Run Query, Query Builder), Automation (Automations, Activities), Journey (Journeys, Journey Entry), Data (Data Extensions), Content (CloudPages, Saved Emails).
- New: Journeys, with each journey drawn like the Journey Builder canvas (horizontal or vertical) and every step's content; feedback with marked-up screenshots and optional technical details; every SQL check switchable in Settings.
- Query Saver users keep their saved queries, run history, workspaces and email versions (same extension ID). Old Query Saver page links forward to their sections. A What's New dialog explains the change once.
- No new permissions compared with Query Saver 1.4.0.

Upload `sfmc-toolkit-2.0.0.zip` in the Chrome Web Store dashboard as a new version of the SFMC Query Saver item.

## 1.x (SFMC Query Saver)

See the archived SFMC Query Saver repository. 1.4.0 (2026-10-03) was the last version under that name.
