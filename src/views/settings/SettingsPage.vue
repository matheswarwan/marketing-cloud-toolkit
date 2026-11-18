<script setup>
import ReportErrorButton from '@/components/results/ReportErrorButton.vue'
import Button from '@/components/ui/button/Button.vue'
import { computed, onUnmounted, ref } from 'vue'
import Switch from '@/components/ui/switch/Switch.vue'
import StorageUsage from '@/components/StorageUsage.vue'
import { CACHE_DAYS, forgetCache, forgetScope } from '@/utils/localCache.js'
import { askConfirm } from '@/composables/useConfirm.js'
import FeedbackModal from '@/components/modals/FeedbackModal.vue'
import CreatorCredit from '@/components/shell/CreatorCredit.vue'
import { useTheme } from '@/composables/useTheme.js'
import { useStoredSetting } from '@/composables/useStoredSetting.js'
import { disabledRules, setRuleDisabled, onLintSettingsChange } from '@/editor/lintSettings.js'
import { LINT_RULES } from '@/utils/sqlLint.js'
import { sqlRulesForAi } from '@/utils/aiRules.js'
import { buildBackup, backupFileName, parseBackup, planImport, describeImport } from '@/utils/backup.js'
import { saveTextFile, readFileText } from '@/utils/download.js'
import { showToast } from '@/composables/useToast.js'
import { useApiConsole } from '@/composables/useApiConsole.js'
import { useAi } from '@/composables/useAi.js'
import { AVAILABILITY_TEXT, isChromeBrowser } from '@/utils/aiAssist.js'
import { DEFAULT_RETENTION_DAYS, SUGGESTED_RETENTION_DAYS, parseRetentionDays } from '@/utils/sfmcApi.js'
import { RUN_CLEANUP_SETTING, DEFAULT_RUN_CLEANUP_DAYS, parseRunCleanupDays } from '@/utils/runCleanup.js'
import { policy, POLICY_NOTE } from '@/utils/policy.js'
import { DNS_SETTING } from '@/utils/dnsCheck.js'
import { HISTORY_SETTING } from '@/utils/history.js'
import { SHARE_SETTING } from '@/utils/share.js'
import { QUERY_STUDIO_SETTING, QUERY_STUDIO_PERMISSION } from '@/utils/queryStudio.js'
import { NOTIFY_KEY } from '@/utils/watches.js'
import { ACTIVITY_SAVER_SETTING, ACTIVITY_MAX_SETTING, DEFAULT_MAX_VERSIONS } from '@/utils/activityVersions.js'
import { STORE_REVIEWS_URL } from '@/utils/storeLinks.js'
import { START_SETTING, CHOICES_KEY, parseStartSetting, cleanChoices, effectiveStart } from '@/utils/runQueryStart.js'

const { currentTheme, themes, setTheme } = useTheme()

// Same keys as SFMC Query Saver, read by the service worker and the run flow.
const { value: emailSaver } = useStoredSetting('_emailSaverEnabled', true, (v) => v !== false)
const { value: cloudPageSaver } = useStoredSetting('_cloudPageSaverEnabled', true, (v) => v !== false) // feedback #1045
// Query and Script activity versions (feedback #122; background/activityCapture.js).
const { value: activitySaver } = useStoredSetting(ACTIVITY_SAVER_SETTING, true, (v) => v !== false)
const { value: activityMax } = useStoredSetting(ACTIVITY_MAX_SETTING, DEFAULT_MAX_VERSIONS,
  (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : DEFAULT_MAX_VERSIONS))
function setActivityMax(e) {
  const n = Math.round(Number(e.target.value))
  activityMax.value = Number.isFinite(n) ? Math.min(500, Math.max(1, n)) : DEFAULT_MAX_VERSIONS
}
const { value: emailDebounce } = useStoredSetting('_emailSaveDebounce', 5,
  (v) => (typeof v === 'number' && v >= 0 ? v : 5))
