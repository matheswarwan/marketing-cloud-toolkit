// public/legacy-redirect.js: SFMC Query Saver's old pages forward to the app.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

// A plain script (no modules in the page), so run it with a `module` to export into.
const sandbox = { module: { exports: {} }, URLSearchParams }
vm.runInNewContext(readFileSync(resolve(__dirname, '../../../public/legacy-redirect.js'), 'utf8'), sandbox)
const { target } = sandbox.module.exports

describe('legacy page redirects', () => {
  it('maps every old page to its section, keeping the parameters that matter', () => {
    expect(target('/index.html', '')).toBe('#/queries/saved')
    expect(target('/popup.html', '')).toBe('#/queries/saved')
    expect(target('/query-detail.html', '?ws=workspace_1&x=1')).toBe('#/queries/workspace?ws=workspace_1')
    expect(target('/query-detail.html', '?id=sql_1')).toBe('#/queries/workspace?id=sql_1')
    expect(target('/query-detail.html', '?sql=SELECT%201')).toBe('#/queries/workspace?sql=SELECT+1')
    expect(target('/query-builder.html', '?id=sql_2')).toBe('#/queries/builder?id=sql_2')
    expect(target('/email-detail.html', '?id=email_42')).toBe('#/emails/email_42')
    expect(target('/email-detail.html', '')).toBe('#/emails')
    expect(target('/features.html', '')).toBe('#/features')
  })
})
