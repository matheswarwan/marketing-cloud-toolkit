# Marketing Cloud Toolkit privacy policy

Last updated: 2026-10-28. This policy covers Marketing Cloud Toolkit version 2.0.18 and later, the Chrome extension that was published as SFMC Query Saver until version 1.4.0.

Publisher: Matheswaran Kanagarajan, an individual developer. Contact: mathes.btech@gmail.com.

## Summary

- The extension works with your own Salesforce Marketing Cloud (SFMC) account, in your browser, with the login you already have. It never asks for or stores a password.
- There is no analytics, no advertising and no tracking. Nothing is sold.
- Data leaves your browser only in these cases: calls to Salesforce Marketing Cloud on your behalf; a query you choose to share; feedback you choose to send; and a diagram you choose to open on diagramforce.com. Each is described below.

## What the extension reads in your browser

- **Marketing Cloud pages and APIs.** The extension calls Marketing Cloud's own APIs with your existing session to list and show your queries, automations, journeys, data extensions, CloudPages and emails, and to run queries you start.
- **Cookies.** It reads the names and expiry dates of Marketing Cloud login cookies to tell which Marketing Cloud stack you use, and the value of Content Builder's security cookie (`_csrf`) to send it back with changes you make there. Cookie values are never stored or sent anywhere except back to Marketing Cloud.
- **Security tokens.** Marketing Cloud adds a security token to its own requests; the extension reads it from those requests to send it back with the changes you make (for example, running a query). The Contacts page also reuses the headers Contact Builder's own page sends. These are kept in memory and in the browser's session storage, which is cleared when the browser closes. They are never written to disk by the extension, never logged and never sent anywhere except back to Marketing Cloud.
- **Request bodies, only for features you turn on.** If you turn on Save email versions, Save Query and Script activity versions, or Save Query Studio runs (all off by default), the extension reads the content of those saves as you make them, to keep a copy in your browser.

## What is stored in your browser

- Saved queries and, while Keep query history is on, the SQL of each run. A run also records the data extension and query activity it created in Marketing Cloud, so they can be cleaned up later.
- If you turn them on: saved email versions (at most 10 per email), saved Query and Script activity versions, and queries you ran in Query Studio.
- Query Builder drafts, Where used scans (names and SQL of Marketing Cloud items, used to show what depends on what), watched automations and journeys, and your settings.
- **Query results are never stored in your browser.** They stay in Marketing Cloud, in the data extension the query wrote to.
- Settings > Storage > Clear all deletes everything the extension stores. Removing the extension deletes it too.

## What is sent, and where

- **Salesforce Marketing Cloud.** Every call to Marketing Cloud goes to Salesforce's own domains (`exacttarget.com`, `marketingcloudapps.com`, `marketingcloud.com`, `salesforce-marketingcloud.com`), with your session, to do what you asked. Salesforce's own privacy terms apply to your Marketing Cloud data.
- **Share (off by default).** When you share a query, its name and SQL are sent to the Toolkit's share service (`sfmc-share-worker.mathes-btech.workers.dev`, run on Cloudflare Workers). Anyone with the link can read it for 24 hours, after which it is deleted. Before anything is sent, the extension shows exactly what will be sent and asks you to confirm. No results, data extension rows or account details are sent. The share service does not store who sent it.
- **Feedback (only when you send it).** The feedback form sends your message, the kind of feedback, the page you were on (without record IDs), the extension version and, only if you fill them in, your name and email. Technical details (browser, language, window size, Marketing Cloud stack and the status codes of recent failed calls) and a screenshot are added only if you choose them; before sending, the form shows exactly what will be sent. Technical details never include business unit names or IDs, SQL, results, record names or Marketing Cloud addresses. Feedback is stored in a Cloudflare D1 database (`query-saver-feedback.mathes-btech.workers.dev`), read only by the developer, and deleted after 180 days. IP addresses are not stored.
- **Diagramforce (only when you click Open in Diagramforce).** The query's table, column and join names are passed to diagramforce.com, a free diagram editor by Mateusz Dabrowski, in a new tab. That site's own privacy policy applies.

## Controls for organizations

Administrators can turn features off for everyone through Chrome policy (managed storage): local query history and the capture features, Share, the feedback form, technical details in feedback, screenshots in feedback, the Contacts page, and Open in Diagramforce. See `docs/enterprise-deployment.md` in the source repository.

## Retention and deletion

- Data in your browser stays until you delete it (Clear all) or remove the extension.
- Shared queries are deleted 24 hours after they are created.
- Feedback is deleted 180 days after it is sent. To have your feedback deleted sooner, or to ask what is held about you, email mathes.btech@gmail.com with the email address you used or the approximate date you sent it.

## What the extension does not do

- It does not sell or transfer your data to third parties, use it for advertising, or use it to determine creditworthiness or for lending.
- It does not use your data for anything other than the features described here.
- It does not run code downloaded from anywhere: all code is in the package Chrome installs.

## Earlier versions

Versions before 2.0.18 sent anonymous usage events (for example "app opened" or "query run", with a random ID and no SQL, names or data) to Google Analytics, sent more technical details with feedback by default (including the business unit name and the paths of recent Marketing Cloud API calls), and stored the IP address of feedback senders. Feedback stored before 2026-10-28 may hold those details until it is deleted after 180 days.

## Changes to this policy

Changes are listed in the extension's CHANGELOG and this page's date is updated. Material changes are also mentioned in the extension's What's new notes.
