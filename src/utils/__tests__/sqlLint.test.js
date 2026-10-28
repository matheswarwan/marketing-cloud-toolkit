import { describe, it, expect } from 'vitest'
import { lintSql, applyFix, LINT_RULES, DEFAULT_DISABLED } from '../sqlLint.js'

const of = (sql, code, opts) => lintSql(sql, opts).filter(d => d.code === code)
const text = (sql, d) => sql.slice(d.from, d.to)

// Asserts `code` fires on `sql` and that one diagnostic covers exactly `covered`.
function hit(sql, code, covered, opts) {
  const ds = of(sql, code, opts)
  expect(ds.length, `${code} should fire on: ${sql}`).toBeGreaterThan(0)
  if (covered != null) expect(ds.map(d => text(sql, d))).toContain(covered)
  return ds.find(d => covered == null || text(sql, d) === covered)
}
function none(sql, code, opts) {
  expect(of(sql, code, opts), `${code} should not fire on: ${sql}`).toEqual([])
}
function fixed(sql, code, opts, which = 0) {
  const d = hit(sql, code, null, opts)
  expect(d.fixes?.length, `${code} should offer a fix`).toBeGreaterThan(0)
  return applyFix(sql, d.fixes[which])
}

describe('API', () => {
  it('returns [] for empty input and never throws on junk', () => {
    expect(lintSql('')).toEqual([])
    expect(lintSql(null)).toEqual([])
    for (const junk of ['(', ')', "'", '[', '/*', 'SELECT', 'FROM', 'SELECT ,', ',,,', 'SELECT (SELECT', 'WITH', 'SELECT a FROM (', 'SELECT * FROM x JOIN', 'SELECT a AS', 'SELECT CAST(']) {
      expect(() => lintSql(junk, { tables: { x: { name: 'x', fields: [] } }, targetName: 'x', isParentBU: true })).not.toThrow()
    }
  })

  it('sorts by from and fills code, severity and message', () => {
    const ds = lintSql("SELECT @a, N'x' AS b FROM t WHERE c = NULL")
    expect(ds.length).toBeGreaterThan(2)
    for (let i = 1; i < ds.length; i++) expect(ds[i].from).toBeGreaterThanOrEqual(ds[i - 1].from)
    for (const d of ds) {
      expect(d.code).toMatch(/^QS\d{3}$/)
      expect(['error', 'warning', 'info']).toContain(d.severity)
      expect(d.message).not.toMatch(/—/)
    }
  })

  it('LINT_RULES lists every rule once, without em dashes', () => {
    const codes = LINT_RULES.map(r => r.code)
    expect(new Set(codes).size).toBe(codes.length)
    expect(codes).toContain('QS001')
    expect(codes).toContain('QS044')
    for (const r of LINT_RULES) expect(r.title).not.toMatch(/—/)
  })

  it('options.disabled skips rules', () => {
    const sql = 'SELECT @a AS x FROM t'
    expect(of(sql, 'QS003')).toHaveLength(1)
    expect(of(sql, 'QS003', { disabled: ['QS003'] })).toHaveLength(0)
  })

  it('applyFix applies changes right to left', () => {
    expect(applyFix('abcdef', { changes: [{ from: 0, to: 1, insert: 'X' }, { from: 4, to: 6, insert: 'YZ!' }] })).toBe('XbcdYZ!')
    expect(applyFix('abc', null)).toBe('abc')
  })
})

describe('clean queries produce no errors', () => {
  const clean = [
    `SELECT s.SubscriberKey, s.JobID, o.EventDate AS OpenDate
FROM _Sent s
INNER JOIN _Open o ON o.JobID = s.JobID AND o.SubscriberKey = s.SubscriberKey
WHERE s.EventDate >= DATEADD(DAY, -7, GETDATE())`,
    `SELECT c.SubscriberKey,
  CASE WHEN c.Country IN ('US', 'CA') THEN 'North America, NA'
       WHEN c.Name = 'O''Brien' THEN 'Irish, probably'
       ELSE 'Other' END AS Region
FROM [Customer Master] c`,
    `SELECT x.SubscriberKey, x.LastPurchase
FROM (
  SELECT TOP 100 p.SubscriberKey, p.PurchaseDate AS LastPurchase
  FROM Purchases p
  ORDER BY p.PurchaseDate DESC
) x`,
    `SELECT SubscriberKey, EmailAddress
FROM (
  SELECT d.SubscriberKey, d.EmailAddress,
    ROW_NUMBER() OVER (PARTITION BY d.EmailAddress ORDER BY d.CreatedDate DESC) AS rn
  FROM [Master Subscribers] d
) ranked
WHERE rn = 1`,
    `-- Active subscribers only
/* joins the welcome DE */
SELECT w.[Subscriber Key], w.[First Name] AS FirstName, a.Status
FROM [Welcome Journey DE] w
INNER JOIN ENT._Subscribers a ON a.SubscriberKey = w.[Subscriber Key]
WHERE a.Status = 'active'`,
    `SELECT b.SubscriberKey, COUNT(b.SubscriberKey) AS BounceCount, MAX(b.EventDate) AS LastBounce
FROM _Bounce b
WHERE b.EventDate > DATEADD(DAY, -30, GETDATE()) AND b.BounceCategory = 'Hard bounce'
GROUP BY b.SubscriberKey
HAVING COUNT(b.SubscriberKey) > 2`,
    `SELECT TOP 10 PERCENT l.SubscriberKey, CONCAT(l.FirstName, ' ', l.LastName) AS FullName
FROM Leads l
WHERE NOT EXISTS (SELECT 1 FROM Unsubs u WHERE u.SubscriberKey = l.SubscriberKey)
  AND l.Email LIKE '%@example.com'
ORDER BY l.CreatedDate DESC`,
    `SELECT a.Id, a.Email
FROM Contacts a
UNION ALL
SELECT b.Id, b.Email
FROM Leads b;`,
    `SELECT CAST(o.Amount AS DECIMAL(18,2)) AS Amount, CONVERT(VARCHAR(10), o.OrderDate, 120) AS OrderDay,
  ISNULL(o.Notes, '') AS Notes
FROM Orders o
WHERE o.Status IN ('a,b', 'c') AND o.Amount IS NOT NULL`,
  ]
  for (const sql of clean) {
    it(sql.split('\n')[0].slice(0, 60), () => {
      const bad = lintSql(sql).filter(d => d.severity !== 'info')
      expect(bad.map(d => `${d.code} ${text(sql, d)}: ${d.message}`)).toEqual([])
    })
  }
})

