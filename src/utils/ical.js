// Plain-English recurrence for an automation schedule's iCal RRULE, e.g.
// "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE" → "Every 2 weeks on Monday, Wednesday"
// (from SFMC Automation Viewer's parseIcalRecur). Unknown parts are left out.
const DAYS = { MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday', SU: 'Sunday' }
const UNITS = { MINUTELY: 'minute', HOURLY: 'hour', DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }

export function describeRecurrence(ical) {
  if (!ical || typeof ical !== 'string') return null
  const parts = Object.fromEntries(ical.replace(/^RRULE:/i, '').split(';').filter(Boolean).map((p) => {
    const [k, ...v] = p.split('=')
    return [k.trim().toUpperCase(), v.join('=').trim()]
  }))
  if (!parts.FREQ) return null
  const interval = Math.max(1, parseInt(parts.INTERVAL || '1', 10) || 1)
  const unit = UNITS[parts.FREQ.toUpperCase()] || parts.FREQ.toLowerCase()
  let text = interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`
  if (parts.BYDAY) text += ` on ${parts.BYDAY.split(',').map((d) => DAYS[d.replace(/^[-+]?\d+/, '')] || d).join(', ')}`
  if (parts.BYMONTHDAY) text += ` on day ${parts.BYMONTHDAY.split(',').join(', ')}`
  if (parts.COUNT) text += `, ${parts.COUNT} times`
  if (parts.UNTIL) text += `, until ${parts.UNTIL}`
  return text
}
