import { describe, it, expect } from 'vitest'
import { SFMC_APPS, resolveUrl } from '../apps.js'

describe('dataUi app (feedback #68)', () => {
  it('is known for mc-data-ui URLs but on demand only', () => {
    const r = resolveUrl('https://mc-data-ui.s4.marketingcloudapps.com/fuelapi/data/v1/customobjects/storageDetails')
    expect(r.app?.id).toBe('dataUi')
    expect(r.stack).toBe('s4')
    const app = SFMC_APPS.find((a) => a.id === 'dataUi')
    expect(app.onDemand).toBe(true)
    expect(app.bearer).toBe(true)
  })
})
