import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('export file names (feedback #39)', () => {
  beforeEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

  it('is business unit, what, date and time', async () => {
    vi.stubGlobal('chrome', { runtime: { lastError: null, sendMessage: (m, cb) => cb({ data: { name: 'Northwind', accountId: 1 } }) } })
    const { exportBaseName } = await import('../exportName.js')
    expect(await exportBaseName('s13', 'data-extensions-orders', new Date(2026, 9, 20, 5, 3))).toBe('Northwind_data-extensions-orders_2026-10-20_0503')
  })

  it('leaves the business unit out when there is no stack, and uses the stack when the BU cannot be read', async () => {
    vi.stubGlobal('chrome', { runtime: { lastError: null, sendMessage: (m, cb) => cb({ error: 'no session' }) } })
    const { exportBaseName } = await import('../exportName.js')
    const d = new Date(2026, 0, 2, 9, 7)
    expect(await exportBaseName(null, 'Hot Price', d)).toBe('Hot_Price_2026-01-02_0907')
    expect(await exportBaseName('s7', 'x', d)).toBe('s7_x_2026-01-02_0907')
  })
})
