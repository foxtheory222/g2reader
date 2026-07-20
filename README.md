# G2 Reader

G2 Reader is a fully offline Even Realities G2 walking skeleton for long-form
text. The packed app contains a one-title library and the bundled first two
chapters of *Alice's Adventures in Wonderland*. It never requests a network
permission, backend, telemetry endpoint, or external asset.

The glasses open on the library. Tap to open the bundled book at its last
confirmed page, tap or swipe down to advance, swipe up to go back, and
double-tap to show the host exit confirmation. Position is written to browser
local storage only after both body and footer updates succeed. If browser
storage is denied or full, a non-throwing in-memory fallback keeps the active
session bootable and coherent.

## Layout and pagination

The G2 canvas is 576×288. The reader uses:

- body: `(0, 0)`, 576×240, 4px padding;
- gap: `y=240..245`;
- footer: `(0, 246)`, 576×42, 4px padding.

`src/paginate.ts` measures the body's 568×232 inner box with
`@evenrealities/pretext` and the G2's fixed 27px line height. Oversized tokens
are split on Unicode code-point boundaries. Every emitted page fits its line
budget and the SDK's 2,000-character `textContainerUpgrade` limit.

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
Do not assume an iPhone workflow.

The desktop simulator is useful for bounded layout and logic proof only. It
cannot establish real-glasses readability, scroll feel, gesture reliability,
or background/relaunch behavior; those claims require an Android + G2 run.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start Vite for local development. |
| `npm run build` | Typecheck production code and create a fresh `dist/`. |
| `npm run typecheck:test` | Typecheck production and `*.test.ts` files without emitting. |
| `npm test` | Fresh build, test typecheck, unit tests, and offline distribution gate. |
| `npm run test:sim` | Run `npm test` first, then the bounded simulator automation proof. |
| `npm run preview` | Serve the existing `dist/` locally. |
| `npm run pack` | Run the verified CLI form `evenhub pack app.json dist`. Packaging release gates still apply before handing off an `.ehpk`. |

The simulator harness refuses occupied ports 4173 and 9898, watches child
process and browser-console failures, and compares the body and footer regions
independently. It writes proof images under ignored `evidence/`.

## Key files

| File | Purpose |
|---|---|
| `src/main.ts` | Startup, desired/rendered reader state, lifecycle handling, and companion mirror. |
| `src/render-queue.ts` | Recovering serialized body/footer/shutdown bridge queue with persist-on-confirm commits. |
| `src/paginate.ts` | Pixel-measured, Unicode-safe, SDK-budgeted pagination. |
| `src/position-store.ts` | Non-throwing local persistence with in-memory fallback. |
| `books/alice-ch1-2.txt` | Bundled offline library content. |
| `src/offline-gate.test.ts` | Manifest, network-literal, and network-API census gate over fresh `dist/`. |
| `offline-allowlist.json` | Reviewed exact URL prefixes and exact built-token populations. |
