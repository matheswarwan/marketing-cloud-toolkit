<script setup>
// Mark up a screenshot: pen or box in red, Hide (a solid block over private data),
// Crop, undo, clear. `image` is a canvas or an <img>; `getResult()` returns the
// marked-up picture as a canvas, cut to the crop when there is one.
import { onMounted, ref, watch } from 'vue'
import { Pencil, Square, Undo2, Eraser, EyeOff, Crop } from 'lucide-vue-next'

const props = defineProps({ image: { type: Object, required: true } })
const canvas = ref(null)
const tool = ref('hide')
const marks = ref([]) // { tool, points: [[x, y], ...] }
let drawing = null

const COLOR = '#e11d48'

const rectOf = ([[x1, y1], [x2, y2]]) => [Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)]
// The crop is the last crop mark; it is shown as a dashed frame and applied in getResult.
const cropMark = () => [...marks.value].reverse().find((m) => m.tool === 'crop' && m.points.length > 1)

function redraw({ forExport = false } = {}) {
  const c = canvas.value
  if (!c) return
  const ctx = c.getContext('2d')
  ctx.clearRect(0, 0, c.width, c.height)
  ctx.drawImage(props.image, 0, 0, c.width, c.height)
  ctx.strokeStyle = COLOR
  ctx.lineWidth = Math.max(3, Math.round(c.width / 400))
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  for (const m of [...marks.value, ...(drawing ? [drawing] : [])]) {
    const p = m.points
    if (m.tool === 'box' && p.length > 1) {
      ctx.strokeRect(...rectOf([p[0], p[p.length - 1]]))
    } else if (m.tool === 'hide' && p.length > 1) {
      ctx.fillStyle = '#000'
      ctx.fillRect(...rectOf([p[0], p[p.length - 1]]))
    } else if (m.tool === 'pen' && p.length) {
      ctx.beginPath()
      ctx.moveTo(...p[0])
      for (const pt of p.slice(1)) ctx.lineTo(...pt)
      ctx.stroke()
    }
  }
  const crop = forExport ? null : (drawing?.tool === 'crop' ? drawing : cropMark())
  if (crop && crop.points.length > 1) {
    ctx.save()
    ctx.setLineDash([12, 8])
    ctx.strokeStyle = '#0070d2'
    ctx.strokeRect(...rectOf([crop.points[0], crop.points[crop.points.length - 1]]))
    ctx.restore()
  }
}

/** The picture to send: marks drawn, no crop frame, cut to the crop. */
function getResult() {
  redraw({ forExport: true })
  const crop = cropMark()
  let out = canvas.value
  if (crop) {
    const [x, y, w, h] = rectOf([crop.points[0], crop.points[crop.points.length - 1]]).map(Math.round)
    if (w > 4 && h > 4) {
      out = document.createElement('canvas')
      out.width = w
      out.height = h
      out.getContext('2d').drawImage(canvas.value, x, y, w, h, 0, 0, w, h)
    }
  }
  const copy = document.createElement('canvas')
  copy.width = out.width
  copy.height = out.height
  copy.getContext('2d').drawImage(out, 0, 0)
  redraw()
  return copy
}

function setup() {
  const c = canvas.value
  c.width = props.image.naturalWidth || props.image.width
  c.height = props.image.naturalHeight || props.image.height
  marks.value = []
  redraw()
}
onMounted(setup)
watch(() => props.image, setup)

// Pointer position in the canvas's own pixels (it is shown scaled down).
function point(e) {
  const r = canvas.value.getBoundingClientRect()
  return [(e.clientX - r.left) * (canvas.value.width / r.width), (e.clientY - r.top) * (canvas.value.height / r.height)]
}
function down(e) {
  canvas.value.setPointerCapture(e.pointerId)
  drawing = { tool: tool.value, points: [point(e)] }
}
function move(e) {
  if (!drawing) return
  if (drawing.tool !== 'pen') drawing.points = [drawing.points[0], point(e)]
  else drawing.points.push(point(e))
  redraw()
}
function up() {
  if (drawing && drawing.points.length > 1) marks.value = [...marks.value, drawing]
  drawing = null
  redraw()
}
function undo() { marks.value = marks.value.slice(0, -1); redraw() }
function clear() { marks.value = []; redraw() }

defineExpose({ getResult, hasMarks: () => marks.value.length > 0 })
</script>

<template>
  <div>
    <div class="flex items-center gap-1 mb-1.5 text-xs" role="toolbar" aria-label="Mark up">
      <button type="button" class="flex items-center gap-1 h-7 px-2 rounded-md border" :class="tool === 'hide' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent'" :aria-pressed="tool === 'hide'" title="Cover private data with a solid block" @click="tool = 'hide'"><EyeOff class="h-3.5 w-3.5" /> Hide</button>
      <button type="button" class="flex items-center gap-1 h-7 px-2 rounded-md border" :class="tool === 'crop' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent'" :aria-pressed="tool === 'crop'" title="Send only the part inside the frame" @click="tool = 'crop'"><Crop class="h-3.5 w-3.5" /> Crop</button>
      <button type="button" class="flex items-center gap-1 h-7 px-2 rounded-md border" :class="tool === 'box' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent'" :aria-pressed="tool === 'box'" @click="tool = 'box'"><Square class="h-3.5 w-3.5" /> Box</button>
      <button type="button" class="flex items-center gap-1 h-7 px-2 rounded-md border" :class="tool === 'pen' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent'" :aria-pressed="tool === 'pen'" @click="tool = 'pen'"><Pencil class="h-3.5 w-3.5" /> Pen</button>
      <button type="button" class="flex items-center gap-1 h-7 px-2 rounded-md border border-border hover:bg-accent disabled:opacity-40" :disabled="!marks.length" @click="undo"><Undo2 class="h-3.5 w-3.5" /> Undo</button>
      <button type="button" class="flex items-center gap-1 h-7 px-2 rounded-md border border-border hover:bg-accent disabled:opacity-40" :disabled="!marks.length" @click="clear"><Eraser class="h-3.5 w-3.5" /> Clear marks</button>
      <span class="ml-auto text-muted-foreground">Hide covers private data, Crop keeps only part of the picture, Box and Pen point at the problem.</span>
    </div>
    <canvas ref="canvas" class="w-full h-auto rounded-md border border-border cursor-crosshair touch-none"
      aria-label="Screenshot; draw on it to mark it up" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" />
  </div>
</template>
