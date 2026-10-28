import { describe, it, expect } from 'vitest'
import { describeActivity, activityEndpoint, formatValue, activityBlocks, activityTypeLabel } from '../activityTypes.js'

const rows = (pairs) => Object.fromEntries(pairs)

describe('activityTypes', () => {
  it('describes a query with its SQL, link and extra fields', () => {
    const d = describeActivity(300, {
      name: 'Daily load', queryDefinitionId: 'q-1', description: '', queryText: 'SELECT 1', targetName: 'Target DE',
      targetUpdateTypeId: 2, targetKey: 'TK', isFrozen: false, somethingNew: { a: 1 },
    }, 's10')
    expect(d.typeLabel).toBe('SQL Query')
    expect(d.title).toBe('Daily load')
    expect(d.link).toBe('https://mc.s10.exacttarget.com/cloud/#app/Automation%20Studio/AutomationStudioFuel3/%23ActivityDetails/300/q-1')
    expect(rows(d.main)).toMatchObject({ Description: '—', Target: 'Target DE', 'Update type': 'Update Only' })
    expect(rows(d.extra)).toMatchObject({ 'Target key': 'TK', Frozen: 'No', 'Something New': '{"a":1}' })
    expect(d.code).toEqual({ label: 'SQL', text: 'SELECT 1', lang: 'sql' })
  })

  it('calls a filter a filter and shows its definition', () => {
    const d = describeActivity(303, { name: 'F', filterActivityId: 'f-1', additionalStepDetails: { derivedFromObjectName: 'Src' } }, 's10')
    expect(d.typeLabel).toBe('Filter')
    expect(d.tables[0]).toEqual({ title: 'Filter definition', columns: ['Property', 'Value'], rows: [['Derived From Object Name', 'Src']], extra: false })
  })

  it('maps import destination and update types', () => {
    const d = describeActivity(43, { name: 'Imp', destinationObjectTypeId: 310, updateTypeId: 3, fieldMappings: [{ name: 'A', type: 'Ordinal', value: '1' }] }, 's10')
    expect(rows(d.main)).toMatchObject({ 'Destination type': 'Data Extension', 'Update type': 'Add and Update' })
    expect(d.tables[0]).toMatchObject({ title: 'Field mappings', rows: [['A', 'Ordinal', '1']], extra: true })
  })

  it('shows every field for types without a view, with a note when only the step is known', () => {
    const d = describeActivity(736, { name: 'Push', activityObjectId: 'x', objectTypeId: 736, _fromStep: true, isActive: true, messageId: 9 }, 's10')
    expect(d.typeLabel).toBe('Mobile Push')
    expect(d.main).toEqual([['Message Id', '9']])
    expect(d.note).toMatch(/no API/)
    expect(activityTypeLabel(99999)).toBe('Type 99999')
  })

  it('a Salesforce Send shows its name, not [object Object]', () => {
    expect(describeActivity(771, { name: 'SF send', _fromStep: true }, 's10').title).toBe('SF send')
  })

  it('knows which types have an endpoint', () => {
    expect(activityEndpoint('s10', { objectTypeId: 423, activityObjectId: 'abc' })).toBe('https://mc.s10.marketingcloudapps.com/AutomationStudioFuel3/fuelapi/automation/v1/scripts/abc')
    expect(activityEndpoint('s10', { objectTypeId: 42, activityObjectId: 'e' })).toContain('/messaging-internal/v1/emailsenddefinition/e')
    expect(activityEndpoint('s10', { objectTypeId: 467, activityObjectId: 'w' })).toBeNull()
    expect(activityEndpoint('s10', { objectTypeId: 771, activityObjectId: 's' })).toBeNull()
  })

  it('formats values as text', () => {
    expect([formatValue(null), formatValue(''), formatValue(true), formatValue(0), formatValue('<b>')]).toEqual(['—', '—', 'Yes', '0', '<b>'])
  })

  it('turns a description into export blocks', () => {
    const blocks = activityBlocks(describeActivity(423, { name: 'S', script: 'Platform.Load("core","1")' }, 's10'), 'Step 1.1')
    expect(blocks[0]).toEqual({ type: 'h', level: 3, text: 'Step 1.1: S' })
    expect(blocks[1].rows[0]).toEqual(['Type', 'Script'])
    expect(blocks[2]).toEqual({ type: 'code', text: 'Platform.Load("core","1")', lang: 'javascript' })
  })
})

describe('links and run data (feedback #35 to #37)', () => {
  it('describes the SQL target DE and how to run the activity', async () => {
    const { describeActivity } = await import('../activityTypes.js')
    const d = describeActivity(300, { name: 'Q', queryDefinitionId: 'q1', queryText: 'SELECT 1', targetName: 'Target_DE', targetId: 't1', targetKey: 'k1', targetUpdateTypeId: 0 }, 's13')
    expect(d.deRefs).toEqual({ Target: { name: 'Target_DE', id: 't1', key: 'k1' } })
    expect(d.run).toMatchObject({ queryDefinitionId: 'q1', sql: 'SELECT 1', targetName: 'Target_DE' })
  })
  it('leaves out DE refs without a name, and has none for other types', async () => {
    const { describeActivity } = await import('../activityTypes.js')
    expect(describeActivity(303, { name: 'F' }, 's1').deRefs).toEqual({})
    expect(describeActivity(43, { targetDataExtension: { name: 'Imp', id: 'i1' } }, 's1').deRefs['Target data extension']).toMatchObject({ name: 'Imp', id: 'i1' })
    expect(describeActivity(9999, { a: 1 }, 's1')).toMatchObject({ deRefs: {}, run: null })
  })
  it('builds Automation Studio and Contact Builder links', async () => {
    const { automationUrl, contactBuilderDEUrl } = await import('../activityTypes.js')
    expect(automationUrl('s13', 'e23117f0')).toBe('https://mc.s13.exacttarget.com/cloud/#app/Automation%20Studio/AutomationStudioFuel3/%23Instance/e23117f0')
    expect(automationUrl('s13')).toBe('https://mc.s13.exacttarget.com/cloud/#app/Automation%20Studio/AutomationStudioFuel3/')
    expect(contactBuilderDEUrl('s13', 'd1')).toBe('https://mc.s13.marketingcloudapps.com/contactsmeta/admin.html#admin/data-extension/d1/properties/')
    expect(contactBuilderDEUrl('s13', null)).toBeNull()
  })
})
