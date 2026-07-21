import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TestDomParser } from '../tests/support/dom-parser'
import { createBookStore } from './book-store'
import { extractEpubText } from './epub-extract'
import { importBookFile } from './file-import'
import { paginate } from './paginate'

const originalDomParser = globalThis.DOMParser
const unusedEpubExtractor = vi.fn(async () => { throw new Error('unexpected EPUB extraction') })

beforeAll(() => {
  globalThis.DOMParser = TestDomParser as unknown as typeof DOMParser
})

afterAll(() => {
  globalThis.DOMParser = originalDomParser
})

function pickedFile(name: string, text: string, type?: string) {
  const bytes = new TextEncoder().encode(text)
  return {
    name,
    size: bytes.byteLength,
    ...(type ? { type } : {}),
    arrayBuffer: async () => bytes.buffer,
  }
}

async function fixtureFile(name: string) {
  const bytes = await readFile(new URL(`../tests/fixtures/${name}`, import.meta.url))
  return {
    name,
    size: bytes.byteLength,
    type: 'application/epub+zip',
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  }
}

describe('phone file import', () => {
  it('routes TXT through the same imported-book store path', async () => {
    const store = createBookStore({ indexedDB: null, clock: () => 17 })
    const extractPdf = vi.fn()
    const result = await importBookFile(pickedFile('walk.txt', 'first\n\nsecond'), { store, extractPdf, extractEpub: unusedEpubExtractor })

    expect(result).toMatchObject({
      status: 'ready',
      durability: 'session-only',
      book: { title: 'walk', text: 'first\n\nsecond' },
    })
    expect(extractPdf).not.toHaveBeenCalled()
    expect((await store.list()).books).toHaveLength(1)
  })

  it('persists PDF text and exposes the multi-column warning', async () => {
    const store = createBookStore({ indexedDB: null, clock: () => 18 })
    const extractPdf = vi.fn(async () => ({
      status: 'ready' as const,
      text: 'left right',
      meta: {
        pageCount: 1,
        charCount: 10,
        pageCharOffsets: [0],
        columnsSuspected: true,
        textPageCount: 1,
        pageErrorCount: 0,
        textCoverage: 1,
      },
    }))
    const result = await importBookFile(pickedFile('layout.pdf', 'bytes'), { store, extractPdf, extractEpub: unusedEpubExtractor })

    expect(result).toMatchObject({ status: 'ready', warnings: ['columns'], book: { title: 'layout' } })
    expect((await store.list()).books[0]).toMatchObject({ columnsSuspected: true, pageCharOffsets: [0] })
  })

  it('routes EPUB bytes and persists package metadata through the imported-book path', async () => {
    const store = createBookStore({ indexedDB: null, clock: () => 19 })
    const extractEpub = vi.fn(async () => ({
      status: 'ready' as const,
      text: 'Chapter\n\nReadable EPUB text.',
      meta: {
        title: 'Package Title',
        author: 'Package Author',
        chapterCount: 1,
        charCount: 28,
        chapterOffsets: [0],
      },
    }))
    const result = await importBookFile(pickedFile('filename.epub', 'zip bytes'), {
      store,
      extractPdf: vi.fn(),
      extractEpub,
    })

    expect(extractEpub).toHaveBeenCalledWith(expect.any(ArrayBuffer), 'filename.epub')
    expect(result).toMatchObject({
      status: 'ready',
      book: {
        title: 'Package Title',
        author: 'Package Author',
        chapterOffsets: [0],
        source: 'imported',
      },
    })
    expect((await store.list()).books).toHaveLength(1)
  })

  it('accepts the EPUB media type even when the filename has no extension', async () => {
    const store = createBookStore({ indexedDB: null })
    const extractEpub = vi.fn(async () => ({
      status: 'unsupported' as const,
      reason: 'fixture refusal',
      meta: { chapterCount: 0, charCount: 0, chapterOffsets: [] },
    }))

    await expect(importBookFile(pickedFile('download', 'zip bytes', 'application/epub+zip'), {
      store,
      extractPdf: vi.fn(),
      extractEpub,
    })).resolves.toEqual({ status: 'unsupported', reason: 'fixture refusal' })
    expect(extractEpub).toHaveBeenCalledOnce()
  })

  it('lets a recognized extension win over a conflicting EPUB media type', async () => {
    const store = createBookStore({ indexedDB: null })
    const extractPdf = vi.fn(async () => ({
      status: 'unsupported' as const,
      reason: 'PDF path selected',
      meta: {
        pageCount: 0, charCount: 0, pageCharOffsets: [], columnsSuspected: false,
        textPageCount: 0, pageErrorCount: 0, textCoverage: 0,
      },
    }))
    const extractEpub = vi.fn()

    await expect(importBookFile(pickedFile('book.pdf', 'bytes', 'application/epub+zip'), {
      store, extractPdf, extractEpub,
    })).resolves.toEqual({ status: 'unsupported', reason: 'PDF path selected' })
    expect(extractPdf).toHaveBeenCalledOnce()
    expect(extractEpub).not.toHaveBeenCalled()
  })

  it('returns a PDF refusal without storing a book', async () => {
    const store = createBookStore({ indexedDB: null })
    const extractPdf = vi.fn(async () => ({
      status: 'unsupported' as const,
      reason: 'This PDF contains scanned images, not text. OCR is unavailable.',
      meta: {
        pageCount: 1,
        charCount: 0,
        pageCharOffsets: [0],
        columnsSuspected: false,
        textPageCount: 0,
        pageErrorCount: 0,
        textCoverage: 0,
      },
    }))

    await expect(importBookFile(pickedFile('scan.pdf', 'bytes'), { store, extractPdf, extractEpub: unusedEpubExtractor })).resolves.toEqual({
      status: 'unsupported',
      reason: 'This PDF contains scanned images, not text. OCR is unavailable.',
    })
    expect((await store.list()).books).toEqual([])
  })

  it('surfaces the partial page-coverage warning beside the columns warning', async () => {
    const store = createBookStore({ indexedDB: null })
    const extractPdf = vi.fn(async () => ({
      status: 'ready' as const,
      text: 'available pages',
      meta: {
        pageCount: 10,
        charCount: 15,
        pageCharOffsets: [0],
        columnsSuspected: true,
        textPageCount: 8,
        pageErrorCount: 0,
        textCoverage: 0.8,
        coverageWarning: true,
      },
    }))

    await expect(importBookFile(pickedFile('partial.pdf', 'bytes'), { store, extractPdf, extractEpub: unusedEpubExtractor })).resolves.toMatchObject({
      status: 'ready',
      warnings: ['columns', 'coverage'],
    })
  })

  it('rejects oversized files before reading bytes', async () => {
    const store = createBookStore({ indexedDB: null })
    const extractPdf = vi.fn()
    const txtRead = vi.fn()
    const pdfRead = vi.fn()
    const epubRead = vi.fn()

    await expect(importBookFile({ name: 'huge.txt', size: 5 * 1024 * 1024 + 1, arrayBuffer: txtRead }, { store, extractPdf, extractEpub: unusedEpubExtractor }))
      .resolves.toMatchObject({ status: 'unsupported', reason: expect.stringContaining('5 MB') })
    await expect(importBookFile({ name: 'huge.pdf', size: 25 * 1024 * 1024 + 1, arrayBuffer: pdfRead }, { store, extractPdf, extractEpub: unusedEpubExtractor }))
      .resolves.toMatchObject({ status: 'unsupported', reason: expect.stringContaining('25 MB') })
    await expect(importBookFile({ name: 'huge.epub', size: 25 * 1024 * 1024 + 1, arrayBuffer: epubRead }, { store, extractPdf, extractEpub: unusedEpubExtractor }))
      .resolves.toMatchObject({ status: 'unsupported', reason: expect.stringContaining('25 MB') })
    expect(txtRead).not.toHaveBeenCalled()
    expect(pdfRead).not.toHaveBeenCalled()
    expect(epubRead).not.toHaveBeenCalled()
    expect(extractPdf).not.toHaveBeenCalled()
  })

  it('refuses invalid UTF-8 without replacement decoding', async () => {
    const store = createBookStore({ indexedDB: null })
    const bytes = Uint8Array.from([0x63, 0x61, 0x66, 0xe9])
    const file = { name: 'legacy.txt', size: bytes.byteLength, arrayBuffer: async () => bytes.buffer }

    await expect(importBookFile(file, { store, extractPdf: vi.fn(), extractEpub: unusedEpubExtractor })).resolves.toEqual({
      status: 'unsupported',
      reason: 'This file is not valid UTF-8 text.',
    })
    expect((await store.list()).books).toEqual([])
  })

  it('reports a TXT read failure separately from invalid UTF-8 bytes', async () => {
    const store = createBookStore({ indexedDB: null })
    const file = {
      name: 'revoked.txt',
      size: 12,
      arrayBuffer: async () => { throw new Error('file handle revoked') },
    }

    await expect(importBookFile(file, { store, extractPdf: vi.fn(), extractEpub: unusedEpubExtractor })).resolves.toEqual({
      status: 'unsupported',
      reason: 'This file could not be read.',
    })
  })

  it('rejects unsupported extensions and empty TXT files specifically', async () => {
    const store = createBookStore({ indexedDB: null })
    const extractPdf = vi.fn()

    await expect(importBookFile(pickedFile('book.docx', 'text'), { store, extractPdf, extractEpub: unusedEpubExtractor })).resolves.toEqual({
      status: 'unsupported',
      reason: 'Choose a PDF, EPUB, or TXT file.',
    })
    await expect(importBookFile(pickedFile('empty.txt', '   '), { store, extractPdf, extractEpub: unusedEpubExtractor })).resolves.toEqual({
      status: 'unsupported',
      reason: 'This text file is empty.',
    })
  })

  it('flows a real EPUB import through listing and shared text pagination', async () => {
    const store = createBookStore({ indexedDB: null, clock: () => 20 })
    const result = await importBookFile(await fixtureFile('valid-two-chapters.epub'), {
      store,
      extractPdf: vi.fn(),
      extractEpub: extractEpubText,
    })

    expect(result).toMatchObject({ status: 'ready', book: { title: 'Small Fixture Book', source: 'imported' } })
    const listed = (await store.list()).books
    expect(listed.map(book => book.title)).toEqual(['Small Fixture Book'])
    expect(paginate(listed[0].text, { width: 568, height: 216 }).length).toBeGreaterThan(0)
  })
})
