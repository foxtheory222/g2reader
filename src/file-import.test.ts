import { describe, expect, it, vi } from 'vitest'
import { createBookStore } from './book-store'
import { importBookFile } from './file-import'

function pickedFile(name: string, text: string) {
  const bytes = new TextEncoder().encode(text)
  return {
    name,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer,
  }
}

describe('phone file import', () => {
  it('routes TXT through the same imported-book store path', async () => {
    const store = createBookStore({ indexedDB: null, clock: () => 17 })
    const extractPdf = vi.fn()
    const result = await importBookFile(pickedFile('walk.txt', 'first\n\nsecond'), { store, extractPdf })

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
    const result = await importBookFile(pickedFile('layout.pdf', 'bytes'), { store, extractPdf })

    expect(result).toMatchObject({ status: 'ready', warnings: ['columns'], book: { title: 'layout' } })
    expect((await store.list()).books[0]).toMatchObject({ columnsSuspected: true, pageCharOffsets: [0] })
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

    await expect(importBookFile(pickedFile('scan.pdf', 'bytes'), { store, extractPdf })).resolves.toEqual({
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

    await expect(importBookFile(pickedFile('partial.pdf', 'bytes'), { store, extractPdf })).resolves.toMatchObject({
      status: 'ready',
      warnings: ['columns', 'coverage'],
    })
  })

  it('rejects oversized files before reading bytes', async () => {
    const store = createBookStore({ indexedDB: null })
    const extractPdf = vi.fn()
    const txtRead = vi.fn()
    const pdfRead = vi.fn()

    await expect(importBookFile({ name: 'huge.txt', size: 5 * 1024 * 1024 + 1, arrayBuffer: txtRead }, { store, extractPdf }))
      .resolves.toMatchObject({ status: 'unsupported', reason: expect.stringContaining('5 MB') })
    await expect(importBookFile({ name: 'huge.pdf', size: 25 * 1024 * 1024 + 1, arrayBuffer: pdfRead }, { store, extractPdf }))
      .resolves.toMatchObject({ status: 'unsupported', reason: expect.stringContaining('25 MB') })
    expect(txtRead).not.toHaveBeenCalled()
    expect(pdfRead).not.toHaveBeenCalled()
    expect(extractPdf).not.toHaveBeenCalled()
  })

  it('refuses invalid UTF-8 without replacement decoding', async () => {
    const store = createBookStore({ indexedDB: null })
    const bytes = Uint8Array.from([0x63, 0x61, 0x66, 0xe9])
    const file = { name: 'legacy.txt', size: bytes.byteLength, arrayBuffer: async () => bytes.buffer }

    await expect(importBookFile(file, { store, extractPdf: vi.fn() })).resolves.toEqual({
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

    await expect(importBookFile(file, { store, extractPdf: vi.fn() })).resolves.toEqual({
      status: 'unsupported',
      reason: 'This file could not be read.',
    })
  })

  it('rejects unsupported extensions and empty TXT files specifically', async () => {
    const store = createBookStore({ indexedDB: null })
    const extractPdf = vi.fn()

    await expect(importBookFile(pickedFile('book.epub', 'text'), { store, extractPdf })).resolves.toEqual({
      status: 'unsupported',
      reason: 'Choose a PDF or TXT file.',
    })
    await expect(importBookFile(pickedFile('empty.txt', '   '), { store, extractPdf })).resolves.toEqual({
      status: 'unsupported',
      reason: 'This text file is empty.',
    })
  })
})
