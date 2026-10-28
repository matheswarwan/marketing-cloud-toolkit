// Display helpers shared by the result screens.

export function formatDateTime(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function formatDate(value) {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// [Name] when the identifier needs brackets in SFMC SQL.
export function sqlName(name) {
  const n = String(name)
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(n) ? n : `[${n.replace(/]/g, ']]')}]`
}
