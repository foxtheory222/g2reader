# Readpane

Readpane is a fully offline long-form reader for Even Realities G2 glasses.
The packed app contains its code, assets, PDF/TXT parsing, pagination, and the
bundled first two chapters of *Alice's Adventures in Wonderland*. It requests
no network permission and uses no backend, telemetry, or external fetches.

On first launch, Readpane opens the glasses library. After a book has been
read, later app launches resume the last-active book at its last confirmed
position. The phone companion imports local PDF and strict UTF-8 TXT files and
stores imported books in IndexedDB.

## Reading controls

- In the library, scroll to choose a book and tap to open it.
- In the reader, page turns are scroll-only: scroll down/ring forward for the
  next page and scroll up/ring back for the previous page.
- Tap in the reader to open the compact reader menu: Continue, Progress style,
  Density, and Library. Scroll to move its cursor and tap to select.
- Progress cycles through percent, page number, and hidden.
- Density cycles through 5, 6, and 8 lines while preserving relative reading
  progress. The default is 6 lines.
- Double-tap anywhere to request the host-confirmed exit flow.

Reading position is persisted only after the complete glasses update or
structural transition succeeds. Failed or timed-out display work retains the
last confirmed position, density, settings, and routing state. If browser
storage is denied or full, non-throwing in-memory fallbacks keep the active
session coherent.

## Layout and pagination

The G2 canvas is 576×288. Library rows use a 240px body and footer. Reader and
menu geometry follows the selected 5-, 6-, or 8-line density, with a 6px gap
before the progress footer. `src/paginate.ts` measures the resulting inner box
with `@evenrealities/pretext` and the G2's fixed 27px line height. Oversized
tokens split on Unicode code-point boundaries, and emitted pages stay within
the SDK text limits.

## Android + G2 device workflow

The default real-device workflow is an Android phone running the Even
Realities app:

```bash
npm install
npm run dev -- --host 0.0.0.0
adb reverse tcp:5173 tcp:5173
npx evenhub qr --url http://127.0.0.1:5173/
```

Scan the QR code from the Even Realities app and verify on the connected G2.
The desktop simulator provides bounded layout and logic proof only; real-G2
readability, scroll feel, gesture reliability, and background behavior require
an Android + G2 run.

## Development

| Command | Purpose |
|---|---|
| `npm run dev` | Start Vite for local development. |
| `npm run build` | Typecheck production code and create `dist/`. |
| `npm run typecheck:test` | Typecheck production and test TypeScript. |
| `npm test` | Build, typecheck tests, run Vitest, and enforce the offline gate. |
| `npm run test:sim` | Run `npm test`, then the bounded simulator proof. |
| `npm run preview` | Serve the existing production build. |
| `npm run pack` | Run the verified `evenhub pack app.json dist` form. All packaging release gates still apply. |

`G2_READER_*` console markers are a stable internal harness protocol retained
across the Readpane rename. The legacy `g2reader:*` local-storage keys and the
`g2reader` IndexedDB database name are also intentionally stable: renaming
them would make existing user data, imported books, settings, and reading
positions appear lost.

The simulator harness refuses occupied ports 4173 and 9898, watches child
process and browser-console failures, compares body/footer regions
independently, and writes ignored proof images under `evidence/`.

## Key files

| File | Purpose |
|---|---|
| `src/main.ts` | Startup, staged UI transitions, lifecycle handling, and companion mirror. |
| `src/render-queue.ts` | Host-exit-aware render, structural, and shutdown bridge lane. |
| `src/ui-coordinator.ts` | Shared companion-mutation and screen-transition coordinator. |
| `src/reader-runtime.ts` | Immutable confirmed-render snapshots and position persistence. |
| `src/paginate.ts` | Pixel-measured, Unicode-safe, SDK-budgeted pagination. |
| `src/position-store.ts` | Non-throwing local position persistence and density remapping. |
| `books/alice-ch1-2.txt` | Bundled offline library content. |
| `src/offline-gate.test.ts` | Fresh-build manifest and network-capability gate. |
| `offline-allowlist.json` | Reviewed built-token allowlist for the offline gate. |
