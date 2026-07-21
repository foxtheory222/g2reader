import { describe, expect, it, vi } from 'vitest'
import type { Book } from './book-store'
import { stageActiveBookPageCache } from './page-cache'
import { createPositionStore } from './position-store'
import type { Density } from './reader-ui'

const activeBook: Book = { id: 'active', title: 'Active', text: 'active text', source: 'imported' }
const lazyBook: Book = { id: 'lazy', title: 'Lazy', text: 'lazy text', source: 'imported' }

describe('density-change page cache', () => {
  it('stages only the active book and lazily paginates dropped books at the new density', () => {
    const pagesFor = vi.fn((book: Book, density: Density, cache: Map<string, string[]>) => {
      const cached = cache.get(book.id)
      if (cached) return cached
      const pages = Array.from({ length: book.id === 'active' ? 13 : 17 }, (_, index) => (
        `${book.id}-${density}-${index}`
      ))
      cache.set(book.id, pages)
      return pages
    })

    const staged = stageActiveBookPageCache(activeBook, 8, pagesFor)

    expect([...staged.keys()]).toEqual(['active'])
    expect(pagesFor).toHaveBeenCalledTimes(1)
    expect(staged.has('lazy')).toBe(false)

    const lazyPages = pagesFor(lazyBook, 8, staged)
    expect(lazyPages).toHaveLength(17)
    expect(staged.has('lazy')).toBe(true)
    expect(pagesFor).toHaveBeenLastCalledWith(lazyBook, 8, staged)
  })

  it('relative-remaps a lazily repaginated book from its stored old-density position', () => {
    const positions = createPositionStore(null)
    positions.save(lazyBook.id, 4, 9, 6)

    const staged = stageActiveBookPageCache(activeBook, 8, (book, density, cache) => {
      const pages = Array.from({ length: 13 }, (_, index) => `${book.id}-${density}-${index}`)
      cache.set(book.id, pages)
      return pages
    })
    const lazyPages = Array.from({ length: 17 }, (_, index) => `lazy-8-${index}`)
    staged.set(lazyBook.id, lazyPages)

    expect(positions.restore(lazyBook.id, lazyPages.length, 8)).toBe(8)
  })
})
