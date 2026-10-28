import { describe, it, expect } from 'vitest'
import { explainRunError } from '../runErrors.js'

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
