<script setup>
// Shown once after an update that has news: to SFMC Query Saver users the rename
// to Marketing Cloud Toolkit (2.0.0) plus the latest news, to Toolkit users only the news.
// Fresh installs skip it. Uses Query Saver's `_seenVersion` key.
// The dialog keeps its title, close button and Got it in view and shows the news
// PAGE_SIZE items to a page with Previous and Next (feedback #1083; arrow keys too).
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { X, ChevronLeft, ChevronRight } from 'lucide-vue-next'

const VERSION = '2.0.23'
const PAGE_SIZE = 3
const open = ref(false)
const fromQuerySaver = ref(false)
const page = ref(0)

// This version's news first, then earlier updates, PAGE_SIZE to a page (feedback #1083).
const NEWS = [
  { title: "Remove contacts from a journey", text: "Journeys > Remove contacts: paste Contact Keys, load a file or pick a data extension column, review, confirm, and see each contact's exit status. The first Toolkit feature that changes SFMC data; your administrator can turn it off." },
  { title: "More of SFMC in one place", text: "Subscriber lookup, Contact deletions, Suppression lists, SMS subscriptions, Data model, Sends, Triggered and Transactional sends, Event notifications, Send settings, Users and roles, Business units, File locations and Import results, all read only." },
  { title: "Recycle bin and clean-up", text: "Find deleted data extensions and Content Builder items, and a report of unused, old and duplicate content. Content > Changes shows what was created or modified, and by whom." },
  { title: "Journeys and automations as SFMC shows them", text: "Journey pages with status, entry source, re-entry, contacts per step, the audit log, a contact check and contact paths. Automations with Automation Studio's own icons and details." },
  { title: "Background jobs", text: "Email validation runs in the background, can write to a copy of the data extension, and tells you when it is done. Activity history lists what ran." },
  { title: "Create a data extension with an AI's help", text: "Create DE > Ask an AI: copy a prompt with SFMC's field rules into the AI assistant you use, paste its answer, and the fields, keys and settings are filled in for you to check. The Toolkit sends nothing.", earlier: true },
  { title: "Failed runs say why", text: "When a Run Query run fails, the Toolkit shows SFMC's own reason, and result data extensions no longer drop duplicate rows.", earlier: true },
  { title: "Excel with the SQL", text: "Download any Run Query result as Excel: the SQL on the first sheet, the rows you see on the second.", earlier: true },
  { title: "One more SQL check", text: "DISTINCT, UNION, GROUP BY or ORDER BY on _Job's DynamicEmailSubject (an ntext column SFMC cannot compare) is marked before you run, with a one-click fix.", earlier: true },
  { title: "Journeys by their live version", text: "Home and Journey overview count a published journey with a newer draft as live, and a journey's page has a version picker.", earlier: true },
  { title: "Setup: Domains and Installed Packages", text: "Sender domains with SPF, DKIM and DMARC explained, From addresses at risk, custom domain certificates, and an alert when an installed package's client secret is about to expire.", earlier: true },
  { title: "Customize Home", text: "Hide, show and reorder Home's sections and cards. Kept in this browser; nothing is sent.", earlier: true },
  { title: "Faster plain reads, and search the results", text: "A query that only reads one data extension shows its rows in seconds, without a Query Activity. A Search rows box finds text in any column of the results.", earlier: true },
  { title: "Old runs cleaned up in SFMC", text: "Data extensions and Query Activities from your Run Query runs are deleted from SFMC after 7 days; the SQL stays in the query's history. Settings > Running queries changes the days or turns it off.", earlier: true },
  { title: "Email validation and Publication Lists", text: "Pick a sendable data extension right on the page and see its details; one tab for one address or many. Contacts > Publication Lists counts each list's subscribers by status.", earlier: true },
  { title: "Emails and CloudPages, browsed", text: "Content Builder folders, a preview of any email with data from a data extension row or values you type, and the code of each version. Every CloudPage save is kept like email versions, with Code and Compare.", earlier: true },
  { title: "Folders and Concepts", text: "Automations, Journeys and Data Extensions list by folder. The book icon in the top bar explains the terms of the section you are on.", earlier: true },
  { title: "Faster, with fewer calls to SFMC", text: "Folders, lists and automation details are kept in this browser for 30 days and only the changes are read again. Settings can forget them.", earlier: true },
  { title: "Automations like Automation Studio", text: "The canvas has a Starting source column and one column per step with numbered cards. AI dialogs can be minimized while they work.", earlier: true },
  { title: "Restore by myself", text: "Saved versions give you the request that puts a version back, to send with your own installed package.", earlier: true },
  { title: "Query Studio saving without a prompt", text: "Chrome asked you once to allow herokuapp.com for this update, so Query Studio runs are saved without another prompt.", earlier: true },
  { title: "A new look and a Home page", text: "Teal and grey, the header across the top, a regrouped sidebar, and Home as the start page: your connection, automations and journeys at a glance, what needs a look, and the pages and queries you use most.", earlier: true },
  { title: "AI Assist (experimental, Chrome only)", text: "Write, fix and explain queries, and summarize automations and journeys, with Chrome's built-in model. It runs on your computer: nothing is sent over the network. Settings > Experimental turns it off.", earlier: true },
  { title: "Run Query toolbar and tools", text: "Edit, Tables, Open and Save menus; Preview the first 10 rows, Sample a data extension, Find and replace, Clear with Undo, and Earlier text from the last 24 hours.", earlier: true },
  { title: "Load everything", text: "The connection menu can read automations, journeys, activities, Content Builder items and data extensions up front, so overviews, Data Extensions, Run Query and Where used open without a wait.", earlier: true },
  { title: "Automation canvas and Previous / Next", text: "Automations under Overview are drawn like Automation Studio, also in downloads. Automation and journey pages step through the list you opened them from (buttons or the arrow keys).", earlier: true },
  { title: "Contact journeys, step by step", text: "Each entry into a journey shows as one flow with times, its path on the canvas, and Download or CSV.", earlier: true },
  { title: "Report the error", text: "Error messages have a link that opens Feedback with the error and page filled in, for you to check before sending.", earlier: true },
  { title: "Saving on by default", text: "Email versions, Query and Script versions, Share and Query Studio runs are on unless you turn them off in Settings. Query Studio still needs your OK in Chrome once.", earlier: true },
  { title: "Email validation", text: "Data > Email validation checks addresses with SFMC's validation API: one, a list, contacts by Contact Key, or a data extension column, with the results written back to that data extension or a new one.", earlier: true },
  { title: "Contact journeys", text: "Journey > Contact journeys shows the journeys a contact is in and the path it took through each, step by step and outlined on the journey canvas.", earlier: true },
  { title: "Email address validation template", text: "Automation > Templates builds an automation that validates every subscriber's address a batch at a time (needs Script activities in your business unit).", earlier: true },
  { title: "Automation Summary with step details", text: "The Automation Summary tab in Automation Studio shows what each step's activities do (targets, SQL, scripts, waits).", earlier: true },
  { title: "Column values and duplicates", text: "The chart icon by a column name in Preview data and Run Query results lists its distinct values with counts; tick values to filter, or keep only duplicates.", earlier: true },
  { title: "View a CloudPage", text: "CloudPages: View shows the page itself (scripts off), its code (landing pages included), and the raw record; for code resources, their code.", earlier: true },
  { title: "The journey diagram in downloads", text: "HTML and PDF downloads of a journey include its canvas.", earlier: true },
  { title: "Data extension descriptions", text: "Data Extensions has a Description column, also in the Excel and document downloads.", earlier: true },
  { title: "Run trends further back", text: "Automation overview reads past the newest 200 runs of each automation.", earlier: true },
  { title: "Run Query runs again", text: "Fixed \"selectCols is not defined\" at the Create DE step in 2.0.12, which stopped every run and Save as query activity.", earlier: true },
  { title: "Data Extensions filters", text: "Search all sources, this BU only, Shared only or Synchronized only, and hide QueryStudioResults data extensions.", earlier: true },
  { title: "Smaller query preview", text: "The Saved queries preview fits the window, and Esc or a click outside closes it.", earlier: true },
  { title: "Query Builder, easier", text: "Opens in Visual, the SQL sits at the bottom (minimize or maximize it), aliases come from table names, and ? icons and Help explain each part.", earlier: true },
  { title: "Contacts work", text: "The count and the search use Contact Builder's own session, and you can search up to 1,000 contact keys at once (paste or load a file).", earlier: true },
  { title: "Templates and run history", text: "Pick folders, get the automation's emails, edit the SQL before creating; failed runs name the step and its error.", earlier: true },
  { title: "A visual Query Builder", text: "Tables as cards you join by dragging from field to field, like Diagramforce. Paste SQL to see it as a diagram (From SQL, or Open in Query Builder from Run Query), with subqueries, UNION tabs, AND/OR groups and HAVING. Open any query in Diagramforce as a data model or lineage.", earlier: true },
  { title: "Run Query helps more", text: "Failed runs explain the error and the fix; Fix all applies every one-click fix; stale results are greyed; save results to a data extension; shared team snippets; Join from the schema search.", earlier: true },
  { title: "Checks before saving a query activity", text: "Required fields, dropped columns, types, lengths, primary keys and duplicate keys are checked against the target first.", earlier: true },
  { title: "20 new SQL checks", text: "Syntax from other databases (LIMIT, NOW(), IFNULL), window functions, aliases not in FROM, ORDER BY without TOP, double-quoted text, a LEFT JOIN undone by WHERE, and more. Settings > Lint rules can copy the rules for an AI assistant.", earlier: true },
  { title: "Create DE", text: "Data > Create DE: paste or drop a sample (CSV, TSV, JSON, Parquet, Excel) or start empty, check the guessed fields, pick the folder and retention, and create the data extension.", earlier: true },
  { title: "Preview data", text: "Data Extensions: Preview data reads the rows straight from SFMC, no query needed. Load more or all (up to 50,000), Refresh, sort and filter by column, hide columns, tick rows to copy or download only those (CSV, Excel, Markdown).", earlier: true },
  { title: "Run once", text: "Activities: start a Data Extract (and, not yet checked against SFMC, an Import, File Transfer or Script) from its card, after a confirm.", earlier: true },
  { title: "Sort and filter tables", text: "Click a column header to sort Automations, Journeys, Data Extensions and CloudPages; open Filters for a box per column.", earlier: true },
  { title: "Running automations at a glance", text: "An automation that is running shows a moving bar with the step it is on, kept up to date while you look. Statuses and activity types have icons, and long loads show progress bars.", earlier: true },
  { title: "Query and Script versions", text: "Automation > Saved Activities keeps the SQL and scripts you save in Automation Studio, with the version from before each edit. Compare, copy or restore one.", earlier: true },
  { title: "Save as query activity", text: "From Run Query, create a named Query Activity in the folder you pick, writing to a new or existing data extension. Nothing is run or scheduled.", earlier: true },
  { title: "See where results went", text: "After a run, the results data extension and Query Activity are named, with links.", earlier: true },
  { title: "Query Builder", text: "Drag data extensions to reorder or swap them, and the search finds every data extension.", earlier: true },
  { title: "Overviews ready sooner", text: "Automation overview and Journey overview load quietly in the background after the app opens.", earlier: true },
  { title: "No more empty searches", text: "When an SFMC app has no session, a search connects it and tries again; if that fails it says which app, with Retry and a link to log in.", earlier: true },
]

