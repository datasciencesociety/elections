# Mobile UI rules

Volunteers use phones and laptops for hours on election day. Every page in `apps/coordinator/public/` and `apps/detector/` follows these rules.

## Rules
- **The on-screen keyboard must never cover a form's submit button.** iOS overlays the keyboard without resizing the page, so scripts can't fix this; the layout must. The browser always scrolls the focused field into view, so on short screens put the button on the same row as the last field (see `login.html`). Allow about 300px of keyboard in portrait and 200px in landscape.
- Use `min-height: 100dvh`, not `100vh`, and align forms to the top on short screens rather than centring them.
- Viewport meta: `width=device-width, initial-scale=1, interactive-widget=resizes-content`.
- Forms are real `<form>`s with a submit button. Inputs get `autocomplete` and `enterkeyhint` (`next`, and `go` on the last field), so the keyboard's Go key submits.
- On touch screens (`pointer: coarse`), make every tap target at least 44px tall and use 16px input text; smaller text makes iOS zoom the page.
- No horizontal page scroll. Long code or JSON wraps with `overflow-wrap: anywhere`.
- On phones, buttons in one group are equal widths: pairs split the row in halves, single buttons span it.
- Status colour carries the meaning. Hover and selection styles must not hide a card's status border, and problem cards (covered, frozen, dark) stand out more than OK cards.
- UI text goes through `i18n.js` in both Bulgarian and English.
- Don't render an error reply as data: check `res.ok` and keep the placeholders.

## Check before merging a UI change
Test portrait and landscape at 320×568, 360×800, 375×667, 390×844, 393×852, 412×915 and 430×932; tablets at 768×1024, 820×1180 and 1024×768; desktop at 1280 and 1440. At each size, focus every input with a simulated keyboard and confirm that its submit button is still visible.
