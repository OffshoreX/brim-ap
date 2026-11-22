# Restyle: liquid glass + redwood forest green

Visual change only. Pages, layouts, components, data hooks and the API stay the same. The one text fix is correct plurals.

## Colours (src/styles.css)
- Page: a soft wash from #eef3ef to #f7f8f5, plus one faint, blurred, static forest-green shape in the bottom-right corner, drawn on the page background behind the content.
- Accent #1f4d3a, hover #2b6a50, white text on accent. Used for buttons, the active nav item, links, chart bars and the focus ring (3px green, with an offset).
- Redwood #8a4b38: used only for the logo mark (a new `brand-warm` token).
- Ink #16211c, muted #5b6b63, hairline rgba(22,33,28,0.10).
- Status colours: ok #047857 on #e3f6ee, warning #92400e on #fef3e2, blocked/error #b42318 on #fdecea, info #1d4ed8 on #eaf1ff, plus a grey for unknown. Each status keeps its colour, icon and word.
- Radius: 16px for cards, 12px for controls, fully round pills.

## Glass (frame only)
New utilities in styles.css: `glass` (light), `glass-dark` (sidebar) and `surface` (solid white card).
- `glass`: rgba(255,255,255,0.55), blur(20px) saturate(160%), a 1px white/60 border, an inset top highlight and a soft green-tinted shadow.
- `glass-dark`: rgba(20,45,35,0.72) with white text.
- Fallback: `@supports not (backdrop-filter)` and `prefers-reduced-transparency: reduce` switch to solid white, or solid #1f3a2e for the sidebar.
- Glass goes on: the sidebar, the sticky invoice header, stat cards, inline confirms, dialogs and toasts.
- Solid white (no blur) stays on: tables, the flag box, forms and inputs, line items, the audit log, and the panels that hold them.

The components need one change each: their colour classes (e.g. `bg-card`, `bg-sidebar`) are swapped for these named classes. No colours are written inside components.

## Contrast check
I'll compute the contrast ratio for every text pair, then adjust shades in the tokens until each pair passes AA (4.5:1 for normal text):
- sidebar text over glass on the light page (the worst case);
- muted text on glass and on white;
- each status text colour on its own background;
- white on the accent.

## Kept
- 36px controls.
- Tabular, right-aligned money.
- The single 250ms bar-grow animation (off with reduced motion), and no other motion.
- No gradients on buttons, no photos.

## Plural fix
Add a `plural(n, "invoice")` helper to `src/lib/format.ts` and use it everywhere a count is followed by a word: the aging "N invoices" (Home and Reports), "N flags" in the flag box and in the approvals table, and the "flag(s)" text in the sample data.

## Check
Screenshots of Home, Invoices, an invoice detail page and Approvals. Add a small test for `plural`.
