<script setup>
import { ref, computed, onMounted } from 'vue'
import { Trash2, Loader2, ChevronRight, ChevronDown } from 'lucide-vue-next'
import { storageReport, trimEmailVersions, formatBytes as fmt } from '@/utils/storageReport.js'
import { forget as forgetWhereUsed } from '@/utils/usage/store.js'
import { showToast } from '@/composables/useToast.js'

const localBytes = ref(0)
const extBytes = ref(0)
const loading = ref(true)
const clearing = ref(false)

const totalBytes = computed(() => localBytes.value + extBytes.value)

function formatBytes(n) {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(2)} ${units[i]}`
}

function measureLocalStorage() {
  try {
    let bytes = 0
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      const val = localStorage.getItem(key) ?? ''
      bytes += (key.length + val.length) * 2 // UTF-16 approximation
    }
    return bytes
  } catch {
    return 0
  }
}

// ── What takes the space (feedback #47) ──────────────────
const report = ref(null)
const openCats = ref(new Set())
const keepVersions = ref(5)
const busy = ref(false)
function toggleCat(id) {
  const next = new Set(openCats.value)
  next.has(id) ? next.delete(id) : next.add(id)
  openCats.value = next
}
function loadReport() {
  try { chrome.storage.local.get(null, (items) => { report.value = storageReport(items || {}) }) } catch { report.value = null }
}
async function removeKeys(keys, what) {
  if (!keys.length) return
  if (!window.confirm(`Delete ${what}? This cannot be undone. Nothing in SFMC changes.`)) return
  busy.value = true
  try {
    // A plain array: chrome.storage does not accept Vue's reactive proxy.
    await new Promise((resolve) => chrome.storage.local.remove([...keys], resolve))
    showToast(`Deleted ${what}.`)
  } finally {
    busy.value = false
    refresh()
  }
}
const deleteGroup = (cat, g) => removeKeys(g.keys, `${g.count} ${cat.label.toLowerCase()} item(s) for ${g.label}`)
const deleteCategory = (cat) => removeKeys(cat.groups.flatMap((g) => g.keys), `all ${cat.label.toLowerCase()} (${cat.count})`)
async function trimVersions() {
  const keep = Math.max(1, Math.round(Number(keepVersions.value)) || 1)
  const items = await new Promise((resolve) => chrome.storage.local.get(null, resolve))
  const t = trimEmailVersions(items, keep)
  if (!t.removedVersions) { showToast(`Every email already has ${keep} version(s) or fewer.`); return }
  if (!window.confirm(`Keep the newest ${keep} version(s) of each email and delete ${t.removedVersions} older one(s) (about ${fmt(t.savedBytes)})?`)) return
  busy.value = true
  try {
    await new Promise((resolve) => chrome.storage.local.set(t.updates, resolve))
    showToast(`Deleted ${t.removedVersions} older email version(s).`)
  } finally {
    busy.value = false
    refresh()
  }
}
async function clearWhereUsed() {
  if (!window.confirm('Delete the saved Where used scans? The next scan reads SFMC again in full.')) return
  await forgetWhereUsed('')
  showToast('Where used scans deleted.')
}

function refresh() {
  loading.value = true
  loadReport()
  localBytes.value = measureLocalStorage()
  try {
    chrome.storage.local.getBytesInUse(null, (bytes) => {
      extBytes.value = bytes || 0
      loading.value = false
    })
  } catch {
    loading.value = false
  }
}

async function clearAll() {
  const ok = window.confirm(
    'Clear ALL extension data?\n\n' +
    'This permanently deletes every saved query and its history, saved email and activity ' +
    'versions, Query Builder drafts, Where used scans and all settings. This cannot be undone.'
  )
  if (!ok) return
  clearing.value = true
  try {
    await new Promise((resolve) => chrome.storage.local.clear(resolve))
    await new Promise((resolve) => chrome.storage.session.clear(resolve)).catch(() => {})
    await forgetWhereUsed('').catch(() => {})
    try { localStorage.clear() } catch { /* ignore */ }
  } finally {
    // Reload so the UI reflects the now-empty state.
    window.location.reload()
  }
}

onMounted(refresh)
</script>

<template>
  <div class="text-xs">
    <div class="flex items-center justify-between mb-1.5">
      <span class="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Storage Usage</span>
      <Loader2 v-if="loading" class="h-3 w-3 animate-spin text-muted-foreground" />
    </div>

    <div class="flex items-center justify-between py-0.5">
      <span class="text-muted-foreground">Local storage</span>
      <span class="text-[10px] font-medium bg-muted text-foreground rounded px-1.5 py-0.5">{{ formatBytes(localBytes) }}</span>
    </div>
    <div class="flex items-center justify-between py-0.5">
      <span class="text-muted-foreground">Chrome extension storage</span>
      <span class="text-[10px] font-medium bg-muted text-foreground rounded px-1.5 py-0.5">{{ formatBytes(extBytes) }}</span>
    </div>
    <div class="flex items-center justify-between py-0.5 border-t border-border mt-1 pt-1.5">
      <span class="font-semibold">Total</span>
      <span class="text-[10px] font-semibold bg-primary text-primary-foreground rounded px-1.5 py-0.5">{{ formatBytes(totalBytes) }}</span>
    </div>

    <div v-if="report" class="mt-3 rounded-md border border-border divide-y divide-border">
      <div class="px-2 py-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">What takes the space</div>
      <div v-for="cat in report.categories" :key="cat.id">
        <div class="flex items-center gap-2 px-2 py-1.5">
          <button class="flex items-center gap-1 flex-1 text-left" :aria-expanded="openCats.has(cat.id)" @click="toggleCat(cat.id)">
            <component :is="openCats.has(cat.id) ? ChevronDown : ChevronRight" class="h-3.5 w-3.5 text-muted-foreground" />
            <span class="font-medium">{{ cat.label }}</span>
            <span class="text-muted-foreground">{{ cat.count.toLocaleString() }}{{ cat.id === 'emails' ? ` emails, ${cat.versions.toLocaleString()} versions` : '' }}</span>
          </button>
          <span class="tabular-nums">{{ fmt(cat.bytes) }}</span>
          <button v-if="cat.id !== 'other'" class="text-red-600 hover:underline disabled:opacity-50" :disabled="busy" @click="deleteCategory(cat)">Delete all</button>
        </div>
        <div v-if="openCats.has(cat.id)" class="pb-1.5">
          <div v-if="cat.id === 'emails'" class="flex flex-wrap items-center gap-1.5 px-7 py-1 text-muted-foreground">
            Keep the newest
            <input v-model="keepVersions" type="number" min="1" class="h-6 w-14 rounded border border-border bg-background px-1 text-xs" aria-label="Versions to keep per email" />
            versions of each email
            <button class="h-6 px-2 rounded border border-border text-foreground hover:bg-accent disabled:opacity-50" :disabled="busy" @click="trimVersions">Delete older versions</button>
          </div>
          <div v-for="g in cat.groups" :key="g.id" class="flex items-center gap-2 px-7 py-0.5">
            <span class="flex-1 truncate" :title="g.label">{{ g.label }} <span class="text-muted-foreground">({{ g.count.toLocaleString() }})</span></span>
            <span class="tabular-nums text-muted-foreground">{{ fmt(g.bytes) }}</span>
            <button v-if="cat.id !== 'other'" class="text-red-600 hover:underline disabled:opacity-50" :disabled="busy" @click="deleteGroup(cat, g)">Delete</button>
          </div>
        </div>
      </div>
      <div class="flex items-center gap-2 px-2 py-1.5">
        <span class="flex-1"><span class="font-medium">Where used scans</span> <span class="text-muted-foreground">(saved separately, not in the totals above)</span></span>
        <button class="text-red-600 hover:underline" @click="clearWhereUsed">Delete</button>
      </div>
    </div>

    <button
      class="mt-2 w-full flex items-center justify-center gap-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-md py-1.5 hover:bg-red-50 disabled:opacity-50"
      :disabled="clearing"
      @click="clearAll"
    >
      <Loader2 v-if="clearing" class="h-3.5 w-3.5 animate-spin" />
      <Trash2 v-else class="h-3.5 w-3.5" />
      {{ clearing ? 'Clearing…' : 'Clear all data' }}
    </button>
  </div>
</template>
