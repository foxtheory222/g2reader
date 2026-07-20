# Agent Learning Log — G2 Reader

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
