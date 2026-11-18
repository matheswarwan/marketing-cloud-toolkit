import { describe, it, expect, beforeEach } from 'vitest'
import {
  effectiveStart, addChoice, cleanChoices, parseStartSetting, CHOICES_KEPT,
  beginOpening, endOpening, choiceForRun, noteChoice, START_SETTING, CHOICES_KEY,
} from '../runQueryStart.js'

let store
beforeEach(() => {
  store = {}
  globalThis.chrome = {
    storage: { local: {
      get: (keys, cb) => cb(Object.fromEntries([].concat(keys).filter((k) => k in store).map((k) => [k, store[k]]))),
      set: (obj) => Object.assign(store, obj),
    } },
  }
  endOpening()
})

describe('effectiveStart', () => {
  it('follows a picked setting', () => {
    expect(effectiveStart('empty', [])).toBe('empty')
    expect(effectiveStart('last', ['fresh', 'fresh', 'fresh'])).toBe('last')
  })
  it('learns only after enough choices, and when fresh wins', () => {
    expect(effectiveStart('auto', ['fresh', 'fresh'])).toBe('last')
    expect(effectiveStart('auto', ['fresh', 'fresh', 'fresh'])).toBe('empty')
    expect(effectiveStart('auto', ['fresh', 'kept', 'fresh', 'kept'])).toBe('last')
    expect(effectiveStart(undefined, ['fresh', 'kept', 'fresh'])).toBe('empty')
  })
  it('keeps the last 10 choices and drops junk', () => {
    let list = []
    for (let i = 0; i < 15; i++) list = addChoice(list, i < 8 ? 'fresh' : 'kept')
    expect(list).toHaveLength(CHOICES_KEPT)
    expect(cleanChoices(['x', 'fresh', 3])).toEqual(['fresh'])
    expect(parseStartSetting('weird')).toBe('auto')
  })
})

describe('one opening', () => {
  it('counts a run of a reopened query as kept, other panels not at all', () => {
    beginOpening('last', ['sql_a'])
    expect(choiceForRun('sql_new')).toBe(null)
    expect(choiceForRun('sql_a')).toBe('kept')
  })
  it('counts a run after opening empty as fresh', () => {
    beginOpening('empty')
    expect(choiceForRun('sql_new')).toBe('fresh')
  })
  it('records only the first choice, and reports when auto flips', async () => {
    store[CHOICES_KEY] = ['fresh', 'fresh']
    beginOpening('last', ['sql_a'])
    expect(await noteChoice('fresh')).toEqual({ changedTo: 'empty' })
    expect(await noteChoice('fresh')).toBe(null) // no opening pending
    expect(store[CHOICES_KEY]).toEqual(['fresh', 'fresh', 'fresh'])
  })
  it('records but never reports a flip when a setting is picked', async () => {
    store[START_SETTING] = 'last'
    store[CHOICES_KEY] = ['fresh', 'fresh']
    beginOpening('last', ['sql_a'])
    expect(await noteChoice('fresh')).toBe(null)
    expect(choiceForRun('sql_a')).toBe(null)
  })
})