const { value: reuseQueryDE } = useStoredSetting('_reuseQueryDE', false, (v) => v === true)
// What Run Query opens with (feedback #1111): learned from use unless picked here.
const { value: runQueryStart } = useStoredSetting(START_SETTING, 'auto', parseStartSetting)
const { value: runQueryChoices } = useStoredSetting(CHOICES_KEY, [], cleanChoices)
const learnedStart = computed(() => effectiveStart('auto', runQueryChoices.value))
const START_OPTIONS = [
  { id: 'auto', label: 'Learn from what I do' },
  { id: 'last', label: 'My last panels' },
  { id: 'empty', label: 'One empty panel' },
]
const { value: autoStartSessions } = useStoredSetting('_autoStartSessions', true, (v) => v !== false)
const { value: preloadOnConnect } = useStoredSetting('_preloadOnConnect', false, (v) => v === true)
const { value: automationPanel } = useStoredSetting('_automationPanel', true, (v) => v !== false)
// DNS checks on the Domains page (user, 2026-11-05): off until the user turns them on.
const { value: dnsLookup } = useStoredSetting(DNS_SETTING, false, (v) => v === true)
const { value: dashboardPanel } = useStoredSetting('_dashboardPanel', false, (v) => v === true)
const { value: retentionDays } = useStoredSetting('_queryDERetentionDays', DEFAULT_RETENTION_DAYS, parseRetentionDays)
// Feedback #1081: delete Run Query's SFMC objects after N days (0 = off).
const { value: cleanupDays } = useStoredSetting(RUN_CLEANUP_SETTING, DEFAULT_RUN_CLEANUP_DAYS, parseRunCleanupDays)
const cleanupOn = computed({ get: () => cleanupDays.value > 0, set: (on) => { cleanupDays.value = on ? DEFAULT_RUN_CLEANUP_DAYS : 0 } })
const cleanupInput = computed({
  get: () => cleanupDays.value,
  set: (v) => { const n = Math.round(Number(v)); if (Number.isFinite(n) && n > 0) cleanupDays.value = parseRunCleanupDays(n) },
})

// Desktop notifications for watched automations: the optional notifications
// permission plus a setting (feedback #50).
const desktopNotify = ref(false)
chrome.storage?.local.get(NOTIFY_KEY, (r) => {
  chrome.permissions?.contains({ permissions: ['notifications'] }, (has) => { desktopNotify.value = !!has && r?.[NOTIFY_KEY] === true })
})
function setDesktopNotify(on) {
  const done = (ok) => {
    void chrome.runtime.lastError
    desktopNotify.value = !!on && !!ok
    chrome.storage.local.set({ [NOTIFY_KEY]: desktopNotify.value })
    if (on && !ok) showToast('Desktop notifications are off: Chrome did not get the permission.')
  }
  if (on) chrome.permissions.request({ permissions: ['notifications'] }, done)
  else chrome.permissions.remove({ permissions: ['notifications'] }, () => done(false))
}

const { value: keepHistory } = useStoredSetting(HISTORY_SETTING, true, (v) => v !== false)
// AI (feedback #1028, #1029): experimental, on by default (composables/useAi.js).
const { enabled: aiEnabled, availability: aiAvailabilityState } = useAi()
const aiStatus = computed(() => (!isChromeBrowser() ? 'AI works only in Google Chrome; this browser does not show it.' : AVAILABILITY_TEXT[aiAvailabilityState.value] || 'Checking Chrome\'s built-in model...'))
const { value: shareSetting } = useStoredSetting(SHARE_SETTING, true, (v) => v !== false)

