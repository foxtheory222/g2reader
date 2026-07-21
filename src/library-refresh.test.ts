import { describe, expect, it, vi } from 'vitest'
import { createLibraryRefreshCoordinator } from './library-refresh'

describe('pending structural library refresh', () => {
  it.each([
    ['import', ['Alice'], ['Alice', 'Notes']],
    ['removal', ['Alice', 'Notes'], ['Alice']],
  ])('publishes %s truth immediately and retries glasses routing before the next input', async (_kind, initial, changed) => {
    let phoneBooks: readonly string[] = initial
    let routedBooks: readonly string[] = initial
    const rebuild = vi.fn()
      .mockRejectedValueOnce(new Error('bridge unavailable'))
      .mockResolvedValueOnce(undefined)
    const refresh = createLibraryRefreshCoordinator<readonly string[]>({
      publishCompanion: snapshot => { phoneBooks = snapshot },
      displayStructural: rebuild,
      commitRouting: snapshot => { routedBooks = snapshot },
    })

    await expect(refresh.stage(changed)).rejects.toThrow('bridge unavailable')
    expect(phoneBooks).toEqual(changed)
    expect(routedBooks).toEqual(initial)
    expect(refresh.pending).toBe(true)

    const acted = vi.fn()
    if (await refresh.retry()) acted(routedBooks)

    expect(rebuild).toHaveBeenCalledTimes(2)
    expect(routedBooks).toEqual(changed)
    expect(acted).toHaveBeenCalledWith(changed)
    expect(refresh.pending).toBe(false)
  })
})
