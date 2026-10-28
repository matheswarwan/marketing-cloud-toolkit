<script setup>
import { computed, onUnmounted, ref } from 'vue'
import Switch from '@/components/ui/switch/Switch.vue'
import StorageUsage from '@/components/StorageUsage.vue'
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
import { DEFAULT_RETENTION_DAYS, SUGGESTED_RETENTION_DAYS, parseRetentionDays } from '@/utils/sfmcApi.js'
import { policy, POLICY_NOTE } from '@/utils/policy.js'
import { HISTORY_SETTING } from '@/utils/history.js'
import { SHARE_SETTING } from '@/utils/share.js'
import { QUERY_STUDIO_SETTING, QUERY_STUDIO_PERMISSION } from '@/utils/queryStudio.js'
import { NOTIFY_KEY } from '@/utils/watches.js'
import { ACTIVITY_SAVER_SETTING, ACTIVITY_MAX_SETTING, DEFAULT_MAX_VERSIONS } from '@/utils/activityVersions.js'

const { currentTheme, themes, setTheme } = useTheme()

// Same keys as SFMC Query Saver, read by the service worker and the run flow.
const { value: emailSaver } = useStoredSetting('_emailSaverEnabled', false, (v) => v === true)
// Query and Script activity versions (feedback #122; background/activityCapture.js).
const { value: activitySaver } = useStoredSetting(ACTIVITY_SAVER_SETTING, false, (v) => v === true)
const { value: activityMax } = useStoredSetting(ACTIVITY_MAX_SETTING, DEFAULT_MAX_VERSIONS,
  (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : DEFAULT_MAX_VERSIONS))
function setActivityMax(e) {
  const n = Math.round(Number(e.target.value))
  activityMax.value = Number.isFinite(n) ? Math.min(500, Math.max(1, n)) : DEFAULT_MAX_VERSIONS
}
const { value: emailDebounce } = useStoredSetting('_emailSaveDebounce', 5,
  (v) => (typeof v === 'number' && v >= 0 ? v : 5))
const { value: reuseQueryDE } = useStoredSetting('_reuseQueryDE', false, (v) => v === true)
const { value: autoStartSessions } = useStoredSetting('_autoStartSessions', true, (v) => v !== false)
const { value: automationPanel } = useStoredSetting('_automationPanel', true, (v) => v !== false)
const { value: dashboardPanel } = useStoredSetting('_dashboardPanel', false, (v) => v === true)
const { value: retentionDays } = useStoredSetting('_queryDERetentionDays', DEFAULT_RETENTION_DAYS, parseRetentionDays)

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
const { value: shareSetting } = useStoredSetting(SHARE_SETTING, false, (v) => v === true)

// Saving Query Studio runs: off by default (security review); on asks Chrome for the
// optional *.herokuapp.com permission, off gives it back (utils/queryStudio.js).
const qsCapture = ref(false)
chrome.storage?.local.get(QUERY_STUDIO_SETTING, (r) => {
  chrome.permissions?.contains(QUERY_STUDIO_PERMISSION, (has) => { qsCapture.value = !!has && r?.[QUERY_STUDIO_SETTING] === true })
})
function setQsCapture(on) {
  const done = (ok) => {
    void chrome.runtime.lastError
    qsCapture.value = !!on && !!ok
    chrome.storage.local.set({ [QUERY_STUDIO_SETTING]: qsCapture.value })
    if (on && !ok) showToast('Query Studio runs are not saved: Chrome did not get the permission.')
  }
  if (on) chrome.permissions.request(QUERY_STUDIO_PERMISSION, done)
  else chrome.permissions.remove(QUERY_STUDIO_PERMISSION, () => done(false))
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
      <h2 class="text-sm font-semibold">Emails</h2>
      <div class="flex items-start gap-3">
        <div class="flex-1">
          <div class="text-sm font-medium">Save email versions</div>
          <p class="text-xs text-muted-foreground">Each time you save an email in Content Builder, a copy is kept in this browser so you can compare or revert it (the 10 newest versions per email). Off by default.</p>
        </div>
        <Switch :model-value="emailSaver && !policy.disableHistory" :disabled="policy.disableHistory" aria-label="Save email versions" @update:model-value="emailSaver = $event" />
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
          <p class="text-xs text-muted-foreground">Each time you save a SQL Query or Script activity in Automation Studio, the version from before your edit and the saved one are kept in this browser (Automation > Saved Activities). Off by default.</p>
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
          <p class="text-xs text-muted-foreground">Each saved query keeps the SQL of its runs, in this browser only. When off, a run keeps only the names of the data extension and Query Activity it created in SFMC (so Delete Toolkit runs can remove them), not its SQL. Query results are never stored in the browser.</p>
        </div>
        <Switch :model-value="keepHistory && !policy.disableHistory" :disabled="policy.disableHistory" aria-label="Keep query history" @update:model-value="keepHistory = $event" />
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
          <div class="text-sm font-medium">Share queries</div>
          <p class="text-xs text-muted-foreground">Shows Share on queries. Sharing sends a query's name and SQL to the Toolkit's share service, where anyone with the link can read it for 24 hours; each share shows what will be sent and asks first. Off by default.</p>
          <p v-if="policy.disableShare" class="text-xs text-amber-700 dark:text-amber-400">{{ POLICY_NOTE }}</p>
        </div>
        <Switch :model-value="shareSetting && !policy.disableShare" :disabled="policy.disableShare" aria-label="Share queries" @update:model-value="shareSetting = $event" />
      </div>
      <div class="flex items-start gap-3">
        <div class="flex-1">
          <div class="text-sm font-medium">Save Query Studio runs</div>
          <p class="text-xs text-muted-foreground">Queries you run in Query Studio and Query Studio 2 are saved in Saved queries, in this browser only. Off by default. Turning it on asks Chrome to let the extension read requests to herokuapp.com, where both Query Studios run; only their "run query" requests are read.</p>
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
      <p v-if="importError" class="mt-2 text-xs text-red-600" role="alert">{{ importError }}</p>
    </section>

    <section class="rounded-lg border border-border bg-card p-4">
      <h2 class="text-sm font-semibold mb-3">Storage</h2>
      <StorageUsage />
    </section>

    <section class="rounded-lg border border-border bg-card p-4 text-sm">
      <h2 class="font-semibold mb-2">About</h2>
      <p class="text-muted-foreground">Marketing Cloud Toolkit {{ version }}. It combines SFMC Query Saver and SFMC Automation Viewer.</p>
      <p class="text-muted-foreground mt-1"><CreatorCredit /></p>
      <div class="flex gap-2 mt-3">
        <RouterLink to="/features" class="h-8 px-3 inline-flex items-center rounded-md border border-border text-xs hover:bg-accent">Features</RouterLink>
        <a href="privacy.html" target="_blank" rel="noopener" class="h-8 px-3 inline-flex items-center rounded-md border border-border text-xs hover:bg-accent">Privacy policy</a>
        <button v-if="!policy.disableFeedback" class="h-8 px-3 rounded-md border border-border text-xs hover:bg-accent" @click="showFeedback = true">Send feedback</button>
      </div>
    </section>

    <FeedbackModal v-if="showFeedback && !policy.disableFeedback" screen="settings" @close="showFeedback = false" />
  </div>
</template>
