# Spec 06 (PR #450) screenshots

Verify app: `VERIFICATION_MOCK=1 PORT=3430`, 1280x900 light unless marked mobile (390x844). UI primitives: Storybook on 3436, 720x480 light. Re-captured after the defect fixes: 01, 06, 14, 15, 16, 18, 19, 22, 23, 24, 26-30, 38; new: 39, 40.

01-index.png | Index: manual code entry with ADL- prefix, where-to-find-the-code card (sample QR at whole pixels per module), what the check shows
02-index-malformed.png | Index: short code submitted, inline error under the field
03-result-loading-skeleton.png | Result loading skeleton (client nav with the server fn call held back)
04-valid.png | Valid, restricted: details, reference chip, Version 2 current, idle hash check
05-superseded-linked.png | Superseded, linked: Version 1 superseded, "View the current version" button
06-superseded-unlinked.png | Superseded, no link: "Ask for the current version." notice (reference DCI-TSC-2026-0012388-L)
07-revoked.png | Revoked: reason "Issued in error", do not rely
08-expired.png | Expired compliance certificate (public): type, issuer, issue date
09-confidential.png | Confidential: validity only, no details
10-not-found.png | Not found: treat as not genuine, look-alike hint, Edit code
11-malformed-url.png | Malformed code in URL (/v/ADL-12345): not a valid verification code, Try again
12-rate-limited.png | Rate limited: countdown, Try again disabled
13-service-unavailable.png | Service unavailable (503): does not mean fake, Try again
14-hash-identical.png | Hash check: MOCK_SLIP_PDF bytes, identical to the issued document (version 2); size "198 bytes"
15-hash-mismatch.png | Hash check: edited copy ("version 3"), does not match, technical details open; size in bytes
16-hash-unreadable.png | Hash check: non-PDF (.docx), could not read this file; "22 bytes"
17-valid-reference-breakdown.png | Valid result with the reference breakdown popover open (viewport only)
18-about.png | About: what this page shows and records; "What you see" heading and table edges line up with the other cards' 24px inset
19-mobile-index.png | Mobile 390: index; placeholder code shown whole (13px placeholder on phones), highlighted sample code on one line
20-mobile-valid.png | Mobile 390: valid result, stacked detail rows
21-mobile-not-found.png | Mobile 390: not found
22-mobile-hash-identical.png | Mobile 390: valid + hash check identical (scrollY 0)
23-ui-qrcode-default.png | QrCode: default 112px, drawn at 3px a module (123px)
24-ui-qrcode-with-code.png | QrCode: WithCode story, real 26-character code beside it (slip card pattern)
25-ui-hashdropzone-idle.png | HashDropZone: idle
26-ui-hashdropzone-checking.png | HashDropZone: Checking story (file read held pending)
27-ui-hashdropzone-identical.png | HashDropZone: identical
28-ui-hashdropzone-mismatch.png | HashDropZone: does not match, technical details open; focus ring on "Hide technical details" now clears the text
29-ui-hashdropzone-unreadable.png | HashDropZone: could not read (not a PDF)
30-ui-hashdropzone-unavailable.png | HashDropZone: Unavailable story (crypto.subtle shadowed for the story)
31-ui-referencechip-default.png | ReferenceChip: default, copy + breakdown buttons
32-ui-referencechip-breakdown-open.png | ReferenceChip: breakdown popover open
33-ui-referencechip-lg.png | ReferenceChip: lg size
34-ui-versionbadge-plain.png | VersionBadge: version only
35-ui-versionbadge-current.png | VersionBadge: current
36-ui-versionbadge-superseded.png | VersionBadge: superseded
37-ui-versionbadge-every-state.png | VersionBadge: all three side by side
38-ui-icontile-tones.png | IconTile: EveryTone story, default and sm sizes
39-ui-icontile-default.png | IconTile: Default story (brand)
40-ui-icontile-art.png | IconTile: Art story (white tile on the art panel colour)

## Defects: fixed / declined

Fixed (PR #450):
- Stories: IconTile (Default, EveryTone, Art) and HashDropZone Checking and Unavailable added; captured from the stories, no in-page patches.
- File size: under 1 KB shows bytes ("198 bytes", "1 byte"); `formatFileSize` in packages/ui.
- QrCode: already had crispEdges; now also drawn at a whole number of CSS pixels per module (size rounded to the nearest multiple of the module count), so modules are even at 1x. Slip 124 -> 135px, verify sample 64 -> 45px.
- QrCode WithCode story uses ADL-7Q4K-M2XR-9HTC-W3NB-5FJD-K6RT-8P.
- Mock references: superseded-unlinked was DCB-TSC-2027 (a 2027 biennial cannot be filed in Sep 2026); now DCI-TSC-2026-0012388-L (valid check character). HashDropZone story text uses DCI-TSC-2026-0012345-8 to match the verify mock.
- About: "What you see" header and outer table cells inset 20px / 24px from sm, matching the other cards; heading same size as theirs.
- Mobile index: placeholder 13px on phones so the whole example shows; sample code no-wrap (one highlight); sample caption keeps "26 Sep 2026" and "Page 1 of 2" whole.
- "Hide technical details": 4px horizontal padding (negative margin keeps alignment) so the focus ring clears the glyphs.

Declined:
- Expired (08) has no expiry date: the contract has none (findings-145 open list), not a UI defect.
- Sticky header covering "Check another" after the auto-scroll on mobile: expected sticky behaviour.