describe('QS001 single SELECT', () => {
  it('flags INSERT, UPDATE, DELETE and friends', () => {
    hit('INSERT INTO x SELECT a FROM t', 'QS001', 'INSERT')
    hit('update t set a = 1', 'QS001', 'update')
    hit('/* c */ DELETE FROM t', 'QS001', 'DELETE')
    hit('DECLARE @a INT', 'QS001', 'DECLARE')
  })
  it('accepts SELECT', () => none('SELECT a FROM t', 'QS001'))
})

describe('QS002 more than one statement', () => {
  it('flags SQL after a semicolon', () => {
    const sql = 'SELECT a FROM t; SELECT b FROM u'
    hit(sql, 'QS002', '; SELECT b FROM u')
  })
  it('flags a GO line', () => hit('SELECT a FROM t\nGO\n', 'QS002', 'GO'))
  it('flags a second SELECT without UNION', () => hit('SELECT a FROM t SELECT b FROM u', 'QS002', 'SELECT b FROM u'))
  it('allows one trailing semicolon, UNION and comments after', () => {
    none('SELECT a FROM t;  -- done', 'QS002')
    none('SELECT a FROM t UNION ALL SELECT a FROM u', 'QS002')
    none('SELECT a AS go FROM t', 'QS002')
  })
})

describe('QS003 variables', () => {
  it('flags @x and @@x', () => {
    hit('SELECT a FROM t WHERE b = @x', 'QS003', '@x')
    hit('SELECT @@ROWCOUNT AS n', 'QS003', '@@ROWCOUNT')
  })
  it('ignores @ in strings', () => none("SELECT a FROM t WHERE e LIKE '%@x.com'", 'QS003'))
})

describe('QS004 temp tables and SELECT INTO', () => {
  it('flags #temp', () => hit('SELECT a FROM #tmp', 'QS004', '#tmp'))
  it('flags SELECT INTO', () => hit('SELECT a INTO NewDE FROM t', 'QS004', 'INTO NewDE'))
  it('accepts plain SELECT', () => none("SELECT a FROM t WHERE b = '#1'", 'QS004'))
})

describe('QS005 procedures, UDFs, dbo', () => {
  it('flags EXEC later in the text, sp_ calls and dbo.', () => {
    hit('SELECT a FROM t EXEC sp_who', 'QS005', 'EXEC sp_who')
    hit('SELECT sp_helptext(a) AS x FROM t', 'QS005', 'sp_helptext')
    hit('SELECT dbo.fnClean(a) AS x FROM t', 'QS005', 'dbo.')
  })
  it('accepts a column named like sp_', () => none('SELECT sp_code FROM t', 'QS005'))
})

describe('QS006 CTE', () => {
  it('flags WITH and rewrites a single CTE into FROM', () => {
    const sql = 'WITH recent AS (SELECT SubscriberKey FROM Opens WHERE x = 1)\nSELECT r.SubscriberKey FROM recent r'
    hit(sql, 'QS006', 'WITH recent')
    expect(fixed(sql, 'QS006')).toBe('SELECT r.SubscriberKey FROM (SELECT SubscriberKey FROM Opens WHERE x = 1) r')
  })
  it('adds the alias when the reference has none', () => {
    const sql = 'WITH c AS (SELECT a FROM t) SELECT a FROM c WHERE a > 1'
    expect(fixed(sql, 'QS006')).toBe('SELECT a FROM (SELECT a FROM t) AS c WHERE a > 1')
  })
  it('offers no fix for two references, a column list or two CTEs', () => {
    expect(hit('WITH c AS (SELECT a FROM t) SELECT x.a FROM c x JOIN c y ON x.a = y.a', 'QS006').fixes).toBeUndefined()
    expect(hit('WITH c (a) AS (SELECT a FROM t) SELECT a FROM c', 'QS006').fixes).toBeUndefined()
    expect(hit('WITH c AS (SELECT a FROM t), d AS (SELECT a FROM c) SELECT a FROM d', 'QS006').fixes).toBeUndefined()
  })
  it('does not fire on WITH (NOLOCK) or WITH TIES', () => {
    none('SELECT TOP 5 WITH TIES a FROM t WITH (NOLOCK) ORDER BY a', 'QS006')
  })
})

