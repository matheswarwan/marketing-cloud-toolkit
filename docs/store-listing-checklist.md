# Chrome Web Store listing checklist

Things the publisher updates by hand in the Chrome Web Store developer dashboard (https://chrome.google.com/webstore/devconsole) so the listing matches the code. Do this with the 2.0.18 upload. Item: Marketing Cloud Toolkit, ID `bkajbggginfjnjhaiififajmncgdneli`.

## Account (Account tab)

- [ ] **Publisher name:** the name reviewers should see. The listing currently shows "CloudKettle Inc". Changing the publisher of an existing item means either renaming the publisher account it is in, or transferring the item to another publisher account (Chrome Web Store support handles transfers; the item keeps its ID and users). Decide which; `PRIVACY.md` and `SECURITY.md` name Matheswaran Kanagarajan.
- [ ] **Developer contact email:** mathes.btech@gmail.com (verified), replacing the cloudkettle.com address.
- [ ] **2-step verification** on the Google account that owns the publisher account (a hardware security key if possible). See `docs/release-process.md`.

## Store listing tab

- [ ] **Description:** from `docs/store-listing.md`; remove any mention of Google Analytics or anonymous usage counts.
- [ ] **Homepage URL:** https://marketing-cloud-toolkit.mathes.dev/
- [ ] **Support URL:** https://marketing-cloud-toolkit.mathes.dev/ (or the email address).
- [ ] **Screenshots:** none should show real customer data.

## Privacy practices tab

- [ ] **Single purpose:** as in `docs/store-listing.md`.
- [ ] **Permission justifications:** paste from `docs/store-listing.md` > Permission justifications. Remove the justifications for `tabs`, `unlimitedStorage` and the hosts that are gone (Google Analytics, the share and feedback services, both Query Studio hosts as required hosts).
- [ ] **Remote code:** No.
- [ ] **Data usage:** tick exactly what `docs/store-listing.md` > Data usage lists (personally identifiable information, authentication information, website content); untick usage data / user activity (no analytics since 2.0.18).
- [ ] **Certifications:** all three ticked.
- [ ] **Privacy policy URL:** https://marketing-cloud-toolkit.mathes.dev/privacy, replacing the ateko.com link.

## Package tab

- [ ] Upload the zip built by the release workflow for the tag, and check its SHA-256 against `security/scans/<version>.md` before uploading.
- [ ] The manifest asks for no new permissions in 2.0.18 (two were removed), so users are not asked to approve anything.

## After publishing

- [ ] Download the published CRX and compare it with the uploaded zip (see `docs/release-process.md`, "Check what Google published"); record the result in `security/scans/<version>.md`.
- [ ] Ask for a new Spin.AI scan and record the score in `security/audits/README.md`.
