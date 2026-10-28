// Orphan contacts, after Mateusz Dąbrowski's "Contact Deletion"
// (https://mateuszdabrowski.pl/docs/salesforce/marketing-cloud-engagement/config/contact-deletion/).
// A filtered mobile list of All Contacts (made by hand: there is no API for it)
// exposes every Contact Key to SQL. Queries collect the contacts that no longer
// exist in Salesforce CRM into a sendable "Contact Deletion Pending" DE; the
// deletion itself stays a manual step in Contact Builder.

const text = (name, length, extra = {}) => ({ name, type: 'text', length, ...extra })

export const orphanContacts = {
  id: 'orphan-contacts',
  title: 'Orphan contacts',
  summary: 'Finds contacts whose Salesforce CRM record is gone (deleted, or Leads and Users no longer synced) and collects them for deletion in Contact Builder.',
  source: { label: 'Mateusz Dąbrowski: Contact Deletion', url: 'https://mateuszdabrowski.pl/docs/salesforce/marketing-cloud-engagement/config/contact-deletion/' },

  defaults: {
    listName: 'AllContactsList',
    checkLeadsUsers: true,
    checkContacts: true,
    leadDE: 'Lead_Salesforce',
    userDE: 'User_Salesforce',
    contactDE: 'Contact_Salesforce',
    archive: true,
    fromParent: false,
    pendingName: 'Contact Deletion Pending',
    archiveName: 'Contact Deletion Archive',
    automationName: 'Orphan contacts - find',
  },

  options: [
    { key: 'listName', label: 'All Contacts list name', type: 'text', help: 'The filtered mobile list you made (see Before you start).' },
    { key: 'checkLeadsUsers', label: 'Leads and Users no longer synced from Salesforce', type: 'checkbox' },
    { key: 'leadDE', label: 'Lead synchronized data extension', type: 'text', showIf: 'checkLeadsUsers' },
    { key: 'userDE', label: 'User synchronized data extension', type: 'text', showIf: 'checkLeadsUsers' },
    { key: 'checkContacts', label: 'Contacts deleted in Salesforce', type: 'checkbox' },
    { key: 'contactDE', label: 'Contact synchronized data extension', type: 'text', showIf: 'checkContacts' },
    { key: 'archive', label: 'Keep an archive (hashed email, reason, date) of contacts collected for deletion', type: 'checkbox' },
    { key: 'pendingName', label: 'Pending data extension name', type: 'text' },
    { key: 'archiveName', label: 'Archive data extension name', type: 'text', showIf: 'archive' },
    { key: 'fromParent', label: 'Read subscribers from the parent business unit (ENT._Subscribers; needed in a child business unit)', type: 'checkbox', showIf: 'archive' },
    { key: 'automationName', label: 'Automation name', type: 'text' },
  ],

  before: [
    'Needs Mobile Studio (MobileConnect) to make the list below, and Marketing Cloud Connect for the Salesforce synchronized data extensions.',
    'Make the All Contacts list by hand (there is no API for it): Contact Builder > All Contacts > Mobile Lists > Create Mobile List; channel MobileConnect, Filtered List; pick All Contacts; remove the Mobile Number filter; drag System Data > Contact > Contact Key into the filter and set it to "is not null"; Done; Save as Filter, named as in "All Contacts list name" below.',
    'Stop syncing the Leads and Users you want gone (for example a ShouldSyncToSFMC checkbox in Salesforce used as the Marketing Cloud Connect filter), or they come back with the next sync.',
  ],

  after: (o) => [
    `Run the automation "${o.automationName}" once in Automation Studio (Run Once). It is not scheduled and was not run.`,
    `Review the rows in "${o.pendingName}". Remove any contact that must stay.`,
    `Delete: Contact Builder > All Contacts > the delete icon with nothing selected > Delete contacts from list / data extension > choose "${o.pendingName}" > Delete Contacts. Up to 1 million contacts per operation.`,
    'Contact Builder > Contacts Configuration > Contact Delete sets the suppression period (default 2 days). Until it ends the contacts are only suppressed; after it, deletion cannot be undone. Deleting from Email Studio does not start the Contact Delete process.',
  ],

  plan(o) {
    if (!o.checkLeadsUsers && !o.checkContacts) throw new Error('Pick at least one check.')
    const list = `[${o.listName}]`
    const pending = {
      ref: 'pending', name: o.pendingName, key: 'contact-deletion-pending-de', sendableField: 'SubscriberKey',
      fields: [text('SubscriberKey', 18, { isPrimaryKey: true, isNullable: false }), text('DeletionReason', 50), { name: 'DeletionDate', type: 'date' }],
    }
    const des = [pending]
    const queries = []
    if (o.checkLeadsUsers) {
      queries.push({
        ref: 'leadsUsers', name: `${o.automationName} - Leads and Users not synced`, target: 'pending',
        sql: `SELECT
    contact.SubscriberKey,
    CASE WHEN contact.SubscriberKey LIKE '005%' THEN 'User not synced from Salesforce' ELSE 'Lead not synced from Salesforce' END AS DeletionReason,
    GETDATE() AS DeletionDate
FROM ${list} AS contact
    LEFT JOIN [${o.leadDE}] AS lead ON lead.Id = contact.SubscriberKey
    LEFT JOIN [${o.userDE}] AS sfUser ON sfUser.Id = contact.SubscriberKey
WHERE
    (contact.SubscriberKey LIKE '005%' AND sfUser.Id IS NULL)
    OR (contact.SubscriberKey LIKE '00Q%' AND lead.Id IS NULL)`,
      })
    }
    if (o.checkContacts) {
      queries.push({
        ref: 'contacts', name: `${o.automationName} - Contacts deleted in Salesforce`, target: 'pending',
        // Only Contact IDs (003): other keys are not expected in Contact_Salesforce.
        sql: `SELECT
    contact.SubscriberKey,
    'Contact deleted in Salesforce' AS DeletionReason,
    GETDATE() AS DeletionDate
FROM ${list} AS contact
    LEFT JOIN [${o.contactDE}] AS crm ON crm.Id = contact.SubscriberKey
WHERE contact.SubscriberKey LIKE '003%' AND crm.Id IS NULL`,
      })
    }
    // The first query replaces last run's list; the next one adds to it.
    queries.forEach((q, i) => { q.updateType = i === 0 ? 0 : 1 })
    if (o.archive) {
      des.push({
        ref: 'archive', name: o.archiveName, key: 'contact-deletion-archive-de',
        fields: [text('SubscriberKey', 18, { isPrimaryKey: true, isNullable: false }), text('HashedEmail', 64), text('DeletionReason', 50), { name: 'LastDeletionDate', type: 'date' }],
      })
      queries.push({
        ref: 'archive', name: `${o.automationName} - Archive`, target: 'archive', updateType: 1,
        sql: `SELECT
    pending.SubscriberKey,
    CONVERT(NVARCHAR(64), HASHBYTES('SHA2_256', LOWER(sub.EmailAddress)), 2) AS HashedEmail,
    pending.DeletionReason,
    pending.DeletionDate AS LastDeletionDate
FROM [${o.pendingName}] AS pending
    LEFT JOIN ${o.fromParent ? 'ENT._Subscribers' : '_Subscribers'} AS sub ON sub.SubscriberKey = pending.SubscriberKey`,
      })
    }
    return {
      des,
      queries,
      automation: {
        name: o.automationName,
        description: 'Created by Marketing Cloud Toolkit (Orphan contacts template). Collects contacts to delete; deletion is done by hand in Contact Builder.',
        // One query per step: each step waits for the one before.
        steps: queries.map((q, i) => ({ name: `Step ${i + 1}`, queries: [q.ref] })),
      },
    }
  },
}
