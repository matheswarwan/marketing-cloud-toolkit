import { describe, it, expect } from 'vitest'
import { collectFeedbackMetadata, metadataLines, routePattern, apiArea } from '../feedbackMeta.js'

describe('feedback technical details', () => {
  const meta = collectFeedbackMetadata({
    route: '/automations/5f2e8c1a-0000-4000-8000-123456789abc?tab=steps', stack: 's7', theme: 'dark',
    businessUnit: 'Acme Child BU', apiCalls: [{ method: 'GET', path: 'mc.s7.exacttarget.com/cloud/fuelapi/automation/v1/automations/abc' }],
    apiErrors: [{ method: 'GET', path: 'mc.s7.exacttarget.com/cloud/fuelapi/internal/v1/customobjects/Loyalty_Members', status: 404, error: 'DE not found: Loyalty_Members' }],
    now: new Date('2026-10-28T00:00:00Z'),
  })
  it('leaves out the business unit, SFMC paths, record names and error text', () => {
    const text = JSON.stringify(meta)
    for (const s of ['Acme', 'Loyalty', 'exacttarget', 'fuelapi', '5f2e8c1a', 'DE not found']) expect(text).not.toContain(s)
    expect(meta.recentErrors).toEqual([{ area: 'customobjects', status: 404 }].map((e) => ({ ...e, area: apiArea('fuelapi/internal/v1/customobjects/x') })))
    expect(meta.section).toBe('/automations/:id')
    expect(meta).not.toHaveProperty('businessUnit')
    expect(meta).not.toHaveProperty('recentApiCalls')
  })
  it('names the API area only', () => {
    expect(apiArea('mc.s7.exacttarget.com/cloud/fuelapi/automation/v1/queries/x')).toBe('automation')
    expect(apiArea('mc.s7.marketingcloudapps.com/contactsmeta/fuelapi/data-internal/v1/customobjects/x')).toBe('customobjects')
    expect(apiArea('somewhere/else')).toBe('other')
  })
  it('keeps simple routes and drops ids', () => {
    expect(routePattern('/queries/saved')).toBe('/queries/saved')
    expect(routePattern('/emails/email_123')).toBe('/emails/:id')
    expect(routePattern('/saved-activities/activity_query_abc')).toBe('/saved-activities/:id')
  })
  it('lists the details for the preview', () => {
    const lines = metadataLines(meta)
    expect(lines.find(([k]) => k === 'Recent errors')[1]).toMatch(/404/)
  })
})
