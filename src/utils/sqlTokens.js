// A small T-SQL tokenizer for SFMC queries. It never throws: anything it
// doesn't recognise becomes a one-character 'op' token, and unterminated
// strings, brackets and comments are flagged with `unterminated: true`.
//
// Token: { type, value, start, end, depth, upper?, unterminated? }
//   type:  'ws' | 'comment' | 'string' | 'ident' (bracketed or double-quoted) |
//          'word' | 'number' | 'var' (@x, @@x) | 'temp' (#x) |
//          'op' | 'comma' | 'dot' | 'semi' | 'lparen' | 'rparen'
//   depth: parenthesis depth at the token (a '(' has the outer depth)
//   upper: upper-cased value, for 'word' tokens

const WORD_START = /[A-Za-z_À-￿]/
const WORD_CHAR  = /[A-Za-z0-9_$À-￿]/

export function tokenize(sql) {
  const tokens = []
  const s = sql || ''
  let i = 0
  let depth = 0

  const push = (type, start, end, extra = {}) => {
    const tok = { type, value: s.slice(start, end), start, end, depth, ...extra }
    if (type === 'word') tok.upper = tok.value.toUpperCase()
    tokens.push(tok)
  }

  while (i < s.length) {
    const c = s[i]
    const n = s[i + 1]
    const start = i

    if (/\s/.test(c)) {
      while (i < s.length && /\s/.test(s[i])) i++
      push('ws', start, i)
    } else if (c === '-' && n === '-') {
      while (i < s.length && s[i] !== '\n') i++
      push('comment', start, i, { line: true })
    } else if (c === '/' && n === '*') {
      const close = s.indexOf('*/', i + 2)
      i = close === -1 ? s.length : close + 2
      push('comment', start, i, close === -1 ? { unterminated: true } : {})
    } else if (c === "'" || ((c === 'N' || c === 'n') && n === "'")) {
      i += c === "'" ? 1 : 2
      let closed = false
      while (i < s.length) {
        if (s[i] === "'") {
          if (s[i + 1] === "'") { i += 2; continue }
          i++; closed = true; break
        }
        i++
      }
      push('string', start, i, { unicode: c !== "'", ...(closed ? {} : { unterminated: true }) })
    } else if (c === '[') {
      i++
      let closed = false
      while (i < s.length) {
        if (s[i] === ']') {
          if (s[i + 1] === ']') { i += 2; continue }
          i++; closed = true; break
        }
        i++
      }
      push('ident', start, i, { name: s.slice(start + 1, closed ? i - 1 : i).replace(/]]/g, ']'), bracket: true, ...(closed ? {} : { unterminated: true }) })
    } else if (c === '"') {
      const close = s.indexOf('"', i + 1)
      i = close === -1 ? s.length : close + 1
      push('ident', start, i, { name: s.slice(start + 1, close === -1 ? i : i - 1), quoted: true, ...(close === -1 ? { unterminated: true } : {}) })
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(n || ''))) {
      while (i < s.length && /[0-9.]/.test(s[i])) i++
      if (/[eE]/.test(s[i] || '') && /[-+0-9]/.test(s[i + 1] || '')) {
        i += 2
        while (i < s.length && /[0-9]/.test(s[i])) i++
      }
      push('number', start, i)
    } else if (c === '@') {
      i++
      if (s[i] === '@') i++
      while (i < s.length && WORD_CHAR.test(s[i])) i++
      push('var', start, i)
    } else if (c === '#') {
      i++
      if (s[i] === '#') i++
      while (i < s.length && WORD_CHAR.test(s[i])) i++
      push('temp', start, i)
    } else if (WORD_START.test(c)) {
      while (i < s.length && WORD_CHAR.test(s[i])) i++
      push('word', start, i)
    } else if (c === '(') {
      i++; push('lparen', start, i); depth++
    } else if (c === ')') {
      depth = Math.max(0, depth - 1)
      i++; push('rparen', start, i)
    } else if (c === ',') {
      i++; push('comma', start, i)
    } else if (c === '.') {
      i++; push('dot', start, i)
    } else if (c === ';') {
      i++; push('semi', start, i)
    } else {
      const two = s.slice(i, i + 2)
      i += ['<>', '!=', '>=', '<=', '!<', '!>', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '::'].includes(two) ? 2 : 1
      push('op', start, i)
    }
  }
  return tokens
}

/** Tokens without whitespace and comments. */
export function significant(tokens) {
  return tokens.filter(t => t.type !== 'ws' && t.type !== 'comment')
}

/** True when `tok` is the keyword `kw` (case-insensitive). */
export function isWord(tok, ...kws) {
  return tok?.type === 'word' && kws.includes(tok.upper)
}

/** Name of an identifier token: the inside of [..] / ".." or the word itself. */
export function identName(tok) {
  if (!tok) return null
  if (tok.type === 'ident') return tok.name
  if (tok.type === 'word') return tok.value
  return null
}

/** Wraps a name in brackets, escaping `]`. */
export function bracket(name) {
  return '[' + String(name).replace(/]/g, ']]') + ']'
}
