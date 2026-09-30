# Design

How the designs map to code. The design system lives in [`packages/ui`](../packages/ui/): tokens in [`src/styles.css`](../packages/ui/src/styles.css), components in [`src/components`](../packages/ui/src/components/). Apps compose screens from those components and never define colours, shadows or radii of their own.

## Source

The clickable HTML prototypes are the source of truth. Where they disagree with the Figma style guide, the prototypes win; the Dials logo is the one thing still taken from Figma.

They are published to [muliswilliam.github.io/adili-v3](https://muliswilliam.github.io/adili-v3/) on every push to `main` that touches a `prototype` dir (`.github/workflows/pages.yml`). The site is public.

| | |
|---|---|
| Prototype kit | [`packages/ui/prototype/kit.css`](../packages/ui/prototype/kit.css) and `kit.js`: tokens, buttons, inputs, cards, badges, callouts, dialogs, tables, tabs. Index: [`packages/ui/prototype/index.html`](../packages/ui/prototype/index.html) |
| Primitives in use | `apps/portal/prototype/declarant-journey.prototype.html` (screen "UI primitives in portal context"), `apps/console/prototype/02-roster.prototype.html` (screen "UI primitives, round 2"), `apps/console/prototype/01-commissions.prototype.html`, `apps/keycloak-theme/prototype/login.prototype.html` |
| Figma file | [Dials](https://www.figma.com/design/wr7hrx3jB9cpWdpsvyAD1G/Dials): the logo (`Dials-logo`, node `21:9`) and the older style guide (`81:3824`) |
| Applied in | PR [#104](https://github.com/muliswilliam/adili-v3/pull/104) (tokens) and the primitive PRs #103, #106 and #107 |

The kit is throwaway: plain CSS with hex values so the prototypes open by double-click. Its values are translated into the semantic tokens below, as oklch with the kit's hex in a comment, rather than copied. To check a component, open the prototype screen that shows it and grep the kit for its class (`.btn`, `.input`, `.card`, `.badge`, `.callout`, `.hstep`, `.drop`, `.pbar`, `.tabs`, `.otp`, …).

## Foundations

| | Kit | Code |
|---|---|---|
| Font | Inter | `font-sans` (Inter Variable, bundled via `@fontsource-variable/inter`), features `cv11` and `ss01` |
| Body text | 15px, line height 1.5 | set on `body`; components set their own sizes (labels and table text 14px, hints 13px) |
| Icons | stroke icons, 16 to 18px | `Icon` from `@adili/ui` with icons from `@hugeicons/core-free-icons`, 16px by default |
| Focus | 2px ink outline, 2px offset | `focusRing` from `@adili/ui` (`outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring`) on buttons, links, tabs, steppers and drop zones; compose it with `cn` to change the colour or offset, or use `focusRingInset` to draw it 2px inside a clipped control. `focusRingWithin` draws it on a label whose visually hidden radio has keyboard focus. Where a focus ring is drawn, use `outline-hidden`, never `outline-none` (which stays only where nothing draws one: inputs, which use `shadow-control-focus`; menu and select items, which show a highlight background; the dialog panel; and `tabIndex={-1}` alerts and headings that take focus only to be read out), and keep `focus-visible:outline-solid`: in Tailwind 4 both hiding utilities set the outline style to none and `outline-2` inherits it, so without it the ring never draws. The `adili/focus-ring` lint rule (`@adili/eslint-config`) catches both. Controls use `shadow-control-focus` |

## Colour tokens

Warm neutrals with a near-black primary. Use the semantic utility (`bg-muted`, `text-muted-foreground`, …), never a hex value.

| Token | Kit | Light | Used for |
|---|---|---|---|
| `background` | `--bg` | `#fafaf9` | page |
| `foreground` | `--ink` | `#1a1a1a` | body text; the toast pill |
| `card` | `--surface` | `#ffffff` | cards, inputs, secondary buttons, menus |
| `muted` | `--sunken` | `#f4f3f1` | hover fills, read-only and disabled inputs, icon tiles, default badges, neutral callouts |
| `muted-foreground` | `--muted` | `#6f6e6b` | hints, table headers, secondary text |
| `secondary-foreground` | `--ink-2` | `#4a4a48` | labels, ghost buttons, default badge text |
| `placeholder` | input placeholder | `#8f8d89` | placeholders, upcoming stepper steps |
| `primary` / `primary-foreground` | `.btn-primary` | `#1a1a1a` / white | primary buttons (with a slight top-down gradient), current step, progress fill, tooltips |
| `primary-disabled` / `-foreground` | `.btn-primary[disabled]` | `#c9c7c3` / white | disabled primary buttons |
| `border` | `--line` | `#e8e6e3` | hairlines, card and control rings, table rows |
| `input` | `--line-2` | `#d9d7d3` | dashed drop zones, step rings and connectors, dialog grabber, hovered controls |
| `ring` | `--ink` | `#1a1a1a` | focus outlines and rings |
| `control` | | `card` | fill of inputs, textareas and selects |
| `scrim` | `.overlay` | `rgb(24 20 16 / 0.42)` | behind dialogs |
| `glow` / `glow-soft` | | `#f0cab9` / `#f5e4dc` | the warm glow behind onboarding screens (`bg-glow`); *sampled from a screenshot, exact stops pending* |
| `logo` | | `#f06225` | the Dials logo only |
| `code` / `code-foreground` | `.code` (roster prototype) | `#171717` / `#ecebe8` | code examples; dark in both themes (`#0f0f0e` with a `border` hairline, `code-border`, in the dark theme). `code-keyword` `#ffb48f`, `code-string` `#b6e3a8` and `code-comment` `#8d8b87` colour their parts, all at least 4.5:1 on the panel |

Status colours come in three steps: the solid colour (`text-success`, dots, bars, badge text), a soft fill (`bg-success-subtle`) and a darker text for callouts on that fill (`text-success-subtle-foreground`). The info and brand solids miss 4.5:1 on their light soft fills, so their badges use `-subtle-foreground`, as the kit's `.badge-info` and `.badge-brand` do.

| Family | Kit | Solid | `-subtle` | `-subtle-foreground` |
|---|---|---|---|---|
| `success` | `--ok` | `#167a3e` | `#e9f6ee` | `#0f5a2d` |
| `warning` | `--warn` | `#9a5a00` | `#fdf4e2` | `#6b4000` |
| `destructive` | `--danger` | `#c9291e` (hover `destructive-hover`, `#b3241a`) | `#fdeceb` | `#8a1c14` |
| `info` | `.badge-info`, `.dot.info` | `#2f6fd1` | `#eaf1fb` | `#1f4f96` |
| `ai` | `--ai` | `#6d4ae0` | `#f1edfd` | `#43299f` |
| `brand` | `--brand`, `--brand-soft`, `--brand-ink` | `#e95a24` | `#fdf0e9` | `#b8430f` |

`brand-faint` (`--brand-softer`, `#fef7f3`) tints selected table rows and a drop zone while a file is dragged over it.

**Brand and logo.** The kit's brand orange (`#e95a24`) is for UI accents: the brand badge, eyebrows, icon tiles on `brand-subtle`. The logo keeps the Figma orange (`#f06225`) through its own `logo` token, so the mark does not shift when UI accents are tuned.

## Elevation and radius

Controls and cards get their edges from a hairline ring in the shadow rather than a border. Each is a token so dark mode can swap it.

| Utility | Kit | Where |
|---|---|---|
| `shadow-control` | `--shadow-input` | inputs, textareas, selects, secondary buttons |
| `shadow-control-hover` | *derived* | hovered controls (the ring darkens to `input`) |
| `shadow-control-focus` | `.input:focus` | focused controls: 1px ink ring and a 4px 8% halo |
| `shadow-control-error`, `-error-focus` | `[aria-invalid]` | invalid controls (`aria-invalid`): 1.5px red ring |
| `shadow-control-selected` | `.gr:has(input:checked)` | a chosen option card (radio cards, grounds): 1.5px ink ring |
| `shadow-card` | `--shadow-card` | cards |
| `shadow-card-editing` | *derived* | the item card open for editing in a `Repeater`: 1.5px ink ring and a soft lift |
| `shadow-pop` | `--shadow-pop` | dialogs, menus, select and combobox lists, toasts, tooltips |
| `shadow-button-primary`, `-destructive` | `.btn-primary`, `.btn-danger` | the lift and inner highlight on solid buttons |

| Radius | Size | Kit | Where |
|---|---|---|---|
| `rounded-sm` | 6px | | checkboxes, skeletons, code chips |
| `rounded-md` | 8px | `--r-sm` | small and icon buttons, tooltips, menu items |
| `rounded-lg` | 10px | `--r` | buttons, inputs, callouts |
| `rounded-xl` | 12px | | menus, toasts, drop zone icon tiles |
| `rounded-item` | 14px | | `Repeater` item cards and their add button |
| `rounded-2xl` | 16px | `--r-lg` | cards, drop zones |

Dialogs use 20px (22px at the top of the phone sheet), as in the kit.

## Logo

From the `Dials-logo` frame (node `21:9`) of the Figma file, in `packages/ui/src/components/logo.tsx`. The prototypes draw a simplified placeholder mark; the Figma logo is used instead.

- `Logo`: the wordmark, plus an optional product name (`Console`) after a divider. Used by `SiteHeader`.
- `LogoWordmark`: the "Dials" lockup on its own, 24px high by default.
- `LogoMark`: the "D" mark on its own, for square slots such as the login page. The favicons in each app's `public/favicon.svg` are the same mark.

The lockup and mark are always the `logo` orange. In Figma the mark carries an 8px stroke in the page colour that cuts gaps into the "i"; code masks those gaps out so the logo sits on any background.

## Components

| Component | Kit | Notes |
|---|---|---|
| `Button` | `.btn` | Variants `default` (primary), `secondary`, `ghost`, `destructive`, `destructive-ghost`, `link`. Sizes `default` 44px, `sm` 34px, `xs` 28px, `icon` 36px square. Presses down 1px; disabled is 50% opacity, except primary, which turns `primary-disabled`. Full width is `className="w-full"`. |
| `Input`, `Textarea` | `.input`, `.textarea` | 44px high (textarea 110px minimum), 12px padding, 15px text. Read-only (the `readonly` attribute) and disabled fill with `muted`; disabled text is dimmer. `controlClassName` carries these for other text controls. Error comes from `aria-invalid`, set by `FormField`. |
| `Label` | `.label` | 14px medium in `secondary-foreground` |
| `FormField` | `.field` | label, hint, control and error 6px apart. The hint sits under the label so it is read before the control; the error sits under the control with an icon and `role="alert"`. |
| `Card` | `.card.card-pad` | white, 16px radius, `shadow-card`, 20px padding (24px from `sm`); `asChild` puts it on a semantic element such as an `article`. `CardHeader` (optional `CardIcon`: 34px `muted` tile; title 16px semibold; description 14px muted), 20px to `CardContent` (fields 16px apart), 20px to `CardFooter` (actions 12px apart; `flex-1` for an equal-width pair). |
| `Badge` | `.badge` | 24px pill, 12.5px medium. `default` (sunken), `success`, `warning`, `destructive`, `info`, `brand`, `ai`. Put an icon or clear text in it; never rely on colour alone. |
| `Alert` | `.callout` | 14px on a soft fill, 18px icon 12px from the text. `neutral` (default, the kit's `.callout-info`), `info` (blue, the portal's `.alert-info`), `success`, `warning`, `destructive`, `ai` (`.callout-ai`), `brand` (`.callout-brand`; its text is `brand-subtle-foreground`, lighter than the kit's `#7a2f0c`). |
| `DescriptionList` | `.dl` | term on the left in muted, value right-aligned in medium weight, rows split by hairlines |
| `SiteHeader` | `.topbar` | 60px, translucent page colour with blur, hairline below; 16px side padding, 28px from `sm` |
| `Dialog` | `.dialog` | bottom sheet with a grabber on phones, centred 560px panel from `sm`. `DialogHeader` (19px title), `DialogBody` (scrolls; fields 18px apart), `DialogFooter` (hairline above; equal-width buttons on phones, right-aligned from `sm`) |
| `Toast` | `.toast` | pill at the bottom centre, portalled to the body so it sits above dialogs. Polite: dark `foreground` pill with `background` text and a tick. Assertive: red `bg-destructive` pill with `text-destructive-foreground` and an alert icon, and no auto-dismiss. The countdown pauses on hover and focus; the dismiss button's ring takes the pill's text colour |
| `Table` | `.table` | 12.5px muted headers on a faint fill, 12px cells with 16px at the row ends, hairlines between rows |
| `EmptyState` | `.empty` | 30px icon tile, 15px title, 14px text up to 340px wide; no border, since it sits inside a card |
| `Skeleton` | `.skeleton` | 12px bar with a shimmer (static when reduced motion is set) |
| `Checkbox` | `.cbx` | native checkbox, 18px, `accent-color` primary |
| `Select` | `.select`, `.menu` | trigger styled like `Input`; the list is a 12px-radius `shadow-pop` menu with 36px items. The trigger takes the id and aria attributes from `FormField`. |
| `Menu` | `.menu`, `.menu-note` | a button's dropdown of actions: 12px-radius `shadow-pop` panel, 200-300px wide, 6px padding; `MenuItem` rows are 36px, 14px text with an optional 16px muted icon (`tone`: `destructive` red, `ai` icon tint), `rounded-md`, `muted` when highlighted; disabled items are 50% opacity. `MenuNote` is a 13px muted entry, reachable but unavailable (`aria-disabled`), explaining an action that is not offered. `MenuTrigger` wraps the button; `MenuContent` aligns to its end by default. A picked item's `onSelect` runs once the menu has closed and focus is back on the trigger, so a dialog it opens returns focus there. `AttachmentList` uses it via `menuItems` behind a 36px ghost icon trigger (vertical ellipsis). |
| `DataTable` | `.table` with `.cbx` | `Table` with a 36px checkbox column; selected rows tint `brand-faint`; select all covers the current page. The header checkbox is named by `selection.selectAllLabel` (default "Select all on page") |
| `FileDropZone` | `.drop` | 1.5px dashed `input` border, 16px radius, 44px icon tile, 15px semibold label and 13.5px hint inside the zone. Hover and drag-over turn the border ink on `brand-faint`; an error softens it red and shows `FieldError` below; disabled is 55% opacity with a not-allowed cursor. A file rejected in the browser shows its message until the next file is accepted or `error` changes to a new value; clearing `error` does not hide it. |
| `ProgressBar` | `.pbar`, `.prog-meta` | 10px bar (`sm`: 6px) on `muted` with a hairline; fill `primary`, or `success` / `destructive` via `tone`. Status text and the percentage sit under the bar. `indeterminate` sweeps while the total is unknown. The label names the bar for screen readers only. |
| `Stepper` | `.hstep` | 24px numbered circles joined by 28px lines (14px on phones, where only the current label shows). Done steps are a green tick on `success-subtle`, the current step is ink (red with a cross when `failed`), upcoming steps are a ring in `placeholder` text. |
| `Tabs` | `.tabs` | 40px underlined tabs, 14px medium, the active one ink with a 2px ink rule; `TabsCount` adds the kit's 18px count pill |
| `Tooltip` | `.tip-t`, `#kit-tipbox` | ink panel, 12.5px medium text up to 280px wide, `shadow-pop`. `TooltipProvider` is optional: mount it near the app root to share one open delay across tooltips; without it each `Tooltip` uses the defaults. |
| `Combobox` | `.combo-list`, `.combo-opt` | `Input` with a search icon; the list is a pop-shadow menu whose options show the description as a `brand-subtle` mono code chip before the label, and a tick on the chosen one |
| `OtpInput` | `.otp` | 54 × 58px boxes, 24px semibold digits, 8px apart with a 10px gap between the halves; the shared `shadow-control-focus` and `shadow-control-error` rings (the kit's 1.5px focus ring is not a separate token); disabled boxes fill `muted` |
| `MaskedContact` | `.masked`, `.vbadge-ok` | semibold tabular value; the optional verified badge is `success` with a tick |
| `CopyButton` | copy button in the portal gallery | 36px ghost icon button, or `sm` with its label shown; confirms with a polite toast |
| `OfficerReference` | `.mono` officer reference in the portal dashboard | the officer reference in semibold mono with a `CopyButton` after it |
| `FilterChip` | `.chip`, `.chip.on` | 32px pill toggle, 13.5px medium, with an optional icon and count; ink when pressed, a control ring when not; state in `aria-pressed` |
| `Spinner` | `.spinner` | 18px ring in the current text colour, spinning (still when reduced motion is set); decorative |
| `StatusMark` | state icon on login outcome pages | 56px circle with a 28px icon above an outcome or error title; tones `success`, `warning`, `destructive`, `neutral` on their soft fills |
| `AttachmentList` | `.att-list`, `.att`, `.att-add` in the declaration screens | one row per file with a 36px icon tile, the 14px medium name and a 12.5px status line: uploading (`ProgressBar` `sm`), scanning (`Spinner`), attached, infected, rejected and failed, each in text with an icon. An add button opens the file picker; removing an attached file asks first. Finishing is announced politely. With `menuItems`, an attached file's actions (and Remove) move into a `Menu` named "Actions for {name}". |
| `CountrySelect` | `.select` (country) in the declaration screens | `Combobox` over the ISO 3166-1 countries, matched by name or two-letter code; the value is the alpha-2 code. `exclude` drops countries already chosen. |
| `CountySelect` | `.select` (county) in the declaration screens | `Combobox` over Kenya's 47 counties, alphabetical; the value is the official county code (`047` for Nairobi City). The lists behind both selects live in `lib/places.ts`. |
| `DateInput` | `.input` with the date picker in the declaration screens | `Input` typed as DD/MM/YYYY with slashes added as you type and impossible dates refused; a 36px ghost calendar button opens a 296px `shadow-pop` picker (12px radius, month and year selects, 36px days, the chosen day ink). The picker is optional and closes on Esc. |
| `MoneyInput` | `.money` in the declaration screens | `Input` with the currency (13.5px semibold muted) inside on the left, linked as a description. Stores integer cents; thousands separators appear as you type, two decimals at most. A minus sign stays in the field and is reported invalid (reason `negative`), so the form shows a field error rather than changing the amount. |
| `PercentInput` | the joint share in the declaration screens | `Input` with a `%` (13.5px semibold muted) inside on the right, hidden from screen readers. A whole number, three digits at most; anything but digits is dropped as you type. The form checks the range and shows the field error. |
| `Repeater` | `.rep`, `.rep-item`, `.rep-add` in the declaration screens | a list of `rounded-item` `shadow-card` cards, each a 38px `muted` icon tile, a 15px medium title, an optional description and aside, and edit, duplicate and remove actions named after the item. The open card takes `shadow-card-editing`. The add button is a 48px dashed `input` bar that turns ink on `brand-faint` on hover. |
| `SaveIndicator` | `.save` in the declaration header | 13px muted status with an icon: `saving` (`Spinner`), `saved` (green cloud tick), `retrying` (warning text), `conflict` (destructive medium text with a `Reload` button, announced assertively). Text and icon, never colour alone. |
| `SectionNav` | `.dnav` sidebar in the declaration screens | ordered list of sections with 24px status circles (done is a tick on `success-subtle`) and an optional 12px muted detail line; sub-sections hang off a 1.5px rule with 13.5px items. The current one has `aria-current="page"`; completeness is also in text for screen readers. |
| `SegmentedChoice` | `.seg` in the declaration screens and the `04-obligations` toolbar | native radios in a fieldset shown as 40px `shadow-control` buttons, 10px radius (`rounded-lg`), 6px apart; the chosen one is ink. Arrow keys move between options. `variant="track"` is the toolbar filter: 30px 13.5px medium options on a `muted` track (3px padding, 8px radius), the chosen one raised on `card` with `shadow-card`, the legend for screen readers only. Both draw the focus ring with `focusRingWithin`. |
| `ConfidenceChip` | `.conf` in the read-into-the-form review | `Badge`: High (`success`, tick), Medium (`warning`, dash), Low (`destructive`, alert); screen readers hear "Confidence: Low". `confidenceLevel` splits a 0-1 score at 0.85 and 0.6. Text and icon, never colour alone. |
| `SourceBadge` | `.src-b` on sourced items and the summary | `Badge` with the source's icon and name: registries (KRA, NTSA, BRS, ArdhiSasa) `info`, Document `ai`. Focusable, with a `Tooltip` and accessible name giving the date and identifier ("From NTSA, 26 Sep 2026 · KCA 123A"; "Read from logbook.pdf, page 1, 26 Sep 2026"), built by `describeSource`. |
| `RegistryStatusList` | `.reg-strip`, `.rs` in the registries panel | a list (one column on phones, two from `sm`) of `RegistryStatusRow`s: 44px `shadow-card` rows with the 14px medium registry name and a 13px status with an icon: Not checked, Checking… (`Spinner`), {n} suggestions (green tick), Nothing found, Not available now (warning alert, with a `Retry {registry}` xs ghost button). |
| `ConsentDialog` | consent modal in the registries panel | `Dialog` with a 34px `muted` icon tile beside the title, the consent text in 15px ink, a "I request this check" `CheckboxItem`, and Cancel / Continue (disabled until ticked). The text names the registries asked (`registries`, all four by default; one when retrying an unavailable registry, which asks again), always in the order KRA, NTSA, BRS, ArdhiSasa; `consentTextVersion(registries)` identifies that exact text (e.g. `registry-consent.v1:kra+ntsa+brs+ardhisasa`) for the lookup to send. The tick clears on each open; focus returns to the opener. `maskNationalId` shows the last three digits. |
| `SuggestionCard` | `.sug` in the registries panel | a `rounded-item` `shadow-card` card with a 38px `muted` icon tile, 15px medium title, 13px muted source line ("From NTSA, 26 Sep 2026"), an optional description and a field preview. Actions are `sm` buttons named "{action}: {title}": Add (primary), Edit and add, Dismiss (ghost); a match shows "Matches …. Fills: Label **value**" and leads with Apply to this item (still the main action when nothing is empty: "Nothing to fill. Applying records {source} as this item's source."), then Add and Edit and add as secondary actions, then Dismiss. Accepted collapses to a tick, "Added" or "Applied" in green and View; dismissed to a `muted` row with "Dismissed". `busy` swaps the actions for a `Spinner` status (Saving… / Your statement changed. Refreshing…). |
| `Chart` | none (derived) | `figure` with a 14px medium caption, hidden from assistive tech because the data table carries the same title. `bar` draws one horizontal 8px track per series under each category label, value text on the right; `line` draws a 192px plot with hairline grid, 2px lines and 8px points. Series take `brand`, `info`, `foreground`, `muted-foreground`, never a status colour. Suppressed (`null`) and missing values are never plotted: bars show `suppressedLabel` or `missingLabel`, lines leave a plain break with nothing joining it, and a long line labels at most four categories (always the latest). The data table is always there for assistive tech; `showTable` puts it on screen. |
| `DeadlineChip` | `.dlc` in `10-access` | a `Badge` for an access clock (a decision, the representation window, a download window; not a filing obligation's due date), 12.5px semibold tabular: days left (`default`), due soon and due today (`warning`), late (`destructive`) or met with a tick (`success`). Due soon starts at the clock's first reminder, from `deadlineSoonDays` (decision 10, representations 2, law enforcement 4); `late` takes the server's flag, late even on the due day after the due time. A `time` element; screen readers hear the label, date and days left ("Decision due 12 Oct 2026, 3 days left"). Days count in Kenyan calendar days (`deadlineStatus`) and move on at midnight. |
| `StatusBadge` | `statusBadge` in `04-obligations` | a `Badge` for a status with its word and an icon, never colour alone: `neutral` (upcoming, clock), `info` (due, calendar), `warning` (overdue, alert), `success` (filed, tick). `icon` replaces the variant's icon or, as `null`, drops it. |
| `ObligationStatusBadge` | `statusBadge` in `04-obligations` | a `StatusBadge` for a filing obligation's status, word and variant from the shared obligations table: `cancelled` is `neutral` with a cross (staff may open one; the portal never lists it). |
| `ReminderOutcomeText` | outcome cell of the reminder history in `04-obligations` and the portal drawer | a reminder's outcome in plain words after a 14px icon: a `success` tick when sent, a `destructive` alert when sending failed or the reminder was missed (its day passed before it went out), a muted dash when skipped on purpose |
| `ReminderHistory` | the reminder history table in `04-obligations` and the portal drawer | an obligation's reminders in a `Table`: when (days before due), scheduled and sent (date and time, Kenyan time), channels and the outcome as `ReminderOutcomeText`; on phones each row turns into labelled lines. Skeleton lines while loading, "No reminders sent yet." when empty, and an `Alert` with a retry when it could not be read. The portal and the console drawers both use it. |
| `StatTile` | `.otile` in `04-obligations`, `.tile` | a summary count: 16px-radius card, 13px muted label with an optional dot or icon `marker`, 28px semibold tabular value, optional description and a breakdown list under a hairline (named "{label} by type" unless `breakdownLabel` says otherwise) that is always shown and also in the hover title. `tone="warning"` tints the tile amber. With `onPressedChange` the label and value are an `aria-pressed` toggle whose hit area covers the tile (pressed takes `shadow-control-selected`); the breakdown stays outside the button so it reads as a list. |
| `Drawer` | `.drawer` | a modal panel from the right edge, full height, 520px (`size="wide"`: 720px, for tables), full width on phones; slides in (not with reduced motion). The close button sits top right and takes focus on open; focus is trapped and returns on close to the `DrawerTrigger` or, for a controlled drawer, the row link that opened it. `DrawerHeader` (18px title, hairline below), `DrawerBody` (scrolls; sections 18px apart), `DrawerFooter` (hairline above, right-aligned). |
| `DateText` | `relPhrase` / `dateText` in `04-obligations` and the portal gallery | a `time` with a relative phrase, "Due in 12 days", "Due today" or "3 days overdue" (warning text), counted in Kenyan calendar days so month ends and the year end count right, with the absolute date in the `title` and read out after the phrase. `kind="opens"` prints "Opens 1 November 2027". Moves on at midnight. `duePhrase` gives the phrase alone. |
| `ObligationCountdown` | `relPhrase` in `04-obligations` and the portal card | a `DateText` chosen by the obligation's status: "Opens 1 November 2027" (statement date) while upcoming, the countdown to the due date while due or overdue, nothing once filed or cancelled (`hasCountdown`). |
| `StatementDateTerm` | `.term` in `04-obligations` and the portal drawer | the term with a dotted underline and a 13px info icon, focusable (`focusRing`), its meaning in a `Tooltip` below; each app passes its own words (the portal says "your"). |
| `ScopePicker` | `.scope` in `10-access` | Years, People and Sections fieldsets (card fill, `shadow-control`, 12.5px uppercase legends), side by side from 760px of its own width. The declarant is always included. `restrictTo` disables what was not requested ("Not requested") so a partial grant can only narrow; errors ring the group red. `Scope` is `form-k.v1`'s scope, as is access.yaml's. `formatScope`, `isScopeWithin` and `isSameScope` go with it. |
| `GroundsSelect` | `.grounds`, `.gr` in `10-access` | a card per Regulation 24 ground, toggled from anywhere on it; checked cards take `shadow-control-selected`. The checkbox is named by the short label and described by the quoted regulation text. The kit's legend tooltip is a hint under the legend, since it says when grounds are required. |
| `RegisterTimeline`, `RegisterList` | `.timeline.reg` in `10-access`; `.rt` in `declarant-profile` | the access register newest first, icon, copy and tint per `RegisterEntry.kind`; a `decided` entry reads and tints by its `outcome` (granted, partially granted, denied). Entries can override title and tone for the declarant's copy. `RegisterTimeline`: vertical timeline for one request in a card. `RegisterList`: flush rows grouped by month headings with the reference, the date shown and the full time read out. |
| `CodeBlock` | `.code` in `02-roster.prototype.html` (API documentation) | 12px-radius `code` panel, 12.5px mono at 1.65 line height, 14 × 16px padding; lines keep their breaks and scroll sideways, so the block is a focusable, labelled group. `CodeKeyword`, `CodeString` and `CodeComment` mark its parts |

Shared helpers live next to the components: the obligations copy table (`lib/obligations.ts`: type labels, status words and variants, reminder outcome words and icons) that the portal and the console both use, `useObligationDetail` for a drawer that loads an obligation's detail with a retry, `formatDate`, `formatDateTime`, `formatLongDate`, `formatMonth` and `formatCalendarDate` print dates in Kenyan time the same on server and browser, `formatNumber` prints counts with thousands separators (`48,312`), `daysBetween`, `addDays` and `plural` count calendar days in Kenyan time for deadlines and periods ("Respond within 12 days"), `calendarDaysUntil` counts Kenyan calendar days to a date and `useToday` gives a now that moves on at each Kenyan midnight, and `useCountdown`, `useCountdownAnnouncement`, `secondsUntil`, `formatClock` and `countdownAnnouncement` drive resend countdowns (on screen every second, announced to screen readers at 10-second steps).

## Storybook

`pnpm --filter @adili/ui storybook` serves every `src/**/*.stories.tsx` on port 6006, with the accessibility panel; `build-storybook` writes a static copy. `src/stories.test.tsx` renders every story in the unit tests, so a story cannot break silently. Stories cover each state a ticket lists (the access and obligations primitives and `Chart` so far).

## Dark theme

*Derived.* The prototypes are light only. `prefers-color-scheme: dark` maps the same tokens onto a dark warm-neutral scale (page `#141413`, cards `#1c1c1a`), lightens the status and brand hues so their text stays legible on the dark fills, and keeps the hairline rings on `border`. White fails AA on the lighter red, so solid destructive buttons take dark text in the dark theme.

## Open questions

For the designer; each is built as described until decided.

1. **Placeholder contrast.** `#8f8d89` on white is about 3.3:1 (3.0:1 on `muted`, which read-only controls use), below the 4.5:1 WCAG 2.2 AA asks of text. The dark theme uses the same grey, which reaches 4.6:1 on `muted` and 5.2:1 on `card`.
2. **Brand buttons.** White on `#e95a24` is about 3.5:1, so there is no solid brand button; the kit's `.btn-brand` is unused by the prototypes.
3. **Hint placement.** The kit's `field()` puts the hint under the control; the portal's onboarding screens put it under the label. Code keeps it under the label so it is read before the control.
4. **Dark theme**: not yet designed.
5. **Logo.** The prototypes draw a placeholder mark; the Figma logo is used.

## Screens

Every `design-pending` ticket is built on the tokens above. A screen's own design pass replaces structure-only layout with its prototype screen.

| Screen | Ticket | Prototype | Status |
|---|---|---|---|
| Foundations and shared components | [#104](https://github.com/muliswilliam/adili-v3/pull/104) | `packages/ui/prototype/kit.css` | applied |
| Commissions list and detail | [#12](https://github.com/muliswilliam/adili-v3/issues/12) | `apps/console/prototype/01-commissions.prototype.html` | tokens only |
| Get started (Identify) | [#66](https://github.com/muliswilliam/adili-v3/issues/66) | `apps/portal/prototype/declarant-journey.prototype.html` (`gs-*` screens) | built from the Figma frame `onboarding-step-1` with a national ID field the frame lacks; glow colours sampled; prototype pass pending |
| Dashboard obligations and drawer | [#89](https://github.com/muliswilliam/adili-v3/issues/89) | `apps/portal/prototype/declarant-journey.prototype.html` (`#89` Home and drawer screens) | built from the prototype; obligation cards are `Card`s (16px radius, the `shadow-card` hairline, not the prototype's 20px and tinted rings) with tints from the `brand` and `warning` tokens instead of the kit's hex gradients; spec 04 copy where it differs from the prototype |
| Obligations workspace (tiles, not-onboarded callout, list, drawer) | [#97](https://github.com/muliswilliam/adili-v3/issues/97) | `apps/console/prototype/04-obligations.prototype.html` (`#obligations` and the `o-*` screens) | built from the prototype; the list turns into cards under 900px of its own width (a container query), and the table's column is "Declarant" where the prototype says "Officer" |
| Obligations policy card, Commission obligations card, national summary | [#100](https://github.com/muliswilliam/adili-v3/issues/100) | `apps/console/prototype/04-obligations.prototype.html` (`#policy`, `p-*`, `#national`, `n-*`); the Commission detail cards in `apps/console/prototype/01-commissions.prototype.html` (`#detail`, `#my-commission`) | built from the prototypes; national sort and paging are client-side, in the URL |
| Declaration capture (overview, bio, household, statements, other information, summary) | [#108](https://github.com/muliswilliam/adili-v3/issues/108) | `apps/portal/prototype/declarant-journey.prototype.html` (`decl-*` screens) | built from the prototype; the header line follows the spec ("{Type} declaration · {Commission}") rather than the prototype sidebar |
| Registries panel on a statement (status strip, suggestion cards, Dismissed fold, consent) | [#312](https://github.com/muliswilliam/adili-v3/issues/312) | `apps/portal/prototype/declarant-journey.prototype.html` (`j-reg-*` states) | built from the prototype |
| KRA line under Your details | [#312](https://github.com/muliswilliam/adili-v3/issues/312) | `apps/portal/prototype/declarant-journey.prototype.html` (`j-bio-kra`) | built from the prototype; read-only for the declarant, whose declaration.v1 bio has no KRA fields |
| Read into the form sheet (attachment row menu, kind, reading, review, failed, not enabled) | [#316](https://github.com/muliswilliam/adili-v3/issues/316) | `apps/portal/prototype/declarant-journey.prototype.html` (`j-ex-*` states) | built from the prototype |
| Source badges on items and the summary, roster note on HR fields in Your details | [#319](https://github.com/muliswilliam/adili-v3/issues/319) | `apps/portal/prototype/declarant-journey.prototype.html` (`j-src-items`, `j-sum-src`, `j-bio-hr`) | built from the prototype |

Add a row when a screen's design pass starts, and flip the status when it merges.

## Working with Figma

Claude Code reads designs through the [Figma MCP server](https://mcp.figma.com/mcp) (`claude mcp add --transport http figma https://mcp.figma.com/mcp`, then authenticate in `/mcp`). Figma is now only needed for the logo and for frames that have no prototype yet.

- Share **frame** links (right-click a frame → Copy link to selection). Page links point at a canvas and fail with "nothing selected".
- Each read counts against the plan's limit: 20 calls a month on Starter, 200 a day on Professional with a Full or Dev seat. One frame usually costs two or three calls.
- When a call is not worth spending, export frames as 2× PNGs and share the paths instead; spacing and colours then need checking by eye.
