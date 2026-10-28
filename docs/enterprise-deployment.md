# Deploying Marketing Cloud Toolkit in an organization

For Chrome administrators. Extension ID: **`bkajbggginfjnjhaiififajmncgdneli`** (Chrome Web Store listing "Marketing Cloud Toolkit", formerly SFMC Query Saver).

What the extension does, its permissions and data flows: `docs/security-summary.md`. Privacy policy: `PRIVACY.md`.

## 1. Allow or force-install it

If your organization blocks extensions by default (`ExtensionInstallBlocklist` = `*`), allow this one:

- `ExtensionInstallAllowlist`: `bkajbggginfjnjhaiififajmncgdneli`

To install it for everyone, without a way to remove it:

- `ExtensionInstallForcelist`: `bkajbggginfjnjhaiififajmncgdneli;https://clients2.google.com/service/update2/crx`

Or with `ExtensionSettings`, which also lets you keep it off hosts it could otherwise be granted:

```json
{
  "bkajbggginfjnjhaiififajmncgdneli": {
    "installation_mode": "force_installed",
    "update_url": "https://clients2.google.com/service/update2/crx",
    "runtime_blocked_hosts": ["*://*.herokuapp.com"]
  }
}
```

`runtime_blocked_hosts` above is optional: it stops the optional Query Studio capture from ever reading Heroku requests, even if a user turns it on.

In the Google Admin console: Devices > Chrome > Apps & extensions > Users & browsers > add by ID, then set the installation policy.

## 2. Turn features off with policy

The extension reads these keys from Chrome's managed storage (`chrome.storage.managed`; schema in `public/managed_schema.json`). All are booleans; only `true` has an effect, and a policy can only turn things off. Users see the switch disabled with "Turned off by your organization's policy."

| Key | Effect |
|---|---|
| `disableHistory` | Runs are stored without their SQL; no capture of Query Studio runs, Content Builder email versions or Automation Studio activity versions. |
| `disableShare` | No Share button; shared links are not imported. No SQL is ever sent to the share service. |
| `disableFeedback` | No feedback form; nothing is sent to the feedback service. |
| `disableFeedbackMetadata` | Feedback never offers technical details. |
| `disableScreenshots` | Feedback never offers a screenshot. |
| `disableContacts` | No Contacts page, and Contact Builder's request headers are not read. |
| `disableDiagramforce` | No Open in Diagramforce (which sends table and column names to diagramforce.com). |

A strict setup for a regulated organization:

```json
{
  "disableHistory": true,
  "disableShare": true,
  "disableFeedbackMetadata": true,
  "disableScreenshots": true,
  "disableContacts": true,
  "disableDiagramforce": true
}
```

### Google Admin console

Apps & extensions > select the extension > **Policy for extensions**, and paste the JSON with each value wrapped as Chrome expects:

```json
{
  "disableShare": { "Value": true },
  "disableScreenshots": { "Value": true }
}
```

### Windows (registry or Group Policy preferences)

```
HKEY_LOCAL_MACHINE\Software\Policies\Google\Chrome\3rdparty\extensions\bkajbggginfjnjhaiififajmncgdneli\policy
  disableShare        REG_DWORD  1
  disableScreenshots  REG_DWORD  1
```

### macOS (configuration profile)

Payload type `com.google.Chrome.extensions.bkajbggginfjnjhaiififajmncgdneli`, with the keys as booleans:

```xml
<key>disableShare</key><true/>
<key>disableScreenshots</key><true/>
```

### Linux

`/etc/opt/chrome/policies/managed/marketing-cloud-toolkit.json` (Chromium: `/etc/chromium/policies/managed/`):

```json
{
  "3rdparty": {
    "extensions": {
      "bkajbggginfjnjhaiififajmncgdneli": { "disableShare": true, "disableScreenshots": true }
    }
  }
}
```

Check what a browser received at `chrome://policy` (Show policies with no value set, then the extension's section).

## 3. Network allow-lists

The extension needs only Salesforce's domains: `*.exacttarget.com`, `*.marketingcloudapps.com`, `*.marketingcloud.com`, `*.salesforce-marketingcloud.com`. Optional, only when the matching feature is used: `sfmc-share-worker.mathes-btech.workers.dev` (Share), `query-saver-feedback.mathes-btech.workers.dev` (Feedback), `diagramforce.com` (Open in Diagramforce). Blocking the optional three at a proxy is a valid alternative to the policies above.

## 4. Versions and pinning

The Chrome Web Store always serves the latest published version, and Chrome updates extensions automatically. There is no store setting to hold one version.

- **Recommended:** allow the extension and review each release before or soon after it reaches users. Every release is listed in `CHANGELOG.md` with its permission changes, and `security/scans/<version>.md` has the SHA-256 of the built package and the scan results, so the published package can be compared with the reviewed source (`scripts/package.mjs` rebuilds it reproducibly).
- **Holding a version:** download the reviewed version's CRX from the store, host it with your own update manifest, and point the extension at it with `ExtensionSettings` (`"update_url"` set to your manifest, `"override_update_url": true`). Chrome keeps the extension ID because the CRX is still signed by the Chrome Web Store. You then update by publishing a new CRX to your manifest. This needs `force_installed` and is supported on managed Windows and macOS devices and ChromeOS.
- Chrome's own guidance: https://support.google.com/chrome/a/answer/9867568 and https://chromeenterprise.google/policies/#ExtensionSettings

## 5. Data and support

- The extension keeps its data in each user's browser profile (`docs/security-summary.md`, Storage). Removing the extension deletes it.
- Security reports: `SECURITY.md`. Privacy and deletion requests: `PRIVACY.md`.
