import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  classifyTextCoverage,
  classifyUnsupportedLayout,
  classifyPdfFailure,
  extractPdfText,
  hasMostlyGarbageText,
} from './pdf-extract'

function pdfJsItem(str: string, options: { dir?: string; transform?: number[]; y?: number } = {}) {
  return {
    str,
    dir: options.dir ?? 'ltr',
    transform: options.transform ?? [12, 0, 0, 12, 72, options.y ?? 500],
    width: Math.max(12, str.length * 6),
    height: 12,
  }
}

function extractionDocument(
  pages: Array<{ items: unknown[]; rotate?: number } | Error>,
) {
  return async () => ({
    numPages: pages.length,
    async getPage(pageNumber: number) {
      const definition = pages[pageNumber - 1]
      if (definition instanceof Error) throw definition
      return {
        rotate: definition.rotate ?? 0,
        getViewport: () => ({ width: 612, height: 792 }),
        getTextContent: async () => ({ items: definition.items }),
        cleanup: () => undefined,
      }
    },
    destroy: async () => undefined,
  })
}

async function fixture(name: string): Promise<ArrayBuffer> {
  const bytes = await readFile(fileURLToPath(new URL(`../tests/fixtures/${name}`, import.meta.url)))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

describe('PDF text extraction', () => {
  it('reconstructs prose, paragraphs, page boundaries, and page offsets', async () => {
    const result = await extractPdfText(await fixture('simple-prose.pdf'))

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.text).toContain('A quiet morning opened over the valley.')
    expect(result.text).toContain('The road below was still empty.')
    expect(result.text).toContain('\n\nBy noon, the town had found its ordinary rhythm.')
    expect(result.meta.pageCount).toBe(2)
    expect(result.meta.pageCharOffsets).toEqual([
      0,
      result.text.indexOf('By noon, the town had found its ordinary rhythm.'),
    ])
    expect(result.meta.charCount).toBe(result.text.length)
    expect(result.meta.columnsSuspected).toBe(false)
  })

  it('dehyphenates only with corpus-internal evidence for the joined word', async () => {
    const result = await extractPdfText(await fixture('hyphenated-lines.pdf'))

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.text).toContain('A conservative choice keeps this word whole.')
    expect(result.text).toContain('A well-\nbeing choice keeps its lexical hyphen without evidence.')
  })

  it('removes digit-normalized furniture repeated in the same y-band', async () => {
    const result = await extractPdfText(await fixture('header-footer-furniture.pdf'))

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.text).not.toContain('FIELD REPORT 2026')
    expect(result.text).not.toMatch(/Page \d/)
    expect(result.text).toContain('Alpha body passage belongs here.')
    expect(result.text).toContain('Ember body passage belongs here.')
  })

  it('keeps repeated central refrains and varying-digit body lines outside the edge bands', async () => {
    const result = await extractPdfText(await fixture('central-refrain.pdf'))

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.text.match(/KEEP THIS CENTRAL REFRAIN/g)).toHaveLength(9)
    for (let rule = 1; rule <= 9; rule++) expect(result.text).toContain(`Rule ${rule}`)
  })

  it('flags a sustained two-column gutter without pretending to reorder columns', async () => {
    const result = await extractPdfText(await fixture('two-column.pdf'))

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.meta.columnsSuspected).toBe(true)
    expect(result.text).toContain('Left column line 1.')
    expect(result.text).toContain('Right column line 1.')
  })

  it('honestly refuses a PDF with no extractable text', async () => {
    const result = await extractPdfText(await fixture('no-text.pdf'))

    expect(result).toMatchObject({
      status: 'unsupported',
      reason: 'This PDF contains scanned images, not text. OCR is not available in this offline reader.',
      meta: {
        pageCount: 2,
        charCount: 0,
        pageCharOffsets: [0, 2],
        textPageCount: 0,
        pageErrorCount: 0,
        textCoverage: 0,
      },
    })
  })

  it('refuses documents over three pages when fewer than 70% yield text', async () => {
    const result = await extractPdfText(await fixture('mostly-image-pages.pdf'))

    expect(result).toMatchObject({
      status: 'unsupported',
      reason: expect.stringContaining('mostly scanned/image pages'),
      meta: { pageCount: 4, textPageCount: 1, pageErrorCount: 0, textCoverage: 0.25 },
    })
  })

  it('warns when page text coverage is between 70% and 95%', async () => {
    const result = await extractPdfText(await fixture('partial-text-coverage.pdf'))

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.meta).toMatchObject({
      pageCount: 10,
      textPageCount: 8,
      pageErrorCount: 0,
      textCoverage: 0.8,
      coverageWarning: true,
    })
  })

  it('computes meaningful-page coverage after repeated furniture removal', async () => {
    const result = await extractPdfText(await fixture('repeated-header-cover-only.pdf'))

    expect(result).toMatchObject({
      status: 'unsupported',
      reason: expect.stringContaining('mostly scanned/image pages'),
      meta: { pageCount: 10, textPageCount: 1, pageErrorCount: 0, textCoverage: 0.1 },
    })
  })

  it('keeps parser-error pages in the post-cleaning coverage denominator', async () => {
    const result = await extractPdfText(new ArrayBuffer(0), {
      loadDocument: extractionDocument([
        { items: [pdfJsItem('Meaningful cover prose.')] },
        new Error('page parser failed'),
        new Error('page parser failed'),
        new Error('page parser failed'),
      ]),
    })

    expect(result).toMatchObject({
      status: 'unsupported',
      meta: { textPageCount: 1, pageErrorCount: 3, textCoverage: 0.25 },
    })
  })

  it('refuses RTL-dominant and rotated/vertical-dominant item sets as unvalidated', () => {
    const base = { str: 'word', width: 20, height: 12 }
    expect(classifyUnsupportedLayout([
      { ...base, dir: 'rtl', transform: [12, 0, 0, 12, 10, 10] },
      { ...base, dir: 'rtl', transform: [12, 0, 0, 12, 30, 10] },
      { ...base, dir: 'ltr', transform: [12, 0, 0, 12, 50, 10] },
    ])).toMatch(/RTL.*unvalidated/i)
    expect(classifyUnsupportedLayout([
      { ...base, dir: 'ltr', transform: [0, 12, -12, 0, 10, 10] },
      { ...base, dir: 'ltr', transform: [0, 12, -12, 0, 10, 30] },
      { ...base, dir: 'ltr', transform: [12, 0, 0, 12, 50, 10] },
    ])).toMatch(/rotated\/vertical.*unvalidated/i)
  })

  it('weights RTL and rotation dominance by readable character count', () => {
    const tinyLtr = ['x', 'y', 'z'].map((str, index) => pdfJsItem(str, { y: 450 - index * 20 }))
    expect(classifyUnsupportedLayout([
      pdfJsItem('مرحبا'.repeat(30), { dir: 'rtl' }),
      pdfJsItem('بالعالم'.repeat(30), { dir: 'rtl', y: 470 }),
      ...tinyLtr,
    ])).toMatch(/RTL.*unvalidated/i)
    expect(classifyUnsupportedLayout([
      pdfJsItem('rotated body '.repeat(30), { transform: [0, 12, -12, 0, 72, 500] }),
      pdfJsItem('vertical body '.repeat(30), { transform: [0, 12, -12, 0, 92, 500] }),
      ...tinyLtr,
    ])).toMatch(/rotated\/vertical.*unvalidated/i)
  })

  it.each([
    ['page-level /Rotate', { items: [pdfJsItem('Long readable body text '.repeat(20))], rotate: 90 }],
    ['180-degree text transform', { items: [pdfJsItem('Long readable body text '.repeat(20), { transform: [-12, 0, 0, -12, 72, 500] })] }],
    ['negative-determinant text transform', { items: [pdfJsItem('Long readable body text '.repeat(20), { transform: [12, 0, 0, -12, 72, 500] })] }],
  ])('refuses unsupported extraction orientation from %s', async (_label, page) => {
    // CoreGraphics cannot reliably author exact PDF.js direction metadata or
    // transform matrices, so these extraction-level doubles model PDF.js output.
    const result = await extractPdfText(new ArrayBuffer(0), {
      loadDocument: extractionDocument([page]),
    })
    expect(result).toMatchObject({ status: 'unsupported', reason: expect.stringMatching(/rotated\/vertical/i) })
  })

  it('detects replacement/private-use, controls, non-printables, and low letter density', () => {
    expect(hasMostlyGarbageText(`readable${'\uFFFD'.repeat(2)}`)).toBe(true)
    expect(hasMostlyGarbageText(`readable text${'\uE000'}`)).toBe(false)
    expect(hasMostlyGarbageText(`mapped${'\u0001'.repeat(3)}text`)).toBe(true)
    expect(hasMostlyGarbageText(`mapped${'\u200B'.repeat(4)}text`)).toBe(true)
    expect(hasMostlyGarbageText('12 34 56 !! ?? :: ;; -- __')).toBe(true)
    expect(hasMostlyGarbageText('Chapter 12: A readable sentence.')).toBe(false)
  })

  it('detects bounded repetition, low entropy, and frequent UTF-8-as-Latin1 mojibake', () => {
    expect(hasMostlyGarbageText('A'.repeat(256))).toBe(true)
    expect(hasMostlyGarbageText('AB'.repeat(128))).toBe(true)
    expect(hasMostlyGarbageText('FranÃ§ais â€” '.repeat(20))).toBe(true)
    expect(hasMostlyGarbageText('A readable passage repeats ordinary words without corrupt encoding. '.repeat(8))).toBe(false)
  })

  it('refuses PDFs over the 1000-page extraction limit before reading pages', async () => {
    const result = await extractPdfText(new ArrayBuffer(0), {
      loadDocument: async () => ({ numPages: 1001 }),
    })
    expect(result).toMatchObject({ status: 'unsupported', reason: expect.stringContaining('1,000 pages') })
  })

  it('counts per-page parser errors as missing coverage', async () => {
    const result = await extractPdfText(new ArrayBuffer(0), {
      loadDocument: async () => ({
        numPages: 4,
        async getPage(pageNumber: number) {
          if (pageNumber > 1) throw new Error(`page ${pageNumber} parse failed`)
          return {
            getViewport: () => ({ width: 612, height: 792 }),
            getTextContent: async () => ({
              items: [{ str: 'Only the cover has text.', dir: 'ltr', transform: [12, 0, 0, 12, 72, 720], width: 130, height: 12 }],
            }),
            cleanup: () => undefined,
          }
        },
        destroy: async () => undefined,
      }),
    })
    expect(result).toMatchObject({
      status: 'unsupported',
      reason: expect.stringContaining('mostly scanned/image pages'),
      meta: { textPageCount: 1, pageErrorCount: 3, textCoverage: 0.25 },
    })
  })

  it('stops once cumulative extracted text exceeds two million characters', async () => {
    const huge = 'a'.repeat(1_000_001)
    const result = await extractPdfText(new ArrayBuffer(0), {
      loadDocument: async () => ({
        numPages: 2,
        async getPage() {
          return {
            getViewport: () => ({ width: 612, height: 792 }),
            getTextContent: async () => ({
              items: [{ str: huge, dir: 'ltr', transform: [12, 0, 0, 12, 72, 720], width: 130, height: 12 }],
            }),
            cleanup: () => undefined,
          }
        },
        destroy: async () => undefined,
      }),
    })
    expect(result).toMatchObject({ status: 'unsupported', reason: expect.stringContaining('2,000,000 characters') })
  })

  it('budgets raw item strings before whitespace normalization', async () => {
    const result = await extractPdfText(new ArrayBuffer(0), {
      loadDocument: extractionDocument([{
        // Budget raw string-bearing items before validating/reconstructing the
        // PDF.js text-item shape or collapsing the whitespace.
        items: [{ str: ' '.repeat(2_000_001) }],
      }]),
    })
    expect(result).toMatchObject({ status: 'unsupported', reason: expect.stringContaining('2,000,000 characters') })
  })

  it('includes inserted page separators in the final text cap', async () => {
    const page = { items: [pdfJsItem('a'.repeat(1_000_000))] }
    const result = await extractPdfText(new ArrayBuffer(0), {
      loadDocument: extractionDocument([page, page]),
    })
    expect(result).toMatchObject({ status: 'unsupported', reason: expect.stringContaining('2,000,000 characters') })
  })

  it('defines exact coverage boundaries and the short-document exemption', () => {
    expect(classifyTextCoverage(7, 10)).toEqual({ unsupported: false, warning: true })
    expect(classifyTextCoverage(19, 20)).toEqual({ unsupported: false, warning: false })
    expect(classifyTextCoverage(1, 3)).toEqual({ unsupported: false, warning: false })
    expect(classifyTextCoverage(1, 4)).toEqual({ unsupported: true, warning: false })
  })

  it('maps encrypted document errors to a specific refusal', () => {
    expect(classifyPdfFailure({ name: 'PasswordException', code: 1 })).toBe(
      'This PDF is encrypted. Remove its password and try again.',
    )
  })
})