// Saving Query Studio runs: on by default (feedback #1021). Since feedback #1068 the
// *.herokuapp.com access is part of the install (no click needed); the switch only turns
// saving on or off. An older install without the access still asks once.
const qsCapture = ref(false)
async function forgetStored() {
  if (!(await askConfirm({ title: 'Forget stored SFMC data?', message: 'Folders, lists and automation details kept in this browser are removed. Pages read them from SFMC again when you open them.', confirmLabel: 'Forget' }))) return
  await forgetCache()
  forgetScope()
  showToast('Stored SFMC data forgotten.')
}
chrome.storage?.local.get(QUERY_STUDIO_SETTING, (r) => {
  chrome.permissions?.contains(QUERY_STUDIO_PERMISSION, (has) => { qsCapture.value = !!has && r?.[QUERY_STUDIO_SETTING] !== false })
})
function setQsCapture(on) {
  const done = (ok) => {
    void chrome.runtime.lastError
    qsCapture.value = !!on && !!ok
    chrome.storage.local.set({ [QUERY_STUDIO_SETTING]: qsCapture.value })
    if (on && !ok) showToast('Query Studio runs are not saved: Chrome did not get the permission.')
  }
  if (!on) { done(false); return }
  chrome.permissions.contains(QUERY_STUDIO_PERMISSION, (has) => (has ? done(true) : chrome.permissions.request(QUERY_STUDIO_PERMISSION, done)))
}
const retentionInput = computed({
  get: () => retentionDays.value,
  set: (v) => { const n = Math.round(Number(v)); if (Number.isFinite(n) && n > 0) retentionDays.value = parseRetentionDays(n) },
})
const retentionOn = computed({
  get: () => retentionDays.value > 0,
  set: (on) => { retentionDays.value = on ? SUGGESTED_RETENTION_DAYS : 0 },
})

const offRules = ref([...disabledRules()].sort())
const stopLint = onLintSettingsChange((set) => { offRules.value = [...set].sort() })
onUnmounted(stopLint)

// Every SQL check, with a switch. QS043 (plain SELECT *) is always off in the editor,
// since the run flow supports SELECT * (src/editor/sqlExtensions.js).
const ALWAYS_OFF = new Set(['QS043'])
const ruleSearch = ref('')
const rules = computed(() => {
  const q = ruleSearch.value.trim().toLowerCase()
  return LINT_RULES.filter((r) => !q || `${r.code} ${r.title}`.toLowerCase().includes(q))
})
async function copyRulesForAi() {
  try {
    await navigator.clipboard.writeText(sqlRulesForAi())
    showToast('SQL rules copied. Paste them into your AI assistant\'s chat or instructions.')
  } catch {
    showToast('Could not copy to the clipboard.')
  }
}
function turnAllOn() { for (const code of [...offRules.value]) setRuleDisabled(code, false) }

const showFeedback = ref(false)
const { enabled: apiConsoleOn, setEnabled: setApiConsole } = useApiConsole()
const version = computed(() => {
  try { return chrome.runtime.getManifest().version } catch { return '' }
})

// ── Backup ───────────────────────────────────────────────
const backupInput = ref(null)
const importResult = ref('')
const importError = ref('')

const getAll = () => new Promise((r) => chrome.storage.local.get(null, (items) => r(items || {})))

async function exportBackup() {
  const backup = buildBackup(await getAll(), { app: 'sfmc-toolkit', appVersion: version.value })
  await saveTextFile(JSON.stringify(backup, null, 2), backupFileName('sfmc-toolkit'), 'application/json', 'Backup file')
}

async function importBackup(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  importResult.value = ''
  importError.value = ''
  if (!file) return
  try {
    const backup = parseBackup(await readFileText(file))
    const plan = planImport(backup.items, await getAll())
    if (Object.keys(plan.writes).length) await new Promise((r) => chrome.storage.local.set(plan.writes, r))
    importResult.value = describeImport(plan)
    showToast(importResult.value)
  } catch (e) {
    importError.value = e.message
  }
}

function setDebounce(e) {
  const n = Math.round(Number(e.target.value))
  emailDebounce.value = Number.isFinite(n) ? Math.min(60, Math.max(0, n)) : 5
}
</script>

