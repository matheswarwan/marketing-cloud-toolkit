// Reference data and pure helpers for editor hover docs, signature help and
// autocomplete in SFMC SQL (Query Activities run on Microsoft SQL Server).
//
// All descriptions are written for this project.

import { tokenize, significant } from './sqlTokens.js'
import { DATA_VIEW_INFO, DATA_VIEW_FIELDS, DATA_VIEWS, FIELD_VALUES } from './dataViews.js'

const GETDATE_NOTE = 'In SFMC this is server time: US Central Standard Time (UTC-6) all year, with no daylight saving change. Convert with AT TIME ZONE, or use GETUTCDATE() and convert from UTC.'
const TIMEOUT_NOTE = 'Query Activities time out after 30 minutes, so keep this off very large row sets where you can.'

const FUNCTION_LIST = [
  // ---- String ----
  ['LEFT', 'string', 'LEFT(string, count)', 'varchar', 'Returns the first `count` characters of a string.', "LEFT(EmailAddress, 5)"],
  ['RIGHT', 'string', 'RIGHT(string, count)', 'varchar', 'Returns the last `count` characters of a string.', "RIGHT(Phone, 4)"],
  ['SUBSTRING', 'string', 'SUBSTRING(string, start, length)', 'varchar', 'Returns part of a string. `start` is 1-based.', "SUBSTRING(EmailAddress, CHARINDEX('@', EmailAddress) + 1, 100)"],
  ['LEN', 'string', 'LEN(string)', 'int', 'Number of characters in a string, not counting trailing spaces.', "LEN(FirstName)"],
  ['DATALENGTH', 'string', 'DATALENGTH(expression)', 'int', 'Number of bytes used by a value. For NVARCHAR this is twice the character count, and trailing spaces count.', "DATALENGTH(Notes)"],
  ['CHARINDEX', 'string', 'CHARINDEX(search, string [, start])', 'int', 'Position (1-based) of `search` inside `string`, or 0 when not found.', "CHARINDEX('@', EmailAddress)"],
  ['PATINDEX', 'string', "PATINDEX('%pattern%', string)", 'int', 'Position of the first match of a LIKE-style pattern, or 0 when not found. The pattern needs % around it to match anywhere.', "PATINDEX('%[0-9]%', PostalCode)"],
  ['REPLACE', 'string', 'REPLACE(string, find, replacement)', 'varchar', 'Replaces every occurrence of `find` with `replacement`.', "REPLACE(Phone, '-', '')"],
  ['STUFF', 'string', 'STUFF(string, start, length, insert)', 'varchar', 'Deletes `length` characters starting at `start` and inserts `insert` there.', "STUFF(Phone, 1, 3, '***')"],
  ['LTRIM', 'string', 'LTRIM(string)', 'varchar', 'Removes leading spaces.', "LTRIM(FirstName)"],
  ['RTRIM', 'string', 'RTRIM(string)', 'varchar', 'Removes trailing spaces.', "RTRIM(FirstName)"],
  ['TRIM', 'string', "TRIM([characters FROM] string)", 'varchar', 'Removes leading and trailing spaces, or the given characters.', "TRIM(EmailAddress)"],
  ['UPPER', 'string', 'UPPER(string)', 'varchar', 'Converts a string to upper case.', "UPPER(CountryCode)"],
  ['LOWER', 'string', 'LOWER(string)', 'varchar', 'Converts a string to lower case.', "LOWER(EmailAddress)"],
  ['CONCAT', 'string', 'CONCAT(value1, value2 [, ...])', 'varchar', 'Joins values into one string. NULL values are treated as empty strings.', "CONCAT(FirstName, ' ', LastName)"],
  ['CONCAT_WS', 'string', 'CONCAT_WS(separator, value1, value2 [, ...])', 'varchar', 'Joins values with a separator between them. NULL values are skipped, along with their separator.', "CONCAT_WS(', ', City, State, Country)"],
  ['FORMAT', 'string', "FORMAT(value, format [, culture])", 'nvarchar', 'Formats a date or number using a .NET format string and an optional culture.', "FORMAT(EventDate, 'yyyy-MM-dd')", 'FORMAT is slow on large row sets. Prefer CONVERT with a style number for dates. ' + TIMEOUT_NOTE],
  ['QUOTENAME', 'string', "QUOTENAME(string [, quote_char])", 'nvarchar', 'Wraps a string in brackets (or the given quote character) and escapes it.', "QUOTENAME('My Column')"],
  ['REPLICATE', 'string', 'REPLICATE(string, count)', 'varchar', 'Repeats a string `count` times.', "REPLICATE('0', 5 - LEN(Code)) + Code"],
  ['REVERSE', 'string', 'REVERSE(string)', 'varchar', 'Returns the characters of a string in reverse order.', "REVERSE(Domain)"],
  ['SPACE', 'string', 'SPACE(count)', 'varchar', 'Returns a string of `count` spaces.', "FirstName + SPACE(1) + LastName"],
  ['STR', 'string', 'STR(number [, length [, decimals]])', 'varchar', 'Converts a number to a right-aligned string of the given length (default 10).', "STR(Amount, 10, 2)"],
  ['STRING_AGG', 'string', "STRING_AGG(expression, separator) [WITHIN GROUP (ORDER BY ...)]", 'varchar', 'Aggregate that joins the values of a group into one string with a separator. NULL values are skipped.', "STRING_AGG(ProductName, ', ') WITHIN GROUP (ORDER BY ProductName)"],
  ['STRING_SPLIT', 'string', 'STRING_SPLIT(string, separator)', 'table (value)', 'Table function that splits a string into rows, one per piece, in a column named `value`.', "SELECT s.SubscriberKey, x.value FROM Prefs s CROSS APPLY STRING_SPLIT(s.Interests, ';') x", 'Use it as a table source with CROSS APPLY or OUTER APPLY, not as a scalar function in the SELECT list. The order of the rows is not guaranteed.'],
  ['TRANSLATE', 'string', 'TRANSLATE(string, characters, translations)', 'varchar', 'Replaces each character in `characters` with the character at the same position in `translations`. Both must be the same length.', "TRANSLATE(Phone, '()-', '   ')"],
  ['SOUNDEX', 'string', 'SOUNDEX(string)', 'varchar', 'Four-character code for how a string sounds in English. Similar sounding words get the same code.', "SOUNDEX(LastName)"],
  ['DIFFERENCE', 'string', 'DIFFERENCE(string1, string2)', 'int', 'Compares the SOUNDEX codes of two strings: 0 means no match, 4 means the strongest match.', "DIFFERENCE(LastName, 'Smith')"],
  ['ASCII', 'string', 'ASCII(string)', 'int', 'Character code of the first character.', "ASCII(LEFT(FirstName, 1))"],
  ['CHAR', 'string', 'CHAR(code)', 'char', 'Character for an ASCII code. CHAR(13) + CHAR(10) is a line break.', "REPLACE(Notes, CHAR(10), ' ')"],
  ['UNICODE', 'string', 'UNICODE(string)', 'int', 'Unicode code point of the first character.', "UNICODE(FirstName)"],
  ['NCHAR', 'string', 'NCHAR(code)', 'nchar', 'Unicode character for a code point.', "NCHAR(8364)"],

  // ---- Date and time ----
  ['GETDATE', 'date', 'GETDATE()', 'datetime', 'Current date and time of the database server.', "WHERE EventDate > DATEADD(day, -7, GETDATE())", GETDATE_NOTE],
  ['GETUTCDATE', 'date', 'GETUTCDATE()', 'datetime', 'Current date and time in UTC.', "GETUTCDATE()"],
  ['SYSDATETIME', 'date', 'SYSDATETIME()', 'datetime2', 'Current server date and time with more precision than GETDATE.', "SYSDATETIME()", GETDATE_NOTE],
  ['SYSUTCDATETIME', 'date', 'SYSUTCDATETIME()', 'datetime2', 'Current UTC date and time with high precision.', "SYSUTCDATETIME()"],
  ['SYSDATETIMEOFFSET', 'date', 'SYSDATETIMEOFFSET()', 'datetimeoffset', 'Current server date and time including the server time zone offset.', "SYSDATETIMEOFFSET()"],
  ['CURRENT_TIMESTAMP', 'date', 'CURRENT_TIMESTAMP', 'datetime', 'Same as GETDATE(), written without parentheses.', "CURRENT_TIMESTAMP", GETDATE_NOTE],
  ['DATEADD', 'date', 'DATEADD(datepart, number, date)', 'same as date', 'Adds `number` units of `datepart` to a date. Use a negative number to go back.', "DATEADD(day, -30, GETDATE())"],
  ['DATEDIFF', 'date', 'DATEDIFF(datepart, startdate, enddate)', 'int', 'Number of `datepart` boundaries crossed between two dates. DATEDIFF(year, \'2024-12-31\', \'2025-01-01\') is 1.', "DATEDIFF(day, DateJoined, GETDATE())"],
  ['DATEDIFF_BIG', 'date', 'DATEDIFF_BIG(datepart, startdate, enddate)', 'bigint', 'Like DATEDIFF but returns BIGINT, for differences in small units that would overflow INT.', "DATEDIFF_BIG(millisecond, StartTime, EndTime)"],
  ['DATEPART', 'date', 'DATEPART(datepart, date)', 'int', 'One part of a date as a number, such as the month or the hour.', "DATEPART(hour, EventDate)"],
  ['DATENAME', 'date', 'DATENAME(datepart, date)', 'nvarchar', 'One part of a date as text, such as the month name or weekday name.', "DATENAME(weekday, EventDate)"],
  ['DATEFROMPARTS', 'date', 'DATEFROMPARTS(year, month, day)', 'date', 'Builds a DATE from numbers.', "DATEFROMPARTS(YEAR(GETDATE()), 1, 1)"],
  ['DATETIMEFROMPARTS', 'date', 'DATETIMEFROMPARTS(year, month, day, hour, minute, seconds, milliseconds)', 'datetime', 'Builds a DATETIME from numbers. All seven arguments are required.', "DATETIMEFROMPARTS(2025, 1, 1, 0, 0, 0, 0)"],
  ['DATETIME2FROMPARTS', 'date', 'DATETIME2FROMPARTS(year, month, day, hour, minute, seconds, fractions, precision)', 'datetime2', 'Builds a DATETIME2 from numbers.', "DATETIME2FROMPARTS(2025, 1, 1, 0, 0, 0, 0, 0)"],
  ['EOMONTH', 'date', 'EOMONTH(date [, months_to_add])', 'date', 'Last day of the month that contains `date`, optionally moved by a number of months.', "EOMONTH(GETDATE(), -1)"],
  ['YEAR', 'date', 'YEAR(date)', 'int', 'Year part of a date.', "YEAR(EventDate)"],
  ['MONTH', 'date', 'MONTH(date)', 'int', 'Month part of a date (1 to 12).', "MONTH(EventDate)"],
  ['DAY', 'date', 'DAY(date)', 'int', 'Day of the month (1 to 31).', "DAY(EventDate)"],
  ['ISDATE', 'date', 'ISDATE(expression)', 'int', 'Returns 1 when the value can be converted to a date or time, otherwise 0. The result depends on the date format and language settings.', "WHERE ISDATE(BirthDate) = 1"],
  ['SWITCHOFFSET', 'date', 'SWITCHOFFSET(datetimeoffset, offset)', 'datetimeoffset', 'Moves a DATETIMEOFFSET value to another time zone offset, keeping the same moment in time.', "SWITCHOFFSET(SYSDATETIMEOFFSET(), '+00:00')"],
  ['TODATETIMEOFFSET', 'date', 'TODATETIMEOFFSET(date, offset)', 'datetimeoffset', 'Attaches a time zone offset to a date without changing the clock time.', "TODATETIMEOFFSET(GETDATE(), '-06:00')", 'To convert between named time zones, use `date AT TIME ZONE \'Central America Standard Time\' AT TIME ZONE \'UTC\'` instead.'],

  // ---- Conversion ----
  ['CAST', 'conversion', 'CAST(expression AS data_type)', 'data_type', 'Converts a value to another data type. Fails the query when the value cannot be converted.', "CAST(EventDate AS DATE)"],
  ['CONVERT', 'conversion', 'CONVERT(data_type, expression [, style])', 'data_type', 'Converts a value to another data type. The optional style number controls date and number formats, for example 101 (mm/dd/yyyy), 103 (dd/mm/yyyy), 112 (yyyymmdd), 120 (yyyy-mm-dd hh:mi:ss).', "CONVERT(VARCHAR(10), EventDate, 120)"],
  ['TRY_CAST', 'conversion', 'TRY_CAST(expression AS data_type)', 'data_type', 'Like CAST, but returns NULL instead of failing when the value cannot be converted.', "TRY_CAST(Age AS INT)"],
  ['TRY_CONVERT', 'conversion', 'TRY_CONVERT(data_type, expression [, style])', 'data_type', 'Like CONVERT, but returns NULL instead of failing when the value cannot be converted.', "TRY_CONVERT(DATE, BirthDate, 103)"],
  ['PARSE', 'conversion', "PARSE(string AS data_type [USING culture])", 'data_type', 'Converts a string to a date or number using a culture. Fails when the string cannot be parsed.', "PARSE('31/12/2025' AS DATE USING 'en-GB')"],
  ['TRY_PARSE', 'conversion', "TRY_PARSE(string AS data_type [USING culture])", 'data_type', 'Like PARSE, but returns NULL when the string cannot be parsed.', "TRY_PARSE(Amount AS DECIMAL(10,2) USING 'de-DE')"],

  // ---- Null handling and logic ----
  ['ISNULL', 'logical', 'ISNULL(expression, replacement)', 'type of expression', 'Returns `replacement` when `expression` is NULL. The result takes the type of the first argument, so long replacements can be cut short.', "ISNULL(FirstName, 'Customer')"],
  ['COALESCE', 'logical', 'COALESCE(value1, value2 [, ...])', 'highest-precedence type', 'Returns the first value that is not NULL.', "COALESCE(MobilePhone, HomePhone, '')"],
  ['NULLIF', 'logical', 'NULLIF(value1, value2)', 'type of value1', 'Returns NULL when the two values are equal, otherwise the first value. Handy for turning empty strings into NULL or avoiding division by zero.', "Clicks * 1.0 / NULLIF(Sends, 0)"],
  ['IIF', 'logical', 'IIF(condition, true_value, false_value)', 'type of the result values', 'Short form of CASE WHEN condition THEN true_value ELSE false_value END.', "IIF(Status = 'active', 1, 0)"],
  ['CHOOSE', 'logical', 'CHOOSE(index, value1, value2 [, ...])', 'type of the values', 'Returns the value at position `index` (1-based) in the list, or NULL when out of range.', "CHOOSE(MONTH(EventDate), 'Q1','Q1','Q1','Q2','Q2','Q2','Q3','Q3','Q3','Q4','Q4','Q4')"],

  // ---- Math ----
  ['ABS', 'math', 'ABS(number)', 'type of number', 'Absolute (positive) value.', "ABS(DATEDIFF(day, A, B))"],
  ['CEILING', 'math', 'CEILING(number)', 'type of number', 'Smallest whole number greater than or equal to the value.', "CEILING(Total / 10.0)"],
  ['FLOOR', 'math', 'FLOOR(number)', 'type of number', 'Largest whole number less than or equal to the value.', "FLOOR(Age / 10) * 10"],
  ['ROUND', 'math', 'ROUND(number, length [, truncate])', 'type of number', 'Rounds to `length` decimal places. A negative length rounds to the left of the decimal point. A non-zero third argument truncates instead.', "ROUND(Amount, 2)"],
  ['POWER', 'math', 'POWER(number, exponent)', 'float', 'Raises a number to a power.', "POWER(2, 10)"],
  ['SQRT', 'math', 'SQRT(number)', 'float', 'Square root.', "SQRT(Variance)"],
  ['SQUARE', 'math', 'SQUARE(number)', 'float', 'Number multiplied by itself.', "SQUARE(Delta)"],
  ['SIGN', 'math', 'SIGN(number)', 'type of number', 'Returns -1, 0 or 1 for negative, zero or positive values.', "SIGN(Balance)"],
  ['RAND', 'math', 'RAND([seed])', 'float', 'Random number from 0 up to 1. Without a seed it returns the same value for every row of one query.', "RAND()", 'For a random value per row, or random sampling, use NEWID() instead.'],
  ['EXP', 'math', 'EXP(number)', 'float', 'e raised to the given power.', "EXP(1)"],
  ['LOG', 'math', 'LOG(number [, base])', 'float', 'Natural logarithm, or the logarithm in the given base.', "LOG(Revenue)"],
  ['LOG10', 'math', 'LOG10(number)', 'float', 'Base 10 logarithm.', "LOG10(Revenue)"],
  ['PI', 'math', 'PI()', 'float', 'The constant pi.', "PI()"],

  // ---- Aggregate ----
  ['COUNT', 'aggregate', 'COUNT(* | [DISTINCT] expression)', 'int', 'Number of rows, or number of non-NULL values. COUNT(DISTINCT x) counts unique values.', "COUNT(DISTINCT SubscriberKey)"],
  ['COUNT_BIG', 'aggregate', 'COUNT_BIG(* | [DISTINCT] expression)', 'bigint', 'Like COUNT but returns BIGINT.', "COUNT_BIG(*)"],
  ['SUM', 'aggregate', 'SUM([DISTINCT] expression)', 'numeric', 'Total of the non-NULL values.', "SUM(OrderTotal)"],
  ['AVG', 'aggregate', 'AVG([DISTINCT] expression)', 'numeric', 'Average of the non-NULL values. On an INT column the result is an INT, so multiply by 1.0 for decimals.', "AVG(OrderTotal * 1.0)"],
  ['MIN', 'aggregate', 'MIN(expression)', 'type of expression', 'Smallest value.', "MIN(EventDate)"],
  ['MAX', 'aggregate', 'MAX(expression)', 'type of expression', 'Largest value.', "MAX(EventDate) AS LastOpen"],
  ['STDEV', 'aggregate', 'STDEV(expression)', 'float', 'Sample standard deviation.', "STDEV(OrderTotal)"],
  ['STDEVP', 'aggregate', 'STDEVP(expression)', 'float', 'Population standard deviation.', "STDEVP(OrderTotal)"],
  ['VAR', 'aggregate', 'VAR(expression)', 'float', 'Sample variance.', "VAR(OrderTotal)"],
  ['VARP', 'aggregate', 'VARP(expression)', 'float', 'Population variance.', "VARP(OrderTotal)"],
  ['CHECKSUM_AGG', 'aggregate', 'CHECKSUM_AGG(expression)', 'int', 'Checksum of the values in a group, useful to detect changes.', "CHECKSUM_AGG(CHECKSUM(*))"],
  ['GROUPING', 'aggregate', 'GROUPING(column)', 'tinyint', 'With ROLLUP or CUBE, returns 1 on summary rows where the column was rolled up.', "GROUPING(Country)"],

  // ---- Window / ranking ----
  ['ROW_NUMBER', 'window', 'ROW_NUMBER() OVER ([PARTITION BY ...] ORDER BY ...)', 'bigint', 'Numbers rows 1, 2, 3 within each partition, in the given order. Ties get different numbers.', "ROW_NUMBER() OVER (PARTITION BY SubscriberKey ORDER BY EventDate DESC)", 'A common way to keep one row per key: wrap the query and filter on the row number = 1. Duplicate primary keys in the target data extension make the query fail.'],
  ['RANK', 'window', 'RANK() OVER ([PARTITION BY ...] ORDER BY ...)', 'bigint', 'Rank within the partition. Ties share a rank and leave a gap after them (1, 1, 3).', "RANK() OVER (ORDER BY Score DESC)"],
  ['DENSE_RANK', 'window', 'DENSE_RANK() OVER ([PARTITION BY ...] ORDER BY ...)', 'bigint', 'Rank within the partition. Ties share a rank with no gap after them (1, 1, 2).', "DENSE_RANK() OVER (ORDER BY Score DESC)"],
  ['NTILE', 'window', 'NTILE(groups) OVER ([PARTITION BY ...] ORDER BY ...)', 'bigint', 'Splits ordered rows into `groups` buckets of about equal size and returns the bucket number.', "NTILE(2) OVER (ORDER BY NEWID()) AS SplitGroup"],
  ['LAG', 'window', 'LAG(expression [, offset [, default]]) OVER ([PARTITION BY ...] ORDER BY ...)', 'type of expression', 'Value from a previous row in the partition (1 row back by default).', "LAG(EventDate) OVER (PARTITION BY SubscriberKey ORDER BY EventDate)"],
  ['LEAD', 'window', 'LEAD(expression [, offset [, default]]) OVER ([PARTITION BY ...] ORDER BY ...)', 'type of expression', 'Value from a following row in the partition (1 row ahead by default).', "LEAD(EventDate) OVER (PARTITION BY SubscriberKey ORDER BY EventDate)"],
  ['FIRST_VALUE', 'window', 'FIRST_VALUE(expression) OVER ([PARTITION BY ...] ORDER BY ...)', 'type of expression', 'Value from the first row of the window frame.', "FIRST_VALUE(URL) OVER (PARTITION BY SubscriberKey ORDER BY EventDate)"],
  ['LAST_VALUE', 'window', 'LAST_VALUE(expression) OVER ([PARTITION BY ...] ORDER BY ... [ROWS BETWEEN ...])', 'type of expression', 'Value from the last row of the window frame. The default frame ends at the current row, so add ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING to get the last row of the partition.', "LAST_VALUE(URL) OVER (PARTITION BY SubscriberKey ORDER BY EventDate ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)"],
  ['PERCENT_RANK', 'window', 'PERCENT_RANK() OVER ([PARTITION BY ...] ORDER BY ...)', 'float', 'Relative rank of a row from 0 to 1.', "PERCENT_RANK() OVER (ORDER BY OrderTotal)"],
  ['CUME_DIST', 'window', 'CUME_DIST() OVER ([PARTITION BY ...] ORDER BY ...)', 'float', 'Share of rows with a value less than or equal to the current row, from above 0 to 1.', "CUME_DIST() OVER (ORDER BY OrderTotal)"],

  // ---- JSON ----
  ['JSON_VALUE', 'json', "JSON_VALUE(json, '$.path')", 'nvarchar(4000)', 'Extracts a single scalar value (text, number, true/false) from a JSON string. Returns NULL for objects and arrays.', "JSON_VALUE(Payload, '$.customer.email')"],
  ['JSON_QUERY', 'json', "JSON_QUERY(json [, '$.path'])", 'nvarchar(max)', 'Extracts an object or array from a JSON string. Returns NULL for scalar values.', "JSON_QUERY(Payload, '$.items')"],
  ['ISJSON', 'json', 'ISJSON(string)', 'int', 'Returns 1 when the string is valid JSON, otherwise 0.', "WHERE ISJSON(Payload) = 1"],
  ['JSON_MODIFY', 'json', "JSON_MODIFY(json, '$.path', new_value)", 'nvarchar(max)', 'Returns the JSON string with the value at `path` changed.', "JSON_MODIFY(Payload, '$.status', 'sent')"],
  ['OPENJSON', 'json', "OPENJSON(json [, '$.path']) [WITH (...)]", 'table', 'Table function that turns a JSON array or object into rows. Use it with CROSS APPLY.', "SELECT o.ID, j.value FROM Orders o CROSS APPLY OPENJSON(o.Items) j"],

  // ---- Other ----
  ['NEWID', 'other', 'NEWID()', 'uniqueidentifier', 'Generates a new random GUID for every row.', "SELECT TOP 1000 SubscriberKey FROM Audience ORDER BY NEWID()", 'Use ORDER BY NEWID() with TOP for a random sample, or NTILE over NEWID() for random splits. It sorts the whole set, so it is slow on very large data extensions.'],
  ['ISNUMERIC', 'other', 'ISNUMERIC(expression)', 'int', "Returns 1 when the value can be converted to some numeric type. It also accepts values like '$', '.', '-' and '1e5', so TRY_CAST is often safer.", "WHERE ISNUMERIC(ZipCode) = 1"],
  ['CHECKSUM', 'other', 'CHECKSUM(* | expression [, ...])', 'int', 'Hash value of the given columns. Different values can share a checksum, so it is not unique.', "CHECKSUM(EmailAddress)"],
  ['BINARY_CHECKSUM', 'other', 'BINARY_CHECKSUM(* | expression [, ...])', 'int', 'Like CHECKSUM but case-sensitive, because it uses the binary value.', "BINARY_CHECKSUM(EmailAddress)"],
  ['HASHBYTES', 'other', "HASHBYTES('algorithm', input)", 'varbinary', "Hash of a string with MD5, SHA1, SHA2_256 or SHA2_512. Convert to text with CONVERT(VARCHAR(64), ..., 2) for a hex string.", "CONVERT(VARCHAR(64), HASHBYTES('SHA2_256', LOWER(EmailAddress)), 2)"],
]