// For SFMC Query Saver users: what moved where.
const FROM_QUERY_SAVER = [
  { title: "Everything you saved is here", text: "Saved queries with their run history, workspaces, Query Builder queries and email versions, under Queries and Saved Emails in the sidebar." },
  { title: "New sections", text: "Automations, Activities, Journeys, Journey Entry, Data Extensions and CloudPages." },
  { title: "Settings have their own page", text: "Email versions, reuse DE, lint rules, backups and the API console are under Settings." },
  { title: "Several tabs", text: "The toolbar icon opens a new tab each time; Ctrl+K jumps to any section." },
  { title: "Where used", text: "Data > Where used shows what uses a data extension, field, email or content block, and what an automation touches." },
]

const items = computed(() => (fromQuerySaver.value ? FROM_QUERY_SAVER : NEWS))
const pageCount = computed(() => Math.max(1, Math.ceil(items.value.length / PAGE_SIZE)))
const shown = computed(() => items.value.slice(page.value * PAGE_SIZE, (page.value + 1) * PAGE_SIZE))
const goTo = (n) => { page.value = Math.min(pageCount.value - 1, Math.max(0, n)) }

try {
  chrome.storage.local.get(null, (all) => {
    if (all?._seenVersion === VERSION) return
    const upgrading = !!all?._seenVersion || Object.keys(all || {}).some((k) => /^(sql|email|workspace)_/.test(k))
    // Query Saver stored 1.x here; the Toolkit stores 2.x.
    fromQuerySaver.value = !String(all?._seenVersion || '').startsWith('2.')
    if (upgrading) open.value = true
    else chrome.storage.local.set({ _seenVersion: VERSION })
  })
} catch { /* not in an extension */ }

