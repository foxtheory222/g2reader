import { describe, expect, it, vi } from 'vitest'
import { createPositionStore } from './position-store'
import { createConfirmedRenderSnapshot, persistConfirmedPosition } from './reader-runtime'
import { createRenderQueue } from './render-queue'

class StorageStub implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise })
  return { promise, resolve }
}

describe('confirmed reader render snapshots', () => {
  it('keeps density and page count immutable when the source state changes', () => {
    const state = { screen: 'menu', activeBookId: 'alice', pageIndex: 4 }
    const snapshot = createConfirmedRenderSnapshot({
      state,
      body: 'menu',
      footer: '50%',
      bookId: 'alice',
      pageIndex: 4,
      pageCount: 9,
      density: 6,
      progressStyle: 'percent',
    })

    state.pageIndex = 8

    expect(snapshot.state.pageIndex).toBe(4)
    expect(snapshot.pageCount).toBe(9)
    expect(snapshot.density).toBe(6)
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.state)).toBe(true)
  })

  it('keeps the confirmed position unchanged when an in-flight render precedes a failed density rebuild', async () => {
    const storage = new StorageStub()
    const positions = createPositionStore(storage)
    positions.save('alice', 4, 9, 6)
    const bodyGate = deferred<boolean>()
    const queue = createRenderQueue({
      writeBody: () => bodyGate.promise,
      writeFooter: async () => true,
      onCommit: persistConfirmedPosition(positions),
    })
    const oldMenuSnapshot = createConfirmedRenderSnapshot({
      state: { screen: 'menu', activeBookId: 'alice', pageIndex: 4 },
      body: 'old menu cursor',
      footer: '50%',
      bookId: 'alice',
      pageIndex: 4,
      pageCount: 9,
      density: 6,
      progressStyle: 'percent',
    })

    const render = queue.render({ body: oldMenuSnapshot.body, footer: oldMenuSnapshot.footer, state: oldMenuSnapshot })
    const failedDensity = queue.structural(async () => false)
    bodyGate.resolve(true)

    await expect(render).resolves.toBe('committed')
    await expect(failedDensity).rejects.toThrow(/structural/i)
    expect(JSON.parse(storage.getItem('g2reader:position:alice') ?? '')).toEqual({
      pageIndex: 4,
      pageCount: 9,
      density: 6,
    })
  })

  it('never lets a late old-density commit borrow a new mutable page count', () => {
    const storage = new StorageStub()
    const positions = createPositionStore(storage)
    let mutableDensity = 8
    let mutablePageCount = 5
    const save = vi.spyOn(positions, 'save')
    const oldSnapshot = createConfirmedRenderSnapshot({
      state: { screen: 'reader', activeBookId: 'alice', pageIndex: 7 },
      body: 'old page',
      footer: '88%',
      bookId: 'alice',
      pageIndex: 7,
      pageCount: 9,
      density: 6,
      progressStyle: 'percent',
    })

    persistConfirmedPosition(positions)(oldSnapshot)

    expect([mutableDensity, mutablePageCount]).toEqual([8, 5])
    expect(save).toHaveBeenCalledWith('alice', 7, 9, 6)
  })
})
