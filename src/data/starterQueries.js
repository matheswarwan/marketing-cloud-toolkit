// Starter queries (user, 2026-11-16; idea from VeLens's Query Library, written here):
// ready-made SQL over SFMC's data views for everyday questions. Every query uses only
// fields listed in utils/dataViews.js and passes the Toolkit's lint without errors
// (src/data/__tests__/starterQueries.test.js). Data views keep about six months of
// tracking, so the date windows stay inside that.
// Item: { id, category, title, purpose, notes?, sql }

export const STARTER_CATEGORIES = ['Sends and engagement', 'Bounces and deliverability', 'Subscribers and unsubscribes', 'Journeys', 'Lists']

export const STARTER_QUERIES = [
  // ── Sends and engagement ──
  {
    id: 'sends-by-job', category: 'Sends and engagement', title: 'Sends in the last 30 days with opens and clicks',
    purpose: 'One row per send (JobID): email name, when it went, how many were sent, unique opens and unique clicks.',
    sql: `SELECT j.JobID, j.EmailName, j.DeliveredTime,
  COUNT(DISTINCT s.SubscriberKey) AS Sent,
  COUNT(DISTINCT o.SubscriberKey) AS UniqueOpens,
  COUNT(DISTINCT c.SubscriberKey) AS UniqueClicks
FROM _Job j
INNER JOIN _Sent s ON s.JobID = j.JobID
LEFT JOIN _Open o ON o.JobID = s.JobID AND o.SubscriberKey = s.SubscriberKey AND o.IsUnique = 1
LEFT JOIN _Click c ON c.JobID = s.JobID AND c.SubscriberKey = s.SubscriberKey AND c.IsUnique = 1
WHERE s.EventDate >= DATEADD(DAY, -30, GETDATE())
GROUP BY j.JobID, j.EmailName, j.DeliveredTime`,
  },
  {
    id: 'opened-last-90', category: 'Sends and engagement', title: 'Subscribers who opened in the last 90 days',
    purpose: 'Engaged audience: everyone with at least one open in 90 days, with their latest open.',
    sql: `SELECT o.SubscriberKey, MAX(o.EventDate) AS LastOpen, COUNT(*) AS Opens
FROM _Open o
WHERE o.EventDate >= DATEADD(DAY, -90, GETDATE())
GROUP BY o.SubscriberKey`,
  },
  {
    id: 'never-opened', category: 'Sends and engagement', title: 'Sent to in 90 days but never opened',
    purpose: 'Unengaged audience for a winback or a sunset policy.',
    notes: 'Apple Mail Privacy Protection opens images for its users, so some "opens" are not real; this list errs on the side of keeping people.',
    sql: `SELECT s.SubscriberKey, COUNT(DISTINCT s.JobID) AS SendsReceived, MAX(s.EventDate) AS LastSent
FROM _Sent s
LEFT JOIN _Open o ON o.SubscriberKey = s.SubscriberKey AND o.EventDate >= DATEADD(DAY, -90, GETDATE())
WHERE s.EventDate >= DATEADD(DAY, -90, GETDATE())
  AND o.SubscriberKey IS NULL
GROUP BY s.SubscriberKey`,
  },
  {
    id: 'clicks-by-link', category: 'Sends and engagement', title: 'Clicks by link for one send',
    purpose: 'Which links were clicked in one send: change the JobID.',
    sql: `SELECT c.URL, c.LinkName, COUNT(*) AS Clicks, COUNT(DISTINCT c.SubscriberKey) AS UniqueClickers
FROM _Click c
WHERE c.JobID = 12345
GROUP BY c.URL, c.LinkName`,
  },
  {
    id: 'top-domains', category: 'Sends and engagement', title: 'Opens and sends by email domain (30 days)',
    purpose: 'How each mailbox provider (gmail.com, outlook.com…) engages: a low open rate at one domain hints at a deliverability problem there.',
    sql: `SELECT s.Domain,
  COUNT(DISTINCT s.SubscriberKey) AS Sent,
  COUNT(DISTINCT o.SubscriberKey) AS Opened
FROM _Sent s
LEFT JOIN _Open o ON o.JobID = s.JobID AND o.SubscriberKey = s.SubscriberKey
WHERE s.EventDate >= DATEADD(DAY, -30, GETDATE())
GROUP BY s.Domain`,
  },
  {
    id: 'last-engagement', category: 'Sends and engagement', title: 'Last open and last click per subscriber',
    purpose: 'One row per subscriber with their latest open and click in the last 180 days, for scoring or suppression.',
    sql: `SELECT s.SubscriberKey,
  MAX(o.EventDate) AS LastOpen,
  MAX(c.EventDate) AS LastClick
FROM _Sent s
LEFT JOIN _Open o ON o.SubscriberKey = s.SubscriberKey
LEFT JOIN _Click c ON c.SubscriberKey = s.SubscriberKey
WHERE s.EventDate >= DATEADD(DAY, -180, GETDATE())
GROUP BY s.SubscriberKey`,
  },
  // ── Bounces and deliverability ──
  {
    id: 'bounces-30', category: 'Bounces and deliverability', title: 'Bounces in the last 30 days with the reason',
    purpose: 'Every bounce with its category, type and the receiving server\'s SMTP reason.',
    sql: `SELECT b.SubscriberKey, b.JobID, b.EventDate, b.BounceCategory, b.BounceType, b.SMTPCode, b.SMTPBounceReason
FROM _Bounce b
WHERE b.EventDate >= DATEADD(DAY, -30, GETDATE())`,
  },
  {
    id: 'bounce-reasons', category: 'Bounces and deliverability', title: 'Bounce reasons, most common first',
    purpose: 'How many bounces each category and SMTP code caused in 30 days: a spike in one code points at a block or a bad list.',
    sql: `SELECT TOP 100 b.BounceCategory, b.SMTPCode, COUNT(*) AS Bounces
FROM _Bounce b
WHERE b.EventDate >= DATEADD(DAY, -30, GETDATE())
GROUP BY b.BounceCategory, b.SMTPCode
ORDER BY COUNT(*) DESC`,
  },
  {
    id: 'hard-bounced', category: 'Bounces and deliverability', title: 'Hard bounces to suppress',
    purpose: 'Subscribers with a hard bounce in 90 days, with the latest one: candidates for a suppression or clean-up.',
    sql: `SELECT b.SubscriberKey, MAX(b.EventDate) AS LastHardBounce, COUNT(*) AS HardBounces
FROM _Bounce b
WHERE b.BounceCategory = 'Hard bounce'
  AND b.EventDate >= DATEADD(DAY, -90, GETDATE())
GROUP BY b.SubscriberKey`,
  },
  {
    id: 'complaints', category: 'Bounces and deliverability', title: 'Spam complaints in the last 90 days',
    purpose: 'Who marked an email as spam, and which send: complaints hurt sender reputation fastest.',
    sql: `SELECT c.SubscriberKey, c.JobID, c.EventDate, c.Domain
FROM _Complaint c
WHERE c.EventDate >= DATEADD(DAY, -90, GETDATE())`,
  },
  {
    id: 'held-subscribers', category: 'Bounces and deliverability', title: 'Held and bounced subscribers',
    purpose: 'Subscribers SFMC no longer sends to (held after repeated bounces) or that bounced lately.',
    notes: 'Data view _Subscribers is available in the enterprise (parent) business unit.',
    sql: `SELECT s.SubscriberKey, s.EmailAddress, s.Status, s.BounceCount, s.DateUndeliverable
FROM _Subscribers s
WHERE s.Status IN ('held', 'bounced')`,
  },
  // ── Subscribers and unsubscribes ──
  {
    id: 'unsubs-30', category: 'Subscribers and unsubscribes', title: 'Unsubscribes in the last 30 days and the send that caused them',
    purpose: 'Every unsubscribe with the email it came from.',
    sql: `SELECT u.SubscriberKey, u.EventDate, u.JobID, j.EmailName
FROM _Unsubscribe u
LEFT JOIN _Job j ON j.JobID = u.JobID
WHERE u.EventDate >= DATEADD(DAY, -30, GETDATE())`,
  },
  {
    id: 'unsubs-by-email', category: 'Subscribers and unsubscribes', title: 'Unsubscribes per email (90 days)',
    purpose: 'Which emails make people leave.',
    sql: `SELECT TOP 100 j.EmailName, COUNT(DISTINCT u.SubscriberKey) AS Unsubscribes
FROM _Unsubscribe u
INNER JOIN _Job j ON j.JobID = u.JobID
WHERE u.EventDate >= DATEADD(DAY, -90, GETDATE())
GROUP BY j.EmailName
ORDER BY COUNT(DISTINCT u.SubscriberKey) DESC`,
  },
  {
    id: 'bu-unsubs', category: 'Subscribers and unsubscribes', title: 'Business unit unsubscribes',
    purpose: 'People unsubscribed from a business unit only (not from everything), with the reason.',
    sql: `SELECT b.SubscriberKey, b.BusinessUnitID, b.UnsubDateUTC, b.UnsubReason
FROM _BusinessUnitUnsubscribes b`,
  },
  {
    id: 'new-subscribers', category: 'Subscribers and unsubscribes', title: 'Subscribers who joined in the last 30 days',
    purpose: 'New people at All Subscribers.',
    notes: 'Data view _Subscribers is available in the enterprise (parent) business unit.',
    sql: `SELECT s.SubscriberKey, s.EmailAddress, s.DateJoined, s.Status
FROM _Subscribers s
WHERE s.DateJoined >= DATEADD(DAY, -30, GETDATE())`,
  },
  // ── Journeys ──
  {
    id: 'journey-email-sends', category: 'Journeys', title: 'Emails sent by journeys (30 days)',
    purpose: 'Sends per journey, version and email activity, joining tracking to journeys through the triggered send.',
    sql: `SELECT j.JourneyName, j.VersionNumber, a.ActivityName,
  COUNT(DISTINCT s.SubscriberKey) AS Sent
FROM _Sent s
INNER JOIN _JourneyActivity a ON a.JourneyActivityObjectID = s.TriggererSendDefinitionObjectID
INNER JOIN _Journey j ON j.VersionID = a.VersionID
WHERE s.EventDate >= DATEADD(DAY, -30, GETDATE())
GROUP BY j.JourneyName, j.VersionNumber, a.ActivityName`,
  },
  {
    id: 'journey-email-engagement', category: 'Journeys', title: 'Opens and clicks per journey email (30 days)',
    purpose: 'Unique opens and clicks for each email activity in each journey version.',
    sql: `SELECT j.JourneyName, j.VersionNumber, a.ActivityName,
  COUNT(DISTINCT s.SubscriberKey) AS Sent,
  COUNT(DISTINCT o.SubscriberKey) AS UniqueOpens,
  COUNT(DISTINCT c.SubscriberKey) AS UniqueClicks
FROM _Sent s
INNER JOIN _JourneyActivity a ON a.JourneyActivityObjectID = s.TriggererSendDefinitionObjectID
INNER JOIN _Journey j ON j.VersionID = a.VersionID
LEFT JOIN _Open o ON o.JobID = s.JobID AND o.SubscriberKey = s.SubscriberKey
LEFT JOIN _Click c ON c.JobID = s.JobID AND c.SubscriberKey = s.SubscriberKey
WHERE s.EventDate >= DATEADD(DAY, -30, GETDATE())
GROUP BY j.JourneyName, j.VersionNumber, a.ActivityName`,
  },
  {
    id: 'running-journeys', category: 'Journeys', title: 'Journeys and their latest version',
    purpose: 'Every journey version with its status and when it was last published.',
    sql: `SELECT j.JourneyName, j.VersionNumber, j.JourneyStatus, j.LastPublishedDate, j.ModifiedDate
FROM _Journey j`,
  },
  // ── Lists ──
  {
    id: 'list-members', category: 'Lists', title: 'Members of one list with their status',
    purpose: 'Who is on a list and whether they are active or unsubscribed: change the list name.',
    sql: `SELECT l.SubscriberKey, l.EmailAddress, l.Status, l.CreatedDate, l.DateUnsubscribed
FROM _ListSubscribers l
WHERE l.ListName = 'My List'`,
  },
  {
    id: 'list-sizes', category: 'Lists', title: 'List sizes by status',
    purpose: 'How many active, unsubscribed, held and bounced members each list has.',
    sql: `SELECT l.ListName, l.Status, COUNT(*) AS Members
FROM _ListSubscribers l
GROUP BY l.ListName, l.Status`,
  },
]
