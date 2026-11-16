<script setup>
// Content > Emails (feedback #1054): Content Builder folders on the left, emails in the
// open folder or matching a search in the middle, the picked email on the right with
// Preview, Text and Code, and Preview with data: pick a data extension and a row, then
// SFMC renders the email for that row (guide/v1 preview), or the Toolkit fills in the
// %%Field%% strings itself. Read only: nothing in SFMC changes.
// User, 2026-11-16 (ideas from VeLens): Checks (unsubscribe link, postal address, preheader,
// text version, images, links, width, size; utils/emailChecks.js) and preview modes
// Dark, Images off and Mobile (utils/emailPreviewModes.js).
import { computed, reactive, ref, watch } from 'vue'
import { Search, Loader2, Mail, RefreshCw, Database, CircleCheck, CircleAlert, CircleX, Info as InfoIcon } from 'lucide-vue-next'
import { checkEmail } from '@/utils/emailChecks.js'
import { PREVIEW_MODES, MOBILE_FRAME_WIDTH, previewHtml } from '@/utils/emailPreviewModes.js'
import Button from '@/components/ui/button/Button.vue'
import Input from '@/components/ui/input/Input.vue'
import SfmcErrorNotice from '@/components/results/SfmcErrorNotice.vue'
import CodeView from '@/components/results/CodeView.vue'
import ReportErrorButton from '@/components/results/ReportErrorButton.vue'
import DEPickerDialog from '@/components/data/DEPickerDialog.vue'
import ContentFolderTree from '@/components/content/ContentFolderTree.vue'
import ContentTabs from '@/components/content/ContentTabs.vue'
import { cachedList, storedList, saveList } from '@/utils/listCache.js'
import { fetchDEFieldList } from '@/utils/deApi.js'
import { PanelLeftClose, PanelLeftOpen, Plus, X as XIcon, ChevronDown as ChevronDownIcon, ChevronRight as ChevronRightIcon } from 'lucide-vue-next'
import { savedAgo } from '@/utils/localCache.js'
import { useStack, whenStack } from '@/composables/useStack.js'
import { useRouteSearch } from '@/composables/useRouteSearch.js'
import { withReconnect, searchError } from '@/utils/sfmcErrors.js'
import { formatDateTime, plural } from '@/utils/format.js'
import {
  clearEmailCaches, emailChanges, searchEmails, emailMatches, fetchEmailAsset, emailParts,
  fillEmail, emailAttributes, previewWithData, EMAIL_PAGE_SIZE,
} from '@/utils/contentEmails.js'

const { stack } = useStack()

// ── Folders ──────────────────────────────────────────────
const currentFolder = ref(null) // { id, name }
const tree = ref(null)
watch(currentFolder, () => runSearch('open'))

// ── Emails ───────────────────────────────────────────────
const text = ref('')
const emails = ref([])
const total = ref(0)
const pageNo = ref(1)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref(null)
const searchedFor = ref(null) // what the list shows: { text, folder }
const searchAll = ref(false) // search every folder, not only the open one