<template>
  <div class="max-w-2xl mx-auto px-6 py-6 space-y-6">
    <section class="rounded-lg border border-border bg-card p-4">
      <h2 class="text-sm font-semibold mb-3">Appearance</h2>
      <div class="flex gap-2" role="radiogroup" aria-label="Theme">
        <button
          v-for="t in themes" :key="t.id" role="radio" :aria-checked="currentTheme === t.id"
          class="flex items-center gap-2 h-8 px-3 rounded-md border text-sm"
          :class="currentTheme === t.id ? 'border-primary text-primary bg-primary/5' : 'border-border hover:bg-accent'"
          @click="setTheme(t.id)"
        >
          <span class="h-3 w-3 rounded-full border border-border" :style="{ background: t.swatch }" />
          {{ t.label }}
        </button>
      </div>
    </section>

    <section class="rounded-lg border border-border bg-card p-4 space-y-4">
      <h2 class="text-sm font-semibold">Emails and CloudPages</h2>
      <div class="flex items-start gap-3">
        <div class="flex-1">
          <div class="text-sm font-medium">Save email versions</div>
          <p class="text-xs text-muted-foreground">Each time you save an email in Content Builder, a copy is kept in this browser so you can compare or revert it (the 10 newest versions per email). On by default.</p>
        </div>
        <Switch :model-value="emailSaver && !policy.disableHistory" :disabled="policy.disableHistory" aria-label="Save email versions" @update:model-value="emailSaver = $event" />
      </div>
      <div class="flex items-start gap-3">
        <div class="flex-1">
          <div class="text-sm font-medium">Save CloudPage versions</div>
          <p class="text-xs text-muted-foreground">Each time you save a CloudPage (landing page, web page or code resource), a copy is kept in this browser (Content > CloudPages, Saved versions tab), to compare, revert or restore yourself (the 10 newest versions per page). On by default.</p>
        </div>
        <Switch :model-value="cloudPageSaver && !policy.disableHistory" :disabled="policy.disableHistory" aria-label="Save CloudPage versions" @update:model-value="cloudPageSaver = $event" />
      </div>
      <div class="flex items-center gap-3" :class="{ 'opacity-50': !emailSaver }">
        <label for="email-debounce" class="flex-1">
          <div class="text-sm font-medium">Minimum time between versions</div>
          <p class="text-xs text-muted-foreground">Saves of the same email closer together than this are skipped. 0 keeps every save.</p>
        </label>
        <div class="flex items-center gap-1.5 text-sm">
          <input id="email-debounce" type="number" min="0" max="60" :value="emailDebounce" :disabled="!emailSaver"
            class="w-16 h-8 rounded-md border border-border bg-background px-2" @change="setDebounce" />
          seconds
        </div>
      </div>
    </section>

    <section class="rounded-lg border border-border bg-card p-4 space-y-4">
      <h2 class="text-sm font-semibold">Automation Studio activities</h2>
      <div class="flex items-start gap-3">
        <div class="flex-1">
          <div class="text-sm font-medium">Save Query and Script activity versions</div>
          <p class="text-xs text-muted-foreground">Each time you save a SQL Query or Script activity in Automation Studio, the version from before your edit and the saved one are kept in this browser (Automation > Saved Activities). On by default.</p>
        </div>
        <Switch :model-value="activitySaver && !policy.disableHistory" :disabled="policy.disableHistory" aria-label="Save Query and Script activity versions" @update:model-value="activitySaver = $event" />
      </div>
      <div class="flex items-center gap-3" :class="{ 'opacity-50': !activitySaver }">
        <label for="activity-max" class="flex-1">
          <div class="text-sm font-medium">Versions kept per activity</div>
          <p class="text-xs text-muted-foreground">The oldest versions go first when an activity has more.</p>
        </label>
        <input id="activity-max" type="number" min="1" max="500" :value="activityMax" :disabled="!activitySaver"
          class="w-20 h-8 rounded-md border border-border bg-background px-2 text-sm" @change="setActivityMax" />
      </div>
    </section>

    <section class="rounded-lg border border-border bg-card p-4 space-y-4">
      <h2 class="text-sm font-semibold">Running queries</h2>
      <p v-if="policy.disableHistory" class="text-xs text-amber-700 dark:text-amber-400">Query history and saving runs, emails and activities: {{ POLICY_NOTE }}</p>
      <div class="flex items-start gap-3">
        <div class="flex-1">
          <div class="text-sm font-medium">Keep query history</div>
          <p class="text-xs text-muted-foreground">Each saved query keeps the SQL of its runs, in this browser only. When off, a run keeps only the names of the data extension and Query Activity it created in SFMC (so Settings > Clean up can remove them), not its SQL. Query results are never stored in the browser.</p>
        </div>
        <Switch :model-value="keepHistory && !policy.disableHistory" :disabled="policy.disableHistory" aria-label="Keep query history" @update:model-value="keepHistory = $event" />
      </div>
      <div class="flex items-start gap-3" data-testid="run-query-start">
        <div class="flex-1">
          <div class="text-sm font-medium">When Run Query opens, show</div>
          <p class="text-xs text-muted-foreground">Your last panels, or one empty panel (the queries stay in Saved queries either way). Learn from what I do watches what you do first after Run Query opens: Start fresh, or running the query shown. When you mostly start fresh it opens empty, and says so; Reopen last panels brings the old ones back.</p>
          <p v-if="runQueryStart === 'auto'" class="text-xs text-muted-foreground mt-1">Now: {{ learnedStart === 'empty' ? 'one empty panel' : 'your last panels' }} ({{ runQueryChoices.length }} of the last 10 openings counted).</p>
          <div class="mt-2 inline-flex items-center p-[3px] border border-border rounded-full bg-card" role="radiogroup" aria-label="When Run Query opens">
            <button v-for="o in START_OPTIONS" :key="o.id" type="button" role="radio" :aria-checked="runQueryStart === o.id"
              class="h-7 px-3 rounded-full text-xs"
              :class="runQueryStart === o.id ? 'bg-primary text-primary-foreground font-semibold' : 'text-foreground/80 hover:bg-accent'"
              @click="runQueryStart = o.id">{{ o.label }}</button>
          </div>
        </div>
      </div>
      <div class="flex items-start gap-3">
        <div class="flex-1">
          <div class="text-sm font-medium">Reuse the data extension and Query Activity</div>
          <p class="text-xs text-muted-foreground">Running the same query again reuses its last target DE and Query Activity instead of creating new ones.</p>
        </div>
        <Switch v-model="reuseQueryDE" aria-label="Reuse the data extension and Query Activity" />
      </div>
      <div class="flex items-start gap-3">
        <div class="flex-1">
          <div class="text-sm font-medium">Delete old runs from SFMC</div>
          <p class="text-xs text-muted-foreground">On by default. Once a day, the data extension and Query Activity of each run you made in this browser more than the given number of days ago are deleted from SFMC. The run stays in the query's history with its SQL; its results are gone. Settings > Clean up deletes the rest (other browsers, older versions).</p>
          <label v-if="cleanupOn" class="mt-2 flex items-center gap-1.5 text-xs">
            Delete runs older than
            <input v-model.lazy="cleanupInput" type="number" min="1" max="365" step="1" aria-label="Delete runs older than, in days"
              class="h-8 w-20 rounded-md border border-border bg-background px-2 text-xs" />
            days
          </label>
        </div>
        <Switch v-model="cleanupOn" aria-label="Delete old runs from SFMC" />
      </div>
      <div class="flex items-start gap-3">
        <div class="flex-1">
          <div class="text-sm font-medium">Share queries</div>
          <p class="text-xs text-muted-foreground">Shows Share on queries. Sharing sends a query's name and SQL to the Toolkit's share service, where anyone with the link can read it for 24 hours; each share shows what will be sent and asks first. On by default; nothing is sent until you click Share and confirm.</p>
          <p v-if="policy.disableShare" class="text-xs text-amber-700 dark:text-amber-400">{{ POLICY_NOTE }}</p>
        </div>
        <Switch :model-value="shareSetting && !policy.disableShare" :disabled="policy.disableShare" aria-label="Share queries" @update:model-value="shareSetting = $event" />
      </div>
      <div class="flex items-start gap-3">
        <div class="flex-1">
          <div class="text-sm font-medium">Save Query Studio runs</div>
          <p class="text-xs text-muted-foreground">Queries you run in Query Studio and Query Studio 2 are saved in Saved queries, in this browser only. On by default. The extension may read requests to herokuapp.com, where both Query Studios run; only their "run query" requests are read, and only while this switch is on.</p>
        </div>
        <Switch :model-value="qsCapture && !policy.disableHistory" :disabled="policy.disableHistory" aria-label="Save Query Studio runs" @update:model-value="setQsCapture" />
      </div>
      <div class="flex items-start gap-3">
        <div class="flex-1">
          <div class="text-sm font-medium">Add data retention to new data extensions</div>
          <p class="text-xs text-muted-foreground">Off: data extensions created by Run Query keep their rows until you delete them. On: SFMC deletes each row the given number of days after it was added.</p>
          <label v-if="retentionOn" class="mt-2 flex items-center gap-1.5 text-xs">
            Delete rows after
            <input v-model.lazy="retentionInput" type="number" min="1" max="3650" step="1" aria-label="Data retention in days"
              class="h-8 w-20 rounded-md border border-border bg-background px-2 text-xs" />
            days
          </label>
        </div>
        <Switch v-model="retentionOn" aria-label="Add data retention to new data extensions" />
      </div>
      <div>
        <div class="flex items-center gap-2">
          <div class="flex-1">
            <div class="text-sm font-medium">SQL checks</div>
            <p class="text-xs text-muted-foreground">The editor checks queries as you type. Turn off any check you don't want; it is off in every panel and tab. {{ offRules.length }} off.</p>
          </div>
          <button v-if="offRules.length" class="h-7 px-2 rounded-md border border-border text-xs hover:bg-accent" @click="turnAllOn">Turn all on</button>
          <button class="h-7 px-2 rounded-md border border-border text-xs hover:bg-accent" title="Copy the SFMC SQL facts, these checks and the data view join keys as Markdown, for an AI assistant writing your queries" @click="copyRulesForAi">Copy rules for AI</button>
        </div>
        <input v-model="ruleSearch" type="search" placeholder="Find a check (code or words)" aria-label="Find a SQL check"
          class="mt-2 h-8 w-full rounded-md border border-border bg-background px-2 text-xs" />
        <ul class="mt-2 max-h-80 overflow-y-auto divide-y divide-border rounded-md border border-border">
          <li v-for="r in rules" :key="r.code" class="flex items-center gap-2 px-2 py-1.5 text-xs">
            <code class="w-12 shrink-0">{{ r.code }}</code>
            <span class="text-[10px] rounded px-1 shrink-0"
              :class="r.severity === 'error' ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' : r.severity === 'warning' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' : 'bg-muted text-muted-foreground'">{{ r.severity }}</span>
            <span class="flex-1">{{ r.title }}</span>
            <span v-if="ALWAYS_OFF.has(r.code)" class="text-muted-foreground" title="SELECT * works in Run Query, so this check is not used">Always off</span>
            <Switch v-else :model-value="!offRules.includes(r.code)" :aria-label="`${r.code} ${r.title}`" @update:model-value="setRuleDisabled(r.code, !$event)" />
          </li>
          <li v-if="!rules.length" class="px-2 py-3 text-xs text-muted-foreground">No check matches.</li>
        </ul>
      </div>
    </section>

    <section class="rounded-lg border border-border bg-card p-4">
      <h2 class="text-sm font-semibold mb-3">Connection</h2>
      <div class="flex items-start gap-3">
        <div class="flex-1">
          <div class="text-sm font-medium">Start the other app sessions</div>
          <p class="text-xs text-muted-foreground">When the Toolkit opens and at least one SFMC app (such as Automation Studio) already has a session, the apps without one (Data Extensions, Content Builder, CloudPages, Journey Builder) are started in the background, one at a time in a tab that closes itself. At most every 10 minutes. With no app session at all, nothing is opened: log in to SFMC first.</p>
        </div>
        <Switch v-model="autoStartSessions" aria-label="Start the other app sessions" />
      </div>
      <div class="flex items-start gap-3 mt-4">
        <div class="flex-1">
          <div class="text-sm font-medium">Load everything when connected</div>
          <p class="text-xs text-muted-foreground">When the Toolkit opens and finds a Marketing Cloud session, reads automations, activities, journeys, content and data extension details into the Toolkit's caches, as Load everything in the connection menu does. It makes many requests to Marketing Cloud, so it is off unless you switch it on.</p>
        </div>
        <Switch v-model="preloadOnConnect" aria-label="Load everything when connected" />
      </div>
          <div class="flex items-start gap-3 mt-4">
        <div class="flex-1">
          <div class="text-sm font-medium">Desktop notifications for watched automations</div>
          <p class="text-xs text-muted-foreground">Changes to automations you watch always show on the bell and the toolbar icon. Switch this on to also get a desktop notification; Chrome asks for permission the first time.</p>
        </div>
        <Switch :model-value="desktopNotify" aria-label="Desktop notifications for watched automations" @update:model-value="setDesktopNotify" />
      </div>
      <div class="flex items-start gap-3 mt-4">
        <div class="flex-1">
          <div class="text-sm font-medium">Automation Summary tab in Automation Studio</div>
          <p class="text-xs text-muted-foreground">On an automation's page in Automation Studio, a tab on the right edge opens a summary of it (status, last run, schedule, steps) with a link into Marketing Cloud Toolkit.</p>
        </div>
        <Switch v-model="automationPanel" aria-label="Automation Summary tab in Automation Studio" />
      </div>
      <div class="flex items-start gap-3 mt-4">
        <div class="flex-1">
          <div class="text-sm font-medium">Marketing Cloud Toolkit on the Marketing Cloud Dashboard (trial)</div>
          <p class="text-xs text-muted-foreground">Off by default. When on, SFMC's Marketing Cloud Dashboard page shows Marketing Cloud Toolkit's summary in place of SFMC's dashboard: this business unit's automations and journeys by status, what needs a look and what you watch, with links into Marketing Cloud Toolkit. Show SFMC dashboard on that page brings SFMC's back for the visit.</p>
        </div>
        <Switch v-model="dashboardPanel" aria-label="Marketing Cloud Toolkit on the Marketing Cloud Dashboard" />
      </div>
