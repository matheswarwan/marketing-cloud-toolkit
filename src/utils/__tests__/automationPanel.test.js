import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SCRIPT = readFileSync(join(process.cwd(), 'public/automationPanel.js'), 'utf8')
const AUTOMATION = {
  name: 'Hot_Price_Audience', status: 6, lastRunTime: '2026-10-20T10:00:00Z', lastRunStatus: 'Complete', key: 'k1',
  schedule: { scheduleStatus: 'Scheduled', scheduledTime: '2026-10-21T10:00:00Z' },
  steps: [{ name: 'Build', activities: [{ objectTypeId: 300, name: 'Loyalty_Engaged_120D' }, { objectTypeId: 42, name: 'Weekly email' }] }],
}

function page(url, { setting, viewerTab } = {}) {
  const dom = new JSDOM(`<!doctype html><body>${viewerTab ? '<div id="query-studio-opener"></div>' : ''}</body>`, { url, runScripts: 'outside-only' })
  const sent = []
  dom.window.chrome = {
    runtime: { lastError: undefined, sendMessage: (m, cb) => { sent.push(m); setTimeout(() => cb(m.type === 'SFMC_FETCH' ? { data: AUTOMATION } : { ok: true }), 0) } },
    storage: { local: { get: (k, cb) => cb(setting === undefined ? {} : { _automationPanel: setting }) }, onChanged: { addListener() {} } },
  }
  dom.window.setInterval = () => 0
  dom.window.eval(SCRIPT)
  const host = () => dom.window.document.getElementById('sfmc-toolkit-automation-summary')
  return { dom, sent, host }
}
const tick = () => new Promise((r) => setTimeout(r, 10))
const AS = 'https://mc.s13.exacttarget.com/cloud/#app/Automation%20Studio/AutomationStudioFuel3/%23Instance/MHlaTDByMVFK'

describe('Automation Summary tab (feedback #45)', () => {
  it('shows on an automation page and loads the summary when opened', async () => {
    const { sent, host } = page(AS)
    expect(host()).toBeTruthy()
    const root = host().shadowRoot
    root.querySelector('.tab').click()
    await tick()
    expect(sent[0]).toMatchObject({ type: 'SFMC_FETCH', url: 'https://mc.s13.marketingcloudapps.com/AutomationStudioFuel3/fuelapi/automation/v1/automations/MHlaTDByMVFK' })
    const text = root.querySelector('.body').textContent
    expect(text).toContain('Hot_Price_Audience')
    expect(text).toContain('Scheduled')
    expect(text).toContain('SQL Query')
    expect(text).toContain('Loyalty_Engaged_120D')
    root.querySelector('.btn').click()
    await tick()
    expect(sent.at(-1)).toEqual({ type: 'OPEN_APP', path: '/automations/MHlaTDByMVFK' })
  })
  it('stays away from other pages, when switched off, and when Automation Viewer shows its own tab', () => {
    expect(page('https://mc.s13.exacttarget.com/cloud/#app/Automation%20Studio/AutomationStudioFuel3/').host()).toBeNull()
    expect(page(AS, { setting: false }).host()).toBeNull()
    expect(page(AS, { viewerTab: true }).host()).toBeNull()
  })
  it('puts names in as text, not HTML', async () => {
    AUTOMATION.name = '<img src=x onerror=alert(1)>'
    const { host } = page(AS)
    host().shadowRoot.querySelector('.tab').click()
    await tick()
    expect(host().shadowRoot.querySelector('img')).toBeNull()
    AUTOMATION.name = 'Hot_Price_Audience'
  })
})