// Feedback #1069: a search is stored for 30 days. Opening a folder (or the page) shows
// the stored list without a call; Search asks SFMC only for emails changed since;
// Refresh reads it all again.
const listInfo = ref(null) // { savedAt, mode, changed }
const searchParams = () => {
  const folderId = searchAll.value && text.value.trim() ? null : currentFolder.value?.id ?? null
  return { text: text.value.trim(), folderId }
}
async function runSearch(mode = 'search') {
  if (!stack.value) { error.value = 'Not connected to Marketing Cloud. Log in to SFMC in this browser.'; return }
  const params = searchParams()
  loading.value = true
  error.value = null
  try {
    let r = mode === 'open' ? await storedList(stack.value, 'emails', params) : null
    if (r) r = { ...r, mode: 'stored' }
    else {
      r = await withReconnect(stack.value, () => cachedList({
        stack: stack.value, kind: 'emails', params, force: mode === 'refresh',
        full: () => searchEmails(stack.value, { ...params, page: 1 }),
        changes: (since) => emailChanges(stack.value, params, since),
        sortBy: (x, y) => String(y.modifiedDate || '').localeCompare(String(x.modifiedDate || '')),
      }))
    }
    // Lists stored before the matches were checked (live test, 2026-11-08) are checked here too.
    const items = params.text ? r.items.filter((e) => emailMatches(e, params.text)) : r.items
    emails.value = items
    total.value = params.text ? items.length : r.total
    pageNo.value = Math.max(1, Math.ceil(r.items.length / EMAIL_PAGE_SIZE))
    listInfo.value = { savedAt: r.savedAt, mode: r.mode, changed: r.changed }
    searchedFor.value = { text: params.text, folder: params.folderId ? currentFolder.value?.name : null }
  } catch (e) {
    error.value = searchError(e, 'search emails')
  } finally { loading.value = false }
}
async function loadMore() {
  const params = searchParams()
  loadingMore.value = true
  try {
    const r = await searchEmails(stack.value, { ...params, page: pageNo.value + 1 })
    const have = new Set(emails.value.map((e) => e.id))
    emails.value = [...emails.value, ...r.items.filter((e) => !have.has(e.id))]
    pageNo.value += 1
    saveList(stack.value, 'emails', params, emails.value, total.value)
  } catch (e) { error.value = searchError(e, 'load more emails') }
  finally { loadingMore.value = false }
}
function refresh() {
  clearEmailCaches()
  tree.value?.reload(true)
  runSearch('refresh')
}

// ── The picked email ─────────────────────────────────────
const picked = ref(null) // row
const asset = ref(null)
const parts = ref(null)
const assetLoading = ref(false)
const assetError = ref('')
const view = ref('preview') // preview | text | code | checks
const MODE_KEY = 'toolkit_email_preview_mode'
const previewMode = ref((() => { try { const m = localStorage.getItem(MODE_KEY); return PREVIEW_MODES.some((x) => x.id === m) ? m : 'normal' } catch { return 'normal' } })())
watch(previewMode, (m) => { try { localStorage.setItem(MODE_KEY, m) } catch { /* no storage */ } })

async function pick(row) {
  picked.value = row
  asset.value = null
  parts.value = null
  assetError.value = ''
  dataPreview.value = null
  dataError.value = ''
  assetLoading.value = true
  try {
    const a = await withReconnect(stack.value, () => fetchEmailAsset(stack.value, row.id))
    if (picked.value?.id !== row.id) return
    asset.value = a
    parts.value = emailParts(a)
    // The data stays picked from one email to the next.
    if (dataOpen.value) { if (dataMode.value === 'values') previewTyped(); else if (de.value) previewRow() }
  } catch (e) {
    assetError.value = `Could not read the email: ${e.message}`
  } finally { assetLoading.value = false }
}

// ── Preview with data ────────────────────────────────────
// From a data extension row (picked in a dialog, #1055; previews straight away, #1056)
// or from values typed in (#1058). Subject and preheader change too (#1057).
const dataOpen = ref(false)
// Feedback #1061: while previewing with data, the folders and the email list fold away
// to give the preview the room; Show emails brings them back.
// Feedback #1070: the folders and list fold into a rail, like the main sidebar; the
// choice is remembered, and opening Preview with data still folds them (#1061).
const PANEL_KEY = 'toolkit_emails_panel_collapsed'
const panelCollapsed = ref((() => { try { return localStorage.getItem(PANEL_KEY) === '1' } catch { return false } })())
watch(panelCollapsed, (v) => { try { localStorage.setItem(PANEL_KEY, v ? '1' : '0') } catch { /* no storage */ } })
watch(dataOpen, (o) => { if (o) panelCollapsed.value = true })
const focus = computed(() => panelCollapsed.value)
const dataMode = ref('de') // de | values
const pickerOpen = ref(false)
const de = ref(null) // { id, name, key }
const deFields = ref([])
const rows = ref([])
const rowIndex = ref(0)
const keyField = ref('')
const dataPreview = ref(null) // { html, subject, preheader, how: 'sfmc' | 'local', filledHere: [], filled, missing, shape }
const dataBusy = ref(false)
const dataError = ref('')
const showShape = ref(false)

