# Agent Learning Log — Readpane

Append-only. Reusable learnings, golden paths, gotchas. Newest at bottom.

## 2026-07-20 — Session 1/2 (kickoff + scaffold)

- **Plugin skills:** Claude Code's skill registry is fixed at session start. Fix
  applied: `claude plugin install everything-evenhub@everything-evenhub` (user
  scope) — future sessions get all 13 skills natively. Equivalent fallback that
  works mid-session: read SKILL.md files directly from
  `~/.claude/plugins/cache/everything-evenhub/everything-evenhub/<ver>/skills/`.
- **Scaffold golden path:** `npx --yes degit even-realities/evenhub-templates/text-heavy <dir>`
  → move into repo root → set identity in app.json/package.json → `npm install`
  → bump `@evenrealities/*` to latest → `npm run build` (tsc --noEmit + vite).
  Template proven against sdk 0.0.12 / simulator 0.8.0 / cli 0.1.13.
- **text-heavy template is the reader base:** pretext pixel-accurate pagination
  (LVGL line height is fixed 27px), flicker-free page turns via
  `textContainerUpgrade` (containers created once, content swapped), serialized
  bridge writes, companion mirror UI.
- **CONFIRMED BUG in official text-heavy template (sdk 0.0.12 wire format):**
  protobuf omits zero-valued fields, so `CLICK_EVENT = 0` arrives as
  `{"sysEvent":{"eventSource":1}}` with NO `eventType`. Template code
  `event.sysEvent?.eventType ?? null` → null ≠ 0 → tap-to-next-page silently
  dead. Its own comment says to coalesce with `?? 0`. Correct pattern: if
  `event.sysEvent` exists, treat missing `eventType` as `0` (CLICK_EVENT); do
  NOT apply the same default to `textEvent` blindly (scroll events 1/2 are
  nonzero so they serialize; a bare textEvent should not be read as a click).
  Evidence: simulator wire log id 123/127 + enum in sdk dist/index.d.ts:794.
- **Simulator automation golden path:** `npx evenhub-simulator "http://127.0.0.1:5173/"
  --automation-port 9898` → `GET /api/ping` → wait ~4s+ after launch →
  `GET /api/screenshot/glasses` (RGBA; lit pixel = alpha>0; composite onto black
  to view) → `POST /api/input {"action":"up|down|click|double_click"}` →
  re-screenshot and pixel-diff. `GET /api/console?since_id=N` for events.
  Caution: `double_click` exits the app (shutDownPageContainer).
- **Shared-simulator gotcha:** if Stephen interacts with the simulator window
  while automation runs, page state and event streams interleave — capture
  baseline screenshot immediately before each injected input, not at boot.
- **Mac python3 needs `pip install --break-system-packages pillow`** (PEP 668).
- **Even docs:** https://hub.evenrealities.com/docs/getting-started/overview,
  templates repo `even-realities/evenhub-templates`.

## 2026-07-20 — Slice 1 walking skeleton

- **Input routing golden path:** keep wire decoding pure. Only an existing
  `sysEvent` defaults an omitted `eventType` to `CLICK_EVENT` (0). A bare
  `textEvent` remains unknown; its serialized scroll values are 1/2. Check
  double-click (3) in both envelopes before normal navigation.
- **One-book library:** a single event-capturing `TextContainerProperty` row
  avoids native list scrolling and list-only rebuilds. Revisit
  `ListContainerProperty` when multiple books make selection state real.
- **Durable position:** save `{ pageIndex, pageCount }` synchronously in
  `localStorage` under `g2reader:position:<bookId>`, then clamp the saved index
  against the freshly paginated page count on restore. SDK 0.0.12's installed
  type surface does not export the background-state helper functions described
  by the background-state skill, so this slice does not call unavailable APIs.
- **Offline test ordering:** npm's `pretest` runs a fresh production build;
  `vitest run` then rejects non-empty permissions, any manifest whitelist,
  missing `dist/`, and unreviewed HTTP(S) literals in built files.
