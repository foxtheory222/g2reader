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
   **Closed by the Slice 2 decision below:** keep bundled Alice and add
   phone-side PDF/TXT import backed by IndexedDB.
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

## 2026-07-20 — PDF strategy (Stephen, closes open item 2)
Stephen directed: study the existing G2 PDF/document apps on GitHub and follow
the ecosystem consensus. Findings (reference clones + code read): every
open G2 reader (epub-reader-g2, Glance, aozora-reader, G2-md-browser,
even-docs, official Teleprompt PDF import, official EH-InNovel) converts the
document to plain text phone-side and feeds a shared text pagination pipeline;
none renders document pages as images on the glasses. The one PDF-specific app
(refact0r/nutshell) extracts via a cloud AI API — mechanism forbidden by our
offline invariant; its File-API import path is still valid precedent.
DECIDED: PDF = phone-side pdfjs-dist text extraction feeding the same reader
pipeline as TXT, with honest refusal for unsupported classes (scanned/no-text).
No page-image reading mode. Cloud/AI extraction is out.

## 2026-07-20 — Slice 2 imported library and input semantics (Stephen)

- The phone companion accepts one local `.pdf` or `.txt` through the Web File
  API. PDF.js receives only the selected file's `ArrayBuffer`; its worker is a
  bundled asset. Remote URLs, CDN workers, dynamic remote imports, and network
  permissions remain forbidden.
- Bundled Alice remains first. Imported plaintext and extraction metadata are
  stored in IndexedDB under a stable content hash, with a non-throwing
  in-memory session fallback. Timestamps use an injected clock in tests.
- The glasses library displays at most five books for this slice. Scroll up or
  down moves a `>` cursor using text-container upgrades; a tap opens the
  selected book at its per-book saved position. Double-tap retains the existing
  host-confirmed exit behavior and normal input never calls a shutdown bridge.
- Import or removal changes library structure, returns the glasses to the
  library, and rebuilds its two containers. Selection changes and reading page
  turns remain serialized text upgrades through the existing render queue.
- PDF extraction preserves page boundaries and offsets, removes repeated
  header/footer furniture, dehyphenates conservatively, and warns rather than
  guessing when columns are suspected. Scanned/no-text, mostly-garbage, and
  encrypted PDFs receive specific honest refusals. Column-aware ordering and
  OCR remain later product decisions.

## 2026-07-20 — Slice 2 audit safety defaults (interim, awaiting Stephen)

- **Implemented interim under safety defaults, awaiting Stephen.** These values
  do not close any future format/UX decisions: PDF files are limited to 25 MB,
  TXT files to 5 MB, PDFs to 1,000 pages, and cumulative extracted PDF text to
  2,000,000 characters. Limits are checked before file reads where the File API
  exposes byte size and during PDF extraction for expanded content.
- TXT import accepts strict UTF-8 only. Invalid byte sequences are refused as
  “not valid UTF-8 text”; replacement decoding and encoding guesses are not
  used. Additional encodings remain a future product decision.
- For PDFs longer than three pages, fewer than 70% text-bearing pages is an
  honest “mostly scanned/image pages” refusal. Coverage from 70% through less
  than 95% is accepted with a companion warning. Empty pages and per-page
  parser errors both count as missing coverage.
- Predominantly RTL or rotated/vertical text is refused as unvalidated rather
  than reordered heuristically. Repeated furniture removal is limited to the
  top and bottom 15% y-bands. Dehyphenation requires the joined word to occur
  elsewhere, unhyphenated, in the same document.
- Imported-book IDs use SHA-256 of text content. No production records exist,
  so the pre-release FNV identifier has no migration requirement.

## Glasses input semantics — walking skeleton (interim, per kickoff; Stephen may revise)
- **Implemented interim under kickoff defaults, awaiting Stephen.** This records
  the current slice behavior without closing open reading-UX item 3.
- Tap / scroll-down: next page. Swipe up / scroll-up: previous page.
- Double-tap: exit reader (host-confirmed exit only; never shutdown from
  normal reading input).

## 2026-07-20 — Slice 2 verify-pass remediation (Stephen)

- PDF text-page coverage is computed after repeated edge furniture is removed;
  parser-error pages remain in the document-page denominator. The existing
  exact 70% refusal boundary, 95% warning boundary, and three-page exemption
  remain unchanged.
- RTL and unsupported orientation dominance are weighted by non-whitespace
  character count. Item transforms, negative determinants, 180-degree text,
  and page-level rotation all contribute to orientation refusal.
- Bounded encoding-corruption gates supplement the existing checks: over 80%
  single-character concentration, less than 1.5 bits/character entropy on
  samples of at least 64 non-whitespace characters, and more than 5% common
  UTF-8-as-Latin1 prefixes with at least two matches.
- The 2,000,000-character PDF ceiling applies independently to raw PDF.js item
  strings and the final joined text including page separators. Library titles
  discard Unicode format controls and the full five-row body stays within the
  SDK's 1,000 UTF-16-unit structural payload ceiling.
- Body/footer upgrades, library rebuilds, and shutdown are coordinated through
  one host-exit-aware UI lane. Durable import/removal success is reported
  independently from a failed glasses refresh, which retries on later input.
- Simulator durability proof seeds only the first launch; relaunch omits the
  seed query and must load the same book and reading position from storage.

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
