<script setup>
// Top-bar connection pill and menu. Combines SFMC Query Saver's connection status and
// stack picker with SFMC Automation Viewer's per-app sessions ("Get Token").
import { computed, ref, watch, onUnmounted } from 'vue'
import { ChevronDown, RefreshCw, Check, X, Loader2, LogIn } from 'lucide-vue-next'
import { useConnectionStatus } from '@/composables/useConnectionStatus.js'
import { getStackChoices, setStackOverride, onStackChange } from '@/utils/stackDetection.js'
import { sendToBackground } from '@/utils/messaging.js'
import { fetchCurrentBU } from '@/utils/sfmcApi.js'
import { openTab } from '@/utils/openTab.js'

const { status, loading, refresh } = useConnectionStatus()

const open = ref(false)
const choices = ref({ candidates: [], resolved: null, source: null, override: null })
const otherStack = ref('')
const showOther = ref(false)
const stackError = ref('')
const savingStack = ref(false)
const apps = ref([])
const appsLoading = ref(false)
const connecting = ref({}) // appId → true | error message
const bu = ref(null)

const SOURCE_LABELS = { tab: 'open tab', cookie: 'logged in', session: 'SFMC page', manual: 'chosen by you', probe: 'probe' }
const sourcesLabel = (sources) => (sources || []).map((s) => SOURCE_LABELS[s] || s).join(', ')

const stack = computed(() => status.value.stack)

async function loadChoices() {
  const res = await getStackChoices()
  if (res) choices.value = res
}

async function loadApps() {
  if (!stack.value) { apps.value = []; return }
  appsLoading.value = true
  const res = await sendToBackground({ type: 'SFMC_SESSION_STATUS', stack: stack.value })
  apps.value = res?.status?.apps || []
  appsLoading.value = false
}

async function loadBU() {
  if (!stack.value) { bu.value = null; return }
  try { bu.value = await fetchCurrentBU(stack.value) } catch { bu.value = null }
}

// While apps are being started (by the automatic warm-up or Start missing), check
// again every 2 seconds so each one turns Ready as it comes up.
let pollTimer = null
watch([open, apps], () => {
  clearTimeout(pollTimer)
  if (open.value && apps.value.some((a) => a.starting)) pollTimer = setTimeout(loadApps, 2000)
})
onUnmounted(() => clearTimeout(pollTimer))
const canStartMissing = computed(() => apps.value.some((a) => a.ok) && apps.value.some((a) => !a.ok && !a.starting))
const startingMissing = ref(false)
async function startMissing() {
  startingMissing.value = true
  const run = sendToBackground({ type: 'SFMC_WARM_UP', stack: stack.value, force: true })
  setTimeout(loadApps, 300)
  await run
  startingMissing.value = false
  await loadApps()
}

async function connectApp(appId) {
  connecting.value = { ...connecting.value, [appId]: true }
  const res = await sendToBackground({ type: 'SFMC_CONNECT_APP', stack: stack.value, appId })
  connecting.value = { ...connecting.value, [appId]: res?.error || false }
  await loadApps()
}

async function chooseStack(value) {
  stackError.value = ''
  if (value === '__other') { showOther.value = true; return }
  showOther.value = false
  savingStack.value = true
  const res = await setStackOverride(value || null)
  savingStack.value = false
  if (res?.error) { stackError.value = res.error; return }
  await Promise.all([loadChoices(), refresh()])
}

function applyOther() {
  const v = otherStack.value.trim().toLowerCase()
  if (!/^s?\d+$/.test(v)) { stackError.value = 'A stack looks like s10 or 401.'; return }
  chooseStack(v)
}

function toggleOpen() {
  open.value = !open.value
  if (open.value) { loadChoices(); loadApps(); refresh() }
}

function openLogin() {
  const url = stack.value ? `https://mc.${stack.value}.exacttarget.com/cloud/` : 'https://mc.exacttarget.com'
  openTab({ url })
}

watch(stack, () => { loadBU(); if (open.value) loadApps() })
const stopStackWatch = onStackChange(() => { refresh(); loadChoices() })
onUnmounted(stopStackWatch)
loadChoices()

const overall = computed(() => {
  if (loading.value) return 'loading'
  if (status.value.connected && status.value.mcaTokenReady) return 'ok'
  if (status.value.connected) return 'partial'
  return 'down'
})
const dotClass = computed(() => ({
  loading: 'bg-muted-foreground', ok: 'bg-emerald-500', partial: 'bg-amber-500', down: 'bg-red-500',
}[overall.value]))
const summary = computed(() => {
  if (loading.value) return 'Checking…'
  if (!status.value.connected) return 'Not connected'
  return choices.value.override ? `${stack.value} (pinned)` : stack.value
})
const pickerOptions = computed(() => {
  const list = choices.value.candidates.map((c) => ({ value: c.stack, label: `${c.stack} (${sourcesLabel(c.sources)})` }))
  const o = choices.value.override
  if (o && !list.some((x) => x.value === o)) list.push({ value: o, label: `${o} (chosen by you)` })
  return list
})
</script>