const KEY_NAME_RE = /^(subscriber_?key|contact_?key|subscriberid)$/i
const EMAIL_NAME_RE = /e-?mail/i
function onPicked({ de: d, fields, rows: r, index }) {
  pickerOpen.value = false
  de.value = d
  deFields.value = fields || []
  rows.value = r || []
  rowIndex.value = index ?? 0
  const names = deFields.value.map((f) => f.name)
  keyField.value = names.find((n) => KEY_NAME_RE.test(n)) || deFields.value.find((f) => f.isPrimaryKey)?.name
    || names.find((n) => EMAIL_NAME_RE.test(n)) || names[0] || ''
  previewRow()
}
const row = computed(() => rows.value[rowIndex.value] || null)
const rowLabel = (r, i) => {
  const v = keyField.value ? r[keyField.value] : Object.values(r)[0]
  return `${i + 1}. ${v ?? ''}`
}
watch([rowIndex, keyField], () => { if (de.value && dataMode.value === 'de') previewRow() })

let previewSeq = 0
async function previewRow() {
  if (!picked.value || !de.value || !row.value || !parts.value) return
  const seq = ++previewSeq
  dataBusy.value = true
  dataError.value = ''
  const local = fillEmail(parts.value, row.value)
  try {
    const r = await previewWithData(stack.value, {
      legacyId: picked.value.legacyId, deId: de.value.id, deKey: de.value.key,
      subscriberKey: keyField.value ? row.value[keyField.value] : null, rowNumber: rowIndex.value + 1,
    })
    if (seq !== previewSeq) return
    // What SFMC did not send is filled in here from the row (feedback #1057).
    const filledHere = [r.subject == null && parts.value.subject ? 'subject line' : null, r.preheader == null && parts.value.preheader ? 'preheader' : null].filter(Boolean)
    dataPreview.value = { html: r.html, subject: r.subject ?? local.subject, preheader: r.preheader ?? local.preheader, how: 'sfmc', filledHere, shape: { first: r.shape, more: r.extraShapes } }
  } catch (e) {
    if (seq !== previewSeq) return
    dataPreview.value = { ...local, how: 'local' }
    dataError.value = `SFMC did not render the preview (${e.message}). Showing the email with this row's values filled in here: %%Field%% strings and simple AttributeValue output only.`
  } finally { if (seq === previewSeq) dataBusy.value = false }
  view.value = 'preview'
}

// Type values (feedback #1058): the attributes the email uses, found in its HTML,
// subject line, preheader and text.
// Feedback #1070: the list comes from the email (found) or from a data extension's
// fields, plus attributes you add; each row has a value.
const attrSource = ref('email') // email | de
const schemaDE = ref(null) // { de, fields: [names] }
const schemaPicker = ref(false)
const schemaError = ref('')
const added = ref([]) // names you added
const newAttr = ref('')
const attrsOpen = ref(true)
const found = computed(() => (parts.value ? emailAttributes(parts.value.subject, parts.value.preheader, parts.value.html, parts.value.text) : []))
const attrRows = computed(() => {
  const base = attrSource.value === 'de' ? (schemaDE.value?.fields || []).map((n) => ({ name: n, from: schemaDE.value.de.name })) : found.value.map((n) => ({ name: n, from: 'Found in the email' }))
  const seen = new Set(base.map((r) => r.name.toLowerCase()))
  return [...base, ...added.value.filter((n) => !seen.has(n.toLowerCase())).map((n) => ({ name: n, from: 'Added', added: true }))]
})
const attributes = computed(() => attrRows.value.map((r) => r.name))
const typed = reactive({})
function addAttr() {
  const n = newAttr.value.trim()
  if (!n || attributes.value.some((a) => a.toLowerCase() === n.toLowerCase())) { newAttr.value = ''; return }
  added.value = [...added.value, n]
  newAttr.value = ''
}
function removeAttr(n) { added.value = added.value.filter((x) => x !== n); delete typed[n] }
async function onSchemaPicked({ de: d }) {
  schemaPicker.value = false
  schemaError.value = ''
  try {
    const fields = await fetchDEFieldList(stack.value, d.id)
    schemaDE.value = { de: d, fields: fields.map((f) => f.name) }
    attrSource.value = 'de'
  } catch (e) { schemaError.value = `Could not read the fields of ${d.name}: ${e.message}` }
}
function useSource(src) {
  if (src === 'de' && !schemaDE.value) { schemaPicker.value = true; return }
  attrSource.value = src
}
function previewTyped() {
  if (!parts.value) return
  dataPreview.value = { ...fillEmail(parts.value, typed), how: 'typed' }
  view.value = 'preview'
}
let typedTimer = null
watch(typed, () => { clearTimeout(typedTimer); typedTimer = setTimeout(() => { if (dataMode.value === 'values') previewTyped() }, 250) })
watch(dataMode, (m) => {
  dataError.value = ''
  if (m === 'values') previewTyped()
  else if (de.value) previewRow()
  else dataPreview.value = null
})
function clearData() { dataPreview.value = null; dataOpen.value = false }

