// SFMC system Data Views — shared across query execution and Query Builder

export const DATA_VIEWS = new Set([
  '_Subscribers','_EnterpriseAttribute','_ListSubscribers','_BusinessUnitUnsubscribes',
  '_Job','_Sent','_Open','_Click','_Bounce','_Complaint','_Unsubscribe','_FTAF',
  '_Journey','_JourneyActivity','_AutomationInstance','_AutomationActivityInstance',
  '_MobileAddress','_MobileSubscription','_SMSSubscriptionLog','_SMSMessageTracking',
  '_UndeliverableSMS','_UndeliverableSms',
  '_ReconcilableDispositionView','_SurveyResponse',
  '_SocialNetworkImpressions','_SocialNetworkTracking','_Coupon',
  '_ChatMessagingSubscription','_PushAddress','_PushTag',
  '_MobileLineAddressContactSubscriptionView','_MobileLineOrphanContactView',
  '_GroupConnectContactSubscriptions','_GroupConnectMobileLineOrphanContactView',
])

// Field definitions for SFMC data views (used when SELECT * targets a data view).
// Keys are uppercase data view names. Type numbers: 0=Text,1=Number,2=Date,3=Boolean,4=Email,5=Phone
export const DATA_VIEW_FIELDS = {
  _JOB: [
    {name:'AccountID',type:1},{name:'AccountUserID',type:1},{name:'JobID',type:1},{name:'EmailID',type:1},
    {name:'FromName',type:0},{name:'FromEmail',type:4},{name:'SchedTime',type:2},{name:'PickupTime',type:2},
    {name:'DeliveredTime',type:2},{name:'TriggererSendDefinitionObjectID',type:0},{name:'TriggeredSendCustomerKey',type:0},
    {name:'EventID',type:0},{name:'IsMultipart',type:3},{name:'JobType',type:0},{name:'JobStatus',type:0},
    {name:'ModifiedBy',type:1},{name:'ModifiedDate',type:2},{name:'EmailName',type:0},{name:'EmailSubject',type:0},
    {name:'IsWrapped',type:3},{name:'TestEmailAddr',type:4},{name:'Category',type:0},{name:'BccEmail',type:4},
    {name:'OriginalSchedTime',type:2},{name:'CreatedDate',type:2},{name:'CharacterSet',type:0},
    {name:'IPAddress',type:0},{name:'SalesForceTotalSubscriberCount',type:1},{name:'SalesForceErrorSubscriberCount',type:1},
    {name:'SendType',type:0},{name:'DynamicEmailSubject',type:0},{name:'SuppressTracking',type:3},
    {name:'SendClassificationType',type:0},{name:'SendClassification',type:0},
    {name:'ResolveLinksWithCurrentData',type:3},{name:'EmailSendDefinition',type:0},{name:'DeduplicateByEmail',type:3},
  ],
  _SENT: [
    {name:'AccountID',type:1},{name:'OYBAccountID',type:1},{name:'JobID',type:1},{name:'ListID',type:1},
    {name:'BatchID',type:1},{name:'SubscriberID',type:1},{name:'SubscriberKey',type:0},{name:'EventDate',type:2},
    {name:'Domain',type:0},{name:'TriggererSendDefinitionObjectID',type:0},{name:'TriggeredSendCustomerKey',type:0},
  ],
  _OPEN: [
    {name:'AccountID',type:1},{name:'OYBAccountID',type:1},{name:'JobID',type:1},{name:'ListID',type:1},
    {name:'BatchID',type:1},{name:'SubscriberID',type:1},{name:'SubscriberKey',type:0},{name:'EventDate',type:2},
    {name:'Domain',type:0},{name:'IsUnique',type:3},
    {name:'TriggererSendDefinitionObjectID',type:0},{name:'TriggeredSendCustomerKey',type:0},
  ],
  _CLICK: [
    {name:'AccountID',type:1},{name:'OYBAccountID',type:1},{name:'JobID',type:1},{name:'ListID',type:1},
    {name:'BatchID',type:1},{name:'SubscriberID',type:1},{name:'SubscriberKey',type:0},{name:'EventDate',type:2},
    {name:'Domain',type:0},{name:'URL',type:0},{name:'LinkName',type:0},{name:'LinkContent',type:0},
    {name:'IsUnique',type:3},{name:'TriggererSendDefinitionObjectID',type:0},{name:'TriggeredSendCustomerKey',type:0},
  ],
  _BOUNCE: [
    {name:'AccountID',type:1},{name:'OYBAccountID',type:1},{name:'JobID',type:1},{name:'ListID',type:1},
    {name:'BatchID',type:1},{name:'SubscriberID',type:1},{name:'SubscriberKey',type:0},{name:'EventDate',type:2},
    {name:'Domain',type:0},{name:'BounceCategoryID',type:1},{name:'BounceCategory',type:0},
    {name:'BounceSubcategoryID',type:1},{name:'BounceSubcategory',type:0},
    {name:'BounceTypeID',type:1},{name:'BounceType',type:0},
    {name:'SMTPBounceReason',type:0,length:500},{name:'SMTPMessage',type:0},{name:'SMTPCode',type:1},
    {name:'IsUnique',type:3},{name:'TriggererSendDefinitionObjectID',type:0},{name:'TriggeredSendCustomerKey',type:0},
  ],
  _COMPLAINT: [
    {name:'AccountID',type:1},{name:'OYBAccountID',type:1},{name:'JobID',type:1},{name:'ListID',type:1},
    {name:'BatchID',type:1},{name:'SubscriberID',type:1},{name:'SubscriberKey',type:0},{name:'EventDate',type:2},
    {name:'IsUnique',type:3},{name:'Domain',type:0},
  ],
  _UNSUBSCRIBE: [
    {name:'AccountID',type:1},{name:'OYBAccountID',type:1},{name:'JobID',type:1},{name:'ListID',type:1},
    {name:'BatchID',type:1},{name:'SubscriberID',type:1},{name:'SubscriberKey',type:0},{name:'EventDate',type:2},
    {name:'IsUnique',type:3},{name:'Domain',type:0},
  ],
  _FTAF: [
    {name:'AccountID',type:1},{name:'OYBAccountID',type:1},{name:'JobID',type:1},{name:'ListID',type:1},
    {name:'BatchID',type:1},{name:'SubscriberID',type:1},{name:'SubscriberKey',type:0},{name:'TransactionTime',type:2},
    {name:'Domain',type:0},{name:'IsUnique',type:3},
    {name:'TriggererSendDefinitionObjectID',type:0},{name:'TriggeredSendCustomerKey',type:0},
  ],
  _BUSINESSUNITUNSUBSCRIBES: [
    {name:'BusinessUnitID',type:1},{name:'UnsubDateUTC',type:2},{name:'UnsubReason',type:0},
    {name:'SubscriberID',type:1},{name:'SubscriberKey',type:0},
  ],
  _RECONCILABLEDISPOSITIONVIEW: [
    {name:'JobId',type:1},{name:'Channel',type:0},{name:'Disposition',type:0},{name:'MessageKey',type:0},
    {name:'SubscriberKey',type:0},{name:'SubscriberId',type:1},{name:'ErrorCodeId',type:1},
    {name:'ErrorDescription',type:0},{name:'ErrorName',type:0},{name:'StartTime',type:2},
  ],
  _SURVEYRESPONSE: [
    {name:'AccountID',type:1},{name:'OYBAccountID',type:1},{name:'JobID',type:1},{name:'ListID',type:1},
    {name:'BatchID',type:1},{name:'SubscriberID',type:1},{name:'SubscriberKey',type:0},{name:'EventDate',type:2},
    {name:'Domain',type:0},{name:'SurveyID',type:1},{name:'SurveyName',type:0},{name:'IsUnique',type:3},
    {name:'QuestionID',type:1},{name:'QuestionName',type:0},{name:'Question',type:0},
    {name:'AnswerID',type:1},{name:'AnswerName',type:0},{name:'Answer',type:0},{name:'AnswerData',type:0},
  ],
  _SOCIALNETWORKIMPRESSIONS: [
    {name:'JobID',type:1},{name:'ListID',type:1},{name:'RegionTitle',type:0},{name:'RegionDescription',type:0},
    {name:'RegionHTML',type:0,length:4000},{name:'ContentRegionID',type:1},{name:'SocialSharingSiteID',type:1},
    {name:'SiteName',type:0},{name:'CountryCode',type:0},{name:'ReferringURL',type:0},{name:'IPAddress',type:0},
    {name:'TransactionTime',type:2},{name:'PublishedSocialContentStatusID',type:1},{name:'ShortCode',type:0},
    {name:'PublishTime',type:2},
  ],
  _SOCIALNETWORKTRACKING: [
    {name:'SubscriberID',type:1},{name:'SubscriberKey',type:0},{name:'ListID',type:1},{name:'BatchID',type:1},
    {name:'SocialSharingSiteID',type:1},{name:'SiteName',type:0},{name:'CountryCode',type:0},
    {name:'PublishedSocialContentID',type:1},{name:'RegionTitle',type:0},{name:'RegionDescription',type:0},
    {name:'RegionHTML',type:0,length:4000},{name:'ContentRegionID',type:1},{name:'OYBMemberID',type:1},
    {name:'TransactionTime',type:2},{name:'IsUnique',type:3},{name:'Domain',type:0},
    {name:'PublishedSocialContentStatusID',type:1},{name:'ShortCode',type:0},{name:'PublishTime',type:2},
  ],
  _COUPON: [
    {name:'Name',type:0},{name:'ExternalKey',type:0},{name:'Description',type:0},
    {name:'BeginDate',type:2},{name:'ExpirationDate',type:2},
  ],
  _ENTERPRISEATTRIBUTE: [
    {name:'_SubscriberID',type:1},
  ],
  _SUBSCRIBERS: [
    {name:'SubscriberID',type:1},{name:'SubscriberKey',type:0},{name:'DateUndeliverable',type:2},
    {name:'DateJoined',type:2},{name:'DateUnsubscribed',type:2},{name:'Domain',type:0},
    {name:'EmailAddress',type:4},{name:'BounceCount',type:1},{name:'SubscriberType',type:0},
    {name:'Status',type:0},{name:'Locale',type:0},
  ],
  _LISTSUBSCRIBERS: [
    {name:'SubscriberID',type:1},{name:'SubscriberKey',type:0},{name:'AddedBy',type:1},
    {name:'AddMethod',type:0},{name:'CreatedDate',type:2},{name:'DateUnsubscribed',type:2},
    {name:'EmailAddress',type:4},{name:'ListID',type:1},{name:'ListName',type:0},
    {name:'ListType',type:0},{name:'Status',type:0},{name:'SubscriberType',type:0},
  ],
  _JOURNEY: [
    {name:'VersionID',type:0},{name:'JourneyID',type:0},{name:'JourneyName',type:0},
    {name:'VersionNumber',type:1},{name:'CreatedDate',type:2},{name:'LastPublishedDate',type:2},
    {name:'ModifiedDate',type:2},{name:'JourneyStatus',type:0},
  ],
  _JOURNEYACTIVITY: [
    {name:'VersionID',type:0},{name:'ActivityID',type:0},{name:'ActivityName',type:0},
    {name:'ActivityExternalKey',type:0},{name:'JourneyActivityObjectID',type:0},{name:'ActivityType',type:0},
  ],
  _AUTOMATIONINSTANCE: [
    {name:'MemberID',type:1},{name:'AutomationName',type:0},{name:'AutomationCustomerKey',type:0},
    {name:'AutomationDescription',type:0},{name:'AutomationType',type:0},
    {name:'AutomationNotificationRecipient_Complete',type:0},{name:'AutomationNotificationRecipient_Error',type:0},
    {name:'AutomationNotificationRecipient_Skip',type:0},{name:'AutomationStepCount',type:1},
    {name:'AutomationInstanceID',type:0},{name:'AutomationInstanceIsRunOnce',type:3},
    {name:'FilenameFromTrigger',type:0},{name:'AutomationInstanceScheduledTime_UTC',type:2},
    {name:'AutomationInstanceStartTime_UTC',type:2},{name:'AutomationInstanceEndTime_UTC',type:2},
    {name:'AutomationInstanceStatus',type:0},{name:'AutomationInstanceActivityErrorDetails',type:0},
  ],
  _AUTOMATIONACTIVITYINSTANCE: [
    {name:'MemberID',type:1},{name:'AutomationName',type:0},{name:'AutomationCustomerKey',type:0},
    {name:'AutomationInstanceID',type:0},{name:'ActivityType',type:0},{name:'ActivityName',type:0},
    {name:'ActivityDescription',type:0},{name:'ActivityCustomerKey',type:0},
    {name:'ActivityInstanceStep',type:1},{name:'ActivityInstanceID',type:0},
    {name:'ActivityInstanceStartTime_UTC',type:2},{name:'ActivityInstanceEndTime_UTC',type:2},
    {name:'ActivityInstanceStatus',type:0},{name:'ActivityInstanceStatusDetails',type:0},
  ],
  _SMSMESSAGETRACKING: [
    {name:'Mobile',type:0},{name:'SubscriberKey',type:0},{name:'SubscriberID',type:1},
    {name:'MobileMessageTrackingID',type:1},{name:'EID',type:1},{name:'MID',type:1},
    {name:'MessageID',type:0},{name:'KeywordID',type:1},{name:'CodeID',type:1},
    {name:'ConversationID',type:0},{name:'CampaignID',type:1},{name:'Sent',type:1},
    {name:'Delivered',type:1},{name:'Undelivered',type:1},{name:'Outbound',type:3},{name:'Inbound',type:3},
    {name:'CreateDateTime',type:2},{name:'ModifiedDateTime',type:2},{name:'ActionDateTime',type:2},
    {name:'MessageText',type:0},{name:'IsTest',type:3},{name:'MobileMessageRecurrenceID',type:1},
    {name:'ResponseToMobileMessageTrackingID',type:1},{name:'IsValid',type:3},{name:'InvalidationCode',type:1},
    {name:'SendID',type:1},{name:'SendSplitID',type:1},{name:'SendSegmentID',type:1},
    {name:'SendJobID',type:1},{name:'SendGroupID',type:1},{name:'SendPersonID',type:1},
    {name:'SMSStandardStatusCodeId',type:1},{name:'Description',type:0},{name:'Name',type:0},
    {name:'ShortCode',type:0},{name:'SharedKeyword',type:0},{name:'Ordinal',type:1},
    {name:'FromName',type:0},{name:'JBActivityID',type:0},{name:'JBDefinitionID',type:0},
    {name:'SMSJobID',type:1},{name:'SMSBatchID',type:1},
  ],
  _SMSSUBSCRIPTIONLOG: [
    {name:'MobileNumber',type:5},{name:'SubscriberKey',type:0},{name:'LogDate',type:2},
    {name:'MobileSubscriptionID',type:1},{name:'SubscriptionDefinitionID',type:1},
    {name:'OptOutStatusID',type:1},{name:'OptOutMethodID',type:1},{name:'OptOutDate',type:2},
    {name:'OptInStatusID',type:1},{name:'OptInMethodID',type:1},{name:'OptInDate',type:2},
    {name:'Source',type:0},{name:'CreatedDate',type:2},{name:'ModifiedDate',type:2},
  ],
  _UNDELIVERABLESMS: [
    {name:'MobileNumber',type:5},{name:'Undeliverable',type:1},{name:'BounceCount',type:1},
    {name:'FirstBounceDate',type:2},{name:'HoldDate',type:2},
  ],
  _MOBILEADDRESS: [
    {name:'_MobileNumber',type:0},{name:'_ContactID',type:0},{name:'_Status',type:0},
    {name:'_Source',type:0},{name:'_SourceObjectId',type:0},{name:'_Priority',type:1},
    {name:'_Channel',type:0},{name:'_CarrierID',type:1},{name:'_CountryCode',type:0},
    {name:'_CreatedDate',type:2},{name:'_CreatedBy',type:0},{name:'_ModifiedDate',type:2},
    {name:'_ModifiedBy',type:0},{name:'_City',type:0},{name:'_State',type:0},{name:'_ZipCode',type:0},
    {name:'_FirstName',type:0},{name:'_LastName',type:0},{name:'_UTCOffset',type:0},{name:'_IsHonorDST',type:3},
  ],
  _MOBILESUBSCRIPTION: [
    {name:'_MobileNumber',type:0},{name:'_SubscriptionDefinitionID',type:0},
    {name:'_OptOutStatusID',type:1},{name:'_OptOutMethodID',type:1},{name:'_OptOutDate',type:2},
    {name:'_OptInStatusID',type:1},{name:'_OptInMethodID',type:1},{name:'_OptInDate',type:2},
    {name:'_Source',type:0},{name:'_CreatedDate',type:2},{name:'_SourceObjectId',type:0},
    {name:'_CreatedBy',type:0},{name:'_ModifiedDate',type:2},{name:'_ModifiedBy',type:0},
  ],
  _CHATMESSAGINGSUBSCRIPTION: [
    {name:'_MobileNumber',type:0},{name:'_ChannelId',type:0},{name:'_ChannelType',type:0},
    {name:'_OptOutStatusID',type:1},{name:'_OptOutMethodID',type:1},{name:'_OptOutDate',type:2},
    {name:'_OptinStatusID',type:1},{name:'_OptinMethodID',type:1},{name:'_OptinDate',type:2},
    {name:'_Source',type:0},{name:'_SourceObjectId',type:0},{name:'_CreatedDate',type:2},
    {name:'_CreatedBy',type:0},{name:'_ModifiedDate',type:2},{name:'_ModifiedBy',type:0},
  ],
  _PUSHADDRESS: [
    {name:'_DeviceID',type:0},{name:'_ContactID',type:0},{name:'_APID',type:0},
    {name:'_Status',type:0},{name:'_Source',type:0},{name:'_SourceObjectId',type:0},
    {name:'_Platform',type:0},{name:'_PlatformVersion',type:0},{name:'_Alias',type:0},
    {name:'_OptOutStatusID',type:1},{name:'_OptOutMethodID',type:1},{name:'_OptOutDate',type:2},
    {name:'_OptInStatusID',type:1},{name:'_OptInMethodID',type:1},{name:'_OptInDate',type:2},
    {name:'_Channel',type:0},{name:'_CreatedDate',type:2},{name:'_CreatedBy',type:0},
    {name:'_ModifiedDate',type:2},{name:'_ModifiedBy',type:0},{name:'_City',type:0},
    {name:'_State',type:0},{name:'_ZipCode',type:0},{name:'_FirstName',type:0},{name:'_LastName',type:0},
    {name:'_UTCOffset',type:0},{name:'_IsHonorDST',type:3},{name:'_SystemToken',type:0},
    {name:'_ProviderToken',type:0},{name:'_Badge',type:1},{name:'_LocationEnabled',type:3},
    {name:'_TimeZone',type:0},{name:'_Device',type:0},{name:'_HardwareId',type:0},{name:'_DeviceType',type:0},
  ],
  _PUSHTAG: [
    {name:'_DeviceID',type:0},{name:'_APID',type:0},{name:'_Value',type:0},
    {name:'_CreatedDate',type:2},{name:'_CreatedBy',type:0},{name:'_ModifiedDate',type:2},{name:'_ModifiedBy',type:0},
  ],
  _MOBILELINEADDRESSCONTACTSUBSCRIPTIONVIEW: [
    {name:'ContactID',type:0},{name:'ContactKey',type:0},{name:'ChannelID',type:1},
    {name:'AddressID',type:0},{name:'IsActive',type:3},{name:'CreatedDate',type:2},{name:'ModifiedDate',type:2},
  ],
  _MOBILELINEORPHANCONTACTVIEW: [
    {name:'ContactID',type:0},{name:'ContactKey',type:0},{name:'AddressID',type:0},{name:'CreatedDate',type:2},
  ],
  // Legacy aliases
  get _GROUPCONNECTCONTACTSUBSCRIPTIONS() { return this._MOBILELINEADDRESSCONTACTSUBSCRIPTIONVIEW },
  get _GROUPCONNECTMOBILELINEORPHANCONTACTVIEW() { return this._MOBILELINEORPHANCONTACTVIEW },
}


