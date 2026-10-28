// Lets the app's tabs avoid editing the same workspace or Query Builder query at the
// same time: a tab claims what it has open, and before reopening "the last one" a
// tab asks whether another tab has it.
const CHANNEL = 'sfmc-toolkit-claims'
const mine = new Set()
let channel = null

function getChannel() {
  if (channel) return channel
  try {
    channel = new BroadcastChannel(CHANNEL)
    channel.addEventListener('message', (e) => {
      if (e.data?.type === 'who-has' && mine.has(e.data.key)) channel.postMessage({ type: 'has', key: e.data.key })
    })
  } catch { channel = null }
  return channel
}

export function claim(key) {
  if (!key) return
  getChannel()
  mine.add(key)
}

export function release(key) {
  mine.delete(key)
}

// True when another open tab has claimed `key`. Waits `wait` ms for answers.
export function isClaimedElsewhere(key, wait = 150) {
  const ch = getChannel()
  if (!ch || !key) return Promise.resolve(false)
  return new Promise((resolve) => {
    let found = false
    const onMessage = (e) => { if (e.data?.type === 'has' && e.data.key === key) found = true }
    ch.addEventListener('message', onMessage)
    ch.postMessage({ type: 'who-has', key })
    setTimeout(() => { ch.removeEventListener('message', onMessage); resolve(found) }, wait)
  })
}
