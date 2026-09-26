# Design

How the Figma designs map to code. The design system lives in [`packages/ui`](../packages/ui/): tokens in [`src/styles.css`](../packages/ui/src/styles.css), components in [`src/components`](../packages/ui/src/components/). Apps compose screens from those components and never define colours, shadows or radii of their own.

## Source

| | |
|---|---|
| Figma file | [Dials](https://www.figma.com/design/wr7hrx3jB9cpWdpsvyAD1G/Dials) |
| Style guide | page `style-guide` (node `81:3799`), frame `81:3824` |
| Card | "Add new asset" form card, node [`93:4128`](https://www.figma.com/design/wr7hrx3jB9cpWdpsvyAD1G/Dials?node-id=93-4128) |
| Applied in | PR [#104](https://github.com/muliswilliam/adili-v3/pull/104) |

The style guide covers type, icons, the input and four button variants with their states; the card frame adds cards and how controls look inside them. Everything else below marked *derived* was decided in code and needs a design decision (see [Open questions](#open-questions)).

## Foundations

| | Design | Code |
|---|---|---|
| Font | Inter | `font-sans` (Inter Variable, bundled via `@fontsource-variable/inter`) |
| Body text | 14px, tracking -0.112px | `text-sm`; body letter-spacing `-0.008em` |
| Page header | 18px | `text-lg font-semibold` on each page's `h1` |
| Icons | Hugeicons | `Icon` from `@adili/ui` with icons from `@hugeicons/core-free-icons` |
| Radius | 8px on controls, 20px on cards | `--radius: 0.5rem`, so `rounded-lg` = 8px, `rounded-2xl` = 20px |

Landing-page hero headings keep their larger size; the style guide only sets page headers.

## Colour tokens

Tailwind's neutral and red scales. Use the semantic utility (`bg-primary`, `text-muted-foreground`, …), never the raw scale.

| Token | Light | Used for |
|---|---|---|
| `background` | neutral-50 `#fafafa` | page |
| `foreground` | neutral-950 `#0a0a0a` | body text |
| `card` | white | cards, inputs, outline buttons |
| `muted` | neutral-100 | skeletons, icon wells |
| `muted-foreground` | neutral-500 `#737373` | labels, hints, secondary text |
| `placeholder` | neutral-400 `#a1a1a1` | input placeholders |
| `primary` / `primary-hover` | `#1a1a1a` / neutral-950 | primary buttons |
| `primary-subtle` | neutral-100 on neutral-800 text | default badge |
| `secondary` / `secondary-hover` | `#f0f0f0` / `#e9e9e9` | secondary buttons, ghost hover |
| `destructive` / `destructive-hover` | red-500 `#fb2c36` / red-600 `#e7000b` | destructive buttons, error text and outlines |
| `destructive-subtle` | red-50 on red-700 text | error alerts and badges |
| `warning-subtle` | amber-50 on amber-800 text | warning alerts, "Invited" badges *(derived)* |
| `success` | green-600 `#00a63e` | card icons |
| `success-subtle` | green-50 on green-800 text | "Activated" badges *(derived)* |
| `border` | neutral-200 | card borders, dividers, table rows |
| `input` | neutral-300 | unused since controls moved to shadows; kept for third-party widgets |
| `control` | `card` on the page, `background` inside a card | fill of inputs, textareas and selects |

## Elevation

Controls get their edges from layered shadows rather than borders, copied from the style guide. Each is a token so dark mode can swap it.

| Utility | Where |
|---|---|
| `shadow-control`, `-hover`, `-focus` | inputs, textareas, selects, outline buttons |
| `shadow-control-error`, `-error-focus` | invalid inputs (`aria-invalid`) |

Inside a `Card`, `shadow-control` becomes a flat 1px ring (8% black) and `bg-control` the page colour, so controls read as filled wells on the white card. The switch is a CSS rule on `[data-slot='card']` in `styles.css`; components do nothing extra.
| `shadow-button-primary`, `-hover`, `-focus` | primary buttons |
| `shadow-button-secondary`, `-focus` | secondary buttons; ghost focus |
| `shadow-button-destructive`, `-focus` | destructive buttons |

## Components

| Component | Style guide states | Notes |
|---|---|---|
| `Button` | primary, secondary, ghost, destructive × default, hover, focus, disabled | 32px (`default`), 28px (`sm`), 40px (`lg`); disabled is 60% opacity. `outline` and `link` are *derived*. |
| `Input`, `Textarea` | default, active (hover), focused, error | 32px high, `px-2.5`; error comes from `aria-invalid`, set by `FormField` |
| `Label` | muted, regular weight | turns red when its field has an error |
| `FormField` | label → control 6px apart | hint below the label, error below the control with `role="alert"` |
| `Card` | white, 20px radius and padding, no border or shadow | `CardHeader` (optional `CardIcon`: 24px, `success` colour, 12px above the title; title 16px semibold; description 14px muted, 1.6 line height), then 32px to `CardContent` (fields 16px apart), then 20px to `CardFooter` (buttons 12px apart; `flex-1` for an equal-width pair) |
| `Combobox` | *derived* | same input styling; the list shows each option's label with its description in mono |
| `Select` | *derived* | same fill, shadows and error state as `Input`; its trigger takes the id and aria attributes from `FormField` |
| `Badge` | *derived* | `default`, `neutral`, `outline`, `warning`, `success`, `destructive` |
| `Alert`, `Dialog`, `Toast`, `Table`, `DataTable`, `EmptyState`, `Skeleton`, `Checkbox`, `FileDropZone`, `ProgressBar`, `Stepper`, `Tabs`, `Tooltip`, `OtpInput`, `MaskedContact`, `CopyButton` | *not designed yet* | styled from the tokens above until screens are designed |

## Dark theme

*Derived.* The style guide is light only. `prefers-color-scheme: dark` maps the same tokens onto the dark end of the neutral scale and swaps the shadow rings for light hairlines.

## Open questions

For the designer; each is built as described until decided.

1. **Destructive contrast.** White on red-500 is about 3.8:1, below the WCAG 2.2 AA minimum of 4.5:1 for 14px text. Red-600 (the hover colour) would pass.
2. **Placeholder contrast.** neutral-400 on white is about 2.6:1.
3. **Focus rings.** The button focus ring (2px at 16% black) is faint on light backgrounds; WCAG 2.4.13 asks for a clearer indicator.
4. **Status colours.** No success or warning colours in the guide; green and amber are used for badges.
5. **Dark theme**, **outline and link buttons**, **badges, cards, tables, alerts, dialogs, toasts**: not yet designed.
6. **Typeface in frames.** Component text layers are set in SF Pro; the guide says Inter. Inter is used.
7. **Secondary button in the card frame** is flat `#f0f0f0`; the style guide's secondary has a hairline ring. The style guide version is used.
8. **Card icon** is solid in the frame; the free Hugeicons set is stroke only.
9. **Cards have no border**, so a white card on the `neutral-50` page relies on a small contrast step (about 1.04:1). Worth a check on low-quality displays.

## Screens

Every `design-pending` ticket is built on the tokens above. A screen's own design pass replaces structure-only layout with its Figma frame.

| Screen | Ticket | Figma frame | Status |
|---|---|---|---|
| Foundations and shared components | [#104](https://github.com/muliswilliam/adili-v3/pull/104) | `81:3824` | applied |
| Cards and controls inside cards | [#104](https://github.com/muliswilliam/adili-v3/pull/104) | `93:4128` | applied |
| Commissions list and detail | [#12](https://github.com/muliswilliam/adili-v3/issues/12) | not yet shared | tokens only |

Add a row when a frame is shared, and flip the status when its design pass merges.

## Working with Figma

Claude Code reads designs through the [Figma MCP server](https://mcp.figma.com/mcp) (`claude mcp add --transport http figma https://mcp.figma.com/mcp`, then authenticate in `/mcp`).

- Share **frame** links (right-click a frame → Copy link to selection). Page links point at a canvas and fail with "nothing selected".
- Each read counts against the plan's limit: 20 calls a month on Starter, 200 a day on Professional with a Full or Dev seat. One frame usually costs two or three calls.
- When a call is not worth spending, export frames as 2× PNGs and share the paths instead; spacing and colours then need checking by eye.