export const SQL_FUNCTIONS = Object.freeze(Object.fromEntries(
  FUNCTION_LIST.map(([name, category, signature, returns, description, example, sfmc]) => {
    const doc = { name, category, signature, returns, description, example }
    if (sfmc) doc.sfmc = sfmc
    return [name, Object.freeze(doc)]
  })
))

export const SQL_KEYWORDS = [
  'SELECT', 'DISTINCT', 'TOP', 'PERCENT', 'WITH TIES', 'AS', 'FROM', 'WHERE',
  'INNER JOIN', 'LEFT JOIN', 'LEFT OUTER JOIN', 'RIGHT JOIN', 'RIGHT OUTER JOIN',
  'FULL JOIN', 'FULL OUTER JOIN', 'CROSS JOIN', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS',
  'ON', 'CROSS APPLY', 'OUTER APPLY', 'APPLY',
  'GROUP BY', 'HAVING', 'ORDER BY', 'ASC', 'DESC', 'ROLLUP', 'CUBE', 'GROUPING SETS',
  'OFFSET', 'ROWS', 'ROW', 'FETCH NEXT', 'FETCH FIRST', 'ONLY',
  'UNION', 'UNION ALL', 'EXCEPT', 'INTERSECT',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'AND', 'OR', 'NOT', 'IS NULL', 'IS NOT NULL', 'NULL', 'IS', 'LIKE', 'NOT LIKE', 'ESCAPE',
  'IN', 'NOT IN', 'EXISTS', 'NOT EXISTS', 'BETWEEN', 'ALL', 'ANY', 'SOME',
  'OVER', 'PARTITION BY', 'RANGE', 'UNBOUNDED PRECEDING', 'UNBOUNDED FOLLOWING', 'CURRENT ROW', 'PRECEDING', 'FOLLOWING',
  'WITHIN GROUP', 'WITH', 'AT TIME ZONE', 'COLLATE', 'PIVOT', 'UNPIVOT', 'FOR',
]