- **Simulator automation harness:** wait for `/api/ping`, then for the app's
  `G2_READER_READY` console marker before clearing logs. Clear `/api/console`
  between actions so an earlier page marker cannot satisfy a later wait.
  Simulator proof remains layout/logic proof only.
- **CLI gotcha:** with simulator 0.8.0 installed locally, invoking
  `npx evenhub-simulator --help` hung without output in this sandbox and had to
  be terminated. Do not use that as a readiness probe; use the documented
  automation API instead.

## 2026-07-20 — Slice 1 post-audit remediation

- **Persist on confirmation (S1-01):** keep desired navigation separate from
  rendered state. Queue immutable page jobs, require `true` from both body and
  footer upgrades, then and only then mirror, log, and persist that job. A
  rejected queue task must settle into a recovered tail so later work runs.
- **Storage must not gate rendering (S1-02):** guard access to the
  `localStorage` getter as well as `getItem`/`setItem`; maintain a session-memory
  copy and reject non-finite, fractional, negative, or unsafe integers at the
  adapter boundary.
- **Offline drift is deny-by-default (S1-03):** scan fresh built text assets for
  HTTP(S), WS(S), and protocol-relative literals, and census network-capable API
  tokens against exact reviewed `{token,count,comment}` populations. Match URL
  entries as exact literals by default; boundary-delimited descendants require
  an explicit `prefix: true` review entry.
- **Simulator proof needs semantic regions (S1-04):** compare decoded 576×288
  RGBA pixels; assert the body (`y=0..245`) and footer (`y=246..287`)
  independently so a changing pager cannot hide a stale reading body.

## 2026-07-20 — Slice 1 verify-pass remediation

- **Timeout is a logical failure, not cancellation:** reject the render at the
  timeout boundary, but retain the single bridge lane until the uncancellable
  SDK promise actually settles. Only then may the latest pending snapshot run;
  otherwise a late stale write can land after a newer commit.
- **Bound render pressure explicitly:** retain one in-flight render and one
  replaceable latest snapshot. Resolve a replaced pending request as
  `superseded`, and let requested shutdown supersede pending UI work before it
  waits for the in-flight bridge operation.
- **Session position outranks durable storage:** save to session memory before
  attempting durable storage, seed session memory on the first valid durable
  read, and never reread an older durable value once the session copy exists.
- **Offline census counts identifiers, including harmless text:** use word
  boundaries for `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`,
  `sendBeacon`, and `importScripts`; inspect and justify every built occurrence.
  Protocol-relative URL detection must cover unquoted HTML and IPv6 while
  filtering code comments and leaving every real candidate to the reviewed URL
  allowlist.
- **Cleanup is an acceptance result:** `Promise.allSettled` ensures every child
  stop is attempted, but rejected stops must be collected into an
  `AggregateError` so the simulator harness cannot report success with orphans.

## 2026-07-20 — Slice 2 PDF import

- **Reference-reader consensus:** phone-side File API ingestion and plaintext
  pagination are the common path. Frequent cursor/page changes use container
  upgrades; structural library/screen changes rebuild. IndexedDB is the common
  durable choice for larger document bodies, while reading positions stay
  separate and per book.
- **Packaged-WebView durability remains a device question:** the reference
  projects disagree on browser IndexedDB/localStorage longevity and several use
  host bridge storage. The Slice 2 mandate selects IndexedDB with an in-memory
  fallback, but restart durability still needs an Android + G2 run; simulator
  results are layout/logic proof only.
- **PDF fixture golden path without a network dependency:** on macOS, run
  `SWIFT_MODULECACHE_PATH=/private/tmp/g2reader-swift-cache CLANG_MODULE_CACHE_PATH=/private/tmp/g2reader-clang-cache swift scripts/generate-pdf-fixtures.swift`.
  CoreGraphics/CoreText emits the small committed fixtures; the app
  and all gates consume only the fixture binaries, never this generator.
- **Offline-gate coverage must include `.mjs`:** PDF.js and its bundled worker
  use ESM assets. Scan `.mjs` for URLs and include it in the network-token
  census, or the gate has a false-negative hole.
