export interface Book {
  id: string
  title: string
  text: string
  source: 'bundled' | 'imported'
  importedAt?: number
  columnsSuspected?: boolean
  pageCharOffsets?: number[]
}

export interface ImportMetadata {
  columnsSuspected?: boolean
  pageCharOffsets?: number[]
}

export type Durability = 'durable' | 'session-only'
export interface ImportBookResult {
  book: Book
  durability: Durability
}
export interface ListBooksResult {
  books: Book[]
  durability: Durability
  invalidRecordCount: number
}
export interface RemoveBookResult {
  durability: Durability
}

export interface BookStore {
  importText(filename: string, text: string, metadata?: ImportMetadata): Promise<ImportBookResult>
  list(): Promise<ListBooksResult>
  remove(bookId: string): Promise<RemoveBookResult>
}

interface BookStoreOptions {
  indexedDB?: IDBFactory | null
  clock?: () => number
}

const DATABASE_NAME = 'g2reader'
const DATABASE_VERSION = 1
const STORE_NAME = 'books'

function browserIndexedDB(): IDBFactory | null {
  try {
    return globalThis.indexedDB
  } catch {
    return null
  }
}

export async function stableBookId(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  const hex = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return `book-${hex}`
}

export function titleFromFilename(filename: string): string {
  const leaf = filename.replaceAll('\\', '/').split('/').pop()?.replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]+/gu, ' ').replace(/\s+/gu, ' ').trim() ?? ''
  const withoutExtension = leaf.replace(/\.(?:pdf|txt)$/i, '').trim()
  return withoutExtension || leaf || 'Untitled'
}

function isBook(value: unknown): value is Book {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<Book>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.text === 'string' &&
    candidate.source === 'imported' &&
    Number.isFinite(candidate.importedAt)
  )
}

function sortBooks(books: Book[]): Book[] {
  return books.sort((left, right) => (
    (right.importedAt ?? 0) - (left.importedAt ?? 0) || left.title.localeCompare(right.title)
  ))
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest
    try {
      request = factory.open(DATABASE_NAME, DATABASE_VERSION)
    } catch (error) {
      reject(error)
      return
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
    request.onblocked = () => reject(new Error('IndexedDB open was blocked'))
  })
}

async function durablePut(factory: IDBFactory, book: Book): Promise<void> {
  const database = await openDatabase(factory)
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put(book)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB write failed'))
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB write aborted'))
    })
  } finally {
    database.close()
  }
}

async function durableList(factory: IDBFactory): Promise<{ books: Book[]; invalidRecordCount: number }> {
  const database = await openDatabase(factory)
  try {
    return await new Promise<{ books: Book[]; invalidRecordCount: number }>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const request = transaction.objectStore(STORE_NAME).getAll()
      request.onsuccess = () => {
        const books = request.result.filter(isBook)
        resolve({ books, invalidRecordCount: request.result.length - books.length })
      }
      request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'))
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB read aborted'))
    })
  } finally {
    database.close()
  }
}

async function durableRemove(factory: IDBFactory, bookId: string): Promise<void> {
  const database = await openDatabase(factory)
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).delete(bookId)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB delete failed'))
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB delete aborted'))
    })
  } finally {
    database.close()
  }
}

export function createBookStore(options: BookStoreOptions = {}): BookStore {
  const durable = options.indexedDB === undefined ? browserIndexedDB() : options.indexedDB
  const clock = options.clock ?? (() => Date.now())
  const session = new Map<string, Book>()
  const removedThisSession = new Set<string>()

  return {
    async importText(filename, text, metadata = {}) {
      const book: Book = {
        id: await stableBookId(text),
        title: titleFromFilename(filename),
        text,
        source: 'imported',
        importedAt: clock(),
        ...(metadata.columnsSuspected ? { columnsSuspected: true } : {}),
        ...(metadata.pageCharOffsets ? { pageCharOffsets: [...metadata.pageCharOffsets] } : {}),
      }
      removedThisSession.delete(book.id)
      session.set(book.id, book)
      let durability: Durability = 'session-only'
      if (durable) {
        try {
          await durablePut(durable, book)
          durability = 'durable'
        } catch {
          // The session copy remains usable if IndexedDB is unavailable,
          // blocked, corrupt, or full.
        }
      }
      return { book, durability }
    },

    async list() {
      let durability: Durability = 'session-only'
      let invalidRecordCount = 0
      if (durable) {
        try {
          const durableRecords = await durableList(durable)
          for (const book of durableRecords.books) {
            if (!removedThisSession.has(book.id) && !session.has(book.id)) session.set(book.id, book)
          }
          invalidRecordCount = durableRecords.invalidRecordCount
          durability = 'durable'
        } catch {
          // Fall through to the coherent in-memory view.
        }
      }
      return {
        books: sortBooks([...session.values()].filter(book => !removedThisSession.has(book.id))),
        durability,
        invalidRecordCount,
      }
    },

    async remove(bookId) {
      session.delete(bookId)
      removedThisSession.add(bookId)
      let durability: Durability = 'session-only'
      if (durable) {
        try {
          await durableRemove(durable, bookId)
          durability = 'durable'
        } catch {
          // A tombstone prevents a failed durable delete from resurrecting the
          // book during this session.
        }
      }
      return { durability }
    },
  }
}
