import { describe, it, expect } from 'vitest'
import { sqlRulesForAi } from '../aiRules.js'

describe('Copy SQL rules for AI', () => {
  it('lists the facts, every check and the data view joins', () => {
    const md = sqlRulesForAi()
    expect(md).toContain('# SFMC SQL rules')
    expect(md).toMatch(/- QS001 \(error\)/)
    expect(md).toContain('_Job to _Sent')
    expect(md).not.toMatch(/—/)
  })
})
