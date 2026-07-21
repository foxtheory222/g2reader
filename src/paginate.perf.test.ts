import { describe, expect, it } from 'vitest'
import { paginate } from './paginate'

const TARGET_CHARACTERS = 2_700_000
const WIDTH = 568
const LINE_HEIGHT = 27
const CEILING_MS = 30_000

function buildNumberedSentenceBook(): string {
  const paragraphs: string[] = []
  let totalLength = 0
  let sentenceNumber = 1

  while (totalLength < TARGET_CHARACTERS) {
    const sentences = Array.from({ length: 8 }, () => (
      `Sentence ${sentenceNumber++} follows the traveler through a deterministic chapter of ordinary classic prose.`
    ))
    const paragraph = sentences.join(' ')
    paragraphs.push(paragraph)
    totalLength += paragraph.length + (paragraphs.length > 1 ? 2 : 0)
  }

  return paragraphs.join('\n\n')
}

describe('pagination performance at novel scale', () => {
  it('paginates a deterministic ~2.7M-character book within the CI-safe budget at every density', () => {
    const book = buildNumberedSentenceBook()
    expect(book.length).toBeGreaterThanOrEqual(TARGET_CHARACTERS)
    expect(book.length).toBeLessThan(TARGET_CHARACTERS + 1_000)

    for (const density of [6, 8, 5] as const) {
      const started = performance.now()
      const pages = paginate(book, { width: WIDTH, height: density * LINE_HEIGHT })
      const durationMs = performance.now() - started

      console.info(
        `PAGINATION_PERF chars=${book.length} density=${density} pages=${pages.length} duration_ms=${durationMs.toFixed(1)}`,
      )
      expect(pages.length).toBeGreaterThan(0)
      expect(durationMs).toBeLessThan(CEILING_MS)
    }
  }, 100_000)
})