export const SQL_DATA_TYPES = [
  'VARCHAR', 'NVARCHAR', 'CHAR', 'NCHAR', 'VARCHAR(MAX)', 'NVARCHAR(MAX)', 'TEXT', 'NTEXT',
  'INT', 'BIGINT', 'SMALLINT', 'TINYINT', 'DECIMAL', 'NUMERIC', 'FLOAT', 'REAL', 'MONEY', 'SMALLMONEY',
  'DATE', 'TIME', 'DATETIME', 'DATETIME2', 'SMALLDATETIME', 'DATETIMEOFFSET',
  'BIT', 'UNIQUEIDENTIFIER', 'VARBINARY', 'BINARY',
]

export const DATE_PARTS = [
  'year', 'yy', 'yyyy',
  'quarter', 'qq', 'q',
  'month', 'mm', 'm',
  'dayofyear', 'dy', 'y',
  'day', 'dd', 'd',
  'week', 'wk', 'ww',
  'weekday', 'dw', 'w',
  'hour', 'hh',
  'minute', 'mi', 'n',
  'second', 'ss', 's',
  'millisecond', 'ms',
  'microsecond', 'mcs',
  'nanosecond', 'ns',
  'iso_week', 'isowk', 'isoww',
  'tzoffset', 'tz',
]

