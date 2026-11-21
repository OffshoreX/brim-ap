---
name: Harborline AP
description: A calm, exact accounts-payable workspace where every figure and every reason is visible on the page.
colors:
  ink: "#1c2430"
  muted: "#566170"
  line: "#d5dbe3"
  page: "#f4f6f9"
  card: "#ffffff"
  table-head: "#e9edf2"
  zebra: "#f8fafc"
  row-hover: "#eef3fb"
  accent: "#1d4ed8"
  accent-ink: "#ffffff"
  focus-ring: "#7aa2ff"
  nav: "#111827"
  nav-ink: "#e5eaf3"
  nav-on: "#374151"
  ok: "#14532d"
  ok-bg: "#e8f8ee"
  ok-line: "#86d3a0"
  warn: "#7c3f06"
  warn-bg: "#fff4e0"
  warn-line: "#f0b45f"
  bad: "#991b1b"
  bad-bg: "#fdecec"
  bad-line: "#f2a3a3"
  info: "#1e3a8a"
  info-bg: "#eaf1ff"
  info-line: "#9db8f2"
  chart-total: "#2563eb"
  chart-taken: "#059669"
  chart-missed: "#d97706"
typography:
  display:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 700
    lineHeight: 1.2
  headline:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.25
  title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.5
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 600
    lineHeight: 1.5
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.875rem"
    lineHeight: 1.5
rounded:
  sm: "6px"
  md: "8px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "4px 12px"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.accent}"
    rounded: "{rounded.sm}"
    padding: "4px 12px"
    height: "36px"
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "4px 12px"
    height: "36px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  topbar:
    backgroundColor: "{colors.nav}"
    textColor: "{colors.nav-ink}"
    padding: "8px 16px"
  badge-ok:
    backgroundColor: "{colors.ok-bg}"
    textColor: "{colors.ok}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 8px"
  badge-warn:
    backgroundColor: "{colors.warn-bg}"
    textColor: "{colors.warn}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 8px"
  badge-bad:
    backgroundColor: "{colors.bad-bg}"
    textColor: "{colors.bad}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 8px"
---

# Design System: Harborline AP

## Overview

**Creative North Star: "The Open Ledger"**

Harborline AP looks like a well-kept ledger: plain, legible, and honest about what it knows. Figures are tabular, reasons are written out next to the thing they explain, and nothing important lives in a tooltip or behind a hover. The voice is calm and exact first, with a crisp, confident hierarchy on top: restrained chrome, dense-but-scannable tables, and color spent almost entirely on status.

The system is utilitarian by intent. It uses the system font stack, one blue accent, a dark navy header, and four status families (ok, warn, bad, info). Density serves the AP clerk scanning an inbox and the controller reading an audit trail equally; the same surfaces work for every role, so no role gets its own visual dialect. The "Harborline AP" header brand is a binding commitment; the repo name `brim-ap` is a placeholder and does not appear in the UI.

All styling lives in one plain stylesheet, `src/app/ui.css`, driven by tokens in `:root`. No UI library, no downloaded fonts.

**Key Characteristics:**
- System fonts, tabular figures, light weights of decoration.
- One blue accent for actions; status colors carry meaning, never decoration.
- Every status, flag and block pairs an icon, a color and a written reason.
- Hairline borders with a whisper of shadow; no heavy elevation.
- Desktop-first, graceful on narrow screens; WCAG 2.1 AA.

## Colors

A cool-grey neutral field, one electric-but-sober blue, and four status families, each a text / background / border trio.

