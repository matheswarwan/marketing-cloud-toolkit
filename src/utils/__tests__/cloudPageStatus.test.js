import { describe, it, expect } from 'vitest'
import { toCloudPage as toCP } from '../cloudPagesApi.js'
describe('CloudPage status (feedback #158)', () => {
  it('a publish date means published, whatever the asset status says', () => {
    expect(toCP({ id: 1, status: { id: 1, name: 'Draft' }, meta: { cloudPages: { publishDate: '2026-10-21 03:56:24.203' } } }).status).toBe('Published')
    expect(toCP({ id: 2, status: { id: 1, name: 'Draft' }, meta: { cloudPages: {} } }).status).toBe('Draft')
  })
})
