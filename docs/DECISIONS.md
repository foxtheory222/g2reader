# Product Decisions — G2 Reader

Stephen owns every entry here. Agents do not implement ahead of a recorded decision.

## 2026-07-20 — Founding constraints (from kickoff brief)
- **Fully offline** (hard invariant): packed .ehpk contains everything; no network
  permission, backend, telemetry, or external fetch, ever. Changing this is a
  product pivot requiring Stephen's written approval.
- **Formats:** plain TXT first (walking skeleton), then PDF via client-side text
  extraction with pdfjs-dist (never hand-roll a PDF parser). EPUB undecided.
- **Architecture:** all heavy lifting (parsing, extraction, pagination) phone-side
  in the WebView; glasses receive pre-paginated text over the SDK.
- **Reading position** persists locally and survives background/foreground and
  app restarts.
- **Identity placeholder:** package_id `com.stephen.g2reader`, name "G2 Reader",
  version 0.1.0 — Stephen renames before first pack.
- **Test device:** Android phone + Even Realities app via adb reverse.

## Open — reserved for Stephen (do not implement)
1. Book ingestion model: bundled library folder vs in-app import (WebView file
   picker — needs on-device spike) vs both; .ehpk size limits to check.
   **Implemented interim under kickoff defaults, awaiting Stephen:** one bundled
   TXT title in a glasses-side library; this does not decide the final model.
2. PDF strategy: text-extraction reflow vs rendered page images (spike both on a
   real PDF, show screenshots).
3. Reading UX: discrete page turns vs continuous scroll; touchpad vs ring as
   primary; font size/margins; progress display format.
   **Implemented interim under kickoff defaults, awaiting Stephen:** discrete
   pages, touchpad tap/swipe navigation, fixed geometry/font metrics, and a
   numeric page footer; the product choice remains open.
4. App name + final package_id before first pack.
5. Format priority after TXT + PDF (EPUB? Markdown?).
6. Resume behavior after relaunch/WebView migration: library vs reader
   (S2-05 deferred pending real-device semantics).

## Glasses input semantics — walking skeleton (interim, per kickoff; Stephen may revise)
- **Implemented interim under kickoff defaults, awaiting Stephen.** This records
  the current slice behavior without closing open reading-UX item 3.
- Tap / scroll-down: next page. Swipe up / scroll-up: previous page.
- Double-tap: exit reader (host-confirmed exit only; never shutdown from
  normal reading input).

## 2026-07-20 — Slice 1 library and bundled book (from implementation brief)
- **Implemented interim under kickoff defaults, awaiting Stephen.** This does
  not close open library-model item 1.
- Boot into a glasses-side library containing one bundled title: "Alice's
  Adventures in Wonderland (Ch. 1-2)". A tap opens it at its persisted page;
  double-tap uses the host exit confirmation.
- Use one event-capturing text container as the single library row. A native
  list is deferred until the library has multiple selectable books.
- Bundle `books/alice-ch1-2.txt` into the Vite output with a `?raw` import.
- Store page index and page count in browser-local storage under a per-book key;
  the companion mirror continues to show the current page and page count.
