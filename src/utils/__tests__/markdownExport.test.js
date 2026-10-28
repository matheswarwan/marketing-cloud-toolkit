import { describe, it, expect } from 'vitest'
import { buildResultsMarkdown } from '../markdownExport.js'

describe('buildResultsMarkdown', () => {
  it('includes the title, SQL block and a table', () => {
    const md = buildResultsMarkdown({
      title: 'Opens', sql: 'SELECT a FROM x', columns: ['a', 'b'], rows: [{ a: 1, b: 'two' }],
    })
    expect(md).toContain('# Opens')
    expect(md).toContain('```sql\nSELECT a FROM x\n```')
    expect(md).toContain('| a | b |\n| --- | --- |\n| 1 | two |')
    expect(md).toContain('1 row.')
  })

  it('escapes pipes and newlines in cells', () => {
    const md = buildResultsMarkdown({ columns: ['a'], rows: [{ a: 'x|y\nz' }] })
    expect(md).toContain('| x\\|y<br>z |')
  })

  it('caps the rows and says so', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ a: i }))
    const md = buildResultsMarkdown({ columns: ['a'], rows, maxRows: 2, totalCount: 5000 })
    expect(md).toContain('5,000 rows; the first 2 are shown.')
    expect(md.match(/^\| \d \|$/gm)).toHaveLength(2)
  })

  it('handles no rows', () => {
    expect(buildResultsMarkdown({ columns: [], rows: [] })).toContain('No rows returned.')
  })
})
