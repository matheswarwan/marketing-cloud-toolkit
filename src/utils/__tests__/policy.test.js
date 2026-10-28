import { describe, it, expect, beforeEach } from 'vitest'
import { normalizePolicy, POLICY_KEYS, policy, routeBlocked } from '../policy.js'
import { historyAllowed, runsForStorage } from '../history.js'
import schema from '../../../public/managed_schema.json'

describe('admin policy', () => {
  beforeEach(() => Object.assign(policy, normalizePolicy({})))

  it('only true turns a policy on', () => {
    expect(normalizePolicy({ disableShare: true, disableFeedback: 'true', disableContacts: 1, other: true }))
      .toEqual({ ...Object.fromEntries(POLICY_KEYS.map((k) => [k, false])), disableShare: true })
  })
  it('the schema lists exactly the keys the code reads, all boolean', () => {
    expect(Object.keys(schema.properties).sort()).toEqual([...POLICY_KEYS].sort())
    expect(Object.values(schema.properties).every((p) => p.type === 'boolean')).toBe(true)
  })
  it('blocks Contacts only under disableContacts', () => {
    expect(routeBlocked('/contacts')).toBe(false)
    policy.disableContacts = true
    expect(routeBlocked('/contacts')).toBe(true)
    expect(routeBlocked('/data-extensions')).toBe(false)
  })
})

describe('query history', () => {
  beforeEach(() => Object.assign(policy, normalizePolicy({})))
  const runs = [{ runId: '1', queryText: 'SELECT Email FROM X', deId: 'd1', activityId: 'a1' }]

  it('keeps the SQL while history is on', () => {
    expect(historyAllowed(undefined)).toBe(true)
    expect(runsForStorage(runs, true)).toEqual(runs)
  })
  it('drops the SQL but keeps what Delete Toolkit runs needs when off', () => {
    expect(historyAllowed(false)).toBe(false)
    expect(runsForStorage(runs, false)).toEqual([{ runId: '1', deId: 'd1', activityId: 'a1' }])
  })
  it('the policy wins over the setting', () => {
    policy.disableHistory = true
    expect(historyAllowed(true)).toBe(false)
  })
})
