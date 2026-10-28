// Saves text as a file: the browser's Save dialog where available, else a download.
export async function saveTextFile(content, fileName, mime = 'text/plain', description = 'File') {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  if ('showSaveFilePicker' in window) {
    try {
      const ext = '.' + fileName.split('.').pop()
      const handle = await window.showSaveFilePicker({ suggestedName: fileName, types: [{ description, accept: { [mime]: [ext] } }] })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return true
    } catch (e) {
      if (e?.name === 'AbortError') return false
      // Fall through to a plain download.
    }
  }
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = fileName
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  return true
}

export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}
