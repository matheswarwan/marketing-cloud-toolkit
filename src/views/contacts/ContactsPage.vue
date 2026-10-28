<script setup>
// Contacts (feedback #57): how many contacts the account has, and a Contact Key
// search with the attributes Contact Builder returns.
import { ref, computed } from 'vue'
import { Loader2, RefreshCw, Search, ChevronDown, ChevronRight, Upload, Download } from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'
import { useStack, whenStack } from '@/composables/useStack.js'
import { fetchContactCount, searchContactKey, parseKeyList, searchContactKeys, contactDetailId, fetchContactDetails } from '@/utils/contactsApi.js'
import { saveTextFile, readFileText } from '@/utils/download.js'
import { csvQuote } from '@/utils/queryCsv.js'
import { formatDateTime } from '@/utils/format.js'

const { stack } = useStack()

const count = ref(null)
const countBusy = ref(false)
const countError = ref('')
async function loadCount() {
  if (!stack.value) { countError.value = 'Not connected to Marketing Cloud.'; return }
  countBusy.value = true
  countError.value = ''
  try {
    count.value = await fetchContactCount(stack.value)
  } catch (e) {
    countError.value = `Could not read the contact count: ${e.message}. The Toolkit uses the headers Contact Builder's own page sends: open Contact Builder > All Contacts in SFMC once, then Refresh.`
  } finally {
    countBusy.value = false
  }
}