function close() {
  open.value = false
  try { chrome.storage.local.set({ _seenVersion: VERSION }) } catch { /* not in an extension */ }
}

const onKey = (e) => {
  if (!open.value) return
  if (e.key === 'Escape') close()
  else if (e.key === 'ArrowRight') goTo(page.value + 1)
  else if (e.key === 'ArrowLeft') goTo(page.value - 1)
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-150 flex items-center justify-center bg-black/50 p-4" @mousedown.self="close">
    <div data-whatsnew class="flex w-full max-w-md max-h-[calc(100vh-2rem)] flex-col rounded-xl border border-border bg-card shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="whatsnew-title">
      <div class="shrink-0 border-b border-border px-5 pt-5 pb-3">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-bold text-primary bg-primary/10 rounded-full px-3 py-1 uppercase tracking-wide">Version {{ VERSION }}</span>
          <button class="p-1 rounded hover:bg-accent" title="Close" aria-label="Close" data-whatsnew-close @click="close"><X class="h-4 w-4" /></button>
        </div>
        <h2 id="whatsnew-title" class="mt-3 text-lg font-bold">{{ fromQuerySaver ? 'SFMC Query Saver is now Marketing Cloud Toolkit' : 'What\'s new in Marketing Cloud Toolkit' }}</h2>
        <p class="mt-1 text-xs text-muted-foreground">The changes in this update, shown once. Every feature is on the <a href="#/features" class="text-primary hover:underline" @click="close">Features</a> page.</p>
      </div>
      <ul class="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-3 text-sm" data-whatsnew-list>
        <li v-for="item in shown" :key="item.title" data-whatsnew-item>
          <span v-if="item.earlier" class="mb-0.5 block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Earlier update</span>
          <strong class="block">{{ item.title }}</strong><span class="text-muted-foreground">{{ item.text }}</span>
        </li>
      </ul>
      <div v-if="pageCount > 1" class="shrink-0 flex items-center justify-between gap-2 border-t border-border px-5 py-2 text-xs" data-whatsnew-pager>
        <button type="button" class="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-border hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent" :disabled="page === 0" data-whatsnew-prev @click="goTo(page - 1)"><ChevronLeft class="h-3.5 w-3.5" /> Previous</button>
        <span class="text-muted-foreground tabular-nums" data-whatsnew-page>Page {{ page + 1 }} of {{ pageCount }}</span>
        <button type="button" class="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-border hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent" :disabled="page >= pageCount - 1" data-whatsnew-next @click="goTo(page + 1)">Next <ChevronRight class="h-3.5 w-3.5" /></button>
      </div>
      <div class="shrink-0 border-t border-border px-5 py-4"><button class="w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium" @click="close">Got it</button></div>
    </div>
  </div>
</template>
