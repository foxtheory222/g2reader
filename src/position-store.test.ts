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
    createPositionStore(storage).save('alice', 4, 12)

    expect(JSON.parse(storage.getItem('g2reader:position:alice') ?? '')).toEqual({
      pageIndex: 4,
      pageCount: 12,
    })
  })

  it('keeps positions independent for each book', () => {
    const storage = new StorageStub()
    const store = createPositionStore(storage)
    store.save('alice', 3, 10)
    store.save('other', 7, 20)

    expect(store.restore('alice', 10)).toBe(3)
    expect(store.restore('other', 20)).toBe(7)
  })

  it('clamps restored positions to the current valid page range', () => {
    const storage = new StorageStub()
    const store = createPositionStore(storage)
    store.save('alice', 9, 10)

    expect(store.restore('alice', 4)).toBe(3)
    expect(store.restore('alice', 0)).toBe(0)
  })

  it('survives a reload represented by a new store over the same storage', () => {
    const storage = new StorageStub()
    createPositionStore(storage).save('alice', 2, 8)

    expect(createPositionStore(storage).restore('alice', 8)).toBe(2)
  })

  it('falls back safely for missing or malformed data', () => {
    const storage = new StorageStub()
    expect(createPositionStore(storage).restore('missing', 5)).toBe(0)

    storage.setItem('g2reader:position:alice', '{broken')
    expect(createPositionStore(storage).restore('alice', 5)).toBe(0)
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
      expect(() => store.save('alice', 3, 10)).not.toThrow()
      expect(store.restore('alice', 10)).toBe(3)
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

    expect(() => store.save('alice', 4, 12)).not.toThrow()
    expect(store.restore('alice', 12)).toBe(4)
  })

  it('keeps a newer session save authoritative when durable storage retains an older page', () => {
    const storage = new StorageStub()
    storage.setItem('g2reader:position:alice', JSON.stringify({ pageIndex: 2, pageCount: 10 }))
    const store = createPositionStore(storage)
    expect(store.restore('alice', 10)).toBe(2)

    storage.setItem = () => { throw new DOMException('full', 'QuotaExceededError') }
    store.save('alice', 5, 10)

    expect(store.restore('alice', 10)).toBe(5)
    expect(createPositionStore(storage).restore('alice', 10)).toBe(2)
  })

  it('seeds the authoritative session copy from a successful durable restore', () => {
    const storage = new StorageStub()
    storage.setItem('g2reader:position:alice', JSON.stringify({ pageIndex: 2, pageCount: 10 }))
    const store = createPositionStore(storage)

    expect(store.restore('alice', 10)).toBe(2)
    storage.setItem('g2reader:position:alice', JSON.stringify({ pageIndex: 7, pageCount: 10 }))
    expect(store.restore('alice', 10)).toBe(2)
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
    store.save('alice', pageIndex, pageCount)
    const saved = JSON.parse(storage.getItem('g2reader:position:alice') ?? '')
    expect(Number.isSafeInteger(saved.pageIndex)).toBe(true)
    expect(Number.isSafeInteger(saved.pageCount)).toBe(true)
    expect(saved.pageIndex).toBeGreaterThanOrEqual(0)
    expect(saved.pageCount).toBeGreaterThanOrEqual(0)
  })

  it.each(['null', '42', '"text"', 'true', '[]'])('rejects primitive/null JSON payload %s', raw => {
    const storage = new StorageStub()
    storage.setItem('g2reader:position:alice', raw)
    expect(createPositionStore(storage).restore('alice', 10)).toBe(0)
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
    expect(createPositionStore(storage).restore('alice', 10)).toBe(0)
  })
})
