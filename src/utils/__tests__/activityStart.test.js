import { describe, it, expect } from 'vitest'
import { startRequest, startTarget, START_TYPES } from '../activityStart.js'
import { describeActivity } from '../activityTypes.js'

describe('Run once (feedback #135, #136)', () => {
  it('builds the data extract request as Automation Studio sends it', () => {
    expect(startRequest('s50', 73, '68edda47-ba4a-4e4c-8ec9-d7d5ac77a9b3')).toEqual({
      url: 'https://mc.s50.marketingcloudapps.com/AutomationStudioFuel3/fuelapi/automation/v1/dataextracts/68edda47-ba4a-4e4c-8ec9-d7d5ac77a9b3/actions/start',
      body: { dataExtractDefinitionId: '68edda47-ba4a-4e4c-8ec9-d7d5ac77a9b3' },
    })
  })
  it('uses each type\'s id field, and refuses other types', () => {
    expect(startRequest('s13', 43, 'i1')).toMatchObject({ url: expect.stringContaining('/automation/v1/imports/i1/actions/start'), body: { importDefinitionId: 'i1' } })
    expect(startRequest('s13', 423, 'x').body).toEqual({ ssjsActivityId: 'x' })
    expect(startRequest('s13', 53, 'f').url).toContain('/filetransfers/f/actions/start')
    expect(() => startRequest('s13', 300, 'q')).toThrow()
    expect(START_TYPES[73].tested).toBe(true)
    expect(START_TYPES[43].tested).toBe(false)
  })
  it('finds the id on a record or an automation step', () => {
    expect(startTarget(73, { dataExtractDefinitionId: 'd1' })).toEqual({ typeId: 73, id: 'd1', label: 'Data Extract', tested: true })
    expect(startTarget(423, { _fromStep: true, activityObjectId: 's9' })?.id).toBe('s9')
    expect(startTarget(43, {})).toBeNull()
    expect(startTarget(300, { queryDefinitionId: 'q' })).toBeNull()
  })
  it('is on the activity description', () => {
    expect(describeActivity(73, { name: 'X', dataExtractDefinitionId: 'd1' }, 's13').start?.id).toBe('d1')
    expect(describeActivity(300, { name: 'Q', queryDefinitionId: 'q1' }, 's13').start).toBeNull()
  })
})
