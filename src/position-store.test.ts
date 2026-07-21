import { describe, expect, it } from 'vitest'
import { createPositionStore } from './position-store'

class StorageStub implements Storage {
  private values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

describe('position store', () => {
  it('stores page index and page count under a per-book key', () => {
    const storage = new StorageStub()
    createPositionStore(storage).save('alice', 4, 12, 6)

    expect(JSON.parse(storage.getItem('g2reader:position:alice') ?? '')).toEqual({
      pageIndex: 4,
      pageCount: 12,
      density: 6,
    })
  })

  it('keeps positions independent for each book', () => {
    const storage = new StorageStub()
    const store = createPositionStore(storage)
    store.save('alice', 3, 10, 6)
    store.save('other', 7, 20, 6)

    expect(store.restore('alice', 10, 6)).toBe(3)
    expect(store.restore('other', 20, 6)).toBe(7)
  })

  it('clamps restored positions to the current valid page range', () => {
    const storage = new StorageStub()
    const store = createPositionStore(storage)
    store.save('alice', 9, 10, 6)

    expect(store.restore('alice', 4, 6)).toBe(3)
    expect(store.restore('alice', 0, 6)).toBe(0)
  })

  it('survives a reload represented by a new store over the same storage', () => {
    const storage = new StorageStub()
    createPositionStore(storage).save('alice', 2, 8, 6)

    expect(createPositionStore(storage).restore('alice', 8, 6)).toBe(2)
  })

  it('falls back safely for missing or malformed data', () => {
    const storage = new StorageStub()
    expect(createPositionStore(storage).restore('missing', 5, 6)).toBe(0)

    storage.setItem('g2reader:position:alice', '{broken')
    expect(createPositionStore(storage).restore('alice', 5, 6)).toBe(0)
  })

  it('survives a throwing localStorage getter', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError')
      },
    })
    try {
      const store = createPositionStore()
      expect(() => store.save('alice', 3, 10, 6)).not.toThrow()
      expect(store.restore('alice', 10, 6)).toBe(3)
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
      else Reflect.deleteProperty(globalThis, 'localStorage')
    }
  })

  it('uses its in-memory fallback when getItem or setItem throws', () => {
    const throwing = new StorageStub()
    throwing.getItem = () => { throw new DOMException('denied', 'SecurityError') }
    throwing.setItem = () => { throw new DOMException('full', 'QuotaExceededError') }
    const store = createPositionStore(throwing)

    expect(() => store.save('alice', 4, 12, 6)).not.toThrow()
    expect(store.restore('alice', 12, 6)).toBe(4)
  })

  it('keeps a newer session save authoritative when durable storage retains an older page', () => {
    const storage = new StorageStub()
    storage.setItem('g2reader:position:alice', JSON.stringify({ pageIndex: 2, pageCount: 10 }))
    const store = createPositionStore(storage)
    expect(store.restore('alice', 10, 6)).toBe(2)

    storage.setItem = () => { throw new DOMException('full', 'QuotaExceededError') }
    store.save('alice', 5, 10, 6)

    expect(store.restore('alice', 10, 6)).toBe(5)
    expect(createPositionStore(storage).restore('alice', 10, 6)).toBe(2)
  })

  it('seeds the authoritative session copy from a successful durable restore', () => {
    const storage = new StorageStub()
    storage.setItem('g2reader:position:alice', JSON.stringify({ pageIndex: 2, pageCount: 10 }))
    const store = createPositionStore(storage)

    expect(store.restore('alice', 10, 6)).toBe(2)
    storage.setItem('g2reader:position:alice', JSON.stringify({ pageIndex: 7, pageCount: 10 }))
    expect(store.restore('alice', 10, 6)).toBe(2)
  })

  it.each([
    [Number.NaN, 10],
    [Number.POSITIVE_INFINITY, 10],
    [Number.NEGATIVE_INFINITY, 10],
    [-1, 10],
    [1.5, 10],
    [Number.MAX_SAFE_INTEGER + 1, 10],
    [2, Number.NaN],
    [2, Number.POSITIVE_INFINITY],
    [2, -1],
    [2, 1.5],
    [2, Number.MAX_SAFE_INTEGER + 1],
  ])('normalizes unsafe save boundary values page=%s count=%s', (pageIndex, pageCount) => {
    const storage = new StorageStub()
    const store = createPositionStore(storage)
    store.save('alice', pageIndex, pageCount, 6)
    const saved = JSON.parse(storage.getItem('g2reader:position:alice') ?? '')
    expect(Number.isSafeInteger(saved.pageIndex)).toBe(true)
    expect(Number.isSafeInteger(saved.pageCount)).toBe(true)
    expect(saved.pageIndex).toBeGreaterThanOrEqual(0)
    expect(saved.pageCount).toBeGreaterThanOrEqual(0)
  })

  it.each(['null', '42', '"text"', 'true', '[]'])('rejects primitive/null JSON payload %s', raw => {
    const storage = new StorageStub()
    storage.setItem('g2reader:position:alice', raw)
    expect(createPositionStore(storage).restore('alice', 10, 6)).toBe(0)
  })

  it.each([
    { pageIndex: Number.NaN, pageCount: 10 },
    { pageIndex: Number.POSITIVE_INFINITY, pageCount: 10 },
    { pageIndex: -1, pageCount: 10 },
    { pageIndex: 1.5, pageCount: 10 },
    { pageIndex: Number.MAX_SAFE_INTEGER + 1, pageCount: 10 },
    { pageIndex: 2, pageCount: -1 },
  ])('rejects invalid stored numeric payload %#', value => {
    const storage = new StorageStub()
    storage.setItem('g2reader:position:alice', JSON.stringify(value))
    expect(createPositionStore(storage).restore('alice', 10, 6)).toBe(0)
  })

  it('remaps relative progress when density changes across growing and shrinking page counts', () => {
    const storage = new StorageStub()
    const store = createPositionStore(storage)
    store.save('grow', 2, 5, 8)
    store.save('shrink', 6, 9, 5)

    expect(store.restore('grow', 9, 6)).toBe(4)
    expect(store.restore('shrink', 5, 6)).toBe(3)
  })

  it('maps either side of a one-page density change to page zero', () => {
    const storage = new StorageStub()
    const store = createPositionStore(storage)
    store.save('old-single', 0, 1, 8)
    store.save('new-single', 4, 5, 8)

    expect(store.restore('old-single', 7, 6)).toBe(0)
    expect(store.restore('new-single', 1, 6)).toBe(0)
  })

  it('migrates old records by treating their missing density as the old eight-line layout', () => {
    const storage = new StorageStub()
    storage.setItem('g2reader:position:alice', JSON.stringify({ pageIndex: 4, pageCount: 9 }))

    expect(createPositionStore(storage).restore('alice', 5, 6)).toBe(2)
  })

  it('does not relative-remap ordinary page-count drift at the same density', () => {
    const storage = new StorageStub()
    const store = createPositionStore(storage)
    store.save('alice', 7, 10, 6)

    expect(store.restore('alice', 20, 6)).toBe(7)
  })
})