const shownHtml = computed(() => dataPreview.value?.html ?? parts.value?.html ?? '')
const frameHtml = computed(() => previewHtml(shownHtml.value, previewMode.value))
const modeNote = computed(() => PREVIEW_MODES.find((m) => m.id === previewMode.value)?.note || '')
// Checks run on what is shown: with data, the filled-in email.
const checks = computed(() => (parts.value ? checkEmail({ html: shownHtml.value, text: parts.value.text, subject: shownSubject.value, preheader: shownPreheader.value }, { textGenerated: !!asset.value?.views?.text?.generateFrom }) : null))
const CHECK_ICON = { fail: CircleX, warn: CircleAlert, info: InfoIcon, pass: CircleCheck }
const CHECK_TONE = { fail: 'text-red-600 dark:text-red-400', warn: 'text-amber-600 dark:text-amber-400', info: 'text-sky-600 dark:text-sky-400', pass: 'text-emerald-600 dark:text-emerald-400' }
const shownSubject = computed(() => dataPreview.value?.subject ?? parts.value?.subject ?? '')
const shownPreheader = computed(() => dataPreview.value?.preheader ?? parts.value?.preheader ?? '')

whenStack(() => runSearch('open'))
// Opened with ?q= (Content > Changes, feedback #1087): search every folder for it.
useRouteSearch('/emails', (q) => { text.value = q; searchAll.value = true; whenStack(() => runSearch('search')) })
</script>

