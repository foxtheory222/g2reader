import { describe, expect, it } from 'vitest'
import { createSettingsStore } from './settings-store'

class StorageStub implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

describe('settings store', () => {
  it('defaults to percent progress, six lines, and no last active book', () => {
    expect(createSettingsStore(new StorageStub()).read()).toEqual({
      progressStyle: 'percent',
      density: 6,
      lastActiveBookId: null,
    })
  })

  it('persists per-app settings across store instances', () => {
    const storage = new StorageStub()
    const store = createSettingsStore(storage)
    store.update({ progressStyle: 'hidden', density: 8, lastActiveBookId: 'book-1' })

    expect(JSON.parse(storage.getItem('g2reader:settings') ?? '')).toEqual({
      progressStyle: 'hidden',
      density: 8,
      lastActiveBookId: 'book-1',
    })
    expect(createSettingsStore(storage).read()).toEqual({
      progressStyle: 'hidden',
      density: 8,
      lastActiveBookId: 'book-1',
    })
  })

  it('normalizes malformed fields independently', () => {
    const storage = new StorageStub()
    storage.setItem('g2reader:settings', JSON.stringify({
      progressStyle: 'time-left', density: 7, lastActiveBookId: 42,
    }))
    expect(createSettingsStore(storage).read()).toEqual({
      progressStyle: 'percent', density: 6, lastActiveBookId: null,
    })
  })

  it('keeps a non-throwing authoritative session fallback', () => {
    const storage = new StorageStub()
    storage.getItem = () => { throw new DOMException('denied', 'SecurityError') }
    storage.setItem = () => { throw new DOMException('full', 'QuotaExceededError') }
    const store = createSettingsStore(storage)

    expect(() => store.update({ density: 5, lastActiveBookId: 'alice' })).not.toThrow()
    expect(store.read()).toEqual({ progressStyle: 'percent', density: 5, lastActiveBookId: 'alice' })
  })

  it('survives a throwing localStorage getter', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('denied', 'SecurityError') },
    })
    try {
      const store = createSettingsStore()
      expect(() => store.update({ progressStyle: 'page', density: 8 })).not.toThrow()
      expect(store.read()).toEqual({
        progressStyle: 'page', density: 8, lastActiveBookId: null,
      })
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
      else Reflect.deleteProperty(globalThis, 'localStorage')
    }
  })
})
