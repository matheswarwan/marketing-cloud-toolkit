// CloudPage Finder calls (from SFMC Automation Viewer's cloudPageExplorer.js): search
// Content Builder for CloudPage assets, then on demand each page's URL and folder.
import { sfmcFetch } from './sfmcApi.js'
import { RESULTS_PAGE_SIZE } from './paging.js'
import { compile } from './emailCompiler.js'

export const CP_PAGE_SIZE = RESULTS_PAGE_SIZE
export const CLOUD_PAGE_ASSET_TYPE_IDS = [240, 241, 242, 243, 244, 245, 247, 248, 249]
const FIELDS = ['assetType', 'category', 'createdDate', 'customerKey', 'id', 'modifiedDate', 'name', 'meta', 'status']
const CB = (stack) => `https://content-builder.${stack}.marketingcloudapps.com/fuelapi`
const CP = (stack) => `https://cloud-pages.${stack}.marketingcloudapps.com/fuelapi`

export const SYSTEM_CP_PREFIXES = ['System', 'Default', 'Template']
export const isSystemCloudPage = (name) => SYSTEM_CP_PREFIXES.some((p) => String(name || '').startsWith(p))

// Matches the text in the name, content, description, file name, subject or key.
function textOperand(value) {
  const fields = [
    { property: 'name', boost: 50 }, { property: 'content', boost: 5 }, { property: 'description', boost: 3 },
    { property: 'fileProperties.fileName', boost: 2 }, { property: 'views.subjectline.content', boost: 50 }, { property: 'customerKey' },
  ]
  const node = (i) => {
    const f = fields[i]
    const leaf = { property: f.property, simpleOperator: 'contains', value, ...(f.boost ? { boost: f.boost } : {}) }
    return i === fields.length - 1 ? leaf : { leftOperand: leaf, logicalOperator: 'OR', rightOperand: node(i + 1) }
  }
  return node(0)
}

export function cloudPageSearchBody(query, page = 1, pageSize = CP_PAGE_SIZE) {
  const types = { property: 'assetType.id', simpleOperator: 'in', values: CLOUD_PAGE_ASSET_TYPE_IDS }
  const value = query.trim().toLowerCase()
  return {
    page: { pageSize, page },
    query: value ? { leftOperand: textOperand(value), logicalOperator: 'AND', rightOperand: types } : types,
    fields: FIELDS,
  }
}

// A published landing page keeps its address in `content`, as a JSON string such as
// {"url":"https://...pub.s4.sfmc-content.com/welcome-page"} (feedback #51).
function urlFromContent(content) {
  let c = content
  if (typeof c === 'string') {
    if (!c.trim().startsWith('{')) return null
    try { c = JSON.parse(c) } catch { return null }
  }
  return c && typeof c === 'object' && typeof c.url === 'string' && /^https?:\/\//.test(c.url) ? c.url : null
}

export function urlFromAsset(item) {
  if (!item) return null
  if (item.url) return item.url
  const cp = item.meta?.cloudPages
  return (cp && (cp.url || cp.pageUrl || cp.publicUrl || cp.publishUrl || cp.liveUrl)) || urlFromContent(item.content) || null
}

export function toCloudPage(item) {
  return {
    id: item.id,
    name: item.name || '',
    customerKey: item.customerKey || '',
    // Content Builder's asset status stays Draft for published pages; a publish
    // date in meta.cloudPages is what marks one as published (feedback #158).
    status: item.meta?.cloudPages?.publishDate ? 'Published' : (item.status?.name || 'Unknown'),
    assetStatus: item.status?.name || '',
    categoryId: item.category?.id ?? null,
    categoryName: item.category?.name || '',
    createdDate: item.createdDate || null,
    modifiedDate: item.modifiedDate || null,
    assetType: item.assetType?.displayName || item.assetType?.name || '',
    publishDate: item.meta?.cloudPages?.publishDate || null,
    url: urlFromAsset(item),
  }
}

export async function searchCloudPages(stack, query, page = 1) {
  const data = await sfmcFetch(`${CB(stack)}/asset/v1/content/assets/query?scope=ours`, 'POST', cloudPageSearchBody(query, page))
  const items = (data?.items || []).map(toCloudPage)
  return { items, total: data?.count ?? items.length }
}

let sitesCache = null // { stack, promise }

function fetchSites(stack) {
  if (!sitesCache || sitesCache.stack !== stack) {
    const promise = sfmcFetch(`https://cloud-pages.${stack}.marketingcloudapps.com/fuelapi/internal/v2/cloudpages/sites?$page=1&$pagesize=5000`, 'GET')
      .then((d) => d?.entities || [])
    promise.catch(() => { sitesCache = null })
    sitesCache = { stack, promise }
  }
  return sitesCache.promise
}

export function urlFromSites(stack, sites, page) {
  const match = sites.find((s) => (page.customerKey && s.key === page.customerKey) ||
    (page.id && String(s.defaultPageId) === String(page.id)) || (page.name && s.name === page.name))
  if (!match) return null
  if (match.url) return match.url
  return match.siteId ? `https://cloud-pages.${stack}.marketingcloudapps.com/sites/${match.siteId}` : null
}

/** The page's public URL: from its asset, else from the CloudPages sites list. */
export async function resolveCloudPageUrl(stack, page) {
  if (page.url) return page.url
  try {
    const url = urlFromAsset(await sfmcFetch(`${CB(stack)}/asset/v1/content/assets/${page.id}`, 'GET'))
    if (url) return url
  } catch { /* try the sites list */ }
  try {
    return urlFromSites(stack, await fetchSites(stack), page)
  } catch {
    return null
  }
}

