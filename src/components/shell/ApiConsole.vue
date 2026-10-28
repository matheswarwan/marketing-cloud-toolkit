<script setup>
// Bottom drawer listing SFMC API calls (from SFMC Query Saver's email page console).
import { ref } from 'vue'
import { ChevronDown, X } from 'lucide-vue-next'
import { useApiConsole, formatLogLine } from '@/composables/useApiConsole.js'
import { saveTextFile } from '@/utils/download.js'

const { enabled, logs, setEnabled, clear } = useApiConsole()
const open = ref(false)
const height = ref(220)

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 2 })
}
const short = (v) => { const s = JSON.stringify(v) ?? ''; return s.length > 400 ? s.slice(0, 400) + '…' : s }

function download() {
  const text = [...logs.value].reverse().map(formatLogLine).join('\n')
  saveTextFile(text, `sfmc-toolkit-api-log-${Date.now()}.txt`, 'text/plain', 'Text file')
}

function startResize(e) {
  const startY = e.clientY
  const startH = height.value
  const move = (ev) => { height.value = Math.max(80, Math.min(600, startH + startY - ev.clientY)) }
  const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}
</script>

<template>
  <div v-if="enabled" class="shrink-0 border-t border-slate-700 bg-[#1E1E1E]">
    <div v-if="open" class="h-1.5 bg-[#333] cursor-ns-resize hover:bg-primary" @mousedown="startResize" />
    <div class="flex items-center justify-between px-3 py-1.5 cursor-pointer select-none bg-[#2D2D2D] hover:bg-[#333]" @click="open = !open">
      <span class="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
        API console
        <span v-if="logs.length" class="text-[10px] bg-[#555] text-slate-300 px-1.5 rounded-full">{{ logs.length }}</span>
      </span>
      <div class="flex items-center gap-2" @click.stop>
        <button class="text-[10px] border border-[#555] text-slate-400 px-1.5 rounded hover:text-slate-200 disabled:opacity-40" :disabled="!logs.length" @click="download">Download</button>
        <button class="text-[10px] border border-[#555] text-slate-400 px-1.5 rounded hover:text-slate-200" @click="clear">Clear</button>
        <button class="text-slate-500 hover:text-slate-300" title="Turn off the API console" @click="setEnabled(false)"><X class="h-3 w-3" /></button>
        <ChevronDown class="h-3 w-3 text-slate-500 transition-transform" :class="{ 'rotate-180': open }" @click="open = !open" />
      </div>
    </div>
    <div v-if="open" class="overflow-y-auto font-mono text-[11px]" :style="{ height: height + 'px' }">
      <div v-if="!logs.length" class="text-slate-500 px-3 py-2 italic">No API calls yet.</div>
      <div v-for="(e, i) in logs" :key="i"
        class="flex items-baseline gap-2 px-3 py-0.5 flex-wrap leading-relaxed border-l-2"
        :class="{ 'border-[#0176D3]': e.type === 'req', 'border-emerald-600': e.type === 'res', 'border-red-600 bg-red-950/20': e.type === 'err', 'border-[#666]': e.type === 'info' }">
        <span class="text-slate-500">{{ formatTime(e.ts) }}</span>
        <span v-if="e.type === 'info'" class="text-slate-400 italic">{{ e.message }}</span>
        <template v-else>
          <span class="font-bold text-[10px]" :class="{ 'text-teal-400': e.method === 'GET', 'text-yellow-300': e.method === 'POST', 'text-orange-300': e.method === 'PUT' || e.method === 'PATCH', 'text-red-400': e.method === 'DELETE' }">{{ e.method }}</span>
          <span class="text-sky-300 break-all flex-1">{{ e.url }}</span>
          <template v-if="e.type === 'req' && e.body != null"><span class="text-slate-500">body:</span><span class="text-orange-300 break-all">{{ short(e.body) }}</span></template>
          <template v-else-if="e.type === 'res'"><span class="text-slate-500">→</span><span class="text-green-300 break-all">{{ short(e.result) }}</span></template>
          <template v-else-if="e.type === 'err'"><span class="text-slate-500">✗</span><span class="text-red-400 break-all">{{ e.error }}</span></template>
        </template>
      </div>
    </div>
  </div>
</template>
