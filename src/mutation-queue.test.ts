import { describe, expect, it, vi } from 'vitest'
import { createMutationQueue } from './mutation-queue'

describe('library mutation queue', () => {
  it('serializes mutations and stays pending until every queued mutation settles', async () => {
    const pending = vi.fn()
    const queue = createMutationQueue(pending)
    const order: string[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve })

    const first = queue.enqueue(async () => {
      order.push('first:start')
      await firstGate
      order.push('first:end')
    })
    const second = queue.enqueue(async () => { order.push('second') })

    await Promise.resolve()
    expect(queue.pending).toBe(true)
    expect(order).toEqual(['first:start'])
    expect(pending).toHaveBeenLastCalledWith(true)
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['first:start', 'first:end', 'second'])
    expect(queue.pending).toBe(false)
    expect(pending).toHaveBeenLastCalledWith(false)
  })
})
