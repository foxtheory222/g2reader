import { describe, expect, it, vi } from 'vitest'
import { createRenderQueue } from './render-queue'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('render queue', () => {
  it('recovers after a rejected write and commits only the later successful job', async () => {
    const writeBody = vi.fn()
      .mockRejectedValueOnce(new Error('bridge lost'))
      .mockResolvedValueOnce(true)
    const writeFooter = vi.fn().mockResolvedValue(true)
    const committed: number[] = []
    const queue = createRenderQueue({ writeBody, writeFooter, onCommit: (page: number) => committed.push(page) })

    await expect(queue.render({ body: 'one', footer: '1 / 2', state: 1 })).rejects.toThrow('bridge lost')
    await expect(queue.render({ body: 'two', footer: '2 / 2', state: 2 })).resolves.toBeUndefined()

    expect(committed).toEqual([2])
    expect(writeFooter).toHaveBeenCalledTimes(1)
  })

  it('treats false and partial body-only success as failures without publishing state', async () => {
    const committed: number[] = []
    const bodyFalse = createRenderQueue({
      writeBody: async () => false,
      writeFooter: async () => true,
      onCommit: (page: number) => committed.push(page),
    })
    await expect(bodyFalse.render({ body: 'one', footer: '1', state: 1 })).rejects.toThrow('body')

    const footerFalse = createRenderQueue({
      writeBody: async () => true,
      writeFooter: async () => false,
      onCommit: (page: number) => committed.push(page),
    })
    await expect(footerFalse.render({ body: 'two', footer: '2', state: 2 })).rejects.toThrow('footer')

    expect(committed).toEqual([])
  })

  it('times out a stuck bridge operation and continues with the next job', async () => {
    const writeBody = vi.fn()
      .mockImplementationOnce(() => new Promise<boolean>(() => undefined))
      .mockResolvedValueOnce(true)
    const queue = createRenderQueue({
      writeBody,
      writeFooter: async () => true,
      onCommit: () => undefined,
      timeoutMs: 20,
    })

    await expect(queue.render({ body: 'stuck', footer: '1', state: 1 })).rejects.toThrow(/timed out/i)
    await expect(queue.render({ body: 'recovered', footer: '2', state: 2 })).resolves.toBeUndefined()
  })

  it('serializes rapid jobs and commits each immutable page state in glasses order', async () => {
    const firstBody = deferred<boolean>()
    const writes: string[] = []
    const committed: number[] = []
    const writeBody = vi.fn(async (content: string) => {
      writes.push(`body:${content}`)
      if (content === 'page one') return firstBody.promise
      return true
    })
    const writeFooter = vi.fn(async (content: string) => {
      writes.push(`footer:${content}`)
      return true
    })
    const queue = createRenderQueue({ writeBody, writeFooter, onCommit: (page: number) => committed.push(page) })

    const first = queue.render({ body: 'page one', footer: '1 / 2', state: 1 })
    const second = queue.render({ body: 'page two', footer: '2 / 2', state: 2 })
    await Promise.resolve()
    expect(writes).toEqual(['body:page one'])

    firstBody.resolve(true)
    await Promise.all([first, second])
    expect(writes).toEqual(['body:page one', 'footer:1 / 2', 'body:page two', 'footer:2 / 2'])
    expect(committed).toEqual([1, 2])
  })

  it('serializes shutdown, suppresses navigation while pending, and permits retry after failure', async () => {
    const body = deferred<boolean>()
    const events: string[] = []
    const queue = createRenderQueue({
      writeBody: async () => {
        events.push('body')
        return body.promise
      },
      writeFooter: async () => {
        events.push('footer')
        return true
      },
      onCommit: () => events.push('commit'),
    })

    const render = queue.render({ body: 'page', footer: '1', state: 1 })
    const shutdown = queue.requestShutdown(async () => {
      events.push('shutdown')
      return false
    })
    expect(queue.exitPending).toBe(true)
    await expect(queue.render({ body: 'ignored', footer: '2', state: 2 })).rejects.toThrow(/exit pending/i)

    body.resolve(true)
    await render
    await expect(shutdown).rejects.toThrow(/shutdown/i)
    expect(events).toEqual(['body', 'footer', 'commit', 'shutdown'])
    expect(queue.exitPending).toBe(false)
    await expect(queue.requestShutdown(async () => true)).resolves.toBeUndefined()
  })

  it('stops queued UI work after a host-confirmed exit', async () => {
    const body = deferred<boolean>()
    const writeFooter = vi.fn().mockResolvedValue(true)
    const queue = createRenderQueue({
      writeBody: async () => body.promise,
      writeFooter,
      onCommit: () => undefined,
    })

    const inFlight = queue.render({ body: 'page', footer: '1', state: 1 })
    queue.confirmHostExit()
    body.resolve(true)

    await expect(inFlight).rejects.toThrow(/host exit/i)
    expect(writeFooter).not.toHaveBeenCalled()
    await expect(queue.render({ body: 'later', footer: '2', state: 2 })).rejects.toThrow(/host exit/i)
  })
})