describe('QS007 / QS043 SELECT *', () => {
  it('errors on SELECT * with a JOIN', () => {
    const d = hit('SELECT * FROM a JOIN b ON a.id = b.id', 'QS007', '*')
    expect(d.severity).toBe('error')
    hit('SELECT * FROM a, b', 'QS007', '*')
  })
  it('warns on plain SELECT *', () => {
    hit('SELECT * FROM a', 'QS043', '*')
    none('SELECT * FROM a', 'QS007')
  })
  it('ignores t.*, COUNT(*) and EXISTS (SELECT *)', () => {
    const sql = 'SELECT a.*, COUNT(*) AS n FROM a JOIN b ON a.id = b.id WHERE EXISTS (SELECT * FROM c)'
    none(sql, 'QS007')
    none(sql, 'QS043')
  })
})

describe('QS008 column without alias', () => {
  it('flags a function call and fixes it with a derived name', () => {
    const sql = 'SELECT COUNT(*) FROM t'
    hit(sql, 'QS008', 'COUNT(*)')
    expect(fixed(sql, 'QS008')).toBe('SELECT COUNT(*) AS CountResult FROM t')
  })
  it('uses ColumnN for literals and keeps names unique', () => {
    const sql = "SELECT 'x', a AS Column1, MAX(b), MAX(c) FROM t"
    const ds = of(sql, 'QS008')
    expect(ds.map(d => text(sql, d))).toEqual(["'x'", 'MAX(b)', 'MAX(c)'])
    expect(applyFix(sql, ds[0].fixes[0])).toBe("SELECT 'x' AS Column12, a AS Column1, MAX(b), MAX(c) FROM t")
    expect(ds[1].fixes[0].changes[0].insert).toBe(' AS MaxResult')
    expect(ds[2].fixes[0].changes[0].insert).toBe(' AS MaxResult2')
  })
  it('flags CASE and computed columns in a derived table', () => {
    hit('SELECT CASE WHEN a = 1 THEN 1 ELSE 0 END FROM t', 'QS008', 'CASE WHEN a = 1 THEN 1 ELSE 0 END')
    hit('SELECT x.n FROM (SELECT a + 1 FROM t) x', 'QS008', 'a + 1')
  })
  it('accepts bare columns, aliases in every form, and unaliased scalar subqueries in WHERE', () => {
    none('SELECT a, t.b, [c d], t.*, COUNT(*) AS n, MAX(x) m, Total = SUM(y), CAST(z AS INT) AS "z" FROM t WHERE a = (SELECT MAX(a) FROM u)', 'QS008')
    none("SELECT a FROM t UNION ALL SELECT 'x' FROM u", 'QS008')
  })
})

describe('QS009 duplicate output names', () => {
  it('flags a repeated name, case-insensitive, including t.col', () => {
    hit('SELECT a.Email, b.email FROM a JOIN b ON a.id = b.id', 'QS009', 'email')
    hit('SELECT x AS Name, y AS NAME FROM t', 'QS009', 'NAME')
  })
  it('accepts distinct names', () => none('SELECT a.Email, b.Email AS Email2 FROM a JOIN b ON a.id = b.id', 'QS009'))
})

describe('QS010 empty select list or stray comma', () => {
  it('flags and removes a trailing comma', () => {
    const sql = 'SELECT a, b,\nFROM t'
    hit(sql, 'QS010', ',')
    expect(fixed(sql, 'QS010')).toBe('SELECT a, b\nFROM t')
  })
  it('flags an empty list and double commas', () => {
    hit('SELECT FROM t', 'QS010', 'SELECT')
    hit('SELECT a,, b FROM t', 'QS010', ',')
  })
  it('ignores commas inside functions and strings', () => none("SELECT CONCAT(a, ','), b FROM t", 'QS010'))
})

describe('QS011 ORDER BY in a subquery', () => {
  it('flags ORDER BY without TOP in a derived table', () => {
    hit('SELECT x.a FROM (SELECT a FROM t ORDER BY a) x', 'QS011', 'ORDER BY')
  })
  it('accepts TOP, OFFSET, OVER (ORDER BY) and a top-level ORDER BY', () => {
    none('SELECT x.a FROM (SELECT TOP 5 a FROM t ORDER BY a) x', 'QS011')
    none('SELECT x.a FROM (SELECT a FROM t ORDER BY a OFFSET 0 ROWS) x', 'QS011')
    none('SELECT ROW_NUMBER() OVER (ORDER BY a) AS rn FROM t ORDER BY a', 'QS011')
  })
})

describe('QS012 TOP without ORDER BY', () => {
  it('flags it', () => hit('SELECT TOP 10 a FROM t', 'QS012', 'TOP'))
  it('accepts TOP with ORDER BY', () => none('SELECT TOP 10 a FROM t ORDER BY a', 'QS012'))
})

describe('QS013 / QS044 output name as DE field name', () => {
  it('errors on bad characters, all digits and over 128 characters', () => {
    hit('SELECT a AS [Price ($)] FROM t', 'QS013', '[Price ($)]')
    hit('SELECT a AS [123] FROM t', 'QS013', '[123]')
    const long = 'x'.repeat(129)
    hit(`SELECT a AS ${long} FROM t`, 'QS013', long)
  })
  it('warns on a leading underscore and mentions the rename', () => {
    const d = hit('SELECT _ContactKey FROM t', 'QS044', '_ContactKey')
    expect(d.message).toContain('t_ContactKey')
    none('SELECT _ContactKey FROM t', 'QS013')
  })
  it('accepts spaces, dots, hyphens and underscores', () => {
    none('SELECT a AS [First Name], b AS [e-mail.addr], c AS Sub_Key FROM t', 'QS013')
    none('SELECT a AS [First Name] FROM t', 'QS044')
  })
})

