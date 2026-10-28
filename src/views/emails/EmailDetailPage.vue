<script setup>
// One captured email: its saved versions, a preview of each, delete, and revert
// (puts a version back into Content Builder). From SFMC Query Saver's email page.
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, RotateCcw, Check, AlertCircle, Loader2, Clock, FolderOpen, Trash2, ExternalLink } from 'lucide-vue-next'
import { compile } from '@/utils/emailCompiler.js'
import { sfmcFetch, logInfo } from '@/utils/sfmcApi.js'
import { showToast } from '@/composables/useToast.js'

const route = useRoute()
const router = useRouter()

const record = ref(null)
const loading = ref(true)
const selectedIdx = ref(0)
const revertState = ref({}) // versionId → 'confirm' | 'pending' | 'success' | { error }
const deletingVersionId = ref(null)

// Only a saved email's own key (email_<asset id>), never another storage key from the URL.
const emailId = computed(() => { const id = String(route.params.id || ''); return /^email_\d+$/.test(id) ? id : '' })

function load() {
  loading.value = true
  selectedIdx.value = 0
  revertState.value = {}
  chrome.storage.local.get(emailId.value, (data) => {
    record.value = data?.[emailId.value] || null
    loading.value = false
  })
}
watch(emailId, (id) => { if (id) load() }, { immediate: true })

// Records captured before versions existed get one version from their own fields.
const versions = computed(() => {
  const r = record.value
  if (!r) return []
  if (r.versions?.length) return r.versions
  return [{
    versionId: `v_${r.timeStamp}`, savedAt: r.timeStamp, subject: r.subject || '', name: r.name || '',
    status: r.status || '', categoryName: r.categoryName || '', compileAsset: r.compileAsset || null,
    assetBody: null, stack: null,
  }]
})
const selectedVersion = computed(() => versions.value[selectedIdx.value] || null)
const compiledHtml = computed(() => {
  const ca = selectedVersion.value?.compileAsset
  if (!ca) return null
  try { return compile(ca, 'html') || null } catch { return null }
})

const label = (v) => `v${versions.value.length - versions.value.indexOf(v)}`
const stateOf = (v) => revertState.value[v.versionId] || 'idle'
const setState = (v, s) => { revertState.value = { ...revertState.value, [v.versionId]: s } }

async function revert(version) {
  if (!version.assetBody || !version.stack) return
  setState(version, 'pending')
  const url = `https://content-builder.${version.stack}.marketingcloudapps.com/fuelapi/asset/v1/content/assets/${record.value.assetId}`
  logInfo(`Reverting "${record.value.name}" to ${label(version)} (saved ${formatDate(version.savedAt)})`)
  try {
    await sfmcFetch(url, 'PUT', version.assetBody)
    setState(version, 'success')
    showToast(`Reverted to ${label(version)}. Reload the email in Content Builder to see it.`, 6000)
  } catch (e) {
    setState(version, { error: e.message })
  }
}

async function deleteVersion(versionId) {
  if (!record.value) return
  const remaining = versions.value.filter((v) => v.versionId !== versionId)
  if (!remaining.length) {
    if (!confirm('This is the last version. Delete this email from Marketing Cloud Toolkit? (Nothing changes in Content Builder.)')) return
    await new Promise((r) => chrome.storage.local.remove(emailId.value, r))
    showToast('Email deleted.')
    router.push('/emails')
    return
  }
  deletingVersionId.value = versionId
  const updated = { ...record.value, versions: remaining }
  if (selectedIdx.value >= remaining.length) selectedIdx.value = remaining.length - 1
  await new Promise((r) => chrome.storage.local.set({ [emailId.value]: updated }, r))
  record.value = updated
  deletingVersionId.value = null
}

