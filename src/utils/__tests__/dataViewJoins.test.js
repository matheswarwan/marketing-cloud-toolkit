import { describe, it, expect } from 'vitest'
import { dataViewJoin, DATA_VIEW_FIELDS } from '../dataViews.js'
import { suggestJoinConditions } from '../sqlBuilder.js'

const dv = (name) => ({ name, isDataView: true, fields: DATA_VIEW_FIELDS[name.toUpperCase()] })
const on = (conds) => conds && conds.map((c) => `${c.leftField}=${c.rightField}`).join(' AND ')

describe('data view joins (feedback #18)', () => {
  it('joins the chain _Journey > _JourneyActivity > _Job > _Sent', () => {
    expect(on(suggestJoinConditions(dv('_Journey'), dv('_JourneyActivity')))).toBe('VersionID=VersionID')
    expect(on(suggestJoinConditions(dv('_JourneyActivity'), dv('_Job')))).toBe('JourneyActivityObjectID=TriggererSendDefinitionObjectID')
    expect(on(suggestJoinConditions(dv('_Job'), dv('_Sent')))).toBe('JobID=JobID')
  })
  it('works in either order', () => {
    expect(on(suggestJoinConditions(dv('_Sent'), dv('_JourneyActivity')))).toBe('TriggererSendDefinitionObjectID=JourneyActivityObjectID')
    expect(on(suggestJoinConditions(dv('_Sent'), dv('_Job')))).toBe('JobID=JobID')
  })
  it('matches one send across tracking views on all four keys', () => {
    expect(on(suggestJoinConditions(dv('_Sent'), dv('_Open')))).toBe('JobID=JobID AND ListID=ListID AND BatchID=BatchID AND SubscriberID=SubscriberID')
  })
  it('joins automation instances on the instance, not MemberID', () => {
    expect(on(suggestJoinConditions(dv('_AutomationInstance'), dv('_AutomationActivityInstance')))).toBe('AutomationInstanceID=AutomationInstanceID')
  })
  it('joins subscribers on SubscriberKey and enterprise attributes on _SubscriberID', () => {
    expect(on(suggestJoinConditions(dv('_Subscribers'), dv('_Bounce')))).toBe('SubscriberKey=SubscriberKey')
    expect(on(dataViewJoin(dv('_EnterpriseAttribute'), dv('_Subscribers')))).toBe('_SubscriberID=SubscriberID')
  })
  it('leaves data extensions to the column-name match', () => {
    expect(dataViewJoin({ name: 'My DE', fields: [{ name: 'SubscriberKey' }] }, dv('_Sent'))).toBeNull()
    expect(on(suggestJoinConditions({ name: 'My DE', fields: [{ name: 'SubscriberKey' }] }, dv('_Sent')))).toBe('SubscriberKey=SubscriberKey')
  })
})

describe('data view joins before fields load (feedback #52)', () => {
  it('joins _Click and _Job on JobID with no fields loaded yet', async () => {
    const { suggestJoinConditions } = await import('../sqlBuilder.js')
    expect(suggestJoinConditions({ name: '_Click', fields: [] }, { name: '_Job', fields: [] }))
      .toEqual([{ leftField: 'JobID', operator: '=', rightField: 'JobID' }])
    expect(dataViewJoin({ name: 'ENT._Subscribers' }, { name: '_Sent', fields: [] }))
      .toEqual([{ leftField: 'SubscriberKey', operator: '=', rightField: 'SubscriberKey' }])
  })
})