</section>

    <section class="rounded-lg border border-border bg-card p-4">
      <h2 class="text-sm font-semibold mb-3">Marketing Cloud account</h2>
      <div class="flex items-start gap-3">
        <div class="flex-1">
          <div class="text-sm font-medium">Installed packages</div>
          <p class="text-xs text-muted-foreground">Setup > Installed Packages: when each installed package secret expires, this account's API endpoints (REST, SOAP, authentication, SFTP), and which Automation Studio activities you can use. Secrets that expire within a week also show as an alert at the top and on Home.</p>
        </div>
        <RouterLink to="/installed-packages" class="text-xs font-medium text-primary hover:underline whitespace-nowrap">Open Installed Packages</RouterLink>
      </div>
      <div class="flex items-start gap-3 mt-4">
        <div class="flex-1">
          <div class="text-sm font-medium">DNS checks on the Domains page</div>
          <p class="text-xs text-muted-foreground">Off by default. Reads the public SPF, DKIM, DMARC, name server, MX and CNAME records of your sender and custom domains through Cloudflare's DNS resolver (cloudflare-dns.com). Only domain names are sent; nothing from Marketing Cloud.</p>
          <p v-if="policy.disableDnsLookup" class="text-xs text-muted-foreground mt-1">{{ POLICY_NOTE }}</p>
        </div>
        <Switch :model-value="dnsLookup && !policy.disableDnsLookup" :disabled="policy.disableDnsLookup" aria-label="DNS checks on the Domains page" @update:model-value="dnsLookup = $event" />
      </div>
    </section>

    <section class="rounded-lg border border-border bg-card p-4">
      <h2 class="text-sm font-semibold mb-3">Experimental</h2>
      <div class="flex items-start gap-3">
        <div class="flex-1">
          <div class="text-sm font-medium">AI (Gemini Nano in Chrome)</div>
          <p class="text-xs text-muted-foreground">On by default. Ask AI, Fix with AI, Explain, Summarize and Suggest types in Run Query, Home, Query Builder, Saved queries, query activities, automations, journeys, Where used and Create DE. The model is built into Chrome and runs on this computer: nothing is sent over the network. Prompts hold names, settings and SQL, never data rows; email addresses, phone numbers and record IDs are replaced first. Answers can be wrong.</p>
          <p class="text-xs text-muted-foreground mt-1">{{ aiStatus }}</p>
          <p v-if="policy.disableAiAssist" class="text-xs text-muted-foreground mt-1">{{ POLICY_NOTE }}</p>
        </div>
        <Switch :model-value="aiEnabled && !policy.disableAiAssist" :disabled="policy.disableAiAssist" aria-label="AI (Gemini Nano in Chrome)" @update:model-value="aiEnabled = $event" />
      </div>
    </section>

    <section class="rounded-lg border border-border bg-card p-4">
      <h2 class="text-sm font-semibold mb-3">Troubleshooting</h2>
      <div class="flex items-start gap-3">
        <div class="flex-1">
          <div class="text-sm font-medium">API console</div>
          <p class="text-xs text-muted-foreground">Shows every SFMC API call and its response in a panel at the bottom of the app. Useful when something fails.</p>
        </div>
        <Switch :model-value="apiConsoleOn" aria-label="API console" @update:model-value="setApiConsole" />
      </div>
    </section>

    <section class="rounded-lg border border-border bg-card p-4">
      <h2 class="text-sm font-semibold">Backup</h2>
      <p class="text-xs text-muted-foreground mt-1">
        One file with your saved queries (with run history), email versions, workspaces and settings.
        Import a backup from SFMC Query Saver or Marketing Cloud Toolkit. Nothing already here is overwritten.
      </p>
      <div class="flex gap-2 mt-3">
        <button class="h-8 px-3 rounded-md border border-border text-xs hover:bg-accent" @click="exportBackup">Export backup</button>
        <button class="h-8 px-3 rounded-md border border-border text-xs hover:bg-accent" @click="backupInput?.click()">Import backup</button>
        <input ref="backupInput" type="file" accept=".json,application/json" class="hidden" @change="importBackup" />
      </div>
      <p v-if="importResult" class="mt-2 text-xs text-emerald-700 dark:text-emerald-400" role="status">{{ importResult }}</p>
      <p v-if="importError" class="mt-2 text-xs text-red-600" role="alert">{{ importError }}<ReportErrorButton /></p>
    </section>

    <section class="rounded-lg border border-border bg-card p-4">
      <h2 class="text-sm font-semibold mb-3">Clean up</h2>
      <div class="flex items-start gap-3">
        <p class="flex-1 text-xs text-muted-foreground">The query activities and results data extensions Run Query left in Marketing Cloud (formerly Delete Toolkit runs in the sidebar). You pick what to delete.</p>
        <RouterLink to="/queries/cleanup" class="inline-flex items-center h-8 px-3 rounded-full border border-border text-xs font-medium hover:bg-accent">Open Clean up</RouterLink>
      </div>
    </section>

    <section class="rounded-lg border border-border bg-card p-4">
      <h2 class="text-sm font-semibold mb-3">Storage</h2>
      <StorageUsage />
      <!-- Feedback #1069: what the Toolkit keeps so it asks SFMC less. -->
      <div class="mt-4 pt-3 border-t border-border flex flex-wrap items-center gap-3 text-xs" data-stored-sfmc>
        <p class="flex-1 min-w-[16rem] text-muted-foreground">Folders, lists and automation details read from SFMC are kept in this browser for {{ CACHE_DAYS }} days, so pages open without asking SFMC again. Refresh on a page reads it again; this forgets all of it.</p>
        <Button variant="outline" size="sm" data-forget-stored @click="forgetStored">Forget stored SFMC data</Button>
      </div>
    </section>

    <section class="rounded-lg border border-border bg-card p-4 text-sm">
      <h2 class="font-semibold mb-2">About</h2>
      <p class="text-muted-foreground">Marketing Cloud Toolkit {{ version }}. It combines SFMC Query Saver and SFMC Automation Viewer.</p>
      <p class="text-muted-foreground mt-1"><CreatorCredit /></p>
      <div class="flex gap-2 mt-3">
        <RouterLink to="/features" class="h-8 px-3 inline-flex items-center rounded-md border border-border text-xs hover:bg-accent">Features</RouterLink>
        <a href="privacy.html" target="_blank" rel="noopener" class="h-8 px-3 inline-flex items-center rounded-md border border-border text-xs hover:bg-accent">Privacy policy</a>
        <button v-if="!policy.disableFeedback" class="h-8 px-3 rounded-md border border-border text-xs hover:bg-accent" @click="showFeedback = true">Send feedback</button>
        <a :href="STORE_REVIEWS_URL" target="_blank" rel="noopener" class="h-8 px-3 inline-flex items-center rounded-md border border-border text-xs hover:bg-accent">Write a review</a>
      </div>
    </section>

    <FeedbackModal v-if="showFeedback && !policy.disableFeedback" screen="settings" @close="showFeedback = false" />
  </div>
</template>
