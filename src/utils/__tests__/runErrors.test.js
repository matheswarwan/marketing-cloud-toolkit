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

describe('old style join error (feedback #1121)', () => {
  it('explains the SFMC message', () => {
    const msg = 'An error occurred while checking the query syntax. Errors: Old style JOIN (ANSI JOINs) syntax is not allowed. Please use standard syntax.'
    const r = explainRunError(msg, 'SELECT a.x FROM a, b WHERE a.id = b.id')
    expect(r.cause).toMatch(/commas in FROM/)
    expect(r.fix).toMatch(/INNER JOIN/)
  })
})