export function isSkippableDE(name) {
  return DATA_VIEWS.has(name) || name.startsWith("_") || /^ent./i.test(name)
}

// Short descriptions of the main data views, for editor hover docs.
// Keys are uppercase data view names, like DATA_VIEW_FIELDS.
const TRACKING_KEYS = ['JobID', 'ListID', 'BatchID', 'SubscriberID']
const TRACKING_NOTE = 'Keeps about 6 months of data. Join to _Job on JobID for email details. Join to other tracking views on JobID, ListID, BatchID and SubscriberID together to match the same send.'

export const DATA_VIEW_INFO = {
  _SUBSCRIBERS: {
    description: 'Email subscribers in the All Subscribers list, with status, email address and dates joined, unsubscribed and marked undeliverable.',
    joinKeys: ['SubscriberID', 'SubscriberKey'],
    notes: 'Subscribers are held at the enterprise level. From a child business unit, query ENT._Subscribers to see them. Status is the All Subscribers status, not a list status.',
  },
  _ENTERPRISEATTRIBUTE: {
    description: 'Profile attributes defined at the enterprise level, one row per subscriber.',
    joinKeys: ['_SubscriberID'],
    notes: 'Join to _Subscribers with _SubscriberID = SubscriberID. Query from the parent business unit, or use ENT._EnterpriseAttribute from a child business unit. Column names are the attribute names in your account.',
  },
  _LISTSUBSCRIBERS: {
    description: 'Which subscribers belong to which lists, with the list name, list type and the status on that list.',
    joinKeys: ['SubscriberID', 'SubscriberKey', 'ListID'],
    notes: 'Results depend on the business unit the query runs in. Use ENT._ListSubscribers for lists owned by the parent business unit.',
  },
  _BUSINESSUNITUNSUBSCRIBES: {
    description: 'Subscribers who unsubscribed from a specific business unit, with the date (UTC) and reason.',
    joinKeys: ['SubscriberID', 'SubscriberKey', 'BusinessUnitID'],
    notes: 'Use this for business unit level unsubscribes in an Enterprise 2.0 account. All Subscribers status lives in _Subscribers.',
  },
  _JOB: {
    description: 'One row per email send job, with the email name, subject, from details, send times and status.',
    joinKeys: ['JobID'],
    notes: 'Join tracking views (_Sent, _Open, _Click, _Bounce and others) to this view on JobID.',
  },
  _SENT: {
    description: 'One row for each email sent to a subscriber.',
    joinKeys: TRACKING_KEYS,
    notes: TRACKING_NOTE,
  },
  _OPEN: {
    description: 'Email opens, one row per open event. IsUnique marks the first open for that subscriber and send.',
    joinKeys: TRACKING_KEYS,
    notes: TRACKING_NOTE + ' Opens depend on images loading, so they undercount and can include machine opens.',
  },
  _CLICK: {
    description: 'Link clicks, one row per click, with the URL and link name. IsUnique marks the first click on that link for that subscriber and send.',
    joinKeys: TRACKING_KEYS,
    notes: TRACKING_NOTE,
  },
  _BOUNCE: {
    description: 'Bounced emails with bounce category, subcategory, type and the SMTP reason and code.',
    joinKeys: TRACKING_KEYS,
    notes: TRACKING_NOTE,
  },
  _COMPLAINT: {
    description: 'Spam complaints reported back to Marketing Cloud by mailbox providers.',
    joinKeys: TRACKING_KEYS,
    notes: TRACKING_NOTE,
  },
  _UNSUBSCRIBE: {
    description: 'Unsubscribe events tied to an email send.',
    joinKeys: TRACKING_KEYS,
    notes: TRACKING_NOTE + ' Unsubscribes that did not come from an email may not appear here, so check _Subscribers or _BusinessUnitUnsubscribes for current status.',
  },
  _FTAF: {
    description: 'Forward to a friend events.',
    joinKeys: TRACKING_KEYS,
    notes: TRACKING_NOTE + ' The date column is TransactionTime, not EventDate.',
  },
  _JOURNEY: {
    description: 'Journey Builder journeys, one row per journey version, with name, version number, status and dates.',
    joinKeys: ['VersionID', 'JourneyID'],
    notes: 'Join to _JourneyActivity on VersionID. Join email tracking to journeys through _JourneyActivity.JourneyActivityObjectID = _Sent.TriggererSendDefinitionObjectID.',
  },
  _JOURNEYACTIVITY: {
    description: 'Activities in each journey version, with activity name, type and external key.',
    joinKeys: ['VersionID', 'JourneyActivityObjectID'],
    notes: 'Join to _Journey on VersionID. JourneyActivityObjectID matches TriggererSendDefinitionObjectID in the email tracking views.',
  },
  _AUTOMATIONINSTANCE: {
    description: 'Automation Studio runs, one row per automation instance, with scheduled, start and end times (UTC), status and error details.',
    joinKeys: ['AutomationInstanceID', 'AutomationCustomerKey'],
    notes: 'Keeps about 31 days of data. Join to _AutomationActivityInstance on AutomationInstanceID.',
  },
  _AUTOMATIONACTIVITYINSTANCE: {
    description: 'Each activity run inside an automation run, with step, start and end times (UTC), status and status details.',
    joinKeys: ['AutomationInstanceID', 'ActivityInstanceID', 'ActivityCustomerKey'],
    notes: 'Keeps about 31 days of data. Join to _AutomationInstance on AutomationInstanceID.',
  },
  _SMSMESSAGETRACKING: {
    description: 'Outbound and inbound SMS messages from MobileConnect, with delivery flags, message text and keyword or code details.',
    joinKeys: ['SubscriberKey', 'Mobile', 'MobileMessageTrackingID'],
    notes: 'Use the Outbound and Inbound flags to tell sends from replies.',
  },
  _SMSSUBSCRIPTIONLOG: {
    description: 'History of SMS opt-in and opt-out changes per mobile number and subscription (keyword).',
    joinKeys: ['MobileNumber', 'SubscriberKey', 'SubscriptionDefinitionID'],
    notes: 'This is a log, so one number can have many rows. Take the latest row per number and subscription for current state.',
  },
  _UNDELIVERABLESMS: {
    description: 'Mobile numbers that bounced or were marked undeliverable for SMS, with bounce count and dates.',
    joinKeys: ['MobileNumber'],
    notes: '',
  },
  _MOBILEADDRESS: {
    description: 'Mobile numbers held in MobileConnect, with contact ID, status, country code and location fields.',
    joinKeys: ['_ContactID', '_MobileNumber'],
    notes: 'Column names start with an underscore. Wrap them in brackets if the editor or engine has trouble with them.',
  },
  _MOBILESUBSCRIPTION: {
    description: 'Current MobileConnect subscription state per mobile number and subscription (keyword), with opt-in and opt-out details.',
    joinKeys: ['_MobileNumber', '_SubscriptionDefinitionID'],
    notes: 'Column names start with an underscore.',
  },
  _PUSHADDRESS: {
    description: 'Devices registered for MobilePush, with contact ID, platform, opt-in status and device details.',
    joinKeys: ['_DeviceID', '_ContactID', '_APID'],
    notes: 'Column names start with an underscore. Join to _PushTag on _DeviceID.',
  },
  _PUSHTAG: {
    description: 'Tags set on MobilePush devices.',
    joinKeys: ['_DeviceID', '_APID'],
    notes: 'Join to _PushAddress on _DeviceID. One device can have many tags.',
  },
  _COUPON: {
    description: 'Coupon definitions in the account, with name, external key and validity dates.',
    joinKeys: ['Name', 'ExternalKey'],
    notes: 'Holds the coupon definitions only, not the individual codes.',
  },
  _SURVEYRESPONSE: {
    description: 'Answers to surveys sent in email, one row per answer, with question and answer details.',
    joinKeys: TRACKING_KEYS,
    notes: TRACKING_NOTE,
  },
}