describe('QS014 select alias in WHERE / GROUP BY / HAVING', () => {
  it('errors in WHERE and GROUP BY, warns in HAVING', () => {
    const sql = 'SELECT DATEDIFF(DAY, b, GETDATE()) AS Age, COUNT(*) AS n FROM t WHERE Age > 5 GROUP BY Age HAVING n > 1'
    const ds = of(sql, 'QS014')
    expect(ds.map(d => [text(sql, d), d.severity])).toEqual([['Age', 'error'], ['Age', 'error'], ['n', 'warning']])
  })
  it('skips names that are real columns of a known table', () => {
    const tables = { t: { name: 't', fields: [{ name: 'Age', type: 1 }] } }
    none('SELECT a + 1 AS Age FROM t WHERE Age > 5', 'QS014', { tables })
  })
  it('ignores qualified references and subqueries', () => {
    none('SELECT a AS x FROM t WHERE t.x = 1 AND b IN (SELECT x FROM u)', 'QS014')
  })
})

describe('QS015 text vs number comparison', () => {
  const tables = { contacts: { name: 'Contacts', fields: [{ name: 'Id', type: 0 }, { name: 'Code', type: 0 }] } }
  it('flags a text column compared with a number column', () => {
    hit('SELECT c.Id FROM Contacts c JOIN _Sent s ON s.SubscriberID = c.Id', 'QS015', 's.SubscriberID = c.Id', { tables })
  })
  it('accepts same types and unknown types', () => {
    none('SELECT c.Id FROM Contacts c JOIN _Sent s ON s.SubscriberKey = c.Id', 'QS015', { tables })
    none('SELECT c.Id FROM Other c JOIN _Sent s ON s.SubscriberID = c.Id', 'QS015', { tables })
  })
})

describe('QS016 unbracketed names with spaces or hyphens', () => {
  it('flags and brackets a hyphenated name', () => {
    const sql = 'SELECT a FROM My-DE x'
    hit(sql, 'QS016', 'My-DE')
    expect(fixed(sql, 'QS016')).toBe('SELECT a FROM [My-DE] x')
  })
  it('flags three bare words and a known name with a space', () => {
    expect(fixed('SELECT a FROM My Data Extension WHERE a = 1', 'QS016')).toBe('SELECT a FROM [My Data Extension] WHERE a = 1')
    const tables = { 'my de': { name: 'My DE', fields: [] } }
    expect(fixed('SELECT a FROM My DE', 'QS016', { tables })).toBe('SELECT a FROM [My DE]')
  })
  it('accepts a name with an alias, brackets and ENT.', () => {
    none('SELECT a FROM MyDE d JOIN [My-DE] e ON d.a = e.a JOIN ENT.Other o ON o.a = d.a', 'QS016')
    none('SELECT a FROM t WHERE a - b > 0', 'QS016')
  })
})

describe('QS017 reserved word as alias', () => {
  it('flags and brackets AS Order / AS Key / AS Date', () => {
    const sql = 'SELECT a AS Order, b AS Key FROM t'
    hit(sql, 'QS017', 'Order')
    expect(fixed(sql, 'QS017')).toBe('SELECT a AS [Order], b AS Key FROM t')
    hit('SELECT d AS Date FROM t', 'QS017', 'Date')
  })
  it('ignores CAST(x AS DATE) and bracketed aliases', () => {
    none('SELECT CAST(x AS DATE) AS [Date], y AS OrderNo FROM t AS src', 'QS017')
  })
})

describe('QS018 MID prefix', () => {
  it('flags 12345.MyDE and replaces it with ENT.', () => {
    const sql = 'SELECT a FROM 12345.MyDE'
    hit(sql, 'QS018', '12345.MyDE')
    expect(fixed(sql, 'QS018')).toBe('SELECT a FROM ENT.MyDE')
  })
  it('offers no fix in the parent BU', () => {
    expect(hit('SELECT a FROM [12345].MyDE', 'QS018', null, { isParentBU: true }).fixes).toBeUndefined()
  })
  it('accepts ENT.MyDE and decimals', () => none('SELECT a FROM ENT.MyDE WHERE b > 1.5', 'QS018'))
})

describe('QS019 = NULL', () => {
  it('fixes = NULL and <> NULL', () => {
    expect(fixed('SELECT a FROM t WHERE b = NULL', 'QS019')).toBe('SELECT a FROM t WHERE b IS NULL')
    expect(fixed('SELECT a FROM t WHERE b <> NULL', 'QS019')).toBe('SELECT a FROM t WHERE b IS NOT NULL')
    hit('SELECT a FROM t WHERE b != NULL', 'QS019', '!= NULL')
  })
  it('accepts IS NULL and the alias = NULL select form', () => {
    none('SELECT Empty = NULL, a FROM t WHERE b IS NULL', 'QS019')
  })
})

describe('QS020 NOT IN subquery', () => {
  it('flags it', () => hit('SELECT a FROM t WHERE a NOT IN (SELECT a FROM u)', 'QS020', 'NOT IN'))
  it('accepts NOT IN with a list and IN subquery', () => {
    none("SELECT a FROM t WHERE a NOT IN ('x', 'y') AND b IN (SELECT b FROM u)", 'QS020')
  })
})

