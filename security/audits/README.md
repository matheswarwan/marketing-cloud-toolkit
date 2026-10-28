# Security reviews and scans

Every report here names the extension version and the git commit it describes. **Self-assessments and automated scans are not independent audits**: they are made by the developer (with AI assistance) and by tools, and nobody else has verified them. An independent review, when there is one, will be listed separately with the reviewer's name.

## Reports

| Date | Version | Commit | Kind | Report |
|---|---|---|---|---|
| 2026-10-28 | 2.0.17 | `c7dc4c3` | Self-assessment (NOT independent) and automated scans | [2026-10-28-self-assessment-2.0.17.md](2026-10-28-self-assessment-2.0.17.md) |

Per-release scan results (built package SHA-256, gitleaks, osv-scanner, retire.js, semgrep, npm audit, manifest guard) go in `security/scans/<version>.md`, written by the release workflow (`.github/workflows/release.yml`) and added through a pull request. The same checks run on every pull request (`.github/workflows/checks.yml`).

## Third-party scores

External scanners rate the published store package. Record each result here with the version scanned, so before and after can be compared.

| Scanner | Version scanned | Date | Score / rating | Notes |
|---|---|---|---|---|
| Spin.AI | 2.0.15 | before 2026-10-28 | 22, low risk | Critical: webRequest, cookies, tabs. High: storage, unlimitedStorage. Medium: outdated JS libraries, external communication. |
| Spin.AI | 2.0.18 | (after publishing) | | Expected changes: `tabs` and `unlimitedStorage` gone; Google Analytics, Heroku and worker hosts gone from host permissions. |

## Tools used

- gitleaks (secrets, working tree and full history), semgrep (`p/javascript`, `p/secrets`, `p/xss`, `p/owasp-top-ten`; does not analyse `.vue` files), osv-scanner (lockfiles), retire.js (built `dist/`), `npm audit`.
- All run in Docker or with `npx`; nothing is installed on the build machine. The commands are in the self-assessment, section 7.