// Known values for some data view fields, for autocomplete after `field =`.
// Keys are 'VIEWNAME.FIELD' in uppercase. Only values we are sure about.
const STATUS_VALUES = ['active', 'held', 'unsubscribed', 'bounced']
const IS_UNIQUE = ['1', '0']
export const FIELD_VALUES = {
  '_SUBSCRIBERS.STATUS': STATUS_VALUES,
  '_LISTSUBSCRIBERS.STATUS': STATUS_VALUES,
  '_BOUNCE.BOUNCECATEGORY': ['Hard bounce', 'Soft bounce', 'Block bounce', 'Technical/Other bounce', 'Unknown bounce'],
  '_JOB.JOBSTATUS': ['Complete', 'Scheduled', 'Sending', 'Canceled', 'Error'],
  '_OPEN.ISUNIQUE': IS_UNIQUE,
  '_CLICK.ISUNIQUE': IS_UNIQUE,
  '_BOUNCE.ISUNIQUE': IS_UNIQUE,
  '_COMPLAINT.ISUNIQUE': IS_UNIQUE,
  '_UNSUBSCRIBE.ISUNIQUE': IS_UNIQUE,
  '_FTAF.ISUNIQUE': IS_UNIQUE,
  '_SURVEYRESPONSE.ISUNIQUE': IS_UNIQUE,
  '_SMSMESSAGETRACKING.OUTBOUND': IS_UNIQUE,
  '_SMSMESSAGETRACKING.INBOUND': IS_UNIQUE,
  '_SMSMESSAGETRACKING.SENT': IS_UNIQUE,
  '_SMSMESSAGETRACKING.DELIVERED': IS_UNIQUE,
  '_SMSMESSAGETRACKING.UNDELIVERED': IS_UNIQUE,
}