<template>
  <div class="h-full flex flex-col bg-background text-sm" data-email-browser>
    <div class="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-border">
      <h1 class="text-lg font-semibold mr-2">Emails</h1>
      <ContentTabs section="emails" />
      <form class="flex items-center gap-2 flex-1 min-w-[16rem]" @submit.prevent="runSearch('search')">
        <div class="relative flex-1">
          <Search class="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input v-model="text" class="pl-9 rounded-full" placeholder="Name, subject line or customer key" aria-label="Search emails" data-email-search />
        </div>
        <label v-if="currentFolder" class="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap">
          <input v-model="searchAll" type="checkbox" /> All folders
        </label>
        <Button type="submit" :disabled="loading"><Loader2 v-if="loading" class="h-4 w-4 animate-spin" /><Search v-else class="h-4 w-4" /> Search</Button>
      </form>
      <Button variant="outline" title="Read folders and emails again" @click="refresh"><RefreshCw class="h-4 w-4" /> Refresh</Button>
      <RouterLink to="/recycle-bin?tab=content&type=emails" class="text-xs text-muted-foreground hover:text-foreground hover:underline whitespace-nowrap" title="Deleted emails and content (read only)" data-recycle-bin-link>Recycle bin</RouterLink>
    </div>

    <div class="flex-1 min-h-0 grid max-[900px]:grid-cols-1 max-[900px]:overflow-y-auto" :class="focus ? '[grid-template-columns:44px_1fr]' : '[grid-template-columns:minmax(200px,260px)_minmax(260px,360px)_1fr]'">
      <!-- Folded panel: a rail with the button that opens it again (feedback #1070). -->
      <div v-if="focus" class="border-r border-border flex flex-col items-center gap-2 py-2 bg-card" data-email-rail>
        <button type="button" class="p-1.5 rounded-md text-muted-foreground hover:bg-accent" title="Show folders and emails" aria-label="Show folders and emails" data-panel-open @click="panelCollapsed = false"><PanelLeftOpen class="h-4 w-4" /></button>
        <Mail class="h-4 w-4 text-muted-foreground" />
      </div>
      <!-- Folders -->
      <ContentFolderTree v-show="!focus" ref="tree" v-model="currentFolder" :stack="stack" all-label="All emails" :all-icon="Mail" class="border-r border-border" />

      <!-- Emails -->
      <section v-show="!focus" class="border-r border-border overflow-y-auto" aria-label="Emails" data-email-list>
        <div class="px-3 py-2 text-xs text-muted-foreground border-b border-border relative pr-9">
          <button type="button" class="absolute right-1.5 top-1.5 p-1 rounded-md hover:bg-accent" title="Fold the folders and emails" aria-label="Fold the folders and emails" data-panel-close @click="panelCollapsed = true"><PanelLeftClose class="h-4 w-4" /></button>
          <template v-if="searchedFor">
            {{ plural(total, 'email') }}<template v-if="searchedFor.folder"> in {{ searchedFor.folder }}</template><template v-if="searchedFor.text"> matching "{{ searchedFor.text }}"</template>
            <span v-if="listInfo?.mode === 'stored'" class="block" data-list-note>Stored {{ savedAgo(listInfo.savedAt) }}. Search reads only the changes; Refresh reads all.</span>
            <span v-else-if="listInfo?.mode === 'delta'" class="block" data-list-note>Stored list, {{ listInfo.changed ? `${plural(listInfo.changed, 'change')} read from SFMC` : 'no changes in SFMC since the last read' }}.</span>
          </template>
          <template v-else-if="loading">Searching</template>
        </div>
        <SfmcErrorNotice v-if="error" :error="error" :retrying="loading" class="m-3" @retry="runSearch('search')" />
        <button v-for="e in emails" :key="e.id" type="button" class="w-full text-left px-3 py-2 border-b border-border" :class="picked?.id === e.id ? 'bg-primary/10' : 'hover:bg-accent'" :data-email-row="e.id" @click="pick(e)">
          <div class="font-medium truncate">{{ e.name }}</div>
          <div class="text-xs text-muted-foreground truncate">{{ e.subject || 'No subject line' }}</div>
          <div class="text-[11px] text-muted-foreground truncate">{{ e.folderName }} · {{ e.type }} · {{ formatDateTime(e.modifiedDate) }}</div>
        </button>
        <div v-if="searchedFor && !emails.length && !loading && !error" class="p-4 text-muted-foreground">No emails here.</div>
        <div v-if="emails.length < total" class="p-3">
          <Button variant="outline" class="w-full" :disabled="loadingMore" @click="loadMore"><Loader2 v-if="loadingMore" class="h-4 w-4 animate-spin" /> Load {{ EMAIL_PAGE_SIZE }} more</Button>
        </div>
      </section>

      <!-- The email -->
      <section class="min-w-0 flex flex-col overflow-y-auto" aria-label="Email preview" data-email-detail>
        <div v-if="!picked" class="m-auto text-muted-foreground p-6 text-center">Pick an email to see it.</div>
        <template v-else>
          <div class="px-4 py-3 border-b border-border space-y-1">
            <div class="flex items-start gap-2">
              <div class="font-semibold text-base flex-1">{{ picked.name }}</div>
            </div>
            <div class="text-xs text-muted-foreground">Subject: <span class="text-foreground" data-email-subject>{{ shownSubject || 'none' }}</span></div>
            <div v-if="shownPreheader" class="text-xs text-muted-foreground">Preheader: <span class="text-foreground" data-email-preheader>{{ shownPreheader }}</span></div>
            <div class="text-[11px] text-muted-foreground">{{ picked.type }} · key {{ picked.customerKey }} · ID {{ picked.id }}<template v-if="picked.legacyId"> · email ID {{ picked.legacyId }}</template></div>
            <div class="flex flex-wrap items-center gap-1.5 pt-1">
              <button v-for="v in [['preview', 'Preview'], ['text', 'Text'], ['code', 'Code']]" :key="v[0]" type="button"
                class="h-7 px-3 rounded-full border text-xs" :class="view === v[0] ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-accent'" @click="view = v[0]">{{ v[1] }}</button>
              <button type="button" class="h-7 px-3 rounded-full border text-xs inline-flex items-center gap-1" :class="view === 'checks' ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-accent'" data-email-checks-tab @click="view = 'checks'">
                Checks<span v-if="checks && (checks.counts.fail || checks.counts.warn)" class="rounded-full px-1.5 text-[10px] font-semibold" :class="checks.counts.fail ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'">{{ checks.counts.fail + checks.counts.warn }}</span>
              </button>
              <button type="button" class="h-7 px-3 rounded-full border text-xs inline-flex items-center gap-1" :class="dataOpen ? 'bg-primary/10 border-primary text-primary' : 'border-border hover:bg-accent'" data-preview-data-toggle @click="dataOpen = !dataOpen">
                <Database class="h-3.5 w-3.5" /> Preview with data
              </button>
            </div>
          </div>

          <div v-if="dataOpen" class="px-4 py-3 border-b border-border bg-primary/5 space-y-2" data-preview-data>
            <div class="flex flex-wrap items-center gap-1.5">
              <button v-for="m in [['de', 'From a data extension'], ['values', 'Type values']]" :key="m[0]" type="button" class="h-7 px-3 rounded-full border text-xs"
                :class="dataMode === m[0] ? 'bg-primary text-primary-foreground border-primary' : 'border-border bg-card hover:bg-accent'" :data-data-mode="m[0]" @click="dataMode = m[0]">{{ m[1] }}</button>
              <Button v-if="dataPreview" size="sm" variant="ghost" class="ml-auto" @click="clearData">Show without data</Button>
            </div>

            <template v-if="dataMode === 'de'">
              <div class="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" data-choose-de @click="pickerOpen = true"><Database class="h-3.5 w-3.5" /> {{ de ? 'Change' : 'Choose data extension and row' }}</Button>
                <template v-if="de">
                  <span class="text-xs font-semibold">{{ de.name }}</span>
                  <label class="text-xs">Row
                    <select v-model.number="rowIndex" class="h-8 ml-1 rounded-full border border-border bg-card px-2 text-xs max-w-[16rem]" aria-label="Row for the preview">
                      <option v-for="(r, i) in rows" :key="i" :value="i">{{ rowLabel(r, i) }}</option>
                    </select>
                  </label>
                  <label class="text-xs">Subscriber key field
                    <select v-model="keyField" class="h-8 ml-1 rounded-full border border-border bg-card px-2 text-xs" aria-label="Subscriber key field">
                      <option v-for="f in deFields" :key="f.name" :value="f.name">{{ f.name }}</option>
                    </select>
                  </label>
                  <Button size="sm" :disabled="dataBusy || !parts" data-preview-sfmc @click="previewRow"><Loader2 v-if="dataBusy" class="h-3.5 w-3.5 animate-spin" /><RefreshCw v-else class="h-3.5 w-3.5" /> Preview</Button>
                </template>
              </div>
              <div v-if="dataPreview && (dataPreview.how === 'sfmc' || dataPreview.how === 'local')" class="text-xs" data-preview-how>
                <template v-if="dataPreview.how === 'sfmc'">SFMC's preview for row {{ rowIndex + 1 }}<template v-if="dataPreview.filledHere.length">; SFMC sent no {{ dataPreview.filledHere.join(' or ') }}, so it is filled in here from the row</template>.
                  <button type="button" class="underline text-muted-foreground" @click="showShape = !showShape">{{ showShape ? 'Hide' : 'What SFMC sent' }}</button>
                </template>
                <template v-else>Filled in here: {{ dataPreview.filled.length ? dataPreview.filled.join(', ') : 'no attributes matched' }}.<template v-if="dataPreview.missing.length"> No value for: {{ dataPreview.missing.join(', ') }}.</template></template>
              </div>
              <div v-if="showShape && dataPreview?.shape" class="space-y-1">
                <p class="text-[11px] text-muted-foreground">The structure of SFMC's answers, without their values. Report sends it so the Toolkit can read the subject line and preheader from it.</p>
                <pre class="text-[11px] max-h-40 overflow-auto rounded border border-border bg-card p-2">{{ JSON.stringify(dataPreview.shape, null, 2) }}</pre>
                <ReportErrorButton :error="`Email preview: SFMC's answer had no subject line or preheader the Toolkit could read. Answer structure (no values): ${JSON.stringify(dataPreview.shape)}`" />
              </div>
            </template>

            <template v-else>
              <div class="flex flex-wrap items-center gap-2 text-xs">
                <span class="text-muted-foreground">Attributes from</span>
                <button v-for="m in [['email', 'Found in this email'], ['de', schemaDE ? `Fields of ${schemaDE.de.name}` : 'A data extension\'s fields']]" :key="m[0]" type="button" class="h-7 px-3 rounded-full border"
                  :class="attrSource === m[0] ? 'bg-primary/10 border-primary text-primary' : 'border-border bg-card hover:bg-accent'" :data-attr-source="m[0]" @click="useSource(m[0])">{{ m[1] }}</button>
                <button v-if="schemaDE" type="button" class="underline text-muted-foreground hover:text-foreground" @click="schemaPicker = true">Other data extension</button>
              </div>
              <p v-if="schemaError" class="text-xs text-red-700 dark:text-red-300">{{ schemaError }}</p>
              <section class="rounded-lg border border-border bg-card" data-typed-values>
                <button type="button" class="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-semibold" :aria-expanded="attrsOpen" @click="attrsOpen = !attrsOpen">
                  <ChevronDownIcon v-if="attrsOpen" class="h-3.5 w-3.5" /><ChevronRightIcon v-else class="h-3.5 w-3.5" /> Attributes ({{ attrRows.length }})
                  <span class="font-normal text-muted-foreground">%%Field%% strings and simple AttributeValue output are filled in; other AMPscript is shown as written.</span>
                </button>
                <div v-if="attrsOpen" class="border-t border-border max-h-72 overflow-y-auto">
                  <table class="w-full text-xs">
                    <thead class="sticky top-0 bg-muted"><tr><th class="text-left font-semibold px-3 py-1.5 w-[35%]">Attribute</th><th class="text-left font-semibold px-3 py-1.5">Value</th><th class="text-left font-semibold px-3 py-1.5 w-[22%]">From</th><th class="w-8" /></tr></thead>
                    <tbody>
                      <tr v-for="r in attrRows" :key="r.name" class="border-t border-border">
                        <td class="px-3 py-1 font-medium break-all">{{ r.name }}</td>
                        <td class="px-2 py-1"><Input v-model="typed[r.name]" class="h-7 rounded-md text-xs" :aria-label="`Value for ${r.name}`" /></td>
                        <td class="px-3 py-1 text-muted-foreground truncate">{{ r.from }}</td>
                        <td class="px-1"><button v-if="r.added" type="button" class="p-1 rounded hover:bg-accent" :aria-label="`Remove ${r.name}`" @click="removeAttr(r.name)"><XIcon class="h-3.5 w-3.5" /></button></td>
                      </tr>
                      <tr v-if="!attrRows.length"><td colspan="4" class="px-3 py-2 italic text-muted-foreground">{{ attrSource === 'de' ? 'This data extension has no fields.' : 'No attributes found in this email.' }} Add your own below.</td></tr>
                      <tr class="border-t border-border bg-muted/40">
                        <td class="px-2 py-1"><Input v-model="newAttr" class="h-7 rounded-md text-xs" placeholder="Attribute name" aria-label="New attribute name" data-new-attr @keydown.enter.prevent="addAttr" /></td>
                        <td colspan="3" class="px-2 py-1"><Button size="sm" variant="outline" class="h-7" :disabled="!newAttr.trim()" data-add-attr @click="addAttr"><Plus class="h-3.5 w-3.5" /> Add attribute</Button></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
              <div v-if="dataPreview?.how === 'typed' && dataPreview.missing.length" class="text-xs text-muted-foreground">No value yet for: {{ dataPreview.missing.join(', ') }}.</div>
            </template>
            <div v-if="dataError" class="text-xs text-amber-800 dark:text-amber-300 flex flex-wrap items-center gap-2">{{ dataError }} <ReportErrorButton :error="dataError" /></div>
          </div>
          <DEPickerDialog v-if="schemaPicker" :stack="stack" title="Use the fields of a data extension" @pick="onSchemaPicked" @close="schemaPicker = false" />
          <DEPickerDialog v-if="pickerOpen" :stack="stack" with-row require-sendable title="Choose a data extension and a row" @pick="onPicked" @close="pickerOpen = false" />

          <div v-if="assetLoading" class="p-6 text-muted-foreground"><Loader2 class="h-4 w-4 animate-spin inline" /> Reading the email</div>
          <div v-else-if="assetError" class="p-4 text-red-700 dark:text-red-300 flex items-center gap-2">{{ assetError }} <ReportErrorButton :error="assetError" /></div>
          <template v-else-if="parts">
            <div v-if="view === 'preview'" class="flex-1 min-h-[480px] p-3 flex flex-col gap-1">
              <div class="flex flex-wrap items-center gap-1.5 text-xs" role="group" aria-label="Preview as">
                <button v-for="m in PREVIEW_MODES" :key="m.id" type="button" class="h-7 px-2.5 rounded-full border" :aria-pressed="previewMode === m.id" :data-preview-mode="m.id"
                  :class="previewMode === m.id ? 'bg-primary/10 border-primary text-primary' : 'border-border hover:bg-accent'" @click="previewMode = m.id">{{ m.label }}</button>
                <span v-if="modeNote" class="text-[11px] text-muted-foreground">{{ modeNote }}</span>
              </div>
              <div class="flex-1 flex justify-center" :class="previewMode === 'mobile' ? 'bg-muted/40 rounded-lg py-3' : ''">
                <iframe :srcdoc="frameHtml" sandbox="" class="h-full min-h-[440px] rounded-lg border border-border bg-white" :style="previewMode === 'mobile' ? { width: `${MOBILE_FRAME_WIDTH}px` } : { width: '100%' }" title="Email preview" data-email-frame />
              </div>
              <p class="text-[11px] text-muted-foreground">Scripts do not run in the preview. Without data, AMPscript shows as written.</p>
            </div>
            <div v-else-if="view === 'checks' && checks" class="flex-1 p-3 space-y-2" data-email-checks>
              <p class="text-xs text-muted-foreground">
                <strong class="text-foreground">{{ checks.counts.fail }} to fix, {{ checks.counts.warn }} to look at, {{ checks.counts.pass }} fine.</strong>
                Checked here from the email's code{{ dataPreview ? ' as filled in with the data above' : '' }}; nothing is sent anywhere. Mail apps differ, so a test send is still the final word.
              </p>
              <ul class="rounded-lg border border-border bg-card divide-y divide-border">
                <li v-for="c in checks.checks" :key="c.id" class="flex items-start gap-2.5 px-3 py-2" :data-check="c.id" :data-level="c.level">
                  <component :is="CHECK_ICON[c.level]" class="h-4 w-4 mt-0.5 shrink-0" :class="CHECK_TONE[c.level]" :aria-label="c.level" />
                  <div class="min-w-0"><div class="text-sm font-medium">{{ c.title }}</div><div class="text-xs text-muted-foreground">{{ c.detail }}</div></div>
                </li>
              </ul>
            </div>
            <pre v-else-if="view === 'text'" class="flex-1 m-3 p-3 rounded-lg border border-border whitespace-pre-wrap text-xs">{{ parts.text || 'No text version.' }}</pre>
            <div v-else class="flex-1 min-h-[480px] p-3"><CodeView :code="shownHtml" lang="html" /></div>
          </template>
        </template>
      </section>
    </div>
  </div>
</template>
