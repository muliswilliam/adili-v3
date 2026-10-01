# Portal screenshots, spec 06 (PR #450)

Desktop 1280 wide, light mode; `-mobile` files 390 wide. Portal dev server on 3410 with DIRECTORY/OBLIGATIONS/DECLARATIONS mocks, fake stepped-up Valkey sessions (demo declarant Wanjiku, two-Commission declarant Grace). The declarations mock now keeps each declarant's drafts to them (as the service does), so Grace sees only her own. Drafts seeded through a temporary untracked server route calling the mock (deleted after). Re-captured after the defect fixes: 11, 14, 15, 17, 18, 19, 20, 21, 24, 27, 28.

01-summary-ready-to-submit.png | Summary, everything complete, Submit card with "You will confirm your identity with a one-time code" (full page)
02-summary-ready-to-submit-mobile.png | Same, mobile, bottom of page: solemn declaration and Submit card
03-summary-step-up-failed.png | Summary after `stepUp=failed`: "We could not confirm your identity. Try again." with Confirm identity
04-affirmation-dialog.png | Affirmation dialog after step-up: identity confirmed time, solemn text, unticked "I affirm", Submit disabled
05-affirmation-late-warning.png | Affirmation dialog for an overdue obligation: filed-late warning naming the due date, affirmed
06-affirmation-submitting.png | Dialog while submitting: controls disabled, "Submitting..."
07-affirmation-error-5xx.png | Dialog after a 503: "Your declaration was not submitted. Try again.", Submit still enabled
08-affirmation-409-before-statement-date.png | Dialog after 409 before-statement-date: "You can submit from 2 Oct 2026.", Submit disabled
09-affirmation-409-amendment-window-closed.png | Amendment dialog ("Submit version 2") after 409 amendment-window-closed: "Amendments closed on ... Contact your Commission."
10-affirmation-409-not-a-draft.png | Dialog after 409 not-a-draft: "changed in another window" with Reload
11-summary-incomplete-blocking.png | Summary after a 400 incomplete submit (statement changed behind the page's back): blocking panel "2 things to complete before you can submit" with links, and the section nav re-read: Financial statements Incomplete
12-success-slip-preparing.png | Success page: reference, Version 1, "Preparing your acknowledgement slip...", What happens next
13-success-slip-taking-longer.png | Success page after 60 s pending: "Still preparing your slip" with Check again
14-success-slip-issued.png | Success page with issued slip card: reference, declarant, QR (whole pixels per module), verification code + copy, sent to masked email and phone, verified 0 times, Download slip, Verify online; What happens next with amend-until date
15-success-slip-issued-mobile.png | Same, mobile (full page): badge on the title's line (wordmark hidden on phones), verification code in two even lines broken between groups
16-success-slip-failed.png | Success page, slip failed: "The slip could not be prepared." with Request again
17-success-filed-late.png | Success page for Grace's late PSC filing (her own name on the slip): Filed late badge, "late" on Submitted, no amend line in What happens next
18-success-version-2-after-amendment.png | Success page for version 2: "replacing version 1" kept together, same reference, new slip
19-my-declarations-submitted-rows.png | My declarations (Grace, her two declarations only): submitted rows with Slip + Amend (window open) and "Amendments closed 17 Aug 2026" + Filed late (closed)
20-my-declarations-mobile.png | Same, mobile (full page): status badge beside the title
21-my-declarations-versions-expanded.png | Wanjiku's row expanded to versions: "Version 2 - current" and "Version 1 - superseded", each with verified count and Slip
22-amend-confirm-dialog.png | Amend confirm: "Amend version 1?", version stays in force, submit again by due date
23-workspace-amendment-banner.png | Workspace while amending: banner "You are amending version 1..." with Discard amendment, "Amending version 1" badge
24-my-declarations-amendment-in-progress.png | My declarations (Grace) row "Amendment in progress" with Continue amendment and Discard amendment
25-discard-amendment-confirm.png | Discard amendment confirm: "Version 1 stays in force, unchanged", Keep amending / Discard amendment
26-my-declarations-empty.png | My declarations empty state: "No declarations yet" with Go to Home
27-my-declarations-pagination.png | My declarations with 7 rows: pager "1-5 of 7", rows-per-page select, pages 1 2 (extra rows are mock clones, so references repeat)
28-dashboard-filed-obligations.png | Dashboard (Grace): Your declarations card, all filed, subtitle "Your filed declarations. Slips and amendments are on My declarations.", facts wrap between facts; filed obligation cards (reference, Version n, Filed late, View acknowledgement); account card onboarding dates kept whole

## Not captured

- Keycloak step-up page (OTP only): needs a real Keycloak sign-in, but the portal client only allows redirect URIs on localhost:3010 (this run was on 3410), and codes go through the notifications service (port 4010), which was not running. A fake Valkey session has no Keycloak SSO session, so step-up would show the full sign-in form, not the OTP-only page.

## Defects: fixed / declined

Fixed (PR #450, commits 0f30be29..e17ed60d):
- 11: real. After a 400 incomplete the summary showed the 400's list while the nav kept the pre-submit header. Now the 400 re-reads the summary and workspace header (router.invalidate), so nav and panel come from the same server read.
- 18: "version\u00A0n" no-break space; subtitle also text-pretty (no lone "number." on the last line, seen on 17).
- 15: on phones the slip wordmark is hidden (page header has the logo), so "Digitally signed" stays on the title's line; code drops break-words and uses text-balance, so it wraps only after a group's dash into even lines.
- 20: row status badge sits in the title row (beside it, under it only when too narrow).
- 28: card subtitle says drafts save as you type only while a draft/amendment is listed, otherwise "Your filed declarations. Slips and amendments are on My declarations."; facts use no-break spaces so lines wrap between facts, never inside a date. Also: account card onboarding date kept whole.
- Verified count: "Verified 1 time" already singular (tests cover 0/1/n). "Verified 0 times" kept: it is the spec copy (FE comment).
- Mock: drafts are now owned by the token's person_id (list scoped, others' ids 404, as the service does) and the bio is pre-filled from the caller's own roster entry (Grace's name and file numbers on her drafts).

Declined:
- Grace's PSC slip sent to her npsc.go.ke email: not a defect. Contacts belong to the person (one verified email, notifications "by person"), not to a Commission; the fixture email just happens to be a work address.
- 27: repeated references remain (rows are mock clones made for the pager shot; no real counterpart).