describe('QS021 LIKE without wildcard', () => {
  it('fixes LIKE and NOT LIKE', () => {
    expect(fixed("SELECT a FROM t WHERE b LIKE 'abc'", 'QS021')).toBe("SELECT a FROM t WHERE b = 'abc'")
    expect(fixed("SELECT a FROM t WHERE b NOT LIKE 'abc'", 'QS021')).toBe("SELECT a FROM t WHERE b <> 'abc'")
  })
  it('accepts % _ and [ patterns', () => {
    none("SELECT a FROM t WHERE b LIKE 'a%' OR c LIKE 'a_c' OR d LIKE '[ab]x'", 'QS021')
  })
})

describe('QS022 + concatenation', () => {
  it('flags + next to a string literal, once per chain', () => {
    const sql = "SELECT a + ' ' + b + '!' AS x FROM t"
    const ds = of(sql, 'QS022')
    expect(ds).toHaveLength(1)
    expect(text(sql, ds[0])).toBe("+ ' ' + b +")
    expect(of("SELECT a + 'x' AS p, b + 'y' AS q FROM t", 'QS022')).toHaveLength(2)
  })
  it('accepts numeric + and CONCAT', () => none("SELECT a + 1 AS x, CONCAT(a, ' ', b) AS y FROM t", 'QS022'))
})

describe('QS023 server time', () => {
  it('notes GETDATE() and CURRENT_TIMESTAMP', () => {
    hit('SELECT GETDATE() AS now FROM t', 'QS023', 'GETDATE()')
    const d = hit('SELECT CURRENT_TIMESTAMP AS now', 'QS023', 'CURRENT_TIMESTAMP')
    expect(d.severity).toBe('info')
  })
  it('stays quiet for GETUTCDATE() and an explicit AT TIME ZONE', () => {
    none("SELECT GETUTCDATE() AS a, GETDATE() AT TIME ZONE 'Central America Standard Time' AS b", 'QS023')
  })
})

describe('QS024 Central Standard Time', () => {
  it('flags and fixes it on server time', () => {
    const sql = "SELECT GETDATE() AT TIME ZONE 'Central Standard Time' AS t"
    hit(sql, 'QS024', "AT TIME ZONE 'Central Standard Time'")
    expect(fixed(sql, 'QS024')).toBe("SELECT GETDATE() AT TIME ZONE 'Central America Standard Time' AS t")
  })
  it('accepts it as the second step of a real conversion', () => {
    none("SELECT x AT TIME ZONE 'UTC' AT TIME ZONE 'Central Standard Time' AS t FROM y", 'QS024')
  })
})

describe('QS025 DECIMAL without precision', () => {
  it('flags CAST and CONVERT and adds (18,2)', () => {
    const sql = 'SELECT CAST(a AS DECIMAL) AS x FROM t'
    hit(sql, 'QS025', 'DECIMAL')
    expect(fixed(sql, 'QS025')).toBe('SELECT CAST(a AS DECIMAL(18,2)) AS x FROM t')
    hit('SELECT CONVERT(NUMERIC, a) AS x FROM t', 'QS025', 'NUMERIC')
  })
  it('accepts DECIMAL(p,s)', () => none('SELECT CAST(a AS DECIMAL(10, 2)) AS x, CONVERT(NUMERIC(5), b) AS y FROM t', 'QS025'))
})

describe('QS026 column not grouped', () => {
  it('flags a bare column missing from GROUP BY', () => {
    hit('SELECT a, b, COUNT(*) AS n FROM t GROUP BY a', 'QS026', 'b')
  })
  it('matches t.col with col and skips ROLLUP', () => {
    none('SELECT t.a, b, COUNT(*) AS n FROM t GROUP BY a, t.b', 'QS026')
    none('SELECT a, b, COUNT(*) AS n FROM t GROUP BY ROLLUP(a)', 'QS026')
  })
})

describe('QS027 tracking view without filter', () => {
  it('adds a WHERE when there is none', () => {
    const sql = 'SELECT o.SubscriberKey FROM _Open o'
    hit(sql, 'QS027', '_Open')
    expect(fixed(sql, 'QS027')).toBe('SELECT o.SubscriberKey FROM _Open o WHERE o.EventDate >= DATEADD(DAY, -30, GETDATE())')
  })
  it('wraps an existing WHERE', () => {
    const sql = "SELECT SubscriberKey FROM ENT._Click WHERE a = 1 OR b = 'x' GROUP BY SubscriberKey"
    expect(fixed(sql, 'QS027')).toBe("SELECT SubscriberKey FROM ENT._Click WHERE _Click.EventDate >= DATEADD(DAY, -30, GETDATE()) AND (a = 1 OR b = 'x') GROUP BY SubscriberKey")
  })
  it('flags _Job without a fix', () => {
    expect(hit('SELECT j.EmailName FROM _Job j', 'QS027', '_Job').fixes).toBeUndefined()
  })
  it('accepts EventDate, JobID and other DEs', () => {
    none('SELECT s.SubscriberKey FROM _Sent s WHERE s.EventDate > DATEADD(DAY, -1, GETDATE())', 'QS027')
    none('SELECT SubscriberKey FROM _Bounce WHERE JobID = 42', 'QS027')
    none('SELECT j.EmailName FROM _Job j WHERE j.DeliveredTime > DATEADD(DAY, -1, GETDATE())', 'QS027')
    none('SELECT a FROM Sent_Log', 'QS027')
  })
})