// ── Known joins between data views ─────────────────────────
// How SFMC's data views relate (Salesforce's data view documentation; also the
// relationships shown on dataviews.io). Used by the Query Builder before it falls
// back to guessing from shared column names. A rule only applies when both views
// have the fields it names.
const TRACKING_VIEWS = ['_SENT', '_OPEN', '_CLICK', '_BOUNCE', '_COMPLAINT', '_UNSUBSCRIBE', '_FTAF']
const SUBSCRIBER_VIEWS = ['_SUBSCRIBERS', '_LISTSUBSCRIBERS', '_BUSINESSUNITUNSUBSCRIBES', ...TRACKING_VIEWS]

export const JOIN_RULES = [
  // [left views, right views, [[leftField, rightField], ...]]
  [['_JOURNEY'], ['_JOURNEYACTIVITY'], [['VersionID', 'VersionID']]],
  [['_JOURNEYACTIVITY'], ['_JOB', ...TRACKING_VIEWS], [['JourneyActivityObjectID', 'TriggererSendDefinitionObjectID']]],
  [['_JOB'], TRACKING_VIEWS, [['JobID', 'JobID']]],
  [TRACKING_VIEWS, TRACKING_VIEWS, [['JobID', 'JobID'], ['ListID', 'ListID'], ['BatchID', 'BatchID'], ['SubscriberID', 'SubscriberID']]],
  [['_AUTOMATIONINSTANCE'], ['_AUTOMATIONACTIVITYINSTANCE'], [['AutomationInstanceID', 'AutomationInstanceID']]],
  [['_ENTERPRISEATTRIBUTE'], ['_SUBSCRIBERS', ...TRACKING_VIEWS, '_LISTSUBSCRIBERS'], [['_SubscriberID', 'SubscriberID']]],
  [SUBSCRIBER_VIEWS, SUBSCRIBER_VIEWS, [['SubscriberKey', 'SubscriberKey']]],
  [['_SMSMESSAGETRACKING'], ['_SMSSUBSCRIPTIONLOG', '_UNDELIVERABLESMS'], [['MobileNumber', 'MobileNumber']]],
  // A device ID is unique only within one MobilePush app.
  [['_PUSHADDRESS'], ['_PUSHTAG'], [['_DeviceID', '_DeviceID'], ['_APID', '_APID']]],
]

