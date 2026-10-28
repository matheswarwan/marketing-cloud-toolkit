import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('../../../utils/deApi.js', () => ({
  fetchDEFieldList: vi.fn(async () => [
    { name: 'SubscriberKey', type: 'Text', length: 254, isPrimaryKey: true, isNullable: false },
    { name: 'First Name', type: 'Text', length: 50, isNullable: true },
  ]),
  fieldTypeLabel: (f) => (f.length ? `${f.type} (${f.length})` : f.type),
}))

function fakeEditor() {
  const inserted = []
  return {
    inserted,
    searchTables: vi.fn(async () => [
      { name: '_Sent', kind: 'dataview' },
      { name: 'Master DE', kind: 'de', id: '42', sourceType: 'shared' },
    ]),
    insertText: (t) => { inserted.push(t); return true },
    fieldFor: (table, field) => `m.[${field}]<${table}>`,
    insertAllFields: vi.fn(async () => ({ ok: true })),
  }
}

describe('Schema search beside Run Query (feedback #72)', () => {
  it('finds a DE, shows its fields with type and key, and inserts a field and the ENT. name', async () => {
    const { default: SchemaPanel } = await import('../SchemaPanel.vue')
    const editor = fakeEditor()
    const w = mount(SchemaPanel, { props: { editor, stack: 's13' } })
    await w.find('input').setValue('mast')
    await new Promise((r) => setTimeout(r, 300))
    await flushPromises()
    const rows = w.findAll('li button')
    expect(rows.map((r) => r.text())).toEqual(['_Sentdata view', 'Master DEShared'])
    await rows[1].trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Text (254), required')
    const fields = w.findAll('li button')
    expect(fields[0].text()).toContain('SubscriberKey')
    await fields[1].trigger('click')
    expect(editor.inserted.at(-1)).toBe('m.[First Name]<ENT.Master DE>')
    await w.findAll('button').find((b) => b.text() === 'Insert name').trigger('click')
    expect(editor.inserted.at(-1)).toBe('ENT.[Master DE]')
    await w.findAll('button').find((b) => b.text().includes('All fields')).trigger('click')
    expect(editor.insertAllFields).toHaveBeenCalledWith('ENT.Master DE')
  })

  it('lists a data view\'s fields without calling SFMC', async () => {
    const { default: SchemaPanel } = await import('../SchemaPanel.vue')
    const editor = fakeEditor()
    const w = mount(SchemaPanel, { props: { editor, stack: 's13' } })
    await w.find('input').setValue('_se')
    await new Promise((r) => setTimeout(r, 300))
    await flushPromises()
    await w.findAll('li button')[0].trigger('click')
    await flushPromises()
    expect(w.text()).toContain('JobID')
    expect(w.text()).toContain('Number')
  })
})