// One key, or many pasted or read from a file (feedback #151): each is searched
// exactly (Contact Builder takes one key per call), 4 at a time.
const MAX_KEYS = 1000
const key = ref('')
const parsed = computed(() => parseKeyList(key.value, MAX_KEYS))
const result = ref(null) // one key: { contacts, total }
const many = ref(null)   // several keys: [{ key, contacts, error }]
const progress = ref({ done: 0, total: 0 })
const searchBusy = ref(false)
const searchError = ref('')
const openRows = ref({})
const fileInput = ref(null)
async function onFile(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  try { key.value = await readFileText(file) } catch (err) { searchError.value = `Could not read ${file.name}: ${err.message}` }
}
async function search() {
  searchBusy.value = true
  searchError.value = ''
  openRows.value = {}
  details.value = {}
  result.value = null
  many.value = null
  const keys = parsed.value.keys
  try {
    if (keys.length === 1) {
      result.value = await searchContactKey(stack.value, keys[0])
      if (result.value.contacts.length === 1) openRows.value = { 0: true }
    } else {
      progress.value = { done: 0, total: keys.length }
      many.value = await searchContactKeys(stack.value, keys, { onProgress: (done, total) => { progress.value = { done, total } } })
    }
  } catch (e) {
    searchError.value = `Search failed: ${e.message}`
  } finally {
    searchBusy.value = false
  }
}
const manyFound = computed(() => (many.value || []).filter((r) => r.contacts.length).length)
function downloadMany() {
  const rows = (many.value || []).flatMap((r) => (r.contacts.length
    ? r.contacts.map((c) => ({ 'Searched key': r.key, Found: 'Yes', 'Contact Key': c.contactKey, 'Contact ID': c.contactId, Created: c.createdDate, Modified: c.modifiedDate, Error: '' }))
    : [{ 'Searched key': r.key, Found: r.error ? 'Error' : 'No', 'Contact Key': '', 'Contact ID': '', Created: '', Modified: '', Error: r.error }]))
  const head = Object.keys(rows[0] || { 'Searched key': '' })
  const csv = [head, ...rows.map((r) => head.map((h) => r[h] ?? ''))].map((r) => r.map(csvQuote).join(',')).join('\n')
  saveTextFile(csv, `contacts-search-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv', 'CSV file')
}

// A contact's details, as Contact Builder's contact screen reads them (when the search
// response carries the encoded id that screen uses; not confirmed live).
const details = ref({}) // id -> { busy, data, error }
async function loadDetails(c) {
  const id = contactDetailId(c.raw)
  if (!id) return
  details.value = { ...details.value, [id]: { busy: true } }
  try { details.value = { ...details.value, [id]: { data: await fetchContactDetails(stack.value, id) } } }
  catch (e) { details.value = { ...details.value, [id]: { error: e.message } } }
}
const showRaw = ref(false)
// Last, so everything loadCount() touches is defined when it runs straight away.
whenStack(loadCount)
</script>

<template>
  <div class="h-full overflow-y-auto p-4 space-y-4 text-sm">
    <div class="flex items-center gap-2">
      <h1 class="text-base font-semibold flex-1">Contacts</h1>
      <Button variant="outline" size="sm" class="h-8 text-xs" :disabled="countBusy" @click="loadCount">
        <Loader2 v-if="countBusy" class="h-3.5 w-3.5 mr-1 animate-spin" /><RefreshCw v-else class="h-3.5 w-3.5 mr-1" /> Refresh
      </Button>
    </div>

    <section class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div class="rounded-lg border border-border bg-card p-3">
        <div class="text-xs text-muted-foreground">Contact count</div>
        <div class="text-2xl font-semibold tabular-nums">
          <Loader2 v-if="countBusy && count === null" class="h-5 w-5 animate-spin" />
          <template v-else>{{ count === null ? '—' : count.toLocaleString() }}</template>
        </div>
        <div class="text-[11px] text-muted-foreground">All contacts in Contact Builder (the whole account, not one business unit).</div>
      </div>
    </section>
    <p v-if="countError" class="text-red-600 text-xs" role="alert">{{ countError }}</p>

    <section class="rounded-lg border border-border bg-card p-3 space-y-2">
      <h2 class="font-semibold">Find contacts</h2>
      <form class="space-y-2 text-xs" @submit.prevent="search">
        <label class="flex flex-col gap-0.5">Contact Keys (exact), one per line or separated by commas
          <textarea v-model="key" rows="6" class="w-full max-w-2xl rounded-md border border-border bg-background px-2 py-1.5 font-mono resize-y" placeholder="0031x00000AbCdE&#10;0031x00000FgHiJ" @keydown.ctrl.enter.prevent="search" @keydown.meta.enter.prevent="search" />
        </label>
        <div class="flex flex-wrap items-center gap-2">
          <Button size="sm" class="h-8 text-xs" :disabled="searchBusy || !parsed.keys.length || !stack" type="submit">
            <Loader2 v-if="searchBusy" class="h-3.5 w-3.5 mr-1 animate-spin" /><Search v-else class="h-3.5 w-3.5 mr-1" /> Search {{ parsed.keys.length > 1 ? `${parsed.keys.length} keys` : '' }}
          </Button>
          <Button type="button" variant="outline" size="sm" class="h-8 text-xs" title="Read the keys from a text or CSV file" @click="fileInput?.click()"><Upload class="h-3.5 w-3.5 mr-1" /> Load a file</Button>
          <input ref="fileInput" type="file" accept=".txt,.csv,.tsv,text/plain,text/csv" class="hidden" @change="onFile" />
          <span v-if="parsed.skipped" class="text-amber-700 dark:text-amber-300">Only the first {{ MAX_KEYS }} keys are searched ({{ parsed.skipped }} more left out).</span>
          <span v-if="searchBusy && progress.total > 1" class="text-muted-foreground">{{ progress.done }} of {{ progress.total }}</span>
        </div>
      </form>
      <p v-if="searchError" class="text-red-600 text-xs" role="alert">{{ searchError }}</p>
      <template v-if="many">
        <div class="flex items-center gap-2 text-xs">
          <span class="text-muted-foreground">{{ manyFound }} of {{ many.length }} keys found.</span>
          <Button variant="outline" size="sm" class="h-7 text-xs ml-auto" @click="downloadMany"><Download class="h-3.5 w-3.5 mr-1" /> CSV</Button>
        </div>
        <table class="w-full text-xs">
          <thead><tr class="text-left text-muted-foreground border-b border-border"><th class="py-1 pr-3">Searched key</th><th class="py-1 pr-3">Found</th><th class="py-1 pr-3">Contact ID</th><th class="py-1 pr-3">Created</th><th class="py-1 pr-3">Modified</th></tr></thead>
          <tbody>
            <tr v-for="r in many" :key="r.key" class="border-b border-border/50">
              <td class="py-1 pr-3 font-mono">{{ r.key }}</td>
              <td class="py-1 pr-3" :class="r.error ? 'text-red-600' : r.contacts.length ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground'">{{ r.error ? `Error: ${r.error}` : r.contacts.length ? 'Yes' : 'No' }}</td>
              <td class="py-1 pr-3 tabular-nums">{{ r.contacts[0]?.contactId || '' }}</td>
              <td class="py-1 pr-3 whitespace-nowrap">{{ r.contacts[0]?.createdDate ? formatDateTime(r.contacts[0].createdDate) : '' }}</td>
              <td class="py-1 pr-3 whitespace-nowrap">{{ r.contacts[0]?.modifiedDate ? formatDateTime(r.contacts[0].modifiedDate) : '' }}</td>
            </tr>
          </tbody>
        </table>
      </template>
      <template v-if="result">
        <p class="text-xs text-muted-foreground">{{ result.contacts.length ? `${result.total} found.` : 'No contact has that key.' }}</p>
        <table v-if="result.contacts.length" class="w-full text-xs">
          <thead><tr class="text-left text-muted-foreground border-b border-border"><th class="py-1 pr-3 w-5"></th><th class="py-1 pr-3">Contact Key</th><th class="py-1 pr-3">Contact ID</th><th class="py-1 pr-3">Created</th><th class="py-1 pr-3">Modified</th></tr></thead>
          <tbody>
            <template v-for="(c, i) in result.contacts" :key="c.contactId || i">
              <tr class="border-b border-border/50 cursor-pointer hover:bg-muted/40" @click="openRows[i] = !openRows[i]">
                <td class="py-1 pr-1"><ChevronDown v-if="openRows[i]" class="h-3 w-3" /><ChevronRight v-else class="h-3 w-3" /></td>
                <td class="py-1 pr-3 font-medium font-mono">{{ c.contactKey || '—' }}</td>
                <td class="py-1 pr-3 tabular-nums">{{ c.contactId || '—' }}</td>
                <td class="py-1 pr-3 whitespace-nowrap">{{ c.createdDate ? formatDateTime(c.createdDate) : '—' }}</td>
                <td class="py-1 pr-3 whitespace-nowrap">{{ c.modifiedDate ? formatDateTime(c.modifiedDate) : '—' }}</td>
              </tr>
              <tr v-if="openRows[i]" class="border-b border-border/50">
                <td></td>
                <td colspan="4" class="py-2 pr-3">
                  <div v-if="contactDetailId(c.raw)" class="mb-1">
                    <button class="text-primary hover:underline" @click.stop="loadDetails(c)">Load the contact's details</button>
                    <Loader2 v-if="details[contactDetailId(c.raw)]?.busy" class="inline h-3 w-3 ml-1 animate-spin" />
                    <p v-if="details[contactDetailId(c.raw)]?.error" class="text-red-600">{{ details[contactDetailId(c.raw)].error }}</p>
                    <pre v-if="details[contactDetailId(c.raw)]?.data" class="max-h-72 overflow-auto rounded bg-muted p-2 text-[11px]">{{ JSON.stringify(details[contactDetailId(c.raw)].data, null, 2) }}</pre>
                  </div>
                  <p v-if="!c.values.length" class="text-muted-foreground">Contact Builder sent no attribute values for this contact.</p>
                  <dl v-else class="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-0.5">
                    <template v-for="(v, j) in c.values" :key="j">
                      <dt class="text-muted-foreground">{{ v.set ? `${v.set}: ` : '' }}{{ v.name }}</dt>
                      <dd class="break-all">{{ v.value || '—' }}</dd>
                    </template>
                  </dl>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
        <button v-if="result.contacts.length" class="text-xs text-primary hover:underline" @click="showRaw = !showRaw">{{ showRaw ? 'Hide' : 'Show' }} the response from Contact Builder</button>
        <pre v-if="showRaw" class="max-h-96 overflow-auto rounded bg-muted p-2 text-[11px]">{{ JSON.stringify(result.contacts.map((c) => c.raw), null, 2) }}</pre>
      </template>
    </section>
  </div>
</template>
