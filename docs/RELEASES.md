# Readpane Releases

## 0.2.0 — 2026-07-20 (first pack)

- **File:** `readpane-0.2.0.ehpk` (672,303 bytes, repo root; gitignored)
- **SHA-256:** `cf6a7849d05aa904a1d63fbea72c3931bbf07fe10babafe7895e318a7d2fc0aa`
- **Source:** main `bdb0009` + version bump; app.json/package.json both 0.2.0.
- **Packaging gate:** full tests 221/221 (fresh build + typecheck + offline
  gate), production build, test:sim ×2 idempotent with no orphaned processes.
  `evenhub pack --check` (package-id availability) NOT run — requires
  Stephen's `evenhub login`; must pass before store submission.
- **Contents:** TXT/PDF/EPUB import (offline extraction, honest refusals,
  4M-char/3,000-page/8MiB-TXT limits), multi-book library, reader menu
  (tap), density presets 5/6/8, cycling footer, resume-into-book, per-book
  positions with persist-on-confirm.
- **Evidence tier:** simulator gates + real-device session (Android SM-G781W,
  Even app, G2 connected): import/durability/resume/picker verified.
  Density comfort and daylight readability still need Stephen's assessment.
- **Store-listing note (required at submission):** independent app by
  Stephen; not affiliated with or endorsed by Even Realities.