describe('QS028 tracking views joined without JobID', () => {
  it('flags the join', () => {
    hit('SELECT s.SubscriberKey FROM _Sent s JOIN _Click c ON c.SubscriberKey = s.SubscriberKey WHERE s.EventDate > 1', 'QS028', '_Click')
  })
  it('accepts a JobID join and a join to a normal DE', () => {
    none('SELECT s.SubscriberKey FROM _Sent s JOIN _Click c ON c.JobID = s.JobID AND c.SubscriberKey = s.SubscriberKey', 'QS028')
    none('SELECT s.SubscriberKey FROM _Sent s JOIN Contacts c ON c.SubscriberKey = s.SubscriberKey', 'QS028')
  })
})

describe('QS029 target DE as source', () => {
  it('flags it', () => hit('SELECT a FROM Master m JOIN [My Target] t ON t.a = m.a', 'QS029', '[My Target]', { targetName: 'My Target' }))
  it('accepts other sources', () => none('SELECT a FROM Master', 'QS029', { targetName: 'My Target' }))
})

describe('QS030 UNION column counts', () => {
  it('flags different counts', () => hit('SELECT a, b FROM t UNION ALL SELECT a FROM u', 'QS030', 'UNION'))
  it('accepts equal counts and skips *', () => {
    none('SELECT a, b FROM t EXCEPT SELECT a, b FROM u', 'QS030')
    none('SELECT * FROM t UNION ALL SELECT a FROM u', 'QS030')
  })
})

describe('QS031 UNION vs UNION ALL', () => {
  it('notes UNION', () => expect(hit('SELECT a FROM t UNION SELECT a FROM u', 'QS031', 'UNION').severity).toBe('info'))
  it('accepts UNION ALL', () => none('SELECT a FROM t UNION ALL SELECT a FROM u', 'QS031'))
})

describe('QS032 unbalanced', () => {
  it('flags unclosed (, extra ), strings, brackets and comments', () => {
    hit('SELECT COUNT(a AS n FROM t', 'QS032', '(')
    hit('SELECT a) FROM t', 'QS032', ')')
    hit("SELECT 'abc FROM t", 'QS032', "'abc FROM t")
    hit('SELECT [abc FROM t', 'QS032', '[abc FROM t')
    hit('SELECT a FROM t /* note', 'QS032', '/* note')
    hit('SELECT a] FROM t', 'QS032', ']')
  })
  it('ignores parens in strings and comments', () => none("SELECT '(' AS a, [x)] FROM t -- )", 'QS032'))
})

describe('QS033 unknown column', () => {
  const tables = { contacts: { name: 'Contacts', fields: [{ name: 'Email', type: 4 }] } }
  it('flags a column missing from a known DE or data view', () => {
    hit('SELECT c.Emial FROM Contacts c', 'QS033', 'Emial', { tables })
    hit('SELECT s.EventDat FROM _Sent s', 'QS033', 'EventDat')
  })
  it('accepts known columns, unknown tables, correlated references and ENT. names', () => {
    none('SELECT c.email, x.Anything FROM Contacts c JOIN Other x ON x.a = c.Email WHERE EXISTS (SELECT 1 FROM ENT._Sent s WHERE s.SubscriberKey = c.Email)', 'QS033', { tables })
  })
})

describe('QS034 unknown table (off by default)', () => {
  const tables = { contacts: { name: 'Contacts', fields: [] }, __complete: true }
  it('is disabled by default', () => {
    expect(DEFAULT_DISABLED).toContain('QS034')
    none('SELECT a FROM Nope', 'QS034', { tables })
  })
  it('flags unknown tables when enabled and the list is complete', () => {
    hit('SELECT a FROM Contacts c JOIN Nope n ON n.a = c.a', 'QS034', 'Nope', { tables, disabled: [] })
  })
  it('accepts data views, known DEs, and an incomplete list', () => {
    none('SELECT a FROM Contacts c JOIN _Sent s ON s.a = c.a', 'QS034', { tables, disabled: [] })
    none('SELECT a FROM Nope', 'QS034', { tables: { contacts: tables.contacts }, disabled: [] })
  })
})

describe('QS034 with tables confirmed missing (editor)', () => {
  const withMissing = (names) => {
    const t = { contacts: { name: 'Contacts', fields: [] } }
    Object.defineProperty(t, '__missing', { value: new Set(names), enumerable: false })
    return t
  }
  it('flags only tables the DE lookup confirmed missing', () => {
    hit('SELECT a FROM Contacts c JOIN Nope n ON n.a = c.a', 'QS034', 'Nope', { tables: withMissing(['nope']), disabled: [] })
    none('SELECT a FROM Contacts c JOIN Unchecked u ON u.a = c.a', 'QS034', { tables: withMissing(['nope']), disabled: [] })
  })
  it('never flags ENT. tables, data views or bracketed known names', () => {
    none('SELECT a FROM ENT.Nope', 'QS034', { tables: withMissing(['nope']), disabled: [] })
    none('SELECT a FROM _Sent', 'QS034', { tables: withMissing(['_sent']), disabled: [] })
  })
  it('flags a bracketed missing name', () => {
    hit('SELECT a FROM [My Gone DE]', 'QS034', '[My Gone DE]', { tables: withMissing(['my gone de']), disabled: [] })
  })
})

