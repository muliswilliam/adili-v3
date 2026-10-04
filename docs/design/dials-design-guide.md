# Dials design guide

Source: [Dials · style-guide](https://www.figma.com/design/wr7hrx3jB9cpWdpsvyAD1G/Dials?node-id=81-3824). Extracted 2 October 2026.

Additional source: [Dials · admin Form K requests dashboard](https://www.figma.com/design/wr7hrx3jB9cpWdpsvyAD1G/Dials?node-id=275-4155), inspected 2 October 2026.

Dialog source: [Dials · Form K request details](https://www.figma.com/design/wr7hrx3jB9cpWdpsvyAD1G/Dials?node-id=275-4472), including the “Identify Officer” modal (`275:4581`), inspected 2 October 2026.

This document translates the style-guide, logged-in admin dashboard, and request-details dialog into reusable design rules. Values marked **observed** come from their nodes or written annotations. Semantic token names and usage recommendations are proposed implementation conventions, not existing Figma variable names. Icon styling is outside these dashboard/dialog updates' scope.

## Design direction

Use a compact, neutral interface with Inter text, pale surfaces, rounded controls, and subtle layered shadows. Dark primary actions establish hierarchy; red identifies destructive actions and validation errors. Keep labels persistent above fields and make focus states visible. The supplied components favor dense desktop forms and navigation.

## Typography

| Role | Family | Size | Weight | Line height | Letter spacing | Evidence |
|---|---|---|---|---|---|---|
| Primary UI text | Inter | 14px | Not specified globally | Not specified globally | Not specified globally | Written annotation: `text-sm` |
| Page header | Inter | 18px | 600 | 16px | -0.02em | Size annotation; remaining values observed in dashboard |
| Input label, placeholder, error | Inter | 14px | 400 | 16px | -0.008em | Observed components |
| Button label | Inter | 14px | 400 | 16px | -0.008em | Observed components |
| Navigation label | Inter | 14px | 500 | 20px | 0 | Observed navigation |
| Navigation count | Inter | 12px | 500 | 20px | 0 | Observed navigation |

The explanatory annotations themselves use 24px Medium text with -0.02em tracking. This is presentation text for the guide; do not adopt it as the product body style. Load Inter explicitly; a system sans-serif fallback is an implementation recommendation.

## Color tokens

| Proposed token | Value | Observed role |
|---|---|---|
| `surface.canvas` | `#FAFAFA` | Style-guide background |
| `surface.control` | `#FFFFFF` | Input surface |
| `text.strong` | `#0A0A0A` | Secondary/ghost button labels, selected navigation |
| `text.muted` | `#525252` | Unselected navigation |
| `text.label` | `#737373` | Input labels |
| `text.placeholder` | `#A1A1A1` | Default input placeholder |
| `text.on-action` | `#FFFFFF` | Primary/destructive button labels |
| `action.primary` | `#1A1A1A` | Primary default, rounded from Figma RGB |
| `action.primary-hover` | `#0A0A0A` | Primary hovered/focused |
| `action.secondary` | `#F0F0F0` | Secondary default |
| `action.neutral-hover` | `#E9E9E9` | Secondary/ghost alternate and focused |
| `action.destructive` | `#FB2C36` | Destructive default; error label/message |
| `action.destructive-hover` | `#E7000B` | Destructive hovered/focused; alert count |
| `input.error-ring` | `#FF0000` | Error input outline effect |
| `input.error-placeholder` | `#FFA2A2` | Error placeholder |
| `nav.selected` | `#E5E5E5` | Selected navigation background |
| `badge.neutral` | `#D4D4D4` | Neutral count background |
| `badge.neutral-text` | `#404040` | Neutral count text |
| `badge.alert` | `#FFE2E2` | Alert count background |

The purple component-set outlines are Figma library presentation chrome, not an application accent color.

## Geometry and spacing

| Property | Observed value | Application |
|---|---|---|
| Control corner radius | 8px | Inputs and all buttons |
| Control height | 32px | Input surface and button samples |
| Button sample width | 360px | Example width, not a universal fixed width |
| Input surface sample width | 320px | Within a 360px specimen wrapper |
| Label-to-input gap | 6px | Also input-to-error-message gap |
| Input horizontal padding | 10px | Control content |
| Button horizontal padding | 12px | Control content |
| Button content gap | 10px | Auto-layout gap; samples contain only text |
| Navigation height | 64px | Header specimen |
| Navigation side padding | 24px | Header container |
| Navigation group gap | 16px | Between entries/logo container |
| Navigation item padding | 4px vertical, 8px horizontal | Tab-like entries |
| Navigation item gap | 6px | Icon, label, count |
| Navigation icons | 16 × 16px | Icon frame size |
| Count badge | 24 × 20px; radius 99px | Pill shape |

Input specimen wrappers have 20px padding on all sides. Treat this as specimen spacing unless a screen independently calls for it. The 1512px guide/header width is a reference canvas, not a responsive breakpoint.

**Sizing discrepancy:** the input and button nodes record 10px vertical padding while their fixed height is 32px and their text line height is 16px. Those values cannot all fit without overflow. Recommended implementation: preserve the 32px visible height, center text, and use 8px vertical content space per side. Keep the observed horizontal padding. Increase height when content wraps or accessibility requirements call for a larger target.

## Inputs

Source component set: `Input` (`81:3863`). Use a persistent label, white input surface, and placeholder. Example: label “Personal File Number”, placeholder “P/No.”.

This is the **base/elevated input** variant. Dialogs use the distinct **dialog/flat input** variant documented below; retain both rather than replacing this base style.

| Figma state | Appearance |
|---|---|
| Default | Gray label/placeholder; subtle elevation and 1px black outline at 6% opacity |
| Active | Same colors and elevation; outline increases to 24% black |
| Focused | Elevation removed; 4px outer black ring at 6% plus 1px black outline at 30% |
| Error | Red label and message; pale red placeholder; 1px pure-red outline; elevation removed |

Default elevation, translated to CSS box-shadow syntax:

```text
0 6px 6px -3px rgb(0 0 0 / 6%),
0 3px 3px -1.5px rgb(0 0 0 / 6%),
0 1px 1px -0.5px rgb(0 0 0 / 6%),
0 0 0 1px rgb(0 0 0 / 6%)
```

Focused input shadow: `0 0 0 4px rgb(0 0 0 / 6%), 0 0 0 1px rgb(0 0 0 / 30%)`.

Error example: “Personal file number is required”. The error specimen grows from 94px to 116px including its wrapper, accommodating a 16px message and 6px gap. The meaning of `Active` is not specified; treat it as a distinct visual state rather than assuming it means filled or hovered.

## Buttons

All samples use centered 14px Regular labels, 16px line height, 8px radius, and 32px height. Suggested roles: primary for the main action, secondary for supporting actions, ghost for low-emphasis actions, destructive for deletion.

| Family | Default | Hover / alternate | Focused | Disabled |
|---|---|---|---|---|
| Primary | `#1A1A1A`, white text | `#0A0A0A`, white text | Hover colors, 2px black ring at 16% | `#0A0A0A`, 50% component opacity, no shadows |
| Secondary | `#F0F0F0`, dark text | `#E9E9E9` (`Variant2`) | Alternate colors; 1px black outline at 30% and 3px ring at 10% | `#E9E9E9`, 60% opacity; default effects retained |
| Ghost | Transparent, dark text | `#E9E9E9` (`Variant2`), no shadows | Alternate colors; same rings as secondary | Transparent, 60% opacity, no shadows |
| Destructive | `#FB2C36`, white text | `#E7000B`, no shadows | Hover colors; 2px red ring at 24% | `State4`: default colors/effect at 60% opacity; disabled interpretation is inferred |

Opacity applies to the whole component, including text and effects.

### Button effects

- Primary default: black shadows `0 4px 4px` and `0 2px 2px`, each at 10%; inset white 1px outline at 10%; inset white top highlight `0 1px 0` at 30%.
- Primary hovered: same outer shadows and inset outline; top highlight removed.
- Primary focused: same outer shadows plus the 2px focus ring; inset highlights removed.
- Secondary default/alternate/disabled: black `0 2px 2px` shadow at 10%, 1px black outline at 10%, and inset 1px white outline at 10%.
- Ghost default: the same effects as secondary default despite its transparent fill. Preserve this if matching the source exactly.
- Secondary/ghost focused: only the specified focus outlines; no elevation.
- Destructive default/`State4`: inset 1px pure-red outline at 10%.

Source sets: `primary-btn` (`81:3883`), `secondary-btn` (`81:3905`), `ghost-btn` (`81:3915`), `destructive-btn` (`81:3924`). `Variant2` is not explicitly named Hovered in the secondary or ghost sets; its use as hover is a proposed mapping. `State4` is not explicitly named Disabled.

## Navigation and icons

Use the **Huge Icons** family specified by the guide. The exact icon style/weight is not declared. Match the supplied 16px navigation icons before extending the set.

The navigation specimen (`268:1958`) uses horizontal auto-layout, vertical centering, and space-between alignment. A left group contains the logo and navigation entries; a 24px image sits at the right. The logo image is 48 × 20px within a 64 × 32px container.

Selected navigation has an 8px radius, `#E5E5E5` fill, and dark text. Unselected entries have a 6px radius, transparent fill, and `#525252` text. Count badges are rounded pills: neutral gray for the selected example and pale red with red text for the alert example. Sample navigation copy and counts are illustrative, not required product content.

## Shared admin data-table page layout

Use this pattern as the default composition for logged-in admin list/data-table pages. Keep the container, title, toolbar, table, and pagination consistent; adapt the page title, tabs, search copy, columns, and status labels to the data. The source is `form-k-requests` (`275:4155`), with main panel `Frame 322` (`275:4156`). Icons are intentionally excluded from these specifications.

### Shell and main panel

| Property | Observed value | Reusable rule |
|---|---|---|
| Application background | `#F5F5F5` | Proposed token `surface.app` |
| Global navigation region | 64px tall | Main panel starts immediately below it |
| Main panel outer inset | 8px left, right, and bottom | Use an 8px shell gutter |
| Main panel surface | `#FAFAFA` | Proposed token `surface.page` |
| Main panel radius | 16px on all corners | Proposed token `radius.page` |
| Panel side content inset | 24px | Title, toolbar, table, and footer share the same content edges |
| Panel border | No explicit stroke | Boundary is supplied by the shadow's 1px outline |

Panel shadow, translated from visible Figma effects:

```text
0 3px 3px -1.5px rgb(0 0 0 / 6%),
0 1px 1px -0.5px rgb(0 0 0 / 6%),
0 0 0 1px rgb(0 0 0 / 6%)
```

The reference viewport is 1512 × 982px. Its panel is 1496 × 910px at `(8, 64)`; the content width is 1448px. These are specimen dimensions, not fixed application widths or breakpoints. Recommended implementation: make the panel fluid, use at least the remaining viewport height, and let longer data/content grow or scroll without clipping.

### Title and vertical rhythm

The title is left aligned at panel-relative `(24, 28)`, using Inter Semi Bold (600), 18px, `#0A0A0A`, and -0.02em tracking. Its observed line height is 16px. That line height is smaller than its font size; use a content-safe line height if the rendered font clips and record the adjustment.

| Region | Position relative to panel | Height |
|---|---|---|
| Page title | Top 28px | 16px text box |
| Tabs/search toolbar | Top 66px | 32px |
| Table header | Top 121px | 36px |
| Table body | Top 157px | Ten 69px rows in this example |
| Pagination footer | Immediately after body | 56px |

The observed title-to-toolbar gap is 22px from the title box's bottom; toolbar-to-table gap is 23px. For reusable flow layout, approximately 24px section gaps are a recommendation. Preserve the hierarchy and shared edges rather than hardcoding absolute coordinates. The table header, body, and footer form one uninterrupted vertical stack with zero inter-region gap. The sample leaves 7px below the footer inside the panel; this is not a global padding token.

### Tabs and search toolbar

Use a horizontal, vertically centered toolbar with tabs at the left and search at the right, distributed with space-between. Do not copy the specimen's computed 562px gap. Tab group gap is 4px; tabs hug their labels and use 28px height, 4px vertical/10px horizontal padding, and a pill radius of 99px.

| Tab state | Fill | Border | Text |
|---|---|---|---|
| Selected | `rgb(9 9 11 / 4%)` | 1px inside `rgb(0 0 0 / 6%)` | `#262626` |
| Unselected | Transparent | None | `#525252` |

Tab text is Inter Medium (500), 14px/20px, with zero tracking. The sample labels are “All requests”, “Needs action”, “Awaiting representations”, “Granted”, and “Denied”; these are page-specific rather than fixed labels for every table. No hover, focus, or disabled tab styles are supplied by this frame.

Search is 296 × 32px in the specimen, radius 8px, surface `#FAFAFA`, and 10px recorded horizontal padding. Its placeholder is 14px/16px Regular, -0.008em tracking, `#737373`. It uses the panel's two elevation shadows with a stronger 1px black outline at 10% instead of 6%. The source placeholder uses **SF Pro**, unlike the Inter style-guide; recommended shared implementation uses Inter and records this normalization. Its recorded 10px vertical padding has the same 32px-height conflict as the base controls; center content without overflow. Make search width responsive to available toolbar space.

### Table header, rows, and columns

| Element | Observed styling |
|---|---|
| Table header band | 36px height; 8px radius on all corners; `rgb(229 229 229 / 50%)` fill; no stroke/shadow |
| Header layout | 12px side padding; 12px column gap; vertically centered |
| Header text | Inter Medium (500), 14px/20px, zero tracking, `#525252`, left aligned |
| Body row | 69px height; 12px padding on all sides; 12px column gap; transparent fill; no corner rounding |
| Row divider | Bottom edge only, 1px `rgb(0 0 0 / 5%)`; no vertical cell borders |
| Main cell text | Inter Medium (500), 14px/20px, zero tracking, `#0A0A0A` |
| Supporting cell text | Inter Regular (400), 14px/20px, zero tracking, `#737373` |
| Two-line cell stack | 4px vertical gap; 44px total text height; left aligned |

Rows are vertically centered within their bands. Status containers are 44px high with badges placed at their top, aligning with the primary text line. The transparent body inherits the page surface; no alternating row fills, selected-row styling, or hover styling are defined in the reference.

The sample has five columns: Reference Code, Applicant, Officer Sought, Deadline, and Status. Body widths are `296 / 296 / 296 / 296 / 192px`. With four 12px gaps and 24px outer padding, these total 1448px. **Source inconsistency:** all five header cells record 296px widths, totaling 1552px including gaps/padding, so the header overflows its 1448px band. Reusable implementation should use one shared column definition for header and rows. For this page, use four equal flexible columns plus a narrower status column, preserving the body proportions at the reference width; choose columns appropriate to other datasets. On narrow screens, provide deliberate wrapping or horizontal table scrolling rather than silently clipping content.

### Status pills

Observed badges use 28px height, 4px vertical/8px horizontal padding, radius 99px, no border, and centered Inter Medium (500) 13px/20px text with zero tracking. Width hugs the label. Treat these as workflow-specific treatments, not a universal mapping of success/warning/error.

| Observed labels | Background | Text |
|---|---|---|
| Review request; Ready for review | `#FFEDD4` | `#F54900` |
| Identify Officer | `#FEF3C6` | `#BB4D00` |
| Notify Officer | `#DFF2FE` | `#0084D1` |
| Awaiting representation | `#E5E5E5` | `#525252` |
| Record decision | `#FFE2E2` | `#E7000B` |

Whether these pills invoke actions or only communicate status is not established by the inspected styling. Use semantics appropriate to their actual behavior.

### Pagination footer

Place pagination directly beneath the final row. The footer is 56px tall with 12px padding on all sides, transparent fill, and no border/shadow. It aligns the result summary left and the rows-per-page/Previous/Next group right using space-between; do not copy the computed 1084px gap. The right group has 7px gaps and vertically centered items.

Summary and “Rows” labels use `#737373`, 14px/16px Regular. Controls use `#F0F0F0` fills, `#0A0A0A` text, 32px height, and 8px radius. Sample widths are 52px for the row-count control, 92px for Previous, and 67px for Next; these include icon space and should remain content driven. Footer text is observed as SF Pro Regular; normalize to Inter for the shared implementation, as with search. Keep labels vertically centered rather than repeating the source's conflicting 10px vertical padding. Actual result counts and disabled pagination behavior must reflect the data.

### Reuse contract

- Compose each page as shell → main panel → title → tabs/search toolbar → table header/body → pagination.
- Keep the 16px panel corners, 24px shared side insets, pale surface, subtle outline/elevation, pill tabs, and dense two-line rows consistent across admin list pages.
- Share column sizing between header and body. Adapt content and column proportions without introducing a second nested card around the table.
- Use layout flow for growth, wrapping, and pagination placement. The source main panel uses absolute positioning; its coordinates are reference measurements rather than a required implementation technique.
- Loading, empty, row interaction, combined focus/selection, sticky headers, and mobile toolbar behavior require additional decisions; they are not specified by this dashboard.

## Dialogs and modals

Use the “Identify Officer” dialog as the shared reference for compact form modals. Compose backdrop → dialog surface → header → form fields → primary action. Keep field labels and dialog copy left aligned. The observed dialog has one full-width primary action; multiple-action or confirmation-only layouts are not supplied by this frame.

### Backdrop and dialog surface

| Property | Observed value | Reuse guidance |
|---|---|---|
| Backdrop | Full 1512 × 982px viewport; `rgb(0 0 0 / 20%)` | Cover the application viewport; proposed token `overlay.modal` |
| Dialog surface | `#FFFFFF`; no stroke or visible shadow | Proposed token `surface.dialog`; do not inherit the main panel shadow |
| Dialog corners | 20px | Proposed token `radius.dialog` |
| Dialog width | 480px | Reference/max width for this compact form type |
| Dialog padding | 20px on all sides | Leaves 440px content width in the reference |
| Dialog height | 532px | Content-driven specimen height, not a fixed requirement |
| Major section gap | 24px | Between header and form/action section |

The dialog is horizontally centered at `(516, 172)` in the 1512 × 982px reference. Its center sits 53px above the viewport midpoint, so this frame does not establish exact vertical centering. Recommended responsive behavior: use a horizontally centered overlay container, safe viewport gutters, and a content-aware vertical placement. Cap height to available space and allow scrolling for longer forms; do not hardcode the specimen coordinates.

### Header and content rhythm

The header is a 440px-wide vertical stack. A 24px-high top utility row distributes its two items to opposite edges, followed by a 12px gap to the title/description stack. Icon artwork is excluded; preserve the utility row's alignment and close-control placement when composing the dialog.

| Element | Observed styling |
|---|---|
| Dialog title | Inter Semi Bold (600), 16px/16px, -0.02em tracking, `#0A0A0A` |
| Title-to-description gap | 8px |
| Description | Inter Regular (400), 14px, 160% line height (22.4px), -0.008em tracking, `#737373` |
| Header-to-form gap | 24px |
| Field group gap | 16px |
| Label-to-control gap | 6px |
| Form-to-primary-action gap | 20px |

The description's observed text box is 382px wide; allow copy to wrap within available dialog content width rather than making this a universal width. The source header is 82px tall and the form/action section 386px; together with padding and the major gap they produce the 532px reference height. Longer descriptions, errors, or wrapped labels should expand the layout.

### Input variant: dialog/flat

Apply this variant to fields inside dialogs/modals. It preserves the base input's size, radius, and label rhythm while using a pale surface and a single outline without elevation.

| Property | Base/elevated input | Dialog/flat input |
|---|---|---|
| Surface | `#FFFFFF` | `#FAFAFA` |
| Outline in default appearance | 1px black at 6% via shadow | 1px black at 8% via shadow |
| Elevation | Three layered drop shadows | None |
| Radius / control height | 8px / 32px | 8px / 32px |
| Width | 320px specimen | 440px specimen; fills dialog content width |
| Label-to-control gap | 6px | 6px |
| Label | Inter Regular 14px/16px, -0.008em, `#737373` | Same |
| Placeholder | Inter Regular 14px/16px, -0.008em, `#A1A1A1` | SF Pro Regular observed, same size/tracking/color |
| Filled value | Not specified in base samples | SF Pro Regular 14px/16px, -0.008em, `#0A0A0A` |

Dialog input outline, translated to CSS box-shadow syntax: `0 0 0 1px rgb(0 0 0 / 8%)`. The Figma nodes have no explicit stroke. Proposed variant tokens: `input.dialog.surface = #FAFAFA` and `input.dialog.outline = rgb(0 0 0 / 8%)`. Keep this treatment scoped to modal fields rather than changing all inputs globally.

The controls record 10px padding on each side, with vertically centered, left-aligned content. Preserve 10px horizontal padding and resolve the existing 32px-height/16px-text/20px-vertical-padding conflict by centering without overflow. Each label/control group is 54px tall: 16px label + 6px gap + 32px control. Five groups with four 16px gaps produce the observed 334px form stack.

The modal contains both filled and placeholder examples; filled appearance alone does not establish read-only or disabled behavior. SF Pro is an observed inconsistency with the Inter style-guide. Recommended shared implementation normalizes dialog values/placeholders to Inter, matching the labels; document this deviation if adopted.

Only the resting filled/empty appearance is shown. Dialog-specific hover, active, focus, invalid, and disabled appearances are **not observed**. Recommended extension: retain the flat surface/no-elevation treatment and add visible focus rings or error outlines/messages following the base input state conventions. Treat these combinations as implementation decisions, not extracted Figma variants; do not restore base elevation when applying a state.

### Dialog actions and behavior

The modal reuses the existing default `primary-btn` instance, stretched to 440 × 32px: `#1A1A1A` surface, white Inter Regular 14px/16px label, 8px radius, and the primary default effects already documented above. It sits 20px below the field stack and 20px above the dialog bottom. Use content-driven width that fills the dialog's inner column. The example action label is page-specific.

Recommended interaction requirements: give the modal an accessible dialog name from its title, keep keyboard focus within an open modal, provide an accessible close action, and return focus to its trigger on dismissal. Backdrop-click dismissal, Escape behavior, submit/loading/error feedback, and destructive-dialog arrangements are not established by this frame; define them according to the actual workflow.

## Implementation guidance

These are recommendations extending the observed guide:

- Use semantic tokens consistently; keep component-specific state colors separate where the source differs.
- Use real labels and semantic input/button elements. Associate inline errors with their fields and expose invalid state programmatically.
- Apply focus treatments to keyboard focus and keep them visible when a field is also invalid; the combined state is not supplied in Figma.
- Prevent disabled buttons from invoking actions. Preserve the observed opacity per family.
- Check rendered text contrast, especially gray labels, pale placeholders, and red error text. Any accessibility adjustments should be documented as deliberate deviations.
- Keep sample widths fluid within their parent layouts. Define responsive navigation behavior from screen requirements; no mobile layout or breakpoints are provided here.
- Preserve the existing logo asset. Do not recreate the brand mark from text.

## Unspecified decisions

The inspected sources do not establish a global spacing scale, dark theme, mobile layout, motion timings, loading states, input disabled state, or pressed button state. Filled input text is established for the dialog variant only. The dashboard establishes the shared list-page panel/table pattern and a workflow-specific badge palette; the request-details frame establishes a compact form dialog with flat inputs, but not every dialog type, other card types, or a complete status system. Resolve remaining decisions from additional product screens or explicit design decisions rather than presenting invented values as source tokens.

## Review checklist

- Inter is loaded; UI text follows the 14px base and page headers use 18px.
- Inputs/buttons retain 8px corners and compact geometry without clipping text.
- All documented input and button states are represented; inferred state mappings are recorded.
- Shadows match visible effects only; hidden Figma effects are excluded.
- Errors include explanatory text as well as color; focus remains visible.
- Navigation follows the 64px header, 16px icons, and selected/count treatments.
- Responsive behavior and any accessibility deviations are explicit implementation decisions.
- Admin list pages use the shared panel, title, tabs/search, table, and pagination composition; header/body column widths align.
- Dashboard font normalization and content-safe adjustments to source line heights/padding are documented.
- Dialogs use the 20% black backdrop, white 20px-radius surface, 20px padding, and documented section/field gaps.
- Modal fields use the dialog/flat variant; base elevated inputs remain available outside dialogs.
- Dialog focus/error extensions and font normalization are recorded as recommendations rather than observed states.
