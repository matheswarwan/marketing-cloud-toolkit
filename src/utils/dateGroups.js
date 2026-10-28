// Groups items by how recent they are: Today, Yesterday, This Week, Last Week, This
// Month, Last Month, then one group per month. Used by saved queries and emails.

export function getDateGroup(timestamp, now = new Date()) {
  const d = new Date(timestamp)
  // Older records can lack a timestamp; they go last.
  if (timestamp == null || timestamp === '' || Number.isNaN(d.getTime())) {
    return { key: 'unknown', label: 'Unknown date', order: Number.MAX_SAFE_INTEGER }
  }
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfDate = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.round((startOfToday - startOfDate) / 86400000)

  if (diffDays === 0) return { key: 'today', label: 'Today', order: 0 }
  if (diffDays === 1) return { key: 'yesterday', label: 'Yesterday', order: 1 }

  const dow = startOfToday.getDay()
  const startOfThisWeek = new Date(startOfToday)
  startOfThisWeek.setDate(startOfToday.getDate() - (dow === 0 ? 6 : dow - 1))
  if (startOfDate >= startOfThisWeek) return { key: 'this_week', label: 'This Week', order: 2 }

  const startOfLastWeek = new Date(startOfThisWeek)
  startOfLastWeek.setDate(startOfThisWeek.getDate() - 7)
  if (startOfDate >= startOfLastWeek) return { key: 'last_week', label: 'Last Week', order: 3 }

  if (startOfDate >= new Date(now.getFullYear(), now.getMonth(), 1)) return { key: 'this_month', label: 'This Month', order: 4 }
  if (startOfDate >= new Date(now.getFullYear(), now.getMonth() - 1, 1)) return { key: 'last_month', label: 'Last Month', order: 5 }

  const yr = d.getFullYear()
  const mo = d.getMonth()
  return {
    key: `m_${yr}_${String(mo).padStart(2, '0')}`,
    label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    order: (now.getFullYear() - yr) * 12 + (now.getMonth() - mo) + 4,
  }
}

// [{ key, label, order, items }] newest group first; items keep their order.
export function groupByDate(items, now = new Date(), getTime = (x) => x.timeStamp) {
  const map = new Map()
  for (const item of items) {
    const g = getDateGroup(getTime(item), now)
    if (!map.has(g.key)) map.set(g.key, { ...g, items: [] })
    map.get(g.key).items.push(item)
  }
  return [...map.values()].sort((a, b) => a.order - b.order)
}