// ── Source and preview (feedback #1010, #1011) ──
// CloudPages' own app reads a page as a Content Builder asset from its host, and a
// code resource's text from internal/v2/cloudpages/code-resources/<id>. Which asset
// fields hold the HTML and the code resource ID are guesses until seen live, so
// several likely ones are read and the raw JSON is shown as well.

const CODE_LANGUAGES = [[/json/i, 'json'], [/javascript|\bjs/i, 'js'], [/css/i, 'css'], [/rss/i, 'xml'], [/xml/i, 'xml'], [/text|txt/i, 'txt']]

/** True for JavaScript, CSS, JSON, XML, RSS and Text code resources. */
export function isCodeResource(asset) {
  const t = `${asset?.assetType?.name || ''} ${asset?.assetType?.displayName || ''}`
  return /code\s*resource/i.test(t) || !!codeResourceIdOf(asset, { strict: true })
}

/** The file extension for a code resource's text ('txt' when unknown). */
export function codeLanguage(asset) {
  const t = `${asset?.assetType?.name || ''} ${asset?.assetType?.displayName || ''}`.replace(/coderesource|code resource/gi, '')
  return CODE_LANGUAGES.find(([re]) => re.test(t))?.[1] || 'txt'
}

/**
 * The CloudPages code resource ID behind an asset, or null. `strict` only accepts
 * fields named for code resources; otherwise the page's own CloudPages ID counts too.
 */
export function codeResourceIdOf(asset, { strict = false } = {}) {
  const cp = asset?.meta?.cloudPages || {}
  const id = cp.codeResourceId ?? cp.codeResource?.id ?? asset?.codeResourceId ?? (strict ? null : (cp.id ?? cp.pageId ?? null))
  return id != null && id !== '' ? String(id) : null
}

/** The page's HTML: content with its slots and blocks filled in, else the html view. */
export function htmlFromAsset(asset) {
  if (!asset) return ''
  let html = compile(asset, 'html') || ''
  // A published landing page's content can be just {"url": ...}: the HTML is in the views.
  if (urlFromContent(html) || /^\s*\{/.test(html)) html = compile({ views: asset.views }, 'html') || ''
  return html
}

/** A code resource record's text. */
export function codeFromResource(r) {
  if (r == null) return ''
  if (typeof r === 'string') return r
  const v = r.content ?? r.code ?? r.body ?? r.text ?? r.data?.content ?? r.entity?.content ?? r.entities?.[0]?.content
  return typeof v === 'string' ? v : ''
}

/**
 * A CloudPage's source: { asset, html, code, language, codeResource, contentAsset, errors }.
 * The asset comes from the CloudPages host, else Content Builder's; a landing page's
 * HTML from the Web Page asset it points to (`contentAsset`).
 */
export async function fetchCloudPageSource(stack, page, fetch = sfmcFetch) {
  const errors = []
  let asset = null
  for (const base of [CP(stack), CB(stack)]) {
    try { asset = await fetch(`${base}/asset/v1/content/assets/${page.id}`, 'GET'); if (asset) break } catch (e) { errors.push(e.message) }
  }
  if (!asset) throw new Error(errors[0] || 'The page could not be read.')
  const out = { asset, html: htmlFromAsset(asset), code: '', language: '', codeResource: null, contentAsset: null, errors: [] }
  // A landing page asset has no views; its code is in the Web Page asset that
  // meta.thumbnailRefAssetId names, under views.html.content (user's capture, 2026-10-27).
  const ref = asset.meta?.thumbnailRefAssetId
  if (!out.html && ref != null && String(ref) !== String(page.id)) {
    for (const base of [CP(stack), CB(stack)]) {
      try {
        out.contentAsset = await fetch(`${base}/asset/v1/content/assets/${encodeURIComponent(ref)}`, 'GET')
        if (out.contentAsset) break
      } catch (e) { if (base === CB(stack)) out.errors.push(`Page content (asset ${ref}): ${e.message}`) }
    }
    out.html = htmlFromAsset(out.contentAsset)
  }
  if (isCodeResource(asset)) {
    out.language = codeLanguage(asset)
    const id = codeResourceIdOf(asset)
    if (id) {
      try {
        out.codeResource = await fetch(`${CP(stack)}/internal/v2/cloudpages/code-resources/${id}`, 'GET')
        out.code = codeFromResource(out.codeResource)
      } catch (e) { out.errors.push(`Code resource ${id}: ${e.message}`) }
    }
    // The asset itself may carry the text.
    if (!out.code) out.code = typeof asset.content === 'string' && !urlFromContent(asset.content) ? asset.content : ''
  }
  return out
}

const folderCache = new Map() // `${stack}:${id}` → Promise<{ name, parentId }>

/** "Folder > Sub folder" under CloudPages ('Root' at the top level). */
export async function fetchCloudPageFolderPath(stack, categoryId) {
  const parts = []
  let id = categoryId != null ? String(categoryId) : ''
  for (let depth = 0; id && id !== '0' && depth < 30; depth++) {
    const key = `${stack}:${id}`
    if (!folderCache.has(key)) {
      const p = sfmcFetch(`${CB(stack)}/asset/v1/content/categories/${id}/?categoryType=cloudpages&$page=1&$pagesize=500`, 'GET')
        .then((d) => ({ name: d?.name || '', parentId: String(d?.parentId ?? '0') }))
      p.catch(() => folderCache.delete(key))
      folderCache.set(key, p)
    }
    const f = await folderCache.get(key)
    if (!f.name) break
    if (f.name !== 'CloudPages') parts.unshift(f.name)
    id = f.parentId
  }
  return parts.length ? parts.join(' > ') : 'Root'
}

export function clearCloudPageCaches() {
  folderCache.clear()
  sitesCache = null
}