/** Case-insensitive function lookup. Returns the doc object or null. */
export function getFunctionDoc(name) {
  if (typeof name !== 'string') return null
  return SQL_FUNCTIONS[name.trim().toUpperCase()] || null
}

function prevSignificant(tokens, i) {
  for (let j = i - 1; j >= 0; j--) {
    const t = tokens[j]
    if (t.type !== 'ws' && t.type !== 'comment') return t
  }
  return null
}

function nextSignificant(tokens, i) {
  for (let j = i + 1; j < tokens.length; j++) {
    const t = tokens[j]
    if (t.type !== 'ws' && t.type !== 'comment') return t
  }
  return null
}

/**
 * When `pos` sits inside the parentheses of a known function call, returns
 * { name, doc, argIndex }. argIndex counts top-level commas before `pos`
 * inside that call (commas in strings and nested parens are ignored).
 * Uses the innermost enclosing known function. Otherwise returns null.
 */
export function signatureAt(sql, pos) {
  if (typeof sql !== 'string' || typeof pos !== 'number') return null
  const tokens = tokenize(sql)
  const stack = []  // { doc, commas }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.start >= pos) break
    // pos inside a comment: no signature help
    if (t.type === 'comment' && t.end > pos) return null
    if (t.type === 'lparen') {
      const prev = prevSignificant(tokens, i)
      const doc = prev && prev.type === 'word' ? getFunctionDoc(prev.value) : null
      stack.push({ doc, commas: 0 })
    } else if (t.type === 'rparen') {
      stack.pop()
    } else if (t.type === 'comma' && stack.length) {
      stack[stack.length - 1].commas++
    }
  }
  for (let k = stack.length - 1; k >= 0; k--) {
    const f = stack[k]
    if (f.doc) return { name: f.doc.name, doc: f.doc, argIndex: f.commas }
  }
  return null
}

