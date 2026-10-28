// Screenshots for feedback: this page (rendered from the page itself, no permission
// needed), another tab or window (Chrome's screen picker), or an image file.

const MAX_WIDTH = 1600
const MAX_BYTES = 1_500_000 // the feedback worker accepts up to 1.9 MB

export async function capturePage(element, { exclude } = {}) {
  const { toCanvas } = await import('html-to-image')
  return toCanvas(element, {
    pixelRatio: 1,
    cacheBust: true,
    // Leave out the feedback form itself, and frames it cannot read (email previews).
    filter: (node) => !(exclude && node === exclude) && node.tagName !== 'IFRAME',
    backgroundColor: getComputedStyle(document.body).backgroundColor,
  })
}

export async function captureDisplay() {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser' }, audio: false })
  try {
    const video = document.createElement('video')
    video.srcObject = stream
    video.muted = true
    await video.play()
    await new Promise((r) => (video.readyState >= 2 ? r() : video.addEventListener('loadeddata', r, { once: true })))
    await new Promise((r) => setTimeout(r, 150)) // let the first frame settle
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    return canvas
  } finally {
    stream.getTracks().forEach((t) => t.stop())
  }
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not read that image.'))
    img.src = src
  })
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

/** Scales to at most MAX_WIDTH and returns a JPEG data URL under MAX_BYTES. */
export function toUploadableDataUrl(source) {
  const scale = Math.min(1, MAX_WIDTH / source.width)
  let w = Math.round(source.width * scale)
  let h = Math.round(source.height * scale)
  for (let attempt = 0; attempt < 6; attempt++) {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(source, 0, 0, w, h)
    for (const q of [0.8, 0.65, 0.5]) {
      const url = c.toDataURL('image/jpeg', q)
      if (url.length <= MAX_BYTES) return url
    }
    w = Math.round(w * 0.75)
    h = Math.round(h * 0.75)
  }
  throw new Error('The screenshot is too large to send.')
}
