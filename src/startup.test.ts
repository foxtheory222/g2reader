import { describe, expect, it, vi } from 'vitest'
import { initializeStartup } from './startup'

describe('startup coordination', () => {
  it('subscribes only after successful startup creation and then announces readiness', async () => {
    const order: string[] = []
    const unsubscribe = vi.fn()
    const result = await initializeStartup({
      create: async () => {
        order.push('create')
        return 0
      },
      subscribe: () => {
        order.push('subscribe')
        return unsubscribe
      },
      onReady: () => order.push('ready'),
      onFailed: () => order.push('failed'),
    })

    expect(order).toEqual(['create', 'subscribe', 'ready'])
    expect(result).toBe(unsubscribe)
  })

  it.each([1, 2, 3])('emits failure %s, refuses subscription, and never announces ready', async code => {
    const subscribe = vi.fn(() => () => undefined)
    const ready = vi.fn()
    const failed = vi.fn()

    await expect(initializeStartup({
      create: async () => code,
      subscribe,
      onReady: ready,
      onFailed: failed,
    })).resolves.toBeNull()

    expect(subscribe).not.toHaveBeenCalled()
    expect(ready).not.toHaveBeenCalled()
    expect(failed).toHaveBeenCalledWith(code)
  })

  it('reports a rejected startup as failure and does not route input', async () => {
    const error = new Error('native bridge unavailable')
    const subscribe = vi.fn(() => () => undefined)
    const failed = vi.fn()

    await expect(initializeStartup({
      create: async () => Promise.reject(error),
      subscribe,
      onReady: () => undefined,
      onFailed: failed,
    })).resolves.toBeNull()

    expect(subscribe).not.toHaveBeenCalled()
    expect(failed).toHaveBeenCalledWith(error)
  })
})