describe('QS035 functions SFMC refuses', () => {
  it('flags them', () => {
    hit('SELECT DB_NAME() AS d', 'QS035', 'DB_NAME')
    hit('SELECT SYSTEM_USER AS u', 'QS035', 'SYSTEM_USER')
    hit("SELECT a FROM OPENJSON(@j)", 'QS035', 'OPENJSON')
  })
  it('accepts normal functions and similarly named columns', () => none('SELECT UPPER(a) AS u, t.DB_NAME FROM t', 'QS035'))
})

describe('QS036 ENT. in the parent BU', () => {
  it('flags and removes ENT.', () => {
    const sql = 'SELECT a FROM ENT.Shared'
    hit(sql, 'QS036', 'ENT.Shared', { isParentBU: true })
    expect(fixed(sql, 'QS036', { isParentBU: true })).toBe('SELECT a FROM Shared')
  })
  it('accepts ENT. in a child BU', () => none('SELECT a FROM ENT.Shared', 'QS036', { isParentBU: false }))
})

describe('QS037 FROM inside an expression', () => {
  it('flags TRIM(... FROM ...) and IS DISTINCT FROM', () => {
    hit("SELECT TRIM('x' FROM a) AS b FROM t", 'QS037', "TRIM('x' FROM a)")
    hit('SELECT a FROM t WHERE a IS NOT DISTINCT FROM b', 'QS037', 'IS NOT DISTINCT FROM')
  })
  it('accepts TRIM(a) and SELECT DISTINCT', () => none('SELECT DISTINCT TRIM(a) AS b FROM t', 'QS037'))
})

describe('QS038 table-valued function arguments', () => {
  it('flags STRING_SPLIT(x, ...)', () => {
    hit("SELECT s.value FROM t CROSS APPLY STRING_SPLIT(t.tags, ',') s", 'QS038', "STRING_SPLIT(t.tags, ',')")
  })
  it('accepts a one-argument function and table hints', () => {
    none('SELECT a FROM t WITH (NOLOCK) CROSS APPLY fn(t.a) f', 'QS038')
  })
})

describe('QS039 N strings', () => {
  it("drops the N prefix", () => {
    const sql = "SELECT a FROM t WHERE b = N'é'"
    hit(sql, 'QS039', "N'é'")
    expect(fixed(sql, 'QS039')).toBe("SELECT a FROM t WHERE b = 'é'")
  })
  it('accepts plain strings and names ending in N', () => none("SELECT a FROM t WHERE IN_ = 'x' AND ColN = 'y'", 'QS039'))
})

describe('QS040 apostrophes in comments', () => {
  it('flags and cleans an odd count', () => {
    const sql = "-- don't do this\nSELECT a FROM t"
    hit(sql, 'QS040', "-- don't do this")
    expect(fixed(sql, 'QS040')).toBe('-- dont do this\nSELECT a FROM t')
  })
  it("accepts an even count and apostrophes in strings", () => none("/* 'quoted' */ SELECT 'it''s' AS a", 'QS040'))
})

describe('QS041 FOR JSON / FOR XML', () => {
  it('flags it at the top level', () => hit('SELECT a FROM t FOR JSON PATH', 'QS041', 'FOR JSON'))
  it('accepts it in a subquery', () => none('SELECT (SELECT a FROM t FOR XML PATH) AS x', 'QS041'))
})

describe('QS042 ORDER BY column number', () => {
  it('notes ORDER BY 1', () => hit('SELECT TOP 5 a, b FROM t ORDER BY 2 DESC, a', 'QS042', '2'))
  it('accepts names and expressions', () => none('SELECT TOP 5 a FROM t ORDER BY a, b + 1', 'QS042'))
})

import { fixAll } from '../sqlLint.js'
describe('Fix all', () => {
  it('applies every fix, linting again after each', () => {
    const r = fixAll("SELECT a.x, COUNT(*) FROM _Subscribers a WHERE a.Status = N'active'")
    expect(r.applied.length).toBeGreaterThan(0)
    expect(r.sql).not.toContain("N'active'")
  })
  it('leaves fixes that change the result to the user', () => {
    const r = fixAll('SELECT SubscriberKey FROM _Open')
    expect(r.applied.map((a) => a.code)).not.toContain('QS027')
  })
})