const DATA_VIEW_UPPER = new Set([...DATA_VIEWS].map(n => n.toUpperCase()))
const TYPE_NAMES = { 0: 'Text', 1: 'Number', 2: 'Date', 3: 'Boolean', 4: 'EmailAddress', 5: 'Phone' }
const NOT_ALIAS = new Set([
  'WHERE', 'ON', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS', 'GROUP', 'ORDER',
  'HAVING', 'UNION', 'EXCEPT', 'INTERSECT', 'WITH', 'APPLY', 'SELECT', 'AND', 'OR', 'AS',
])

function viewNameOf(tok) {
  if (!tok) return null
  const name = tok.type === 'word' ? tok.value : tok.type === 'ident' ? tok.name : null
  if (!name || name[0] !== '_') return null
  const up = name.toUpperCase()
  return DATA_VIEW_UPPER.has(up) || DATA_VIEW_INFO[up] ? up : null
}

/** Map of alias/view name (upper) to data view (upper) for views in the query. */
function dataViewAliases(sig) {
  const map = new Map()
  for (let i = 0; i < sig.length; i++) {
    const view = viewNameOf(sig[i])
    if (!view) continue
    // skip a column reference like x._Something (but allow ENT._Sent)
    const before = sig[i - 1]
    if (before?.type === 'dot') {
      const owner = sig[i - 2]
      if (!(owner?.type === 'word' && owner.upper === 'ENT')) continue
    }
    if (sig[i + 1]?.type === 'dot') continue
    map.set(view, view)
    let j = i + 1
    if (sig[j]?.type === 'word' && sig[j].upper === 'AS') j++
    const a = sig[j]
    if (a && (a.type === 'word' || a.type === 'ident') && !(a.type === 'word' && NOT_ALIAS.has(a.upper))) {
      map.set((a.type === 'ident' ? a.name : a.value).toUpperCase(), view)
    }
  }
  return map
}

