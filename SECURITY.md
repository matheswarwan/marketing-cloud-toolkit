# Security policy

## Reporting a vulnerability

Email **mathes.btech@gmail.com** with "Marketing Cloud Toolkit security" in the subject. Please include the extension version (Settings > About), what you found, and the steps to reproduce it. Do not include real customer data; describe it instead.

- You will get a reply within 5 working days.
- A fix for a confirmed issue that exposes customer data or session material is released to the Chrome Web Store as soon as it is ready, normally within 14 days, and noted in CHANGELOG.md.
- Please give a reasonable time to fix an issue before making it public. Reporters are credited in the changelog if they want to be.

Do not test against Marketing Cloud accounts that are not yours.

## Supported versions

Only the latest version published on the Chrome Web Store gets security fixes. Chrome updates installed extensions automatically; organizations that pin a version should follow `docs/enterprise-deployment.md` to stay current.

| Version | Supported |
|---|---|
| Latest published (2.0.x) | Yes |
| Older 2.0.x | No, update to the latest |
| SFMC Query Saver 1.x | No |

## Scope

In scope: the extension (this repository's `src/` and `public/`), the share service (`workers/share`) and the feedback service (`workers/feedback`).

Out of scope: Salesforce Marketing Cloud itself (report to Salesforce), diagramforce.com, and Chrome.

## How the extension is built to be safe

The design, permissions, data flows and admin controls are described in `docs/security-summary.md`. Self-assessments and scan results are kept in `security/audits/`; they are not independent audits.
