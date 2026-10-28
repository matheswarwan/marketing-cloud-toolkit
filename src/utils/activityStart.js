// Run once for Automation Studio activities other than SQL Query (feedback #135, #136).
// Data extracts are confirmed from the user's request on s50: POST
// AutomationStudioFuel3/fuelapi/automation/v1/dataextracts/<id>/actions/start with
// {"dataExtractDefinitionId": "<id>"}. Imports, file transfers and scripts follow the
// same pattern, with the body named after each record's ID field; not checked live.
// SQL Query activities keep their own run menu (startQueryActivity in sfmcApi.js).

const AS_BASE = (stack) => `https://mc.${stack}.marketingcloudapps.com/AutomationStudioFuel3/fuelapi`

export const START_TYPES = {
  73: { path: 'dataextracts', idField: 'dataExtractDefinitionId', label: 'Data Extract', tested: true },
  43: { path: 'imports', idField: 'importDefinitionId', label: 'Import File', tested: false },
  53: { path: 'filetransfers', idField: 'id', label: 'File Transfer', tested: false },
  423: { path: 'scripts', idField: 'ssjsActivityId', label: 'Script', tested: false },
}

/** { typeId, id, label, tested } for an activity record that can be started, else null. */
export function startTarget(typeId, record) {
  const t = START_TYPES[typeId]
  if (!t || !record) return null
  const id = record[t.idField] || (record._fromStep ? record.activityObjectId : null)
  return id ? { typeId: Number(typeId), id: String(id), label: t.label, tested: t.tested } : null
}

/** The request that starts one activity: { url, body }. */
export function startRequest(stack, typeId, id) {
  const t = START_TYPES[typeId]
  if (!t) throw new Error(`Activity type ${typeId} cannot be started from the Toolkit.`)
  return {
    url: `${AS_BASE(stack)}/automation/v1/${t.path}/${encodeURIComponent(id)}/actions/start`,
    body: { [t.idField]: id },
  }
}