function formatDate(ts) {
  if (!ts) return '-'
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
const contentBuilderUrl = (stack) => `https://mc.${stack}.exacttarget.com/cloud/#app/Content%20Builder`
</script>

<template>
  <div class="h-full flex flex-col">
    <div v-if="loading" class="flex-1 flex items-center justify-center"><Loader2 class="h-6 w-6 animate-spin text-muted-foreground" /></div>

    <div v-else-if="!record" class="flex-1 flex flex-col items-center justify-center gap-3">
      <AlertCircle class="h-10 w-10 text-muted-foreground/40" />
      <p class="text-sm text-muted-foreground">This email is not saved in Marketing Cloud Toolkit.</p>
      <RouterLink to="/emails" class="text-xs text-primary underline">Back to emails</RouterLink>
    </div>

    <template v-else>
      <div class="flex items-center gap-3 px-4 py-2 border-b border-border bg-card">
        <RouterLink to="/emails" class="p-1.5 rounded-md text-muted-foreground hover:bg-accent" title="Back to emails"><ArrowLeft class="h-4 w-4" /></RouterLink>
        <div class="flex-1 min-w-0">
          <h1 class="text-sm font-semibold truncate">{{ record.name }}</h1>
          <div class="flex items-center gap-2 mt-0.5 flex-wrap text-[11px] text-muted-foreground">
            <span v-if="record.categoryName" class="inline-flex items-center gap-1"><FolderOpen class="h-3 w-3" /> {{ record.categoryName }}</span>
            <span v-if="record.assetTypeDisplayName">{{ record.assetTypeDisplayName }}</span>
            <span v-if="record.memberId">MID {{ record.memberId }}</span>
            <span>Asset {{ record.assetId }}</span>
          </div>
        </div>
        <span class="text-[11px] font-medium bg-muted border border-border rounded-full px-2.5 py-0.5 text-muted-foreground">
          {{ versions.length }} {{ versions.length === 1 ? 'version' : 'versions' }}
        </span>
      </div>

      <div class="flex-1 flex min-h-0">
        <aside class="w-72 shrink-0 border-r border-border bg-card flex flex-col min-h-0" aria-label="Versions">
          <div class="px-4 py-2 border-b border-border text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Version history</div>
          <div class="flex-1 overflow-y-auto">
            <div v-for="(version, idx) in versions" :key="version.versionId"
              class="border-b border-border last:border-0 border-l-2 cursor-pointer"
              :class="selectedIdx === idx ? 'bg-primary/5 border-l-primary' : 'hover:bg-muted/50 border-l-transparent'"
              :aria-current="selectedIdx === idx" @click="selectedIdx = idx">
              <div class="px-4 py-3">
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-xs font-bold">{{ label(version) }}</span>
                  <span v-if="idx === 0" class="text-[9px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-full px-1.5">Latest</span>
                  <span v-if="version.status" class="text-[9px] rounded-full px-1.5 border"
                    :class="version.status === 'Published' ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800' : 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-700'">{{ version.status }}</span>
                  <button class="ml-auto p-1 rounded text-muted-foreground/50 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                    :disabled="deletingVersionId === version.versionId" title="Delete this version" @click.stop="deleteVersion(version.versionId)">
                    <Loader2 v-if="deletingVersionId === version.versionId" class="h-3 w-3 animate-spin" /><Trash2 v-else class="h-3 w-3" />
                  </button>
                </div>
                <div class="flex items-center gap-1 text-[10px] text-muted-foreground mb-1.5"><Clock class="h-2.5 w-2.5" /> {{ formatDate(version.savedAt) }}</div>
                <p v-if="version.subject" class="text-[10px] text-foreground/70 line-clamp-2 mb-2 italic">"{{ version.subject }}"</p>

                <template v-if="idx !== 0">
                  <div v-if="version.assetBody && version.stack" @click.stop>
                    <button v-if="stateOf(version) === 'idle'"
                      class="flex items-center justify-center gap-1.5 w-full text-[10px] font-semibold px-2.5 py-1 rounded-md border border-primary/40 text-primary hover:bg-primary/10"
                      @click="setState(version, 'confirm')"><RotateCcw class="h-3 w-3" /> Revert to this version</button>
                    <div v-else-if="stateOf(version) === 'confirm'" class="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-700 p-2 text-[10px] text-amber-900 dark:text-amber-200">
                      <p>Replace the email in Content Builder with {{ label(version) }}? The current content is kept here as the latest version.</p>
                      <div class="flex gap-1.5 mt-1.5">
                        <button class="flex-1 rounded bg-primary text-primary-foreground py-1 font-semibold" @click="revert(version)">Revert</button>
                        <button class="flex-1 rounded border border-border bg-background py-1" @click="setState(version, 'idle')">Cancel</button>
                      </div>
                    </div>
                    <div v-else-if="stateOf(version) === 'pending'" class="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground py-1"><Loader2 class="h-3 w-3 animate-spin" /> Reverting…</div>
                    <div v-else-if="stateOf(version) === 'success'" class="flex items-center justify-center gap-1.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 py-1 rounded-md bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800"><Check class="h-3 w-3" /> Reverted</div>
                    <div v-else-if="stateOf(version)?.error" class="flex flex-col gap-1">
                      <div class="flex items-start gap-1.5 text-[10px] text-red-700 dark:text-red-400 px-2.5 py-1.5 rounded-md bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800" role="alert">
                        <AlertCircle class="h-3 w-3 shrink-0 mt-px" />
                        <span v-if="stateOf(version).error.includes('EBADCSRFTOKEN')">
                          The Content Builder session expired. Open Content Builder once, then try again.
                          <a :href="contentBuilderUrl(version.stack)" target="_blank" class="underline font-semibold inline-flex items-center gap-0.5">Open <ExternalLink class="h-2.5 w-2.5" /></a>
                        </span>
                        <span v-else class="wrap-break-word">{{ stateOf(version).error }}</span>
                      </div>
                      <button class="text-[10px] text-primary underline" @click="setState(version, 'idle')">Try again</button>
                    </div>
                  </div>
                  <p v-else class="text-[9px] text-muted-foreground/60 italic text-center">Revert unavailable (saved before versions were kept)</p>
                </template>
              </div>
            </div>
          </div>
        </aside>

        <section class="flex-1 flex flex-col min-w-0" aria-label="Preview">
          <div class="flex items-center gap-3 px-5 py-2 border-b border-border bg-card text-xs">
            <span class="font-semibold">{{ selectedVersion ? label(selectedVersion) : '' }} <span class="text-muted-foreground font-normal ml-1">{{ formatDate(selectedVersion?.savedAt) }}</span></span>
            <span v-if="selectedVersion?.subject" class="text-muted-foreground truncate flex-1 min-w-0">Subject: {{ selectedVersion.subject }}</span>
          </div>
          <div class="flex-1 relative bg-white">
            <iframe v-if="compiledHtml" :srcdoc="compiledHtml" sandbox class="w-full h-full border-0" title="Email preview" />
            <div v-else class="h-full flex items-center justify-center text-sm text-muted-foreground bg-muted/20">No preview for this version.</div>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>