<template>
  <div class="relative">
    <button
      class="flex items-center gap-2 h-8 px-2.5 rounded-md border border-border text-xs hover:bg-accent"
      :aria-expanded="open"
      @click="toggleOpen"
    >
      <span class="h-2 w-2 rounded-full shrink-0" :class="dotClass" />
      <span class="font-medium">{{ summary }}</span>
      <span v-if="bu?.name" class="hidden md:inline max-w-56 truncate text-muted-foreground">· {{ bu.name }}</span>
      <ChevronDown class="h-3.5 w-3.5 text-muted-foreground" />
    </button>

    <template v-if="open">
      <div class="fixed inset-0 z-40" @click="open = false" />
      <div class="absolute right-0 mt-1 w-80 z-50 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-3 text-xs">
        <div class="flex items-center justify-between mb-2">
          <span class="font-semibold">Connection</span>
          <button class="text-muted-foreground hover:text-foreground" title="Check again" @click="refresh(); loadApps()">
            <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': loading || appsLoading }" />
          </button>
        </div>

        <ul class="space-y-1.5">
          <li class="flex items-center gap-2">
            <span class="h-4 w-4 rounded-full flex items-center justify-center shrink-0"
              :class="status.connected ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'">
              <Check v-if="status.connected" class="h-2.5 w-2.5" /><X v-else class="h-2.5 w-2.5" />
            </span>
            <div class="min-w-0 flex-1">
              <div class="font-medium">Marketing Cloud session</div>
              <div class="text-muted-foreground truncate">
                {{ status.connected ? `Stack ${stack}${bu?.name ? ` · ${bu.name}` : ''}` : 'Log in to SFMC in any tab' }}
              </div>
            </div>
            <button v-if="!status.connected" class="flex items-center gap-1 px-1.5 py-0.5 rounded border border-border hover:bg-accent" @click="openLogin">
              <LogIn class="h-3 w-3" /> Log in
            </button>
          </li>
          <li class="flex items-center gap-2">
            <span class="h-4 w-4 rounded-full flex items-center justify-center shrink-0"
              :class="status.mcaTokenReady ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'">
              <Check v-if="status.mcaTokenReady" class="h-2.5 w-2.5" /><Loader2 v-else class="h-2.5 w-2.5 animate-spin" />
            </span>
            <div class="min-w-0 flex-1">
              <div class="font-medium">App token</div>
              <div class="text-muted-foreground">{{ status.mcaTokenReady ? 'Ready' : 'Provisioning automatically…' }}</div>
            </div>
          </li>
        </ul>

        <div v-if="status.connected" class="mt-3 pt-2 border-t border-border">
          <div class="flex items-center mb-1">
            <span class="font-medium flex-1">App sessions</span>
            <button v-if="canStartMissing" class="flex items-center gap-1 px-1.5 py-0.5 rounded border border-border hover:bg-accent disabled:opacity-50" :disabled="startingMissing"
              title="Start every app that has no session yet, one at a time in a background tab" @click="startMissing">
              <Loader2 v-if="startingMissing" class="h-3 w-3 animate-spin" /> Start missing
            </button>
          </div>
          <p class="text-muted-foreground mb-1.5">When one app has a session, the others are started in the background. Connect starts one now.</p>
          <ul class="space-y-1">
            <li v-for="app in apps" :key="app.id" class="flex items-center gap-2">
              <span class="h-2 w-2 rounded-full shrink-0" :class="app.ok ? 'bg-emerald-500' : app.starting ? 'bg-amber-500' : 'bg-muted-foreground/40'" />
              <span class="flex-1 truncate">{{ app.name }}</span>
              <span v-if="app.ok" class="text-muted-foreground">Ready</span>
              <span v-else-if="app.starting" class="flex items-center gap-1 text-muted-foreground"><Loader2 class="h-3 w-3 animate-spin" /> Starting…</span>
              <button v-else class="flex items-center gap-1 px-1.5 py-0.5 rounded border border-border hover:bg-accent disabled:opacity-50"
                :disabled="connecting[app.id] === true" @click="connectApp(app.id)">
                <Loader2 v-if="connecting[app.id] === true" class="h-3 w-3 animate-spin" />
                Connect
              </button>
            </li>
            <li v-if="!apps.length && appsLoading" class="text-muted-foreground">Checking…</li>
          </ul>
          <p v-for="(err, id) in connecting" v-show="typeof err === 'string'" :key="id" class="mt-1 text-red-600">{{ err }}</p>
        </div>

        <div class="mt-3 pt-2 border-t border-border">
          <label class="block font-medium mb-1" for="toolkit-stack">Stack</label>
          <select id="toolkit-stack"
            class="w-full rounded border border-border bg-background text-foreground px-1.5 py-1"
            :value="showOther ? '__other' : choices.override || ''" :disabled="savingStack"
            @change="chooseStack($event.target.value)">
            <option value="">Automatic{{ !choices.override && choices.resolved ? ` (${choices.resolved})` : '' }}</option>
            <option v-for="o in pickerOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            <option value="__other">Other…</option>
          </select>
          <div v-if="showOther" class="flex gap-1 mt-1">
            <input v-model="otherStack" class="flex-1 min-w-0 rounded border border-border bg-background text-foreground px-1.5 py-0.5"
              placeholder="e.g. s10" @keydown.enter="applyOther" />
            <button class="px-2 rounded border border-border hover:bg-accent" @click="applyOther">Use</button>
          </div>
          <p v-if="stackError" class="mt-1 text-red-600">{{ stackError }}</p>
          <p v-else class="mt-1 text-muted-foreground">
            {{ choices.override ? 'Pinned. Pick Automatic to detect it again.' : 'Wrong stack? Pick the one you are logged in to.' }}
          </p>
        </div>
      </div>
    </template>
  </div>
</template>
