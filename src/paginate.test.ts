import { measureTextWrap } from '@evenrealities/pretext'
import { describe, expect, it } from 'vitest'
import aliceText from '../books/alice-ch1-2.txt?raw'
import { paginate } from './paginate'

const FULL_WIDTH = 568
const LINE_HEIGHT = 27

describe('paginate', () => {
  it('returns no pages for empty or whitespace-only text', () => {
    expect(paginate('', { width: FULL_WIDTH, height: 216 })).toEqual([])
    expect(paginate(' \n\n  ', { width: FULL_WIDTH, height: 216 })).toEqual([])
  })

  it('keeps a short paragraph on one page', () => {
    expect(paginate('A short paragraph.', { width: FULL_WIDTH, height: 216 })).toEqual([
      'A short paragraph.',
    ])
  })

  it('splits a paragraph longer than one page into fitting pages', () => {
    const source = 'Alice followed the White Rabbit down the passage. '.repeat(30).trim()
    const pages = paginate(source, { width: 180, height: 2 * LINE_HEIGHT })

    expect(pages.length).toBeGreaterThan(1)
    for (const page of pages) {
      expect(measureTextWrap(page, 180).lineCount).toBeLessThanOrEqual(2)
    }
  })

  it('keeps an exact-fit paragraph on one page', () => {
    const source = 'Alice was beginning to get very tired of sitting by her sister.'
    const lineCount = measureTextWrap(source, 180).lineCount

    expect(paginate(source, { width: 180, height: lineCount * LINE_HEIGHT })).toEqual([source])
  })

  it('charges one blank line between paragraphs', () => {
    const pages = paginate('First paragraph.\n\nSecond paragraph.', {
      width: FULL_WIDTH,
      height: 2 * LINE_HEIGHT,
    })

    expect(pages).toEqual(['First paragraph.', 'Second paragraph.'])
  })

  it('has a stable page count for the bundled Alice excerpt', () => {
    const pages = paginate(aliceText, { width: FULL_WIDTH, height: 216 })
    expect(pages).toHaveLength(96)
  })

  it.each([
    ['huge unbroken token', 'x'.repeat(10_000)],
    ['emoji without broken surrogate pairs', '🙂'.repeat(3_000)],
    ['CJK without spaces', '不怕长文本'.repeat(1_200)],
    ['large whitespace token', `before${' '.repeat(5_000)}after`],
  ])('splits %s into SDK-safe fitting chunks', (_label, source) => {
    const pages = paginate(source, { width: 90, height: LINE_HEIGHT })
    expect(pages.length).toBeGreaterThan(1)
    for (const page of pages) {
      expect(page.length).toBeLessThanOrEqual(2_000)
      expect(measureTextWrap(page, 90).lineCount).toBeLessThanOrEqual(1)
      expect(page).not.toMatch(/[\uD800-\uDBFF]$/)
      expect(page).not.toMatch(/^[\uDC00-\uDFFF]/)
    }
  })

  it('post-checks every assembled page against the SDK character limit', () => {
    const shortMeasuring = `visible${'\u200B'.repeat(2_500)}${' '.repeat(2_500)}end`
    const pages = paginate(`First.\n\n${shortMeasuring}\n\nLast.`, { width: FULL_WIDTH, height: 216 })

    expect(pages.length).toBeGreaterThan(1)
    for (const page of pages) expect(page.length).toBeLessThanOrEqual(2_000)
  })

  it('recognizes CRLF paragraph endings and preserves the maxLines=1 limit', () => {
    const pages = paginate('first\r\n\r\nsecond', { width: FULL_WIDTH, height: LINE_HEIGHT })
    expect(pages).toEqual(['first', 'second'])
  })
})
