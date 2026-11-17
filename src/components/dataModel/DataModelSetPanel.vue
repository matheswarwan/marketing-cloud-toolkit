<script setup>
// Details of one attribute set on the data model map (user, 2026-11-17: "click and view
// contents of the data model and do things with it"): its attributes and links, and
// actions: View contents (Preview data), Query this set and Query with a linked set (Run
// Query), Where used and Copy attributes. Read only: nothing is changed in SFMC.
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { X, Table2, FileCode, Network, Copy, Check, Loader2, KeyRound, ArrowRight } from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'
import { useUsage } from '@/composables/useUsage.js'
import { findSetDataExtension, deSqlName } from '@/utils/dataModel.js'
import { setSql, joinSql, fieldTypeText } from '@/utils/dataModelMap.js'

const props = defineProps({
  stack: { type: String, required: true },
  set: { type: Object, required: true },
  model: { type: Object, required: true },
})
const emit = defineEmits(['close', 'select'])
const router = useRouter()
const usage = useUsage()

const idOf = (v) => String(v ?? '').toLowerCase()
const setById = computed(() => new Map(props.model.sets.map((s) => [idOf(s.id), s])))
const groupById = computed(() => new Map(props.model.groups.map((g) => [idOf(g.id), g])))

const links = computed(() => {
  const k = idOf(props.set.id)
  return props.model.relationships.filter((r) => idOf(r.left.id) === k || idOf(r.right.id) === k).map((r) => {
    const mineLeft = idOf(r.left.id) === k
    const other = mineLeft ? r.right : r.left
    const otherSet = other.kind === 'set' ? setById.value.get(idOf(other.id)) : null
    const card = mineLeft ? r.cardinality : r.cardinality.split('-to-').reverse().join('-to-')
    const on = r.fields.map((f) => (mineLeft ? `${f.left || '?'} = ${f.right || '?'}` : `${f.right || '?'} = ${f.left || '?'}`)).join(', ')
    return { id: r.id, r, otherSet, otherName: otherSet?.name || groupById.value.get(idOf(other.id))?.name || (other.kind === 'group' ? 'Contacts' : other.id), card, on, joinable: !!otherSet }
  })
})

// The data extension behind the set, looked up once per set.
const de = ref(null)
const deState = ref('idle') // idle | finding | found | none | error
const deError = ref('')
watch(() => props.set.id, () => { de.value = null; deState.value = 'idle'; deError.value = ''; message.value = '' })
async function needDE(set = props.set) {
  if (set === props.set && (deState.value === 'found' || deState.value === 'none')) return de.value
  if (set === props.set) deState.value = 'finding'
  try {
    const found = await findSetDataExtension(props.stack, set)
    if (set === props.set) { de.value = found; deState.value = found ? 'found' : 'none' }
    return found
  } catch (e) {
    if (set === props.set) { deState.value = 'error'; deError.value = e?.message || String(e) }
    return null
  }
}
const NONE = 'No data extension the Toolkit can read was found for this attribute set. SFMC keeps its own sets (MobileConnect, MobilePush, Predictive Intelligence and other system data) outside data extensions.'

const message = ref('')
async function viewContents() {
  const d = await needDE()
  if (!d) return
  router.push({ path: '/data-extensions/preview', query: { id: d.id, key: d.customerKey, name: d.name, ...(d.sourceType ? { source: d.sourceType } : {}) } })
}
async function querySet() {
  const d = await needDE()
  if (!d) return
  router.push({ path: '/queries/workspace', query: { sql: setSql(props.set, deSqlName(d)) } })
}
async function queryJoin(link) {
  const [a, b] = [setById.value.get(idOf(link.r.left.id)), setById.value.get(idOf(link.r.right.id))]
  const [da, db] = await Promise.all([needDE(a), needDE(b)])
  if (!da || !db) { message.value = `No data extension found for ${!da ? a.name : b.name}, so there is nothing to query.`; return }
  const sql = joinSql(link.r, setById.value, new Map([[idOf(a.id), deSqlName(da)], [idOf(b.id), deSqlName(db)]]))
  if (!sql) { message.value = 'SFMC did not say which fields this link joins on.'; return }
  router.push({ path: '/queries/workspace', query: { sql } })
}
async function whereUsed() {
  const d = await needDE()
  if (d) usage.start(props.stack, { kind: 'de', de: { id: d.id, name: d.name, customerKey: d.customerKey, ...(d.sourceType ? { sourceType: d.sourceType } : {}) } })
}

const copied = ref(false)
async function copyFields() {
  const head = 'Attribute\tColumn\tType\tPrimary key\tRequired'
  const rows = props.set.fields.map((f) => [f.name, f.column, fieldTypeText(f), f.pk ? 'Yes' : '', f.nullable ? '' : 'Yes'].join('\t'))
  try {
    await navigator.clipboard.writeText([head, ...rows].join('\n'))
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
  } catch { message.value = 'Chrome did not allow copying to the clipboard.' }
}
const facts = computed(() => [
  ['Stored in', props.set.storage || 'Not given'], ['Key', props.set.key || 'Not given'],
  ['Root', props.set.root ? 'Yes' : 'No'], ['Sendable', props.set.sendable ? 'Yes' : 'No'],
])
</script>

