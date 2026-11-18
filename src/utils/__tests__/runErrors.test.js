import { describe, it, expect } from 'vitest'
import { attributeSetNames, explainRunError } from '../runErrors.js'

describe('Explain the run error', () => {
  it('matches SFMC messages to a cause and fix', () => {
    expect(explainRunError('Divide by zero error encountered.').fix).toMatch(/NULLIF/)
    expect(explainRunError("Conversion failed when converting date and/or time from character string.").fix).toMatch(/TRY_CONVERT/)
    expect(explainRunError('Violation of PRIMARY KEY constraint \'PK_123\'. Cannot insert duplicate key in object').fix).toMatch(/ROW_NUMBER/)
    expect(explainRunError("Invalid length parameter passed to the LEFT or SUBSTRING function.").cause).toMatch(/CHARINDEX/)
    expect(explainRunError("'NOW' is not a recognized built-in function name.").fix).toMatch(/GETDATE/)
  })

  it('reads the SQL when SFMC gives no reason', () => {
    const r = explainRunError('Automation failed due to system error', "SELECT a / b AS r, LEFT(e, CHARINDEX('@', e) - 1) AS u FROM x -- end")
    expect(r.sqlHints.join(' ')).toMatch(/NULLIF\(divisor, 0\)/)
    expect(r.sqlHints.join(' ')).toMatch(/CHARINDEX/)
    expect(r.sqlHints.join(' ')).toMatch(/-- comment/)
    expect(explainRunError('Automation failed due to system error', 'SELECT a FROM x')).toBe(null)
  })

  it('stays out of session and known errors', () => {
    expect(explainRunError('SESSION_EXPIRED')).toBe(null)
    expect(explainRunError('Something nobody knows')).toBe(null)
  })
})

describe('ntext errors (feedback #1085)', () => {
  it('explains DISTINCT on an ntext column', () => {
    const r = explainRunError('An error occurred while checking the query syntax. Errors: The ntext data type cannot be selected as DISTINCT because it is not comparable.')
    expect(r.cause).toMatch(/ntext/)
    expect(r.fix).toMatch(/NVARCHAR\(4000\)/)
  })
  it('explains sorting and = on ntext', () => {
    expect(explainRunError('The text, ntext, and image data types cannot be compared or sorted, except when using IS NULL or LIKE operator.').fix).toMatch(/CAST/)
    expect(explainRunError('The data types ntext and varchar are incompatible in the equal to operator.').fix).toMatch(/CAST/)
  })
})

describe('attribute set names used as tables (feedback #1105)', () => {
  const msg = 'An error occurred while checking the query syntax. Errors: [Contact] is not a known data extension or system data view. You can only query existing data extensions or system data views. [Email] is not a known data extension or system data view.'
  it('says Contact and Email are attribute sets and points to _Subscribers', () => {
    expect(attributeSetNames(msg)).toEqual(['Contact', 'Email'])
    const r = explainRunError(msg)
    expect(r.cause).toMatch(/\[Contact\] and \[Email\] are Contact Builder attribute set names/)
    expect(r.fix).toMatch(/_Subscribers/)
  })
  it('keeps the general advice for other unknown names', () => {
    const r = explainRunError('[My_DE] is not a known data extension or system data view.')
    expect(r.cause).toMatch(/data extension name is wrong/)
    expect(attributeSetNames("Invalid object name 'Email Addresses'.")).toEqual(['Email Addresses'])
  })
})
