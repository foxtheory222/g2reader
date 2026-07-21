import { describe, expect, it, vi } from 'vitest'
import { createUiCoordinator } from './ui-coordinator'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise })
  return { promise, resolve }
}

describe('UI coordinator', () => {
  it('rolls a failed library-to-reader transition back to consistent routing and display', async () => {
    let desiredScreen = 'library'
    let renderedScreen = 'library'
    const coordinator = createUiCoordinator(() => undefined)

    await expect(coordinator.runTransition({
      display: async () => { throw new Error('reader rebuild failed') },
      commit: () => {
        desiredScreen = 'reader'
        renderedScreen = 'reader'
      },
      rollback: () => {
        desiredScreen = renderedScreen
      },
    })).rejects.toThrow('reader rebuild failed')

    expect({ desiredScreen, renderedScreen }).toEqual({
      desiredScreen: 'library',
      renderedScreen: 'library',
    })
  })

  it('defers a companion mutation until an in-flight menu-open transition settles', async () => {
    const menuGate = deferred<void>()
    const events: string[] = []
    const pending = vi.fn()
    const coordinator = createUiCoordinator(pending)

    const menuOpen = coordinator.runTransition({
      display: async () => {
        events.push('menu:start')
        await menuGate.promise
        events.push('menu:displayed')
      },
      commit: () => { events.push('menu:commit') },
      rollback: () => { events.push('menu:rollback') },
    })
    const mutation = coordinator.runMutation(async () => { events.push('mutation') })

    await Promise.resolve()
    expect(events).toEqual(['menu:start'])
    expect(coordinator.pending).toBe(true)
    menuGate.resolve()
    await Promise.all([menuOpen, mutation])

    expect(events).toEqual(['menu:start', 'menu:displayed', 'menu:commit', 'mutation'])
    expect(pending.mock.calls).toEqual([[true], [false]])
  })
})