/**
 * Join conditions between two data views, or null when no rule applies.
 * @param {{ name: string, fields: Array<{name: string}> }} left
 * @param {{ name: string, fields: Array<{name: string}> }} right
 * @returns {Array<{ leftField, operator, rightField }> | null}
 */
export function dataViewJoin(left, right) {
  const ln = String(left?.name || '').replace(/^ENT\./i, '').toUpperCase()
  const rn = String(right?.name || '').replace(/^ENT\./i, '').toUpperCase()
  if (!DATA_VIEWS_UPPER.has(ln) || !DATA_VIEWS_UPPER.has(rn) || (ln === rn && !TRACKING_VIEWS.includes(ln))) return null
  // A data view added before its fields have loaded still gets its join (feedback #52):
  // fall back to the known fields of that data view.
  const fieldsOf = (de) => (de.fields?.length ? de.fields : DATA_VIEW_FIELDS[String(de.name || '').replace(/^ENT\./i, '').toUpperCase()] || [])
  const fieldOf = (de, name) => fieldsOf(de).find((f) => f.name.toLowerCase() === name.toLowerCase())?.name
  for (const [lefts, rights, keys] of JOIN_RULES) {
    for (const [a, b, flip] of [[ln, rn, false], [rn, ln, true]]) {
      if (!lefts.includes(a) || !rights.includes(b)) continue
      const conds = keys.map(([lk, rk]) => {
        const [lf, rf] = flip ? [fieldOf(left, rk), fieldOf(right, lk)] : [fieldOf(left, lk), fieldOf(right, rk)]
        return lf && rf ? { leftField: lf, operator: '=', rightField: rf } : null
      })
      if (conds.every(Boolean)) return conds
    }
  }
  return null
}

const DATA_VIEWS_UPPER = new Set([...DATA_VIEWS].map((n) => n.toUpperCase()))
