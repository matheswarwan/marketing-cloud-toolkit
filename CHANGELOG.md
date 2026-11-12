# Changelog

All notable changes to Marketing Cloud Toolkit. Versions 2.0.0 and later are published to the Chrome Web Store as updates to the former SFMC Query Saver listing (1.x). Entries before 2.0.18 are the GitHub release notes, unchanged; "Checked headless" notes describe testing at the time.

## 2.0.23 (2026-11-12)

No permission changes since 2.0.22. **First feature that changes SFMC data:** Remove contacts from a journey (below). Administrators can turn it off with the new policy `disableJourneyWrites`; the privacy policy says so.

**New:**
- Journeys > Remove contacts from a journey: Contact Keys from a pasted list, a file or a data extension column, sent to Journey Builder 50 at a time after you review them and type the number to confirm; each contact's exit status is read back.
- Contacts: Subscriber lookup (one subscriber's status, lists and attributes), Contact deletions (deletion requests and their status), Suppression lists, SMS subscriptions, and a Data model page (attribute groups and their data extensions).
- Sending: Transactional sends, Triggered sends, Sends (recent sends with their counts), Event notifications (ENS subscriptions with a sample callback page) and Send settings (send classifications, sender profiles and what uses them). Setup: Users and roles, Business units with a MID lookup, and File locations.
- Recycle bin for deleted data extensions and Content Builder items, and a Content Builder clean-up report (unused, old and duplicate items).
- Automation: Import results page, and recent runs on import activity cards.
- Content > Changes: what was created or modified in a period, and by whom (feedback #1087).
- Journey pages show what Journey Builder shows: status, activity count, duration, entry data extension, re-entry setting and contact counts per step, plus the journey's audit log. A journey's page can check whether a contact is in it and draw contact paths on the canvas (feedback #1088, #1089, #1094, #1095); Contact journeys moved under Journeys.
- Automations show Automation Studio's own icons (read from your SFMC stack, not shipped with the extension) and the details Automation Studio shows: created, saved and paused by, folder, and the schedule start in the schedule's time zone.
- Email validation can write to a copy of the data extension, summarizes results by category, and runs in the background with a notice when it ends; Activity history lists background jobs (feedback #1090 to #1092).
- Preview data opens as its own page (also in a new tab), with Load 50k rows and Load last N rows (feedback #1097).

**Changed:**
- What's New shows 3 items a page with Previous and Next (feedback #1083).
- AI answers are formatted (lists, bold, code) instead of raw Markdown (feedback #1096).
- Saved Emails keep each save's content once, so more emails fit, and say when Chrome refuses a save (feedback #1086).
- Where used links data extensions to their pages (feedback #1098).

**Fixed:**
- ORDER BY without TOP runs: OFFSET 0 ROWS is added when you run, validate or save (feedback #1093); the SQL check for it is now a warning.
- Content Builder and Journey Builder sessions start through their SSO page and wait longer on slow stacks, with a hint on what to open (feedback #1099); stack 1 uses the right hosts.

## 2.0.22 (2026-11-09)

No permission changes since 2.0.21.

**New:**
- Create DE > Ask an AI (feedback #1084): describe the data extension and copy a prompt with SFMC's field rules into the AI assistant you use, then paste its JSON answer. The name, fields (types, lengths, decimals, primary keys, required, defaults), sendable and retention settings and example rows are filled in for you to check; you still pick the folder. The Toolkit sends nothing. The Paste rows box also reads such an answer.
- SQL check QS065 (feedback #1085): an ntext data view column (`_Job.DynamicEmailSubject`) in SELECT DISTINCT, UNION, GROUP BY or ORDER BY is marked before you run, with a fix that wraps it in CAST(... AS NVARCHAR(4000)). The ntext errors SFMC returns are explained with the same fix.
- Run Query: a failed run shows SFMC's reason. The activity runs once more in a temporary automation whose run log holds the error text; the automation is deleted right after.
- Run Query: Excel download above every results table, with the SQL on the first sheet and the rows shown (after search, filters and sorting) on the second.
- Journeys: a version picker on the journey page, with a link to the published version.

**Changed:**
- What's New fits the window (feedback #1083): the title, close button and Got it stay in view, only the list scrolls, older news is behind Show earlier updates, and Esc closes it.
- Run Query result data extensions have no primary key and no required fields, so SFMC no longer drops duplicate rows (a UNION ALL of 40 rows twice showed 40).
- Home, Journey overview and the Marketing Cloud dashboard card count each journey by its live version (a published journey with a newer draft counted as a draft).
- Statuses read in words ("Paused schedule", "Scheduled to publish"); a schedule ending in 2079 (SFMC's no end date) reads "No end date"; imports into a list show "List ID n".
- Setup > Installed Packages lists only the endpoints a package uses; SFMC's internal services are hidden.

**Fixed:**
- Templates rollback and Settings > Clean up delete automations through Automation Studio's own endpoint (the REST delete answered 404 and left automations behind); Clean up also lists leftover SFMCQS_run_ automations.
- Home showed "—" for journeys when the overview preload was still reading.
- An automation opened by its REST ID stayed on Loading.
- Email search keeps only real matches (Content Builder's contains also matches any one word).
- Automation Studio links use the list ID; import update types and targets; run history health chips; watch status; Create DE send field and required defaults; DE search with `_`; editor autocomplete and tooltips; plurals and text.

## 2.0.21 (2026-11-06)

No GitHub release was made for 2.0.21; its store zip is `releases/sfmc-toolkit-2.0.21.zip` (built at 483ab74, SHA-256 7257864c2704b0cc9de3831d6998eac646ce0ea640c7b372c1930663b88099f0). Same permissions as 2.0.20, plus `https://cloudflare-dns.com` in the CSP for the Domains DNS checks.

**New:**
- Setup > Domains and Installed Packages (feedback #1077, #1078, #1079): sender domains with SPF, DKIM and DMARC explained (DNS checks are off until you turn them on), From addresses at risk, custom domain certificates, installed packages with their endpoints, and an alert when a package's client secret is about to expire.
- Contacts > Publication Lists (feedback #1080): subscribers per list by status, counted in the background.
- Customize Home: hide, show and reorder Home's sections and cards (kept in this browser).
- Run Query: a query that only reads one data extension shows its rows without a Query Activity, and loads the rest up to 50,000 rows (feedback #1076); a Search rows box finds text in any column of the results.

**Changed:**
- Run Query's data extensions and Query Activities are deleted from SFMC after 7 days (feedback #1081); the SQL stays in the query's history. Settings > Running queries changes the days or turns it off.
- Email validation: pick a sendable data extension on the page and see its details, an Email addresses tab, a 50,000-row limit.
- Primary colour is Salesforce Lightning brand blue.

**Fixed:**
- Preview data: filtering from a later page shows the matching rows (feedback #1082).
- Emails > Preview with data refuses a data extension that is not sendable before reading its rows (feedback #1075): SFMC refuses to preview with one (error 10005). Type values still works without a data extension.

## 2.0.20 (2026-11-04)

**New:**
- Saved CloudPages (feedback #1045): each time you save a CloudPage (landing page, web page or code resource), the version is kept in this browser like Saved Emails (10 newest per page), with a preview (scripts off) and Revert. Content > Saved CloudPages; Settings > Emails and CloudPages turns it off; admin policy `disableHistory` stops it. The CloudPages editor is assumed to save through the Content Builder asset API, not yet seen live.
- Code and Compare on Saved Emails and Saved CloudPages (feedback #1046): each version has Preview and Code (the HTML with slots and blocks filled in, AMPscript as written; code resources open as code), and Compare with shows two versions side by side, as code with the changed lines and words marked or as two previews.
- Restore by myself (feedback #1045): beside Revert and Restore in Saved Emails, Saved CloudPages and Saved Activities. It gives the request that puts the version back (method, REST path, the JSON body to download, the token call and a cURL command, or all of it as a Markdown file) to send with your own installed package. Restore stays.

- Emails, Preview with data (feedback #1055 to #1058): the data extension and row are chosen in a dialog with folders and search; the preview runs as soon as a row is picked (the button is now Preview); the subject line and preheader follow the row (filled in here when SFMC does not send them); Type values lists the attributes the email uses and fills them in as you type.
- Emails > Preview with data > Type values (feedback #1070): attributes in a foldable table (Attribute, Value, From); the list comes from the email (now also bare field names in AMPscript such as iif(region == 'ON', ...)) or from a data extension's fields; Add attribute adds your own. The folders and email list fold into a rail with an open button, like the sidebar.
- Automation Overview canvas laid out like Automation Studio's workflow view (feedback #1072): a Starting source column with the schedule as labelled fields and Active / Paused, then one column per step with numbered cards (1.1 SQL Query) and an icon tile. The Toolkit's own styling; the download keeps its drawing.
- AI dialogs (Summarize, Explain, Ask AI) can be minimized while the model downloads or writes; a card in the corner shows its state and opens it again (feedback #1074). Activities: Fetch all removed, Search with an empty box lists all (feedback #1073).
- Automations folder fix (feedback #1071): SFMC ignored the first folder filter and listed every automation. The Toolkit now tries several folder requests, keeps the first that really narrows the list (or filters rows that name their folder), and says so when none works instead of showing everything.
- Folder trees on Automations, Journeys (feedback #1064) and Data Extensions (feedback #1065): pick a folder to list what is in it. Automation Studio and Journey folders come from the automation folders API (categorytype automations and journey, not checked live).
- Concepts (feedback #1067): a book icon in the top bar explains the terms of the section you are on (query activity, data action, sendable, entry source, AMPscript and more), with a search and All sections.
- Emails: while previewing with data, the folders and email list fold away (Show emails brings them back; feedback #1061). When SFMC's HTML preview has no subject line or preheader, the Toolkit asks SFMC for them separately (feedback #1062).
- CloudPages View shows a landing page's source from CloudPages' own landing-pages contents call (entities.html) when its asset has none, in a code editor (feedback #1063). How the landing page and state IDs are found is not yet checked live.
- CloudPages has a folder tree (feedback #1059); Email validation picks its data extension in the same folder dialog (feedback #1060).
- Content > Emails (feedback #1054): Content Builder folders, email search by name, subject line or key, and each email's preview, text version and code. Preview with data picks a data extension row: SFMC renders the email for it (guide/v1 email preview, not yet checked live), or the Toolkit fills in the %%Field%% strings itself.

**Changed:**
- **Permissions:** `https://*.herokuapp.com/*` is now a required host (feedback #1068), so saving Query Studio runs works without a Chrome prompt. Chrome asks existing users to accept it when they update; until they do, Chrome keeps the extension turned off.
- Fewer calls to SFMC (feedback #1066, #1069): folder trees, the Emails, CloudPages, Journeys and Automations lists, and each automation with its activities are kept in this browser for 30 days (IndexedDB). Opening them again makes no SFMC call; Search asks SFMC only for what changed since the newest stored item (Content Builder's modifiedDate filter for emails and CloudPages; lists sorted by last change for journeys and automations); Refresh reads everything again (also drops deleted items). An automation page asks for its status only when the stored copy says it runs, or on Check status. Settings > Storage > Forget stored SFMC data removes it all.
- Saved Emails and Saved CloudPages are now the Saved versions tab of Emails and CloudPages (feedback #1059); their old addresses still work.
- Run Query panels are named after their SQL (feedback #1053): a new panel is "New query", then "_Sent, _Job +2" or "Counts from _Sent" from the tables it reads, until you name it. It was "Panel 1 · date and time".
- No browser alert or confirm boxes (feedback #1050): every question (Run once, Run this query, deletes, Clear all data, Restart to update) is an in-app dialog.
- Messages show in a bar at the top of the page instead of a passing toast (feedback #1050): errors stay until closed, with Copy and Report; others close by themselves. Run once and Run this query show their result in the activity card until closed.

**Fixed:**
- Run once is no longer offered for File Transfer activities: SFMC has no start request for them (it answered 404, feedback #1050).
- Create DE: the Sendable and Testable switches did not turn on (feedback #1052). Turning Sendable on now also picks the EmailAddress field (or the first field that fits) as the one related to Subscriber Key.

**Build:** test zips (`npm run package -- --test`, or any zip named `*-test-*`) have a To Test page in the sidebar: what to test in each version, with steps and what should happen, Pass / Fail / Skip kept in the browser, and Fail opening Feedback with the item filled in. Store builds leave the page out, and the package script refuses a store zip that contains it. Send results (test builds) sends every result and an optional note per item as one feedback row of kind `test-results`; the tester sees it first and must add a name.

**Changed:**
- AI Assist writes better SFMC SQL (feedback #1044): each request gets the rules that apply to it (dates and time zones, joins, data views, deduplication, target data extensions and more, written for the Toolkit from Mateusz Dabrowski's SFMC SQL guides at mateuszdabrowski.pl), the fields and joins of the data views it mentions, and matching worked examples. The answer goes through the Toolkit's SQL checks; if they find problems the model gets one round to fix them, and anything left is listed beside the suggestion. Copy prompt copies the instructions and request to use with a larger assistant.

**Fixed:**
- The Features page and What's New no longer describe old behaviour: no usage analytics (removed in 2.0.18), Clean up is under Settings, the teal colours, the current sidebar groups, Contact journeys under Contacts, the one-time Chrome OK for saving Query Studio runs, and the removed "Not seeing your saves?" request log.

## 2.0.19 (2026-11-03)

**New:**
- Previous and Next on automation and journey pages, with "2 of 40" and the ← → keys: they step through the list you opened the page from, in the order it was shown (search, filters and sort). Hidden when the page was not opened from a list (feedback #1043).
- Load everything in the connection menu: reads automations, activities, journeys, entry events, file locations, Content Builder items, Shared and Synchronized data extensions and data extension fields and folders into the caches the pages already use (memory for this tab, and Where used's saved data in the browser), one part after another with a count and time for each, so overviews, Data Extensions, Run Query and Where used open without a wait. Refresh reads everything again, Stop ends it. Nothing is saved to a file or downloaded. Settings > Connection can run it when the Toolkit connects (off by default) (feedback #1037).
- Automation canvas laid out like Automation Studio: the start source, a lane per step with its activities; also in HTML and PDF downloads (feedback #1035).
- AI Assist in Run Query can keep working in the background: the panel shows when the suggestion is ready (feedback #1032).
- Create DE and Where used pages follow the new design; the sidebar shows icons only in narrow windows.
- Home page, the new start page: connection and business unit, automations and journeys at a glance, what needs a look, watched automations, quick start links, the pages you use most and your recent saved queries (feedback #1025).
- Report the error: error messages have a link that opens Feedback with the error, the page and the time filled in, to check and edit before sending.
- Contact journeys: each entry into a journey (definitionInstanceId) shows as one flow, such as Entry attempted, Entry, Journey started, Email, Left the journey, with times on hover; pick an entry to see its path on the canvas (feedback #1020). Results stay while you visit other pages (#1017). Download menu (Markdown, Word, PDF, HTML, with the canvas and the path) and CSV of every step (#1019).
- Journeys open on an interactive canvas laid out like Journey Builder: pan, zoom, a minimap, keyboard navigation, horizontal or vertical layout, an icon per activity type and each activity's settings. Contributed by João Lucas ([@jolucas245](https://github.com/jolucas245)) in pull request #3, the project's first outside contribution.
- Journey HTML and PDF downloads draw the new journey canvas (shapes, icons, connectors, path labels, join points).
- Automation overview: Unwatch per watched automation, Unwatch all, Unwatch the ones not found (feedback #1027).
- Run Query (feedback #1028):
  - AI Assist (beta): write a query from a description, or fix the one in the panel, with Chrome's built-in model (Gemini Nano). It runs on the computer: nothing is sent over the network and query results are never in the prompt. The whole prompt is shown before it runs, the answer is a diff you apply or open in a new panel. Needs Chrome 138 or later on a desktop with enough memory; admins can turn it off (`disableAiAssist`).
  - New look (feedback #1031, from the redesign canvas): teal accent and grey neutrals, rounder cards and pill buttons; the header runs across the top with the sidebar under it; sidebar regrouped (Queries: Run Query, Query Builder, Saved queries; a Contacts group with Contacts, Contact journeys and Email validation; Delete Toolkit runs is now Settings > Clean up). Home has a search box that opens the Ctrl+K search, status bars on the automation and journey tiles, Good places to start, Recent queries and Jump back in. Run Query: pill toolbar, panel status line, Start from cards in an empty panel. Query Builder: header with sources and fields count, New menu, join-type picker with plain descriptions, collapsible Generated SQL bar. Saved queries: a list grouped by date with a details panel (cards still available). Data Extensions: tabs (All, Storage, Where used), detail panel with keys, dates, fields and preview. Clean up: counts, select everything older than 7 days, and an in-page delete confirmation.
  - Run Query toolbar grouped (feedback #1030): Edit (Format, Fix all, Find and replace, Insert all fields, Clear, Earlier text), Tables (Schema search, Sample rows, Shared snippets), Open (query activity, Query Builder, Diagramforce) and Save (Save as query activity, Share) menus with a line on what each does; Ask AI, Validate, Preview and Run stay on the bar with labels. Narrow panels drop the labels and wrap instead of cutting buttons off.
  - AI in more places (feedback #1029; experimental, on by default, Settings > Experimental turns it off; shown only in Google Chrome when the built-in model can run): a labelled Ask AI button and Fix with AI under the editor in Run Query; "Describe the query you need" on Home (opens Run Query and asks); Ask AI (drawn as a new builder query) and Explain in Query Builder; Explain on saved queries and query activities; Summarize on automations, journeys and Where used results; Suggest types (from field names only) in Create DE. Email addresses, phone numbers and record IDs are replaced before any prompt, and prompts are cut to fit the model.
  - Preview: runs the query (or the selection) with TOP 10 to see the first rows quickly.
  - Sample: the first 10 rows of each data extension in the query, read without running it; data views get a TOP 10 query in a new panel.
  - Find and replace button (also Ctrl/Cmd+F in the editor).
  - Clear, with Undo.
  - Earlier text: the panel's SQL from the last 24 hours (kept before Clear, opening a query activity, AI Assist and Restore, and every few minutes while typing), with a diff and Restore.
  - Ask before overwriting: opening a query activity into a panel with SQL asks to replace it or open a new panel; Save as query activity into an existing data extension with Overwrite, and Save to data extension with Update, need a tick first.

**Changed:**
- Data Extensions hides the Description, Modified, Created and ID columns until you turn them on in Columns (feedback #1040).
- Save email versions, Save Query and Script activity versions, Share queries and Save Query Studio runs are on by default (feedback #1021). Each can be turned off in Settings, admin policies still turn them off, Share still shows what will be sent and asks first, and Query Studio still needs Chrome's permission once. PRIVACY.md and the security summary are updated.
- Raw JSON on Contact journeys and Contacts shows in the code viewer with Copy (feedback #1018, #1023).

**Fixed:**
- Where used listed automations by their ID instead of their name, and opening one failed to load its run history ("not a valid identifier"). Results now show the automation name, step and activity, and an automation page opened by that ID switches to the one run history needs (feedback #1041, #1042).
- Home and Run Query offer once to turn on saving Query Studio runs, since Chrome grants that access only on a click (feedback #1039).
- Reorder columns on Data Extensions is turned off for now (feedback #1033).
- Automation details open in Full view again; the canvas is under Overview (feedback #1038).
- AI Assist on an empty panel shows only the suggested SQL, not a comparison with empty text (feedback #1034).
- Watched automations showed "SFMC API error 404" for every automation (feedback #1026): watches now remember their business unit and are checked only there, an old error clears on the next good check, and an automation SFMC does not find says so plainly.
- Contact journeys could not draw a journey when Journey Builder answered 404 for the id in the history (feedback #1024): it now looks the journey up by key and by name, and says when the drawing is from another version.
- Contacts listed one contact twice, once per address (email, mobile); they are now one contact with its addresses (feedback #1022/#1023).
- Email validation by contact checked a Contact Builder formula value such as {toLower(@EmailAddress)} as an address (feedback #1022).
- Run Query: text typed just before closing a panel or the tab could be lost (the save waited 500 ms and was cancelled on close); it is now written.

## 2.0.18 (2026-11-02)

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

**New:**
- Data > Email validation: check addresses with SFMC's email validation API (syntax, mail server, List Detective; pick which). One address, a pasted or loaded list (up to 5,000), the email addresses of contacts found by Contact Key, or a data extension column (up to 50,000 rows). For a data extension the results go into three fields you pick in it (isValidEmail, invalidReason, APIresponse; rows matched by primary key) or into a new data extension. CSV download. One SFMC call per address.
- Journey > Contact journeys: one contact across all journeys or within one: the journeys it is in now, the journeys it went through in the last 7, 30 or 90 days, each step in order with status and errors, and the path outlined on the journey canvas. Email sends in Run Query opens data-view SQL for the contact's journey emails. Journey Builder's history search is not yet checked against a live org.

- Automation > Templates > Email address validation: an automation that adds new and changed subscribers to an Email Validation data extension, picks the next batch not yet validated (50,000 by default), and validates it with a Script activity (SSJS) that uses the client ID and secret you put in a settings data extension. Each run stops before SFMC's 30-minute Script activity limit; what it did not reach is in the next batch. A run log data extension records each run. Needs Script activities turned on in the business unit (the template checks and stops before creating anything if not). The script has not been run against a live org.
- Email validation: a new results data extension gets a name that is not taken yet (SFMC refuses a second one with the same name), checked before any row is read.

**Fixed:** Journey Builder calls that send data (Contact journeys) were refused with "invalid csrf token"; error pages from Journey Builder now show SFMC's message.

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
