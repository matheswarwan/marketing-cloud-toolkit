import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { toMarkdown, toHtml, toDocxDocumentXml, toDocxBlob, uniqueSheetNames, safeFileName } from '../exportDoc.js'

const now = new Date(2026, 9, 14, 9, 0)
const doc = {
  title: 'Daily load',
  blocks: [
    { type: 'h', level: 2, text: 'Schedule' },
    { type: 'kv', rows: [['Status', 'Active'], ['Next run', '15 Oct']] },
    { type: 'table', columns: ['Step', 'Activity'], rows: [['1', 'Query | with pipe'], ['2', 'line1\nline2']] },
    { type: 'code', text: "SELECT 1 AS x -- <tag> & 'q'", lang: 'sql' },
    { type: 'table', columns: ['Empty'], rows: [] },
  ],
}

describe('exportDoc', () => {
  it('writes Markdown with escaped tables and fenced code', () => {
    const md = toMarkdown(doc, now)
    expect(md).toContain('# Daily load')
    expect(md).toContain('## Schedule')
    expect(md).toContain('| Property | Value |\n| --- | --- |\n| Status | Active |')
    expect(md).toContain('| 1 | Query \\| with pipe |')
    expect(md).toContain('| 2 | line1<br>line2 |')
    expect(md).toContain("```sql\nSELECT 1 AS x -- <tag> & 'q'\n```")
    expect(md).toContain('_None._')
  })

  it('escapes HTML', () => {
    const html = toHtml(doc, now)
    expect(html).toContain('<title>Daily load</title>')
    expect(html).toContain('-- &lt;tag&gt; &amp; &#39;q&#39;')
    expect(html).not.toContain('<tag>')
  })

  it('builds a valid Word document', async () => {
    const xml = toDocxDocumentXml({ title: 'A & B', blocks: [{ type: 'p', text: 'bad \u0001 char <x>' }] }, now)
    expect(xml).toContain('A &amp; B')
    expect(xml).toContain('bad  char &lt;x&gt;')
    const zip = await JSZip.loadAsync(await (await toDocxBlob(doc)).arrayBuffer())
    expect(Object.keys(zip.files).sort()).toEqual(['[Content_Types].xml', '_rels/', '_rels/.rels', 'word/', 'word/document.xml'])
  })

  it('makes Excel sheet names valid and unique', () => {
    expect(uniqueSheetNames(['Index', 'A/B:C', 'x'.repeat(40), 'x'.repeat(40), 'index'])).toEqual([
      'Index', 'A_B_C', 'x'.repeat(31), 'x'.repeat(27) + '(2)', 'index(2)',
    ])
  })

  it('makes safe file names', () => {
    expect(safeFileName('My: DE / list?')).toBe('My_DE_list_')
    expect(safeFileName('a\\b')).toBe('a_b')
  })
})
