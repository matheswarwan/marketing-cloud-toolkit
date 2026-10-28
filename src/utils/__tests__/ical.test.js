import { describe, it, expect } from 'vitest'
import { describeRecurrence } from '../ical.js'

describe('describeRecurrence', () => {
  it('describes common schedules', () => {
    expect(describeRecurrence('FREQ=DAILY;INTERVAL=1')).toBe('Every day')
    expect(describeRecurrence('FREQ=HOURLY;INTERVAL=4')).toBe('Every 4 hours')
    expect(describeRecurrence('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE')).toBe('Every 2 weeks on Monday, Wednesday')
    expect(describeRecurrence('RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15;COUNT=10')).toBe('Every month on day 1, 15, 10 times')
    expect(describeRecurrence('FREQ=MINUTELY;INTERVAL=30')).toBe('Every 30 minutes')
  })
  it('returns null for nothing usable', () => {
    expect(describeRecurrence('')).toBeNull()
    expect(describeRecurrence(null)).toBeNull()
    expect(describeRecurrence('INTERVAL=2')).toBeNull()
  })
})
