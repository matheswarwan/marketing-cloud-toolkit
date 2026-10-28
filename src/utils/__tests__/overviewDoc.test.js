import { describe, it, expect } from 'vitest'
import { automationOverviewDoc, journeyOverviewDoc } from '../overviewDoc.js'
import { toMarkdown } from '../exportDoc.js'

describe('overview documents (feedback #69)', () => {
  it('turns the Automation overview into a document with every section', () => {
    const a = { id: 'a1', name: 'Nightly | load', status: 6, lastRunTime: '2026-10-20T01:00:00Z' }
    const doc = automationOverviewDoc({
      businessUnit: 'Main BU', stack: 's13', savedAt: Date.parse('2026-10-21T10:00:00Z'), trendDays: 7,
      summary: { total: 12, failedLastRun: 1, byStatus: [{ label: 'Scheduled', count: 9 }], attention: [{ automation: a, reason: 'Last run: Error' }] },
      trends: {
        days: [{ key: '2026-10-20', ok: 3, failed: 1, runs: [] }], read: 5, errors: 1,
        perAutomation: [{ automation: a, runs: 4, failed: 1, lastRun: { start: '2026-10-20T01:00:00Z' }, lastFailure: { start: '2026-10-20T01:00:00Z', message: 'Bad SQL' } }, { automation: { name: 'Idle' }, runs: 0 }],
      },
      watched: [{ name: 'Welcome', last: { status: 2, lastRunStatus: 'Complete' }, checkedAt: 0 }],
    })
    const md = toMarkdown(doc)
    expect(doc.title).toBe('Automation overview')
    expect(md).toContain('| Business unit | Main BU |')
    expect(md).toContain('Needs a look (1)')
    expect(md).toContain('Nightly \\| load')
    expect(md).toContain('| 2026-10-20 | 3 | 1 |')
    expect(md).toContain('4 runs, 1 failed, across 5 automations')
    expect(md).toContain('1 run logs could not be read')
    expect(md).toContain('Bad SQL')
    expect(md).not.toContain('Idle')
    expect(md).toContain('Watched (1)')
    expect(md).toContain('Not yet')
  })

  it('leaves out run trends that were not loaded', () => {
    const md = toMarkdown(automationOverviewDoc({ summary: { total: 0, failedLastRun: 0, byStatus: [], attention: [] } }))
    expect(md).not.toContain('Run trends')
    expect(md).toContain('Watched (0)')
  })

  it('turns the Journey overview into a document', () => {
    const md = toMarkdown(journeyOverviewDoc({
      businessUnit: 'Main BU',
      summary: { total: 3, live: 1, byStatus: [{ label: 'Published', count: 1 }] },
      sends: { checked: 1, rows: [{ journey: { name: 'Welcome', status: 'Published' }, email: ['Hello'], sms: [], push: [], error: '' }] },
    }))
    expect(md).toContain('| Live (published or scheduled) | 1 |')
    expect(md).toContain('| Welcome | Published | Hello |')
  })
})