- **Dependency-cache gotcha:** `npm install --package-lock-only --offline
  --ignore-scripts` fails with `ENOTCACHED` when `pdfjs-dist` has not previously
  been cached. Do not invent a lockfile entry or allowlist population; install,
  build, inspect the emitted census, then record exact reviewed counts.
- **PDF.js 6 legacy entry is the shared compatibility path:**
  `pdfjs-dist/legacy/build/pdf.mjs` imports successfully in supported Node 22+
  by using PDF.js's optional `@napi-rs/canvas` integration, while the modern
  entry requires `DOMMatrix` at module scope. Use the matching legacy worker
  for older Android WebViews and tests so production and fixtures exercise the
  same engine without hand-written canvas shims.
- **PDF.js 6 lifecycle/options changed:** destroy the
  `PDFDocumentLoadingTask`, not the resolved document proxy. Version 6.1.200 no
  longer declares or reads `isEvalSupported`; do not retain an ignored option
  and claim it as a control. The supported offline controls here are
  ArrayBuffer-only `data`, `useWorkerFetch:false`, `disableFontFace:true`, no
  resource base URLs, a bundled worker, and a fresh dist census.

## 2026-07-20 — Slice 2 audit remediation

- **PDF.js input-buffer ownership:** 6.1.200 sends `data.buffer` in the
  `GetDocRequest` transfer list (`legacy/build/pdf.mjs`), which detaches the
  transferred buffer. Clone the caller-owned `ArrayBuffer` before creating the
  loading task; this copy is intentional even under tight memory limits.
- **Page-aware extraction:** catch each `getPage`/`getTextContent` failure,
  count it with empty/image-only pages, and stop incrementally at the page and
  cumulative-character limits. Determine coverage before furniture removal so
  legitimate header-only pages are not misclassified as parser failures.
- **Fixture regeneration from any cwd:** the Swift generator resolves
  `tests/fixtures` from its own script URL and accepts fixture filenames as
  arguments. CoreGraphics injects current CreationDate/ModDate plus macOS build
  metadata and does not expose date override keys through this API, so fixture
  regeneration is intentionally not byte-identical. Regenerate only the
  fixtures a change needs, for example:
  `swift /path/to/repo/scripts/generate-pdf-fixtures.swift central-refrain.pdf`.
- **Dev-only simulator seed:** Vite replaces `import.meta.env.DEV` with false in
  production and removes the guarded query hook/seed payload. The simulator
  harness uses the Vite dev server plus `?simSeedBook=1`; production-build tests
  assert neither the query key nor seed title remains in built JS.
- **Library mutation lane:** queue the entire import/remove/list/rebuild slice,
  retain a pending count across queued work, and disable phone mutation controls
  until it reaches zero. Bridge rendering remains separately serialized.

## 2026-07-20 — Slice 2 verify-pass remediation

- **Correction to the earlier coverage note:** meaningful-page coverage must be
  calculated after repeated header/footer removal. Preserve an empty page for
  every parser failure so errors still count in the original page denominator.
- **PDF expansion limits need two independent gates:** sum every raw PDF.js item
  string before whitespace normalization, then calculate the final joined size
  including inserted page separators before allocating/storing the joined text.
- **PDF layout evidence is content-weighted:** use non-whitespace character
  counts, the text baseline angle, determinant sign, and page rotation. Exact
  PDF.js matrices/direction are more reliable as extraction-level doubles than
  CoreGraphics fixtures; keep real PDFs for extraction behaviors CoreGraphics
  can author deterministically enough.
- **Bridge atomicity belongs above individual calls:** a generic promise lane
  around each SDK call does not keep a render's body/footer pair atomic. Queue
  renders, structural rebuilds, and shutdown as jobs; structural work
  supersedes not-yet-started renders and is rejected once exit is pending.
- **Simulator durability proof is a two-URL flow:** first launch with
  `?simSeedBook=1` performs idempotent eviction/reseed; relaunch the same origin
  without that query and assert both the book ID and non-default page survive.
- **Swift fixture-generator behavior test:** copy the script below a temporary
  repo-shaped directory, run it from an unrelated cwd with `--output-dir`, and
  assert only the requested fixture is emitted. Set both Swift and Clang module
  caches inside the temporary directory in sandboxed runs.

