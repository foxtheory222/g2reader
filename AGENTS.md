# Agent Rules — G2 Reader

## Product invariants
- Fully offline: the packed .ehpk contains everything. app.json permissions
  never include network. No backend, telemetry, or external fetches. Adding
  any network capability is a product pivot only Stephen can approve.
- Reading position is never lost: persist locally, restore on
  foreground/restart and app relaunch.
- Glasses input semantics are documented in docs/DECISIONS.md before
  implementation. Never call app-shutdown bridge APIs from normal reading
  input; runtime cleanup only after host-confirmed exit events.

## Stephen's device workflow
- Default real-device phone is Android + Even Realities app + ADB. Prefer
  `adb reverse tcp:<port> tcp:<port>` and `http://127.0.0.1:<port>/`.
  Never assume iPhone unless Stephen says so.
- Simulator proof is layout/logic proof only — label it. Claims about
  readability, scroll feel, gesture reliability, or background behavior
  need a real Android + G2 run.
- Keep proof bounded: focused tests, full test run, build, short simulator
  or device checks. No marathon soaks as routine acceptance.

## Workflow
- Small vertical slices on `slice/N-name` branches; reuse the slice branch
  for follow-up fixes; merge to main only when Stephen approves; safe-delete
  merged branches (`git branch -d`, never `-D`).
- Inspect before editing. Build-vs-buy before any new script >50 lines:
  pdfjs-dist for PDF, the official simulator automation API for harnesses,
  @evenrealities/pretext for text measurement — custom code is for policy
  (offline gate, proof orchestration), not mechanics.
- Stephen owns product decisions (formats, UX, gestures, naming, fonts,
  library model). Record each in docs/DECISIONS.md with a date. Do not
  implement ahead of a recorded decision, and do not write detailed plans
  for interfaces that don't exist yet — smallest real slice instead.
- Record reusable learnings and golden paths (commands, order, gotchas,
  what didn't work) in docs/agent_learning_log.md. This project should
  need zero secrets; flag it immediately if one ever appears.
- Use the everything-evenhub:* skills for SDK/UI/input/simulator/packaging
  questions instead of memory. Never invent CLI commands; verify against
  `--help` and official docs.
- Packaging gate (all required before handing Stephen an .ehpk):
  app.json/package.json versions in sync and bumped, full tests, build,
  test:sim, the offline gate, and a release note recording filename and
  SHA-256.
- End every work session by listing files changed, commands run, and any
  dependencies installed.

## Do not
- Do not create god files or vague catch-all docs.
- Do not add network anything.
- Do not touch other workspaces (VelvetSpeak, demo apps) except read-only.