### Primary
- **Ledger Blue** (#1d4ed8): the only action color. Primary buttons, links, the active chart series, hover borders on clickable cards. White text on it is above 4.5:1.

### Neutral
- **Ink Navy** (#1c2430): body text and headings.
- **Slate Muted** (#566170): secondary text, field labels, empty-state copy, chart axes.
- **Hairline Grey** (#d5dbe3): every border and divider.
- **Paper Cool** (#f4f6f9): the page background.
- **White Card** (#ffffff): panels, cards, table body, inputs.
- **Header Mist** (#e9edf2), **Zebra Whisper** (#f8fafc), **Row Hover Blue** (#eef3fb): table header, alternate rows, hover row.
- **Harbour Night** (#111827): the top bar. **Nav Slate** (#374151) marks the active or hovered nav item. **Nav Ink** (#e5eaf3) is nav text.
- **Focus Periwinkle** (#7aa2ff): focus ring, 3px, offset 2px.

### Status
- **Cleared Green** (#14532d on #e8f8ee, line #86d3a0): approved, scheduled, paid; success toasts.
- **Caution Amber** (#7c3f06 on #fff4e0, line #f0b45f): needs review, pending approval, flag boxes.
- **Hold Red** (#991b1b on #fdecec, line #f2a3a3): rejected, errors, blocking banners.
- **Received Blue** (#1e3a8a on #eaf1ff, line #9db8f2): received, informational.

### Chart Series
Chart fills are `:root` tokens like every other color (`--chart-total`, `--chart-taken`, `--chart-missed`). Chart code reads them from CSS, never as hardcoded hex. Fills are graphics, so they need 3:1 against white, not 4.5:1; every value is also printed as text.
- **Total Blue** (#2563eb): a single-series chart of amounts (aging, spend by vendor, department or month). A brighter sibling of Ledger Blue, not the same value.
- **Taken Green** (#059669): early-payment discounts taken. Lighter than Cleared Green (#14532d).
- **Missed Amber** (#d97706): early-payment discounts missed. Brighter than Caution Amber (#7c3f06). 

Two-series charts always pair Taken Green with Missed Amber and show a legend with a swatch and a name for each. Single-series charts have no legend.

### Named Rules
**The Status-Only Color Rule.** Outside the one blue accent, color appears only to say what state something is in. Never decorate with a status color.

**The Trio Rule.** A status is always text color + tinted background + border line from the same family, plus an icon and words. Color alone never carries meaning.

## Typography

**Display / Body Font:** the system stack (system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif)
**Mono Font:** ui-monospace, SFMono-Regular, Menlo, Consolas

**Character:** One native family at a few sizes, so the app feels fast and familiar on any laptop. Weight, not font change, creates hierarchy.

### Hierarchy
- **Display** (700, 2.25rem, 1.2): the big numbers on dashboard link-cards only.
- **Headline** (700, 1.5rem, 1.25): page `h1`; and card figures. Drops to 1.125rem on narrow screens.
- **Title** (700, 1.125rem, 1.5): section `h2`, brand name, the "about" lead line.
- **Body** (400, 0.9375rem, 1.5): everything else, including table cells.
- **Label** (600, 0.78rem): badges, chips, role pill. Table headers use 0.875rem.
- **Mono** (0.875rem): codes, IDs, preformatted output.

### Named Rules
**The Tabular Figures Rule.** Any amount, count or date column uses `font-variant-numeric: tabular-nums` and right alignment so digits line up. Money is shown from integer cents with its currency code.

## Layout

A single centered column, 72rem max, with 1rem gutters, stacked under a full-width top bar. Spacing follows a six-step scale (4, 8, 12, 16, 24, 40px) and nothing off it. Two-up layouts (`.split`, invoice document beside its fields) collapse to one column at 800px; card grids use `auto-fit` with 10 to 14rem minimums; tables scroll sideways inside their wrapper rather than squeezing. Table headers are sticky inside a 70vh scroll area. Desktop-first: the demo runs on a laptop or projector, narrow widths only need to not break.

Print is a first-class layout: the invoice detail drops the nav, buttons and preview and renders in 11pt on white.

## Elevation & Depth

Flat with a whisper of shadow. Depth comes first from hairline borders and the tone shift between paper-grey page and white cards. Panels, cards and table wrappers add one very light ambient shadow; only toasts lift noticeably.

### Shadow Vocabulary
- **Whisper** (`box-shadow: 0 1px 2px rgb(16 24 40 / .08), 0 1px 3px rgb(16 24 40 / .06)`): cards, panels, table wrappers.
- **Lift** (`box-shadow: 0 6px 20px rgb(16 24 40 / .18)`): toasts only. Shadows are removed in print.

### Named Rules
**The Borders-First Rule.** Separate with a 1px hairline before reaching for a shadow. If removing the shadow breaks the layout, the layout was wrong.

## Shapes

Gently rounded and consistent: 8px for containers (cards, panels, table wrappers, toasts), 6px for controls and small boxes (buttons, inputs, selects, skip link), fully round pills for badges, chips and the role tag. Flags and steps carry a thick left edge (5 to 6px) in their status color as the one signature silhouette. Empty states use a dashed 1px border; the dropzone a dashed 2px border.

## Components

### Buttons
- **Shape:** 6px radius, min height 2.25rem (36px) everywhere, including toast and top-bar buttons, padding 4px 12px, weight 600.
- **Primary (default `button`):** Ledger Blue fill, white text; hover brightens slightly.
- **Secondary (`.secondary`):** white fill, blue text and blue border; hover tints to Row Hover Blue.
- **Focus:** 3px Focus Periwinkle outline, 2px offset; border turns accent.
- **Disabled:** 55% opacity, not-allowed cursor. While a form is busy the cursor shows progress.
- In the top bar, secondary buttons turn transparent with white text.

### Badges and Chips
- **Style:** pill, 0.78rem label type, 1px border, trio colors by status. Always paired with an icon and text.
- **Mapping:** received / info = blue; needs_review / pending_approval / warning = amber; approved / scheduled / settled / paid = green; rejected / failed / error = red. Any status the UI does not know gets a neutral grey badge showing its plain label, never a raw code and never a status color.

### Cards / Containers
- **Corner Style:** 8px. **Background:** white. **Border:** 1px hairline. **Shadow:** Whisper.
- **Padding:** 12px 16px for stat cards; 16px for panels. Stat cards show a large tabular figure over a label; clickable ones (`.cards.big`) border and tint blue on hover.

### Inputs / Fields
- **Style:** white fill, 1px hairline, 6px radius, 36px high. Hover darkens border to muted; focus shows the ring and blue border.
- **Read-only facts** use a two-column definition list: muted term left, right-aligned tabular value.

### Tables
- **Style:** white wrapper with hairline and Whisper; sticky Header Mist head; zebra rows; blue-tint hover; numbers right-aligned. Cells have 8px by 12px padding.

### Navigation
- **Style:** Harbour Night bar with the Harborline AP logo mark on the left (white tile, blue glyph), nav links in Nav Ink, the signed-in persona and a role pill on the right. Active page is Nav Slate with a white 2px underline. Wraps on narrow screens. A skip link appears on focus.

### Flag Box (signature)
Panel with a 6px left edge, listing each flag as a chip plus its plain-text reason. This is the visual form of the product promise: the reason sits next to the flag, never in a tooltip. The panel takes the color of its worst flag: red (heading "Blocked") when any flag has severity error, amber when the worst is a warning, neutral blue when all are informational.

### Money Actions
Release, approve and reject are never one bare click. Releasing money shows an inline confirmation with the amount, currency, payee and method before it runs, locks the control while the request is in flight, and reports the result next to the control that was clicked. Success messages for money stay on screen until dismissed.

### Feedback
- **Error:** persistent red banner with left edge; stays until fixed. **Toast:** green, bottom-right, with a dismiss button. **Empty:** dashed box, muted text. **Skeleton:** shimmering rows, still under reduced-motion.

### Charts
Horizontal bar charts in inline SVG, no chart library (`Charts.tsx`). A `figure` 40rem max, with a caption, three hairline gridlines (0, half, max) with money ticks, category labels right-aligned on the left (wide enough to show the full name, wrapped to two lines when long, never truncated and never moved into a `<title>`), 16px bars, each bar's value printed in semibold text just past its end (dark text beside light fills), 12px minimum chart text, money ticks carry the currency, an italic muted axis title for each axis, and a legend only when there is more than one series. The SVG has an `aria-label` that reads out every row and value. Fills come from Chart Series above.

**Bar-grow animation (the one allowed chart motion; not yet implemented in code, so this is the spec).** On first render only, each bar's width grows from 0 to its value over 250ms with `ease-out`, with no stagger. No loop, no hover, no replay on data refresh. Under `prefers-reduced-motion: reduce` bars render at full width at once. Bar value text and gridlines are always visible and do not animate, so the figures are readable during the 250ms. Bars must keep the 2px minimum width for non-zero values. Implement it in `ui.css` as a CSS animation on the bar `rect` (`transform: scaleX` from the label edge, `transform-origin` at the bar's left), not in JavaScript, and wrap it in the reduced-motion guard.

The SVG classes `.tick` and `.cat` get their own rules in `ui.css` (axis tick text and category label text); until then they inherit `.chart text`.

## Do's and Don'ts

### Do:
- **Do** put the reason in visible text next to every flag, block and status.
- **Do** pair every status color with an icon and a word.
- **Do** take every color, space, radius, shadow and size from the `:root` tokens in `src/app/ui.css`.
- **Do** keep amounts tabular, right-aligned and formatted from integer cents with currency.
- **Do** give every control a visible 3px focus ring and a 36px minimum height.
- **Do** keep text on status backgrounds at 4.5:1 or better.
- **Do** keep motion to one load animation under 300ms, disabled under `prefers-reduced-motion`. For charts that is the 250ms bar-grow.
- **Do** use the three chart series colors only for chart fills, print every value as text, and add a legend whenever a chart has two or more series.

### Don't:
- **Don't** hide a reason or a label in a tooltip, title attribute or hover state, charts included.
- **Don't** use color alone to convey state.
- **Don't** add a UI library, a webfont or a second stylesheet.
- **Don't** use a status color as decoration, or add a second accent next to Ledger Blue.
- **Don't** add a new chart color or a different blue, green or amber for a chart without updating Chart Series here first.
- **Don't** add heavy shadows, gradients, or hover motion beyond the toast's lift and the loading skeleton.
- **Don't** show the placeholder name `brim-ap` in the interface; the brand is Harborline AP.
- **Don't** fake demo-path content with mock data.