function fieldDoc(view, fieldName) {
  const fields = DATA_VIEW_FIELDS[view]
  if (!fields) return null
  const f = fields.find(x => x.name.toUpperCase() === fieldName.toUpperCase())
  if (!f) return null
  const typeName = TYPE_NAMES[f.type] || 'Text'
  const values = FIELD_VALUES[`${view}.${f.name.toUpperCase()}`] || null
  return {
    view, name: f.name, type: f.type, typeName,
    ...(f.length ? { length: f.length } : {}),
    ...(values ? { values } : {}),
  }
}


/**
 * Hover info for the word at `pos`:
 *   { from, to, doc, kind }
 *   kind 'function': doc is the SQL_FUNCTIONS entry (only when followed by '(',
 *                    or for CURRENT_TIMESTAMP which takes no parentheses)
 *   kind 'dataview': doc is the description string, `info` the full entry
 *   kind 'field':    doc is a short description string, `field` the details
 * Returns null for strings, comments, plain words and unknown names.
 */
export function hoverDocAt(sql, pos) {
  if (typeof sql !== 'string' || typeof pos !== 'number') return null
  const tokens = tokenize(sql)
  let idx = -1
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.start <= pos && pos <= t.end && (t.type === 'word' || t.type === 'ident')) {
      // when pos sits between two tokens, prefer the word one
      if (pos < t.end || idx === -1) idx = i
      if (pos < t.end) break
    }
    if (t.start > pos) break
  }
  if (idx === -1) return null
  const tok = tokens[idx]
  const from = tok.start
  const to = tok.end

  if (tok.type === 'word') {
    const next = nextSignificant(tokens, idx)
    const fdoc = getFunctionDoc(tok.value)
    const prev = prevSignificant(tokens, idx)
    if (fdoc && prev?.type !== 'dot' && (next?.type === 'lparen' || fdoc.name === 'CURRENT_TIMESTAMP')) {
      return { from, to, doc: fdoc, kind: 'function' }
    }
  }

  const view = viewNameOf(tok)
  const prev = prevSignificant(tokens, idx)
  const qualifiedByNonEnt = prev?.type === 'dot' && !(prevSignificant(tokens, tokens.indexOf(prev))?.upper === 'ENT')
  if (view && !qualifiedByNonEnt) {
    const info = DATA_VIEW_INFO[view]
    const display = [...DATA_VIEWS].find(n => n.toUpperCase() === view) || view
    return {
      from, to, kind: 'dataview', name: display,
      doc: info ? info.description : `SFMC system data view ${display}.`,
      ...(info ? { info } : {}),
    }
  }

  // Field of a data view: alias.Field, or an unqualified name when the
  // query uses exactly one data view.
  const sig = significant(tokens)
  const aliases = dataViewAliases(sig)
  if (!aliases.size) return null
  const name = tok.type === 'ident' ? tok.name : tok.value
  let targetView = null
  if (prev?.type === 'dot') {
    const owner = prevSignificant(tokens, tokens.indexOf(prev))
    const ownerName = owner?.type === 'ident' ? owner.name : owner?.type === 'word' ? owner.value : null
    if (ownerName) targetView = aliases.get(ownerName.toUpperCase()) || null
  } else if (nextSignificant(tokens, idx)?.type !== 'dot') {
    const views = new Set(aliases.values())
    if (views.size === 1) targetView = [...views][0]
  }
  if (!targetView) return null
  const field = fieldDoc(targetView, name)
  if (!field) return null
  const display = [...DATA_VIEWS].find(n => n.toUpperCase() === targetView) || targetView
  let text = `${field.typeName} field of ${display}.`
  if (field.values) text += ` Known values: ${field.values.join(', ')}.`
  return { from, to, kind: 'field', doc: text, field }
}