## 2026-07-20 — Slice 3 reader menu and resume

- **Idempotent resume harnesses must normalize persisted UI settings:** a
  second simulator-proof run correctly starts in the last-read book with the
  prior density/progress choices, so a harness that assumes library/defaults
  is inherently one-shot. Enter the menu, return to Library when needed,
  select the deterministic fixture, cycle progress/density to a known baseline,
  then begin pixel evidence. Keep the final unseeded relaunch unnormalized so
  it proves direct resume into the saved book and page.

## 2026-07-20 — Slice 3 staged UI commits

- **Persist from confirmed render snapshots, never pagination globals:** carry
  the book ID, page index, page count, density, progress style, body, footer,
  and copied reader state in each queued render. A density rebuild paginates
  into a local cache and publishes the cache/settings/position only after the
  structural lane confirms success.
- **Use one mutation-backed coordinator for phone and glasses structure:**
  enqueue menu/reader/library transitions and companion import/removal through
  the same pending-count lane. Keep the target local, let the render queue own
  bridge serialization, then publish routing on success or restore routing to
  the last rendered state on failure.

## 2026-07-20 — Slice 4 EPUB import

- **DOMParser test gap:** Node 24 exposes no global `DOMParser`, and this repo
  has no installed jsdom/happy-dom package. With new dependencies forbidden,
  fixture tests install a small XML-only DOM implementation from
  `tests/support`; production still uses the WebView's standard `DOMParser`.
- **JSZip offline census:** the bundled dependency adds four static
  license/help URLs and one `importScripts` feature-detection token. EPUB font
  obfuscation adds two algorithm-identifier URLs. All are exact reviewed
  populations; none is a request target or call.

## 2026-07-20 — Slice 4 audit remediation

- **JSZip bounded-inflation path:** `loadAsync` parses ZIP records without
  inflating file bodies. Inspect each loaded entry's central-directory
  `uncompressedSize` first, then consume selected entries through
  `internalStream('uint8array')`; pause and reject on the first chunk that
  would cross either the per-entry or cumulative emitted-byte ceiling.
  Declared-size and emitted-size gates are both required because a forged
  central directory can understate expansion.
- **OCF names remain exact:** reject any `unsafeOriginalName` changed by
  JSZip's zip-slip sanitization, plus normalized or case-folded collisions.
  Keep `mimetype`, container, package, manifest, encryption, and spine lookups
  case-sensitive; URI percent-decoding belongs in reference resolution, not
  archive-name fallback.
- **Companion truth and glasses routing are separate commit domains:** publish
  a post-mutation store snapshot to the phone immediately, retain the last
  confirmed books for gesture routing, and keep the failed structural plan for
  retry. Commit routing only after the retry rebuild succeeds, then act on the
  triggering gesture.
- **EPUB fixture provenance:** keep every committed `.epub` in the JSZip-based
  generator and byte-compare a full temporary regeneration in tests. A hostile
  forged-size fixture can be produced deterministically by patching only the
  target central-directory uncompressed-size field after generation.

## 2026-07-20 — Slice 5 novel-scale pagination

- **Use generated numbered prose for scale proof:** build the ~2.7M-character
  input inside Vitest so no large fixture enters the package. Log character
  count, density, page count, and elapsed milliseconds; keep a 30-second
  per-pagination assertion to tolerate slow CI while retaining useful timing.
- **Stage density changes for the active book only:** one novel-scale paginate
  measured about 1.8 seconds on this workspace, so eagerly rebuilding five
  cached novels would approach nine seconds. Publish a fresh cache containing
  only the active book after the structural render succeeds. Other books then
  paginate lazily, and the position record's old density/page count remaps
  relative progress on reopen.
- **Large-import memory check:** the import result, in-memory store, companion
  list, and routed list share the same `Book` object/string. Selected-file
  buffers, decoder/hash bytes, extractor chapter/page intermediates, and list
  wrapper arrays are temporary; only the store text and page-cache strings are
  intentionally retained. Assert store/result object identity at 2.7M chars to
  guard against a second retained book record.
