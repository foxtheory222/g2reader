// Sample text for the reader demo. Swap this for your own content — the
// pagination logic in `paginate.ts` works on any plain-text string.

export const SAMPLE_TEXT = `Notes on rendering long-form text on a 576x288 waveguide display.

The hardware gives you 16 shades of green on black, refreshes slowly over BLE, and accepts text updates through a small handful of container primitives. Everything else — pagination, layout, input handling — is your job.

Pre-paginate your content. Splitting a long document into 400–500 character pages up front is faster and more predictable than trying to stream and measure on the glass. Break at paragraph boundaries when you can, sentence boundaries when you can't, and word boundaries only as a fallback.

Use textContainerUpgrade for page turns. Rebuilding the whole page works too but causes a brief flicker each time the user advances — annoying during a focused reading session. Upgrade in-place and the transition feels instantaneous.

Keep a page counter visible. Readers lose track of where they are in dense text more often on a heads-up display than on a phone, partly because there's no scrollbar and partly because focus drifts. A compact "3 / 12" indicator in the corner costs you nothing and answers the most common question at any moment.

Think about re-entry. If the user exits mid-chapter, their next session should pick up where they left off — not at page one. Persist the current page index through setLocalStorage on every page turn, debounced so you're not hammering the BLE link.

Respect the input ergonomics of the ring. Tap to advance is the obvious default, but remember that the R1 also understands swipes and long-press. A swipe back gesture for "previous page" is worth wiring up; otherwise a stray tap becomes a mild annoyance because it can't be undone.

Finally: don't fight the medium. This isn't a phone and it isn't an e-reader. Text-heavy apps on G2 work best when they stay short, stay structured, and let the user drive the pace.`
