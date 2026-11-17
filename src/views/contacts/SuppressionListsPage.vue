<script setup>
// Contacts > Suppression lists (API idea 16, user 2026-11-11): every suppression list with
// its subscriber count and where it applies (enterprise, business unit, send classification,
// sender profile, publication or one send). SOAP SuppressionListDefinition and
// SuppressionListContext (utils/suppressionLists.js). A list's addresses open in Preview
// data (search, filters, downloads): a suppression list is stored as a data extension
// (suppressionPreviewTo, checked live 2026-11-17). Read-only: nothing is changed in SFMC.
import { computed, ref } from 'vue'
import { Loader2, RefreshCw, Info } from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'
import SfmcErrorNotice from '@/components/results/SfmcErrorNotice.vue'
import DataTable from '@/components/results/DataTable.vue'
import DownloadMenu from '@/components/results/DownloadMenu.vue'
import { useStack, whenStack } from '@/composables/useStack.js'
import { searchError } from '@/utils/sfmcErrors.js'
import { fetchSuppressionLists, suppressionSummary, suppressionPreviewTo } from '@/utils/suppressionLists.js'
import { formatDateTime } from '@/utils/format.js'

const { stack } = useStack()
const data = ref(null)
const busy = ref(false)
const error = ref(null)
const allBusinessUnits = ref(false)
const onlyUnlinked = ref(false)

async function load() {
  busy.value = true
  error.value = null
  try { data.value = await fetchSuppressionLists(stack.value, { allBusinessUnits: allBusinessUnits.value }) } catch (e) { error.value = searchError(e, 'read the suppression lists') } finally { busy.value = false }
}
whenStack(load)
function toggleAll() { allBusinessUnits.value = !allBusinessUnits.value; load() }

const summary = computed(() => (data.value ? suppressionSummary(data.value.lists, data.value.contextsRead) : null))
const rows = computed(() => (data.value?.lists || [])
  .map((l) => ({
    ...l, id: l.id || l.key, countText: l.count == null ? '' : l.count.toLocaleString(),
    appliesText: !data.value.contextsRead ? 'Not read' : l.appliesTo || 'Not set to apply anywhere',
    modified: formatDateTime(l.modifiedDate), created: formatDateTime(l.createdDate),
  }))
  .filter((l) => !onlyUnlinked.value || (data.value.contextsRead && !l.contexts.length)))

const columns = [
  { key: 'name', label: 'Name' }, { key: 'countText', label: 'Subscribers', sortValue: (r) => r.count ?? -1 },
  { key: 'appliesText', label: 'Applies to' }, { key: 'description', label: 'Description' },
  { key: 'key', label: 'External key', hidden: true }, { key: 'mid', label: 'MID', hidden: true },
  { key: 'modified', label: 'Modified', hidden: true, sortValue: (r) => r.modifiedDate },
  { key: 'created', label: 'Created', hidden: true, sortValue: (r) => r.createdDate },
  { key: 'id', label: 'Object ID', hidden: true },
]

function getDoc() {
  return {
    title: 'Suppression lists',
    blocks: [
      ...(data.value?.notes || []).map((n) => ({ type: 'p', text: n })),
      { type: 'table', columns: columns.map((c) => c.label), rows: rows.value.map((r) => columns.map((c) => String(r[c.key] ?? ''))) },
    ],
  }
}
</script>

<template>
  <div class="p-4 space-y-4 max-w-7xl">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-lg font-semibold">Suppression lists</h1>
      <span class="text-xs text-muted-foreground">Each suppression list, how many addresses it holds and which sends it applies to. Read only: change them in Email Studio or Contact Builder.</span>
      <div class="flex-1" />
      <DownloadMenu :get-doc="getDoc" file-name="suppression-lists" :disabled="!data" />
      <Button variant="outline" size="sm" class="gap-1" :disabled="busy" @click="load"><Loader2 v-if="busy" class="h-3.5 w-3.5 animate-spin" /><RefreshCw v-else class="h-3.5 w-3.5" /> Refresh</Button>
    </div>
    <SfmcErrorNotice v-if="error" :error="error" :retrying="busy" @retry="load" />
    <div v-if="busy && !data" class="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 class="h-4 w-4 animate-spin" /> Reading the suppression lists…</div>
    <template v-if="data">
      <div class="flex flex-wrap items-center gap-3 text-xs">
        <span data-suppression-summary>{{ summary.lists }} {{ summary.lists === 1 ? 'list' : 'lists' }}, {{ summary.subscribers.toLocaleString() }} addresses in all<template v-if="summary.unlinked != null">, {{ summary.unlinked }} not set to apply anywhere</template></span>
        <label v-if="data.contextsRead" class="flex items-center gap-1.5"><input v-model="onlyUnlinked" type="checkbox" data-suppression-unlinked /> Only lists not set to apply anywhere</label>
        <label class="flex items-center gap-1.5"><input :checked="allBusinessUnits" type="checkbox" :disabled="busy" data-suppression-all-bus @change="toggleAll" /> Every business unit</label>
      </div>
      <p v-for="n in data.notes" :key="n" class="text-xs text-amber-700 dark:text-amber-400">{{ n }}</p>
      <section class="rounded-lg border border-border bg-card">
        <DataTable :columns="columns" :rows="rows" storage-key="suppression-lists" empty-text="No suppression lists in this business unit.">
          <template #cell-name="{ row }">
            <RouterLink v-if="suppressionPreviewTo(row)" :to="suppressionPreviewTo(row)" class="text-primary hover:underline" data-suppression-open>{{ row.name }}</RouterLink>
            <span v-else>{{ row.name }}</span>
          </template>
          <template #cell-appliesText="{ row }">
            <ul v-if="row.contexts.length" class="text-xs space-y-0.5">
              <li v-for="c in row.contexts" :key="c.id || c.label"><span class="text-muted-foreground">{{ c.kind }}:</span> {{ c.label }}</li>
            </ul>
            <span v-else class="text-muted-foreground">{{ row.appliesText }}</span>
          </template>
        </DataTable>
      </section>
      <p class="flex items-start gap-1.5 text-xs text-muted-foreground"><Info class="h-3.5 w-3.5 mt-0.5 shrink-0" /> Click a list's name to see its addresses, search them and download them (Preview data). A list that is not set to apply anywhere still suppresses a send that picks it when the send is set up.</p>
    </template>
  </div>
</template>