describe('MCE error list rules (QS045 to QS064)', () => {
  const codes = (sql, opts) => lintSql(sql, opts).map((d) => d.code)
  const has = (sql, code) => expect(codes(sql)).toContain(code)
  const not = (sql, code) => expect(codes(sql)).not.toContain(code)

  it('QS045 ORDER BY without TOP at the top level', () => {
    has('SELECT a FROM x ORDER BY a', 'QS045')
    not('SELECT TOP 10 a FROM x ORDER BY a', 'QS045')
    const d = lintSql('SELECT a FROM x ORDER BY a').find((x) => x.code === 'QS045')
    expect(applyFix('SELECT a FROM x ORDER BY a', d.fixes[0]).trim()).toBe('SELECT a FROM x')
  })
  it('QS046 comma join', () => { has('SELECT a.x FROM a, b WHERE a.id = b.id', 'QS046'); not('SELECT a.x FROM a JOIN b ON a.id = b.id', 'QS046') })
  it('QS047 other dialects', () => {
    has('SELECT a FROM x LIMIT 10', 'QS047')
    has("SELECT a || 'b' AS c FROM x", 'QS047')
    has('SELECT a FROM x WHERE d > CURRENT_DATE', 'QS047')
    has("SELECT a FROM x WHERE a ILIKE 'b%'", 'QS047')
  })
  it('QS048 functions from other databases, with renames', () => {
    has('SELECT NOW() AS n FROM x', 'QS048')
    const sql = 'SELECT IFNULL(a, 0) AS n FROM x'
    expect(applyFix(sql, lintSql(sql).find((d) => d.code === 'QS048').fixes[0])).toBe('SELECT ISNULL(a, 0) AS n FROM x')
    not('SELECT ISNULL(a, 0) AS n FROM x', 'QS048')
  })
  it('QS049 alias not in FROM', () => {
    has('SELECT b.x FROM a', 'QS049')
    not('SELECT a.x FROM [Tbl] a WHERE EXISTS (SELECT 1 FROM b WHERE b.id = a.id)', 'QS049')
    not('SELECT x.y FROM ENT.[Shared] x', 'QS049')
    not("SELECT s.value FROM x CROSS APPLY STRING_SPLIT(x.list, ',') s", 'QS049')
  })
  it('QS050 same alias twice', () => { has('SELECT a.x FROM t1 a JOIN t2 a ON a.id = a.id', 'QS050'); not('SELECT a.x FROM t1 a JOIN t1 b ON a.id = b.id', 'QS050') })
  it('QS051 to QS053 window functions', () => {
    has('SELECT a FROM x WHERE ROW_NUMBER() OVER (ORDER BY a) = 1', 'QS051')
    has('SELECT COUNT(DISTINCT a) OVER (PARTITION BY b) AS c FROM x', 'QS052')
    has('SELECT ROW_NUMBER() OVER (PARTITION BY a) AS rn FROM x', 'QS053')
    has('SELECT ROW_NUMBER() OVER (ORDER BY a ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS rn FROM x', 'QS053')
    has('SELECT SUM(a) OVER (ROWS UNBOUNDED PRECEDING) AS s FROM x', 'QS053')
    has("SELECT STRING_AGG(a, ',') OVER (PARTITION BY b) AS s FROM x", 'QS053')
    has('SELECT SUM(a) OVER (ORDER BY d RANGE BETWEEN 3 PRECEDING AND CURRENT ROW) AS s FROM x', 'QS053')
    not('SELECT ROW_NUMBER() OVER (PARTITION BY a ORDER BY d DESC) AS rn FROM x', 'QS053')
  })
  it('QS054 aggregates in WHERE and nested', () => {
    has('SELECT a FROM x WHERE COUNT(a) > 1', 'QS054')
    has('SELECT MAX(COUNT(a)) AS m FROM x GROUP BY b', 'QS054')
    not('SELECT a FROM x WHERE a IN (SELECT MAX(b) FROM y)', 'QS054')
  })
  it('QS055 to QS058', () => {
    has('SELECT a FROM x WHERE a IN (SELECT b, c FROM y)', 'QS055')
    has('SELECT a, COUNT(*) AS n FROM x GROUP BY 1', 'QS056')
    has('SELECT TOP 5 a FROM x ORDER BY 2', 'QS057')
    has("SELECT TOP 5 a FROM x ORDER BY 'a'", 'QS057')
    has('SELECT DISTINCT TOP 5 a FROM x ORDER BY b', 'QS058')
    not('SELECT DISTINCT TOP 5 a AS z FROM x ORDER BY z', 'QS058')
  })
  it('QS059 JSON literal', () => { has(`SELECT JSON_VALUE('{"a": 1,}', '$.a') AS v FROM x`, 'QS059'); not(`SELECT JSON_VALUE('{"a": 1}', '$.a') AS v FROM x`, 'QS059') })
  it('QS060 trailing -- comment, fixed to /* */', () => {
    const sql = 'SELECT a FROM x -- done'
    const d = lintSql(sql).find((x) => x.code === 'QS060')
    expect(applyFix(sql, d.fixes[0])).toBe('SELECT a FROM x /* done */')
    not('-- note\nSELECT a FROM x', 'QS060')
  })
  it('QS061 run-time failures', () => {
    const sql = 'SELECT CAST(a AS INT) AS n, CONVERT(DATE, b) AS d, DATEDIFF(SECOND, c, d) AS s, x / y AS r, x / NULLIF(y, 0) AS ok FROM t'
    const d = lintSql(sql).filter((x) => x.code === 'QS061')
    expect(d).toHaveLength(4)
  })
  it('QS062 double-quoted text', () => {
    const sql = 'SELECT a FROM x WHERE b = "abc"'
    expect(applyFix(sql, lintSql(sql).find((d) => d.code === 'QS062').fixes[0])).toBe("SELECT a FROM x WHERE b = 'abc'")
    not('SELECT "col" FROM x', 'QS062')
  })
  it('QS063 LEFT JOIN undone by WHERE', () => {
    has("SELECT a.x FROM a LEFT JOIN b ON b.id = a.id WHERE b.s = 'y'", 'QS063')
    not('SELECT a.x FROM a LEFT JOIN b ON b.id = a.id WHERE b.id IS NULL', 'QS063')
  })
  it('QS064 push join', () => {
    has('SELECT t._Value FROM _PushTag t JOIN _PushAddress p ON p._DeviceID = t._DeviceID', 'QS064')
    not('SELECT t._Value FROM _PushTag t JOIN _PushAddress p ON p._DeviceID = t._DeviceID AND p._APID = t._APID', 'QS064')
  })
})
