# text-heavy

Long-form reader demo on G2. Pre-paginates a multi-paragraph string into page-sized chunks, renders one page at a time, and uses `textContainerUpgrade` for flicker-free page turns. Tap advances, swipe goes back, double-tap exits.

## Run

```bash
npm install
npm run dev
```

Then `npm run simulate` (desktop simulator) or `npx evenhub qr --url http://<your-ip>:5173` to test on real glasses.

## What's in here

| File | Purpose |
|---|---|
| `src/main.ts` | App entry. Renders `body` + `pager` text containers, wires tap/swipe/double-tap, mirrors current page into the companion WebView. |
| `src/paginate.ts` | Pixel-accurate pagination via [`@evenrealities/pretext`](https://www.npmjs.com/package/@evenrealities/pretext). Measures each paragraph at the glyph widths LVGL uses on G2, then packs paragraphs into pages that fill the container without clipping. |
| `src/sample.ts` | Sample content — replace with your own text. |
| `index.html` | WebView host with zoom-locked viewport. |
| `app.json` | Manifest. No permissions required. |

## Why this pattern

On G2 you can't scroll. You turn pages. That means:

- **Pre-paginate.** Splitting the whole string up front is cheaper and more predictable than measuring on the glass each time.
- **Use `textContainerUpgrade`, not `rebuildPageContainer`.** Upgrading in place is flicker-free; rebuilding flashes the full page on every turn.
- **Keep a page counter.** Readers lose their place on a HUD more easily than on a phone — a tiny `3 / 12` indicator costs nothing.
- **Serialize bridge writes.** If the user taps fast, overlapping upgrades can race. This template queues through a shared promise chain.

## Resizing the body

Pagination is driven by the container's real pixel box, not a character budget. Change `BODY_W` / `BODY_H` / `BODY_PAD` at the top of `src/main.ts` and `paginate()` re-splits to fit — no separate tuning constant to keep in sync.

LVGL's line height on G2 is fixed at 27px, so the body's inner height divided by 27 gives you the lines-per-page ceiling. `measureTextWrap(text, innerWidth)` from `@evenrealities/pretext` returns the exact wrapped line count at the firmware's glyph widths (Latin, Cyrillic, Greek, CJK, emoji), so pages fill consistently across mixed-script content.

Per-container text hard limits still apply:
- `textContainerUpgrade` — 2000 chars max
- `rebuildPageContainer` — 1000 chars max per container

## G2 specifics

- Display: 576x288. This template reserves 576x240 for body and 576x30 for the pager strip.
- **Tap** (`CLICK_EVENT`) → next page.
- **Swipe up** (`SCROLL_TOP_EVENT`) → previous page. Swipe down (`SCROLL_BOTTOM_EVENT`) also advances, matching typical scroll expectations.
- **Double-tap** (`DOUBLE_CLICK_EVENT`) → `shutDownPageContainer(1)` → system exit confirmation.
- If the user exits mid-read, you probably want to persist `currentPage` via `bridge.setLocalStorage` and restore on next launch. Left out of the template for clarity — wire it in when you ship.
