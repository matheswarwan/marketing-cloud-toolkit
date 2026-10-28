import { describe, it, expect } from 'vitest'
import { automationDoc } from '../automationDoc.js'
import { describeActivity } from '../activityTypes.js'
import { toMarkdown } from '../exportDoc.js'

describe('automationDoc', () => {
  it('lists overview, schedule, notifications and each step activity', () => {
    const details = {
      name: 'Nightly', key: 'NK', status: 'Scheduled',
      schedule: { scheduleStatus: 'active', icalRecur: 'FREQ=DAILY;INTERVAL=1', timezoneName: 'UTC' },
      steps: [{ name: 'Load', activities: [{ name: 'Q1', objectTypeId: 300 }, { name: 'W', objectTypeId: 467 }] }, { activities: [] }],
    }
    const descs = { '0.0': describeActivity(300, { name: 'Q1', queryText: 'SELECT 1' }, 's10') }
    const doc = automationDoc(details, { workers: [{ notificationType: 'Error', definition: 'a@b.c', channelType: 'Email' }] }, (s, a) => descs[`${s}.${a}`] || null)
    const md = toMarkdown(doc)
    expect(doc.title).toBe('Nightly')
    expect(md).toContain('| Recurrence | Every day |')
    expect(md).toContain('| Error | a@b.c | Email |')
    expect(md).toContain('## Step 1: Load')
    expect(md).toContain('### 1.1: Q1')
    expect(md).toContain('```sql\nSELECT 1\n```')
    expect(md).toContain('### 1.2: W')
    expect(md).toContain('Wait. Details could not be loaded.')
    expect(md).toContain('## Step 2\n\nNo activities.')
  })
})

describe('automationsDoc (feedback #40)', () => {
  it('summarises several automations and nests each one, noting one that fails', async () => {
    const { vi } = await import('vitest')
    vi.resetModules()
    vi.stubGlobal('chrome', { runtime: { lastError: null, sendMessage(msg, cb) {
      const u = msg.url
      if (u.includes('/automations/A2')) return cb({ error: 'SFMC API error 404: not found' })
      if (u.includes('/automations/A1')) return cb({ data: { id: 'g1', name: 'Daily load', steps: [{ name: 'S', activities: [{ objectTypeId: 300, activityObjectId: 'q1', name: 'Q' }] }] } })
      if (u.includes('/queries/q1')) return cb({ data: { name: 'Q', queryText: 'SELECT 1', targetName: 'T' } })
      cb({ data: {} })
    } } })
    const { automationsDoc } = await import('../automationDoc.js')
    const progress = []
    const doc = await automationsDoc('s13', [{ id: 'A1', name: 'Daily load', status: 'Ready' }, { id: 'A2', name: 'Gone' }], { onProgress: (d) => progress.push(d) })
    expect(doc.title).toBe('2 automations')
    expect(doc.blocks[0].rows.map((r) => r[0])).toEqual(['Daily load', 'Gone'])
    const heads = doc.blocks.filter((b) => b.type === 'h')
    expect(heads[0]).toMatchObject({ level: 2, text: 'Daily load' })
    expect(heads.find((h) => h.text === 'Overview').level).toBe(3)
    expect(doc.blocks.some((b) => b.type === 'code' && b.text === 'SELECT 1')).toBe(true)
    expect(doc.blocks.some((b) => b.type === 'p' && /Could not load this automation: SFMC API error 404/.test(b.text))).toBe(true)
    expect(progress).toEqual([1, 2])
    vi.unstubAllGlobals()
  })
})
