// Journey entry events (event definitions), from SFMC Automation Viewer's Journey
// Activity Details. Journey Builder is reached with its own session cookies; the
// service worker starts that session when needed (src/background/sessions.js).
import { sfmcFetch } from './sfmcApi.js'
import { formatValue } from './activityTypes.js'

export const EVENT_TYPES = {
  EmailAudience: 'Data Extension (Email Audience)',
  ContactAudience: 'Contact Audience',
  AutomationAudience: 'Data Extension sent from Automation Studio',
  APIEvent: 'API Event',
  CloudPagesSmartCaptureSubmissionEvent: 'CloudPages',
  SalesforceObjectTriggerV2: 'Salesforce Data',
  ContactEvent: 'Contact Event',
}
export const EVENT_CATEGORIES = { Audience: 'Audience', Event: 'Event', ContactEvent: 'Contact Event' }

export async function fetchEventDefinitions(stack) {
  const data = await sfmcFetch(`https://jbinteractions.${stack}.marketingcloudapps.com/fuelapi/interaction/v1/eventDefinitions?$page=1&$pagesize=1000&$orderBy=modifiedDate%20desc`, 'GET')
  const items = data?.items || []
  return { items, total: data?.count ?? items.length }
}

const has = (value, part) => String(value ?? '').toLowerCase().includes(String(part).trim().toLowerCase())

/**
 * Client-side filters. Text filters are case-insensitive "contains"; `journeyStatus`
 * is 'active' (published in a journey) or 'inactive'; `scheduledFrom` keeps event
 * definitions whose schedule ends on or after that day.
 * (Automation Viewer's Event Definition Key filter read the DE ID box; fixed here.)
 */
export function filterEventDefinitions(items, f = {}, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return items.filter((it) =>
    (!f.type || it.type === f.type) &&
    (!f.category || it.category === f.category) &&
    (!f.name?.trim() || has(it.name, f.name)) &&
    (!f.key?.trim() || has(it.eventDefinitionKey, f.key)) &&
    (!f.deName?.trim() || has(it.dataExtensionName, f.deName)) &&
    (!f.deId?.trim() || has(it.dataExtensionId, f.deId)) &&
    (!f.journeyStatus || (f.journeyStatus === 'active' ? Number(it.publishedInteractionCount) > 0 : !Number(it.publishedInteractionCount))) &&
    (!f.scheduledFrom || (it.schedule?.endDateTime && new Date(it.schedule.endDateTime) >= today)))
}

export function eventIconUrl(stack, item) {
  const icon = item?.iconUrl
  if (!icon) return null
  if (/^https:\/\//.test(icon)) return icon
  return `https://jbinteractions.${stack}.marketingcloudapps.com/${String(icon).replace(/^\/+/, '')}`
}

const kv = (title, obj) => (obj && typeof obj === 'object' && Object.keys(obj).length
  ? { title, columns: ['Property', 'Value'], rows: Object.entries(obj).map(([k, v]) => [k, formatValue(v)]) }
  : null)

/** Display data for ActivityCard (see utils/activityTypes.js). */
export function describeEventDefinition(it, stack) {
  const published = Number(it.publishedInteractionCount) || 0
  return {
    typeLabel: EVENT_TYPES[it.type] || it.type || 'Event',
    title: it.name || it.eventDefinitionKey || 'Event definition',
    icon: eventIconUrl(stack, it),
    link: null,
    main: [
      ['Event definition key', formatValue(it.eventDefinitionKey)],
      ['Data extension', formatValue(it.dataExtensionName)],
      ['Journey status', published ? `Active (${published} published ${published === 1 ? 'journey' : 'journeys'})` : 'Not active'],
      ['Journeys using it', formatValue(it.interactionCount)],
      ['Category', formatValue(it.category)],
      ['Mode', formatValue(it.mode)],
      ['Automation ID', formatValue(it.automationId)],
      ['Created', formatValue(it.createdDate)], ['Created by', formatValue(it.createdBy)],
      ['Modified', formatValue(it.modifiedDate)], ['Modified by', formatValue(it.modifiedBy)],
    ],
    extra: [
      ['Description', formatValue(it.description)], ['Type', formatValue(it.type)], ['Data extension ID', formatValue(it.dataExtensionId)],
      ['ID', formatValue(it.id)], ['Source application extension ID', formatValue(it.sourceApplicationExtensionId)],
      ['Platform object', formatValue(it.isPlatformObject)], ['Visible in picker', formatValue(it.isVisibleInPicker)],
      ['Arguments: criteria', formatValue(it.arguments?.criteria)], ['Arguments: serialized object type', formatValue(it.arguments?.serializedObjectType)],
      ['Arguments: event definition ID', formatValue(it.arguments?.eventDefinitionId)],
    ],
    code: null,
    tables: [kv('Schedule', it.schedule), { ...(kv('Metadata', it.metaData) || {}), extra: true }].filter((t) => t?.rows),
    // View, SFMC link and row count next to the data extension (feedback #72).
    deRefs: it.dataExtensionName ? { 'Data extension': { name: it.dataExtensionName, id: it.dataExtensionId || null, key: null } } : {},
  }
}