<template>
  <aside class="flex flex-col min-h-0 h-full border-l border-border bg-card" data-dm-panel :aria-label="`Attribute set ${set.name}`">
    <div class="flex items-start gap-2 px-3 py-2 border-b border-border">
      <div class="min-w-0 flex-1">
        <h2 class="font-semibold text-sm break-words">{{ set.name }}</h2>
        <p class="text-xs text-muted-foreground">{{ set.fieldCount || 0 }} attributes · {{ links.length }} {{ links.length === 1 ? 'link' : 'links' }}</p>
      </div>
      <button type="button" class="p-1 rounded hover:bg-accent" aria-label="Close details" @click="emit('close')"><X class="h-4 w-4" /></button>
    </div>
    <div class="flex-1 min-h-0 overflow-y-auto p-3 space-y-4 text-sm">
      <div class="flex flex-wrap gap-1.5">
        <Button size="sm" class="gap-1" :disabled="deState === 'finding'" data-dm-action="contents" @click="viewContents"><Loader2 v-if="deState === 'finding'" class="h-3.5 w-3.5 animate-spin" /><Table2 v-else class="h-3.5 w-3.5" /> View contents</Button>
        <Button size="sm" variant="outline" class="gap-1" :disabled="deState === 'finding'" data-dm-action="query" @click="querySet"><FileCode class="h-3.5 w-3.5" /> Query this set</Button>
        <Button size="sm" variant="outline" class="gap-1" :disabled="deState === 'finding'" data-dm-action="where-used" @click="whereUsed"><Network class="h-3.5 w-3.5" /> Where used</Button>
        <Button size="sm" variant="outline" class="gap-1" data-dm-action="copy" @click="copyFields"><Check v-if="copied" class="h-3.5 w-3.5" /><Copy v-else class="h-3.5 w-3.5" /> {{ copied ? 'Copied' : 'Copy attributes' }}</Button>
      </div>
      <p v-if="deState === 'none'" class="text-xs text-amber-700 dark:text-amber-400" data-dm-no-de>{{ NONE }}</p>
      <p v-if="deState === 'error'" class="text-xs text-red-600" role="alert">Could not look up the data extension: {{ deError }}</p>
      <p v-if="message" class="text-xs text-amber-700 dark:text-amber-400" role="status">{{ message }}</p>

      <dl class="grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-xs">
        <template v-for="[k, v] in facts" :key="k"><dt class="text-muted-foreground">{{ k }}</dt><dd class="break-all">{{ v }}</dd></template>
      </dl>

      <section>
        <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Links</h3>
        <p v-if="!links.length" class="text-xs text-muted-foreground">Not linked to anything.</p>
        <ul class="space-y-1.5">
          <li v-for="l in links" :key="l.id" class="rounded-md border border-border p-2 text-xs" data-dm-link>
            <div class="flex items-center gap-1.5">
              <ArrowRight class="h-3 w-3 shrink-0 text-muted-foreground" />
              <button v-if="l.otherSet" type="button" class="font-medium text-primary hover:underline text-left" @click="emit('select', idOf(l.otherSet.id))">{{ l.otherName }}</button>
              <span v-else class="font-medium">{{ l.otherName }}</span>
              <span class="text-muted-foreground">{{ l.card }}</span>
            </div>
            <div v-if="l.on" class="mt-0.5 text-muted-foreground break-words">On {{ l.on }}</div>
            <button v-if="l.joinable" type="button" class="mt-1 inline-flex items-center gap-1 text-primary hover:underline" data-dm-join @click="queryJoin(l)"><FileCode class="h-3 w-3" /> Query both, joined</button>
          </li>
        </ul>
      </section>

      <section>
        <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Attributes</h3>
        <table class="w-full text-xs">
          <thead><tr class="text-left text-muted-foreground"><th class="font-normal py-0.5 pr-2">Name</th><th class="font-normal pr-2">Type</th><th class="font-normal">Required</th></tr></thead>
          <tbody>
            <tr v-for="f in set.fields" :key="f.id || f.name" class="border-t border-border/60" :class="{ 'text-muted-foreground': f.hidden }">
              <td class="py-0.5 pr-2">
                <span class="inline-flex items-center gap-1"><KeyRound v-if="f.pk" class="h-3 w-3 text-yellow-600" aria-label="Primary key" />{{ f.name }}</span>
                <span v-if="f.column && f.column !== f.name" class="block text-[10px] text-muted-foreground">Column {{ f.column }}</span>
              </td>
              <td class="pr-2 whitespace-nowrap">{{ fieldTypeText(f) }}</td>
              <td>{{ f.nullable ? '' : 'Yes' }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </aside>
</template>
