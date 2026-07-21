import { describe, expect, it } from 'vitest'
import { createBookStore, stableBookId, titleFromFilename } from './book-store'

describe('book store', () => {
  it('uses a stable SHA-256 content id and a filename-derived title', async () => {
    expect(await stableBookId('abc')).toBe(
      'book-ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(await stableBookId('same text')).toBe(await stableBookId('same text'))
    expect(await stableBookId('same text')).not.toBe(await stableBookId('different text'))
    expect(await stableBookId('same text')).toMatch(/^book-[0-9a-f]{64}$/)
    expect(titleFromFilename('/downloads/field-notes.txt')).toBe('field-notes')

    const store = createBookStore({ indexedDB: null, clock: () => 1234 })
    const imported = await store.importText('field-notes.txt', 'same text')
    expect(imported).toEqual({
      durability: 'session-only',
      book: {
        id: await stableBookId('same text'),
        title: 'field-notes',
        text: 'same text',
        source: 'imported',
        importedAt: 1234,
      },
    })
  })

  it('lists and removes imported books using its non-throwing memory fallback', async () => {
    let now = 8
    const store = createBookStore({ indexedDB: null, clock: () => ++now })
    const { book: first } = await store.importText('first.txt', 'one')
    await store.importText('second.txt', 'two')

    expect((await store.list()).books.map(book => book.title)).toEqual(['second', 'first'])
    await expect(store.remove(first.id)).resolves.toEqual({ durability: 'session-only' })
    expect((await store.list()).books.map(book => book.title)).toEqual(['second'])
  })

  it('keeps the session coherent when durable operations reject', async () => {
    const rejectingFactory = {
      open() {
        throw new Error('IndexedDB denied')
      },
    } as unknown as IDBFactory
    const store = createBookStore({ indexedDB: rejectingFactory, clock: () => 1 })

    await expect(store.importText('offline.txt', 'available')).resolves.toMatchObject({
      durability: 'session-only', book: { title: 'offline' },
    })
    await expect(store.list()).resolves.toMatchObject({ durability: 'session-only', books: [{ title: 'offline' }] })
    await expect(store.remove(await stableBookId('available'))).resolves.toEqual({ durability: 'session-only' })
    await expect(store.list()).resolves.toEqual({ durability: 'session-only', books: [], invalidRecordCount: 0 })
  })

  it('persists extraction metadata with imported text', async () => {
    const store = createBookStore({ indexedDB: null, clock: () => 5 })
    const { book } = await store.importText('columns.pdf', 'left right', {
      columnsSuspected: true,
      pageCharOffsets: [0, 6],
    })

    expect(book).toMatchObject({ columnsSuspected: true, pageCharOffsets: [0, 6] })
  })

  it('counts malformed durable records that are filtered from list()', async () => {
    const valid = {
      id: 'book-valid',
      title: 'Valid',
      text: 'Readable text',
      source: 'imported',
      importedAt: 10,
    }
    const store = createBookStore({ indexedDB: indexedDbWithRecords([valid, { id: 'broken' }]) })

    await expect(store.list()).resolves.toEqual({
      books: [valid],
      durability: 'durable',
      invalidRecordCount: 1,
    })
  })
})

function indexedDbWithRecords(records: unknown[]): IDBFactory {
  const database = {
    objectStoreNames: { contains: () => true },
    transaction() {
      const transaction = {
        objectStore: () => ({
          getAll() {
            const request: Record<string, unknown> = {}
            queueMicrotask(() => {
              request.result = records
              ;(request.onsuccess as (() => void) | undefined)?.()
            })
            return request
          },
        }),
      }
      return transaction
    },
    close() { /* no-op test database */ },
  }
  return {
    open() {
      const request: Record<string, unknown> = {}
      queueMicrotask(() => {
        request.result = database
        ;(request.onsuccess as (() => void) | undefined)?.()
      })
      return request
    },
  } as unknown as IDBFactory
}
